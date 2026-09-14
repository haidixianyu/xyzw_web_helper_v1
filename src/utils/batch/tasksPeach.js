/**
 * 蟠桃园战场实时监控与操作
 *
 * 命令簇: payload_* (2026-08-21 源码核实, PayloadService)
 *  - legion_getpayloadbf {}                          获取战场数据(含 bfId/cars/players)
 *  - payload_enterbf      { bfId }                   进战场
 *  - payload_ping         { bfId }                   心跳
 *  - payload_setbattleteam { bfId, battleTeam, lordWeaponId, petUId }
 *  - payload_getteaminfo   { bfId, roleId }          查询队伍(响应含 weaponId/petUId/team)
 *  - payload_startmarch   { bfId, carId, path }      行军, carId=0 自己, path=[{x,y}...](首元素为当前坐标)
 *  - payload_startbattle  { bfId, targetId }         攻击目标(roleId)
 *  - payload_cancelmarch  { bfId }                   取消行军
 *  - payload_useitem      { bfId, carId }            对船使用道具
 *
 * 复活机制(源码核实): 角色带 sleepTime 字段(复活绝对时间戳ms),
 * state=die/watching 即阵亡, 到点自动复活; 仅 idle/march 可发起攻击。
 *
 * 时钟校准: XyzwWebSocketClient 对响应包 time 字段做 EMA 偏移估计(getServerTime())。
 *
 * 日志: 全部经页面 addLog 写入 IndexedDB 小时分块(LOG_CHUNK_PREFIX),
 * 与盐场同管道持久化, 事后可精确回溯定位问题。
 */
import { sleep } from "../helperTaskRunner.js";

const PEACH_POLL_INTERVAL = 3000; // 战场轮询间隔
const PING_INTERVAL = 15000; // 心跳间隔

/** 统一日志格式 */
function log(addLog, name, message, type = "info") {
  addLog({ time: new Date().toLocaleTimeString(), message: `${name} ${message}`, type });
}

/**
 * 从 legion_getpayloadbf 响应中提取战场对象与 bfId
 * 记录字段探测过程便于排查结构不符
 */
function extractBattlefield(res, addLog, name) {
  const candidates = [
    ["res.battlefield", res?.battlefield],
    ["res.data.battlefield", res?.data?.battlefield],
    ["res.body.battlefield", res?.body?.battlefield],
    // 实测响应顶层为 [info, ended, roleBfState, legions], 战场数据在 info 下
    ["res.info", res?.info],
    ["res 自身", res],
  ];
  for (const [label, data] of candidates) {
    if (!data) continue;
    const bfId = Number(data.id ?? data.bfId ?? data.battlefieldId ?? 0);
    if (bfId > 0) {
      if (label !== "res 自身") {
        log(addLog, name, `战场数据取自 ${label}, bfId=${bfId}`);
      }
      // 船只/玩家字段可能在顶层(如 res.cars)而非 info 内, 合并保证解析器可见
      const raw = data === res ? res : { ...res, ...data };
      return { bfId, raw };
    }
  }
  // 全部失败: 输出顶层字段名帮助定位真实结构
  const keys = res && typeof res === "object" ? Object.keys(res).slice(0, 15).join(",") : typeof res;
  log(addLog, name, `未解析出 bfId! 响应顶层字段: [${keys}]`, "error");
  return null;
}

/**
 * 解析蟠桃船列表 (兼容多种字段命名), 返回列表+实际命中的字段名
 */
export function parsePeachShips(bf) {
  let hitField = "";
  let shipsRaw = null;
  for (const [field, val] of Object.entries({
    carDataMap: bf?.carDataMap,
    cars: bf?.cars,
    carDatas: bf?.carDatas,
    carData: bf?.carData,
  })) {
    if (val) {
      shipsRaw =
        val instanceof Map ? Object.fromEntries(val) : val;
      hitField = field;
      break;
    }
  }
  if (!shipsRaw) return { ships: [], hitField };
  const list = Array.isArray(shipsRaw) ? shipsRaw : Object.values(shipsRaw);
  const ships = list.map((ship) => ({
    shipId: ship.carId ?? ship.id,
    position: { x: ship.x ?? ship.position?.x ?? 0, y: ship.y ?? ship.position?.y ?? 0 },
    progress: ship.progress ?? ship.schedule ?? 0,
    controlLegionId: ship.legionId ?? ship.controlLegionId ?? 0,
    hp: ship.hp ?? 0,
    maxHp: ship.maxHp ?? ship.hp ?? 0,
    defenders: ship.roleIds || ship.defenders || [],
  }));
  return { ships, hitField };
}

/**
 * 解析全部玩家角色, 返回列表+实际命中的字段名
 */
export function parsePlayers(bf) {
  let hitField = "";
  let playersRaw = null;
  for (const [field, val] of Object.entries({
    players: bf?.players,
    roles: bf?.roles,
    roleMap: bf?.roleMap,
  })) {
    if (val) {
      playersRaw = val instanceof Map ? Object.fromEntries(val) : val;
      hitField = field;
      break;
    }
  }
  if (!playersRaw) return { players: [], hitField };
  const list = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
  const players = list.map((p) => {
    const state = p.state ?? p.roleState ?? "";
    const sleepTime = Number(p.sleepTime ?? 0);
    const hp = p.hp ?? 0;
    const isDead =
      state === "die" || state === "watching" ||
      (state === "" && hp <= 0);
    return {
      roleId: Number(p.roleId ?? p.id),
      legionId: p.legionId ?? p.legionID ?? 0,
      hp,
      maxHp: p.maxHp ?? p.maxhp ?? 0,
      position: { x: p.x ?? p.position?.x ?? 0, y: p.y ?? p.position?.y ?? 0 },
      carId: p.carId ?? null,
      state,
      sleepTime,
      isDead,
    };
  });
  return { players, hitField };
}

/** 发送命令并等待响应, 记录命令与耗时; 失败抛出并记录 */
async function sendCmd(tokenStore, tokenId, cmd, params, addLog, name, timeout = 8000) {
  const t0 = Date.now();
  try {
    const res = await tokenStore.sendMessageWithPromise(tokenId, cmd, params, timeout);
    const ms = Date.now() - t0;
    const brief = summarizeResponse(res);
    log(addLog, name, `[${cmd}] 参数=${JSON.stringify(params)} → ${ms}ms 响应=${brief}`);
    return res;
  } catch (e) {
    const ms = Date.now() - t0;
    log(addLog, name, `[${cmd}] 参数=${JSON.stringify(params)} → ${ms}ms 失败: ${e.message}`, "error");
    throw e;
  }
}

/** 响应摘要: 截断长对象, 保留 code/顶层键 */
function summarizeResponse(res) {
  if (res == null) return "null";
  if (typeof res !== "object") return JSON.stringify(res).slice(0, 120);
  const keys = Object.keys(res).slice(0, 10);
  const codePart = res.code !== undefined ? `code=${res.code}` : "";
  return `${codePart} keys=[${keys.join(",")}]`.trim();
}

/**
 * 设置出战阵容 (含宠物)
 */
export async function deployTeam(tokenStore, tokenId, bfId, roleId, addLog, name) {
  try {
    log(addLog, name, `[阵容] 查询当前队伍 roleId=${roleId}...`);
    const teamRes = await sendCmd(
      tokenStore, tokenId, "payload_getteaminfo", { bfId, roleId }, addLog, name,
    );
    const teamInfo = teamRes?.teamInfo || teamRes?.data?.teamInfo || teamRes;
    const battleTeam = teamInfo?.team || teamInfo?.battleTeam || {};
    const lordWeaponId = Number(teamInfo?.weaponId ?? teamInfo?.lordWeaponId ?? 0);
    const petUId = String(teamInfo?.petUId ?? "");
    const teamSize =
      battleTeam instanceof Map ? battleTeam.size :
      typeof battleTeam === "object" ? Object.keys(battleTeam).length : 0;

    log(addLog, name,
      `[阵容] 查询结果: 队伍槽位=${teamSize} 武器=${lordWeaponId} 宠物=${petUId || "(空)"}` +
      (petUId === "" ? " ⚠宠物ID为空, 若游戏内有宠物请抓包核对 getteaminfo 响应字段" : ""),
      petUId === "" ? "warning" : "info");

    await sendCmd(
      tokenStore, tokenId, "payload_setbattleteam",
      { bfId, battleTeam, lordWeaponId, petUId }, addLog, name,
    );
    log(addLog, name, `[阵容] 同步成功 (武器:${lordWeaponId} 宠物:${petUId || "无"})`, "success");
    return true;
  } catch (e) {
    log(addLog, name, `[阵容] 设阵容失败: ${e.message}`, "warning");
    return false;
  }
}

/**
 * 行军到目标坐标
 * path 首元素须为当前坐标 (源码 unshift)
 */
export async function marchTo(tokenStore, tokenId, bfId, selfPos, targetPos, addLog, name) {
  const path = [
    { x: selfPos.x, y: selfPos.y },
    { x: targetPos.x, y: targetPos.y },
  ];
  log(addLog, name,
    `[行军] (${selfPos.x},${selfPos.y}) → (${targetPos.x},${targetPos.y})`);
  return sendCmd(
    tokenStore, tokenId, "payload_startmarch",
    { bfId, carId: 0, path }, addLog, name,
  );
}

/**
 * 蟠桃园主循环
 */
export async function runPeachBattle(options) {
  const {
    tokenStore,
    tokenId,
    roleId,
    name,
    addLog,
    shouldStop,
    commandDelay = 500, // 命令间延时(ms)
    pollInterval = PEACH_POLL_INTERVAL, // 战场轮询间隔(ms)
    contestEnemy = true, // 是否抢夺敌方控制的船
    noAttackPlayers = false, // 只上船不打人(小号打不过别人): 不攻击玩家, 可上船(含敌方船)
    targetStrategy = "progress", // 目标船策略: progress=进度最高 | nearest=距离最近
    autoResurrect = true, // 阵亡后按服务端 sleepTime 等待自动复活
    onBattlefieldUpdate,
  } = options;

  /** 两点距离平方(目标策略 nearest 排序用) */
  const sqDist = (a, b) => {
    if (!a || !b) return Number.MAX_SAFE_INTEGER;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  let currentTargetShipId = null;
  let lastPingAt = 0;
  let deployed = false;
  let loopCount = 0;

  // 服务器时间校准信息
  const getClient = () => tokenStore.getWebSocketClient?.(tokenId) || null;
  const serverNow = () => {
    const client = getClient();
    return client && typeof client.getServerTime === "function"
      ? client.getServerTime()
      : Date.now();
  };

  // roleId 缺失时从 role_getroleinfo 回退获取
  let rid = Number(roleId || 0);
  if (!rid) {
    log(addLog, name, "token 无 roleId, 尝试 role_getroleinfo 回退获取...");
    try {
      const info = await tokenStore.sendGetRoleInfo(tokenId);
      const roleData = info?.role || info?.roleInfo;
      rid = Number(roleData?.roleId ?? 0);
      log(addLog, name, `回退获取 roleId=${rid}`, rid > 0 ? "success" : "error");
    } catch (e) {
      log(addLog, name, `获取 roleId 失败: ${e.message}`, "error");
    }
  }
  if (!rid) {
    log(addLog, name, "无有效 roleId, 无法监控战场", "error");
    return;
  }

  log(addLog, name,
    `=== 蟠桃园监控启动 === roleId=${rid} 抢夺敌船=${contestEnemy ? "开" : "关"}` +
    ` 只上船不打人=${noAttackPlayers ? "开" : "关"}` +
    ` 目标策略=${targetStrategy === "nearest" ? "距离最近" : "进度最高"}` +
    ` 自动复活=${autoResurrect ? "开" : "关"} 轮询=${pollInterval}ms 延时=${commandDelay}ms`);

  while (!shouldStop()) {
    loopCount++;
    try {
      // 1. 获取战场数据
      const bfRes = await sendCmd(tokenStore, tokenId, "legion_getpayloadbf", {}, addLog, name);
      const bf = extractBattlefield(bfRes, addLog, name);
      if (!bf) {
        log(addLog, name, `第${loopCount}轮 无法获取战场(活动未开启/已结束/结构变化), 稍后重试`, "warn");
        await sleep(pollInterval);
        continue;
      }
      const { bfId, raw } = bf;

      // 2. 首次进战场 + 同步阵容
      if (!deployed) {
        await sendCmd(tokenStore, tokenId, "payload_enterbf", { bfId }, addLog, name);
        log(addLog, name, `[进场] payload_enterbf 成功 (bfId:${bfId})`, "success");
        await sleep(commandDelay);
        await deployTeam(tokenStore, tokenId, bfId, rid, addLog, name);
        deployed = true;
      }

      // 3. 心跳保活
      if (Date.now() - lastPingAt > PING_INTERVAL) {
        const offset = getClient()?.serverTimeOffset;
        sendCmd(tokenStore, tokenId, "payload_ping", { bfId }, addLog, name).catch(() => {});
        if (offset != null && loopCount % 20 === 1) {
          log(addLog, name, `[时钟] 服务器时间偏移 ${Math.round(offset)}ms (EMA)`);
        }
        lastPingAt = Date.now();
      }

      // 4. 解析战场
      const { ships, hitField: shipField } = parsePeachShips(raw);
      const { players, hitField: playerField } = parsePlayers(raw);
      const self = players.find((p) => p.roleId === rid) || null;

      // 结构探测日志: 仅前几轮输出, 避免刷屏
      if (loopCount <= 3) {
        log(addLog, name,
          `[解析] 第${loopCount}轮 船只字段=${shipField || "(未命中!)"} 共${ships.length}艘;` +
          ` 玩家字段=${playerField || "(未命中!)"} 共${players.length}人;` +
          ` self=${self ? "✓" : "✗ 未找到"}`);
        if (loopCount === 1 && ships.length > 0) {
          log(addLog, name,
            `[解析] 首船样例: ${JSON.stringify(ships[0]).slice(0, 300)}`);
        }
        if (loopCount === 1 && !self && players.length > 0) {
          log(addLog, name,
            `[解析] 首玩家样例: ${JSON.stringify(players[0]).slice(0, 300)}`);
        }
      }

      if (onBattlefieldUpdate) {
        onBattlefieldUpdate({ ships, players, self, bfId, raw });
      }

      if (ships.length > 0 && loopCount % 10 === 1) {
        const summary = ships
          .map((s) => `#${s.shipId}[${s.progress}% 军团:${s.controlLegionId || "无"}]`)
          .join(" ");
        log(addLog, name, `船况: ${summary}`);
      }

      // 5. 阵亡等待
      if (self && self.isDead) {
        if (!autoResurrect) {
          log(addLog, name,
            `[复活] 阵亡(state=${self.state}) 且未开启自动复活, 结束监控`, "warning");
          break;
        }
        let remainMs = self.sleepTime > 0 ? self.sleepTime - serverNow() : pollInterval;
        if (!Number.isFinite(remainMs) || remainMs < 0) remainMs = 0;
        const waitMs = Math.min(remainMs + 500, 30000);
        log(addLog, name,
          `[复活] 阵亡(state=${self.state}) sleepTime=${self.sleepTime}` +
          ` 服务器now=${serverNow()} 剩余=${remainMs}ms` +
          ` → 等待 ${waitMs}ms`,
          remainMs > 5000 ? "info" : "info");
        await sleep(Math.max(waitMs, 1000));
        continue;
      }

      // 6. 目标选择
      let activeShips = ships.filter((s) => s.progress < 100);
      // 只上船不打人: 不限制目标(可上敌方船), 仅在决策阶段跳过攻击
      if (!contestEnemy && self?.legionId) {
        const own = activeShips.filter((s) => s.controlLegionId === self.legionId);
        if (own.length > 0) activeShips = own;
      }

      if (currentTargetShipId) {
        const cur = ships.find((s) => s.shipId === currentTargetShipId);
        if (!cur || cur.progress >= 100) {
          log(addLog, name, `[目标] 船 #${currentTargetShipId} 已送达(progress=${cur?.progress}), 重选`);
          currentTargetShipId = null;
        }
      }

      if (!currentTargetShipId && activeShips.length > 0) {
        const best =
          targetStrategy === "nearest" && self?.position
            ? [...activeShips].sort(
                (a, b) => sqDist(self.position, a.position) - sqDist(self.position, b.position),
              )[0]
            : [...activeShips].sort((a, b) => b.progress - a.progress)[0];
        currentTargetShipId = best.shipId;
        const mine = best.controlLegionId === self?.legionId;
        log(addLog, name,
          `[目标] 候选${activeShips.length}艘(未送达${contestEnemy ? ",含敌方" : ",仅己方"})` +
          ` 策略=${targetStrategy === "nearest" ? "距离最近" : "进度最高"}` +
          ` 选定 #${best.shipId} 进度${best.progress}% 控制军团=${best.controlLegionId}` +
          `(${mine ? "己方护送" : "敌方需抢回"})`);
      }

      if (!currentTargetShipId) {
        if (loopCount % 20 === 1) {
          log(addLog, name, `[目标] 无未送达船只, 待机...`);
        }
        await sleep(pollInterval);
        continue;
      }

      const targetShip = ships.find((s) => s.shipId === currentTargetShipId);
      if (!targetShip) {
        currentTargetShipId = null;
        continue;
      }

      // 7. 敌人检测
      const enemiesOnShip = players
        .filter((p) => {
          if (p.legionId === self?.legionId || p.isDead) return false;
          if (p.carId != null) return p.carId === targetShip.shipId;
          return (
            Math.abs(p.position.x - targetShip.position.x) < 50 &&
            Math.abs(p.position.y - targetShip.position.y) < 50
          );
        })
        .sort((a, b) => a.hp - b.hp);

      if (enemiesOnShip.length > 0 && loopCount % 5 === 1) {
        log(addLog, name,
          `[敌人] 目标船#${targetShip.shipId} 上 ${enemiesOnShip.length} 名敌人:` +
          enemiesOnShip.slice(0, 3).map((e) => `#${e.roleId}(HP:${e.hp}/${e.maxHp}${e.carId != null ? ",car:" + e.carId : ""})`).join(" "));
      }

      // 8. 决策执行
      const isEnemyControlled = targetShip.controlLegionId !== self?.legionId;

      if (enemiesOnShip.length > 0 && !noAttackPlayers) {
        if (self?.position && isEnemyControlled) {
          await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name);
          await sleep(commandDelay);
        }
        const target = enemiesOnShip[0];
        log(addLog, name,
          `[攻击] 船#${targetShip.shipId} 敌人#${target.roleId} HP:${target.hp}/${target.maxHp}` +
          `(最低血) state=${target.state}`);
        await sendCmd(tokenStore, tokenId, "payload_startbattle",
          { bfId, targetId: target.roleId }, addLog, name);
        await sleep(commandDelay * 2);
      } else if (enemiesOnShip.length > 0 && noAttackPlayers) {
        // 只上船不打人: 船上有敌人也照常上船, 只是不发起攻击
        if (self?.position) {
          const dx = self.position.x - targetShip.position.x;
          const dy = self.position.y - targetShip.position.y;
          if (dx * dx + dy * dy > 100 * 100) {
            log(addLog, name,
              `[上船] 船#${targetShip.shipId} 有 ${enemiesOnShip.length} 名敌人, 只上船不打人, 行军上船`);
            await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name);
            await sleep(commandDelay);
          }
        }
        await sleep(pollInterval);
      } else if (isEnemyControlled && self?.position) {
        log(addLog, name,
          noAttackPlayers
            ? `[上船] 敌控船#${targetShip.shipId} 暂无敌人, 行军上船(不打人)`
            : `[逼近] 敌控船#${targetShip.shipId} 暂无敌人, 靠近待战`);
        await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name);
        await sleep(commandDelay);
      } else if (self?.position) {
        // 护送: 距离远才发行军, 避免重复刷命令
        const dx = self.position.x - targetShip.position.x;
        const dy = self.position.y - targetShip.position.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > 100 * 100) {
          log(addLog, name,
            `[护送] 船#${targetShip.shipId} 距离${Math.round(Math.sqrt(dist2))} > 100, 行军跟随`);
          await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name);
          await sleep(commandDelay);
        }
      }

      await sleep(pollInterval);
    } catch (error) {
      log(addLog, name,
        `第${loopCount}轮 异常: ${error.message}\n${error.stack?.split("\n")[1] || ""}`,
        "error");
      await sleep(pollInterval);
    }
  }

  log(addLog, name, `=== 蟠桃园监控结束 (共${loopCount}轮) ===`, "success");
}
