/**
 * 蟠桃园战场实时监控与操作
 *
 * 命令簇: payload_* (2026-08-21 源码核实, PayloadService)
 *  - legion_getpayloadbf {}                          获取战场数据(含 bfId/cars/players)
 *  - payload_enterbf      { bfId }                   进战场
 *  - payload_ping         { bfId }                   心跳
 *  - payload_setbattleteam { bfId, battleTeam, lordWeaponId, petUId }
 *  - payload_getteaminfo   { bfId, roleId }          查询队伍(响应含 weaponId/petUId/team)
 *  - payload_startmarch   { bfId, carId, path }      行军/上船; carId=0 自己走, carId=<船id> 上该船(推断, 待抓包核实), path=[{x,y}...](首元素为当前坐标)
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
const DEATH_WAIT_MAX = 10000; // 阵亡等待单段上限(期间穿插心跳)
const MARCH_RETRY_MS = 8000; // 行军重发间隔(未到达且未行军中时)

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
    // 自身在该战场的状态里也可能直接带 bfId
    ["res.roleBfState", res?.roleBfState],
    ["res 自身", res],
  ];
  for (const [label, data] of candidates) {
    if (!data || typeof data !== "object") continue;
    // 注意: 实测蟠桃 bfId 是形如 "261004:4366" 的字符串(日期:战场号),
    // 旧代码 Number("261004:4366") 得到 NaN 会误判为解析失败, 故此处保留原始字符串
    const rawBfId = data.bfId ?? data.id ?? data.battlefieldId ?? "";
    const asText = String(rawBfId ?? "").trim();
    if (!asText || asText === "0") continue;
    const bfId = /^\d+$/.test(asText) ? Number(asText) : asText;
    if (label !== "res 自身") {
      log(addLog, name, `战场数据取自 ${label}, bfId=${bfId}`);
    }
    // 船只/玩家字段可能在顶层(如 res.cars)而非 info 内, 合并保证解析器可见
    const raw = data === res ? res : { ...res, ...data };
    return { bfId, raw };
  }
  // 全部失败: 输出顶层字段名 + info 结构 + ended 标记, 便于定位 bfId 真实位置
  const keys = res && typeof res === "object" ? Object.keys(res).slice(0, 15).join(",") : typeof res;
  let hint = "";
  try {
    const info = res?.info;
    if (info && typeof info === "object") {
      hint += ` info字段=[${Object.keys(info).slice(0, 20).join(",")}]`;
    } else if (info !== undefined) {
      hint += ` info值=${JSON.stringify(info)?.slice(0, 80)}`;
    }
    if (res?.ended !== undefined) hint += ` ended=${JSON.stringify(res.ended)}`;
  } catch (_) { /* 诊断信息尽力而为, 失败不影响主流程 */ }
  log(addLog, name, `未解析出 bfId! 响应顶层字段: [${keys}]${hint}`, "error");
  return null;
}

/**
 * 解析蟠桃船列表 (兼容多种字段命名), 返回列表+实际命中的字段名
 * recognizable=false 表示结构完全未命中, 调用方应进入只记录模式, 不要盲动
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
      shipsRaw = val instanceof Map ? Object.fromEntries(val) : val;
      hitField = field;
      break;
    }
  }
  if (!shipsRaw) return { ships: [], hitField, recognizable: false };
  const list = Array.isArray(shipsRaw) ? shipsRaw : Object.values(shipsRaw);
  const ships = list
    .filter((ship) => ship && typeof ship === "object")
    .map((ship) => ({
      shipId: ship.carId ?? ship.id,
      position: { x: ship.x ?? ship.position?.x ?? 0, y: ship.y ?? ship.position?.y ?? 0 },
      progress: Number(ship.progress ?? ship.schedule ?? 0),
      controlLegionId: Number(ship.legionId ?? ship.controlLegionId ?? 0),
      hp: Number(ship.hp ?? 0),
      maxHp: Number(ship.maxHp ?? ship.hp ?? 0),
      defenders: ship.roleIds || ship.defenders || [],
    }));
  return { ships, hitField, recognizable: true };
}

/**
 * 解析全部玩家角色, 返回列表+实际命中的字段名
 * - 区分 die(等复活) 与 watching(未进场), 避免字段缺失导致全员误判阵亡
 * - 兼容官方模型的 roleToCarId(Map roleId→carId) 与角色自带的 carId
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
  if (!playersRaw) return { players: [], hitField, recognizable: false };

  // 官方模型用 roleToCarId(Map) 记录谁在哪艘船上
  const roleToCarId = bf?.roleToCarId;
  const carIdOf = (roleId) => {
    if (roleToCarId && typeof roleToCarId.get === "function") {
      const v =
        roleToCarId.get(roleId) ??
        roleToCarId.get(Number(roleId)) ??
        roleToCarId.get(String(roleId));
      if (v != null && v !== 0) return v;
    }
    return null;
  };

  const list = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
  const players = list
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const hasState = "state" in p || "roleState" in p;
      const hasHp = "hp" in p || "curHp" in p;
      const state = p.state ?? p.roleState ?? "";
      const hp = Number(p.hp ?? p.curHp ?? 0);
      const maxHp = Number(p.maxHp ?? p.maxhp ?? 0);
      const sleepTime = Number(p.sleepTime ?? 0);
      const roleId = Number(p.roleId ?? p.id);
      const isDie = state === "die" || (!hasState && hasHp && hp <= 0);
      const isWatching = state === "watching";
      const carId = p.carId ?? carIdOf(roleId);
      return {
        roleId,
        legionId: Number(p.legionId ?? p.legionID ?? 0),
        hp,
        maxHp,
        position: { x: p.x ?? p.position?.x ?? 0, y: p.y ?? p.position?.y ?? 0 },
        carId,
        isOnCar: p.isOnCar === true || carId != null,
        state,
        sleepTime,
        isDie,
        isWatching,
        isDead: isDie || isWatching, // 兼容旧字段名
      };
    });
  return { players, hitField, recognizable: true };
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
    const rawTeam = teamInfo?.team || teamInfo?.battleTeam || {};
    // 归一化: 槽位值可能是 {id,...} 对象, 统一取 heroId (源码 _team 存的是 heroId)
    const battleTeam = {};
    const srcEntries =
      rawTeam instanceof Map ? Array.from(rawTeam.entries()) : Object.entries(rawTeam);
    for (const [slot, v] of srcEntries) {
      const heroId = v && typeof v === "object" ? (v.id ?? v.heroId) : v;
      if (heroId != null) battleTeam[slot] = heroId;
    }
    const lordWeaponId = Number(teamInfo?.weaponId ?? teamInfo?.lordWeaponId ?? 0);
    const petUId = String(teamInfo?.petUId ?? "");
    const teamSize = Object.keys(battleTeam).length;

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
export async function marchTo(tokenStore, tokenId, bfId, selfPos, targetPos, addLog, name, carId = 0) {
  const path = [
    { x: selfPos.x, y: selfPos.y },
    { x: targetPos.x, y: targetPos.y },
  ];
  const tag = Number(carId) > 0 ? `上船 carId=${carId}` : "自走 carId=0";
  log(addLog, name,
    `[行军] ${tag} (${selfPos.x},${selfPos.y}) → (${targetPos.x},${targetPos.y})`);
  return sendCmd(
    tokenStore, tokenId, "payload_startmarch",
    { bfId, carId: Number(carId) || 0, path }, addLog, name,
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
    boardCar = true, // 上船实验: 行军时带 carId=<目标船id> 尝试真正登船(关闭则 carId=0 只陆地行军)
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

  let entered = false; // 是否已在战场(阵亡/观战后需重进)
  let teamDeployed = false; // 阵容仅成功设置一次(失败下轮重试)
  let currentTargetShipId = null;
  let lastPingAt = 0;
  let marchOrder = null; // { shipId, at } 避免每轮重复行军
  let loopCount = 0;
  let probeDone = false; // 首样例探测是否已输出
  let selfMissingStreak = 0;

  // 服务器时间校准信息
  const getClient = () => tokenStore.getWebSocketClient?.(tokenId) || null;
  const serverNow = () => {
    const client = getClient();
    return client && typeof client.getServerTime === "function"
      ? client.getServerTime()
      : Date.now();
  };
  const ping = (bfId) => {
    sendCmd(tokenStore, tokenId, "payload_ping", { bfId }, addLog, name).catch(() => {});
    lastPingAt = Date.now();
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
    ` 只上船不打人=${noAttackPlayers ? "开" : "关"} 上船=${boardCar ? "开" : "关"}` +
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

      // 2. 解析战场(防御式)
      const { ships, hitField: shipField, recognizable: shipsOk } = parsePeachShips(raw);
      const { players, hitField: playerField, recognizable: playersOk } = parsePlayers(raw);
      const self = players.find((p) => p.roleId === rid) || null;

      // 首样例探测: 仅一次, 便于活动开启后核对字段名
      if (!probeDone) {
        probeDone = true;
        log(addLog, name,
          `[解析] 船只字段=${shipField || "(未命中!)"} 共${ships.length}艘;` +
          ` 玩家字段=${playerField || "(未命中!)"} 共${players.length}人; self=${self ? "✓" : "✗"}`,
          shipsOk && playersOk ? "info" : "error");
        try {
          log(addLog, name, `[解析] 战场顶层字段=[${Object.keys(raw || {}).slice(0, 25).join(",")}]`);
          if (ships.length > 0) log(addLog, name, `[解析] 首船样例: ${JSON.stringify(ships[0]).slice(0, 300)}`);
          if (players.length > 0) log(addLog, name, `[解析] 首玩家样例: ${JSON.stringify(players[0]).slice(0, 300)}`);
        } catch (_) { /* 样例打印失败不影响主流程 */ }
      }

      if (onBattlefieldUpdate) {
        onBattlefieldUpdate({ ships, players, self, bfId, raw });
      }

      // 3. 结构不可识别 → 只记录不盲动
      if (!playersOk || !shipsOk) {
        log(addLog, name,
          `⚠ 战场结构未识别(玩家=${playerField || "无"} 船只=${shipField || "无"}), 进入只记录模式;` +
          ` 请把首样例日志反馈以校正字段名`, "error");
        await sleep(pollInterval);
        continue;
      }
      if (!self) {
        selfMissingStreak++;
        if (selfMissingStreak <= 3 || selfMissingStreak % 20 === 0) {
          log(addLog, name,
            `未在玩家列表找到自身 roleId=${rid} (连续${selfMissingStreak}轮), 检查字段名`, "warn");
        }
        await sleep(pollInterval);
        continue;
      }
      selfMissingStreak = 0;

      // 4. 心跳保活(阵亡等待期间也会穿插)
      if (Date.now() - lastPingAt > PING_INTERVAL) {
        const offset = getClient()?.serverTimeOffset;
        ping(bfId);
        if (offset != null && loopCount % 20 === 1) {
          log(addLog, name, `[时钟] 服务器时间偏移 ${Math.round(offset)}ms (EMA)`);
        }
      }

      // 5. 阵亡 → 按 sleepTime 分段等待复活(每段≤DEATH_WAIT_MAX, 期间穿插心跳)
      if (self.isDie) {
        if (!autoResurrect) {
          log(addLog, name,
            `[复活] 阵亡(state=${self.state}) 且未开启自动复活, 结束监控`, "warning");
          break;
        }
        let remainMs = self.sleepTime > 0 ? self.sleepTime - serverNow() : pollInterval;
        if (!Number.isFinite(remainMs) || remainMs < 0) remainMs = 0;
        log(addLog, name,
          `[复活] 阵亡(state=${self.state}) sleepTime=${self.sleepTime}` +
          ` 服务器now=${serverNow()} 剩余=${remainMs}ms`);
        const t0 = Date.now();
        while (!shouldStop() && Date.now() - t0 < Math.max(remainMs, 1000)) {
          await sleep(Math.min(DEATH_WAIT_MAX, Math.max(remainMs - (Date.now() - t0), 1000)));
          if (Date.now() - lastPingAt > PING_INTERVAL) ping(bfId);
        }
        entered = false; // 复活后需重新进场
        marchOrder = null; // 需重新行军
        log(addLog, name, `[复活] 等待结束, 重新进场`);
        continue;
      }

      // 6. 进场(首次/观战/复活后) + 阵容仅成功设置一次(失败下轮重试)
      if (!entered || self.isWatching) {
        if (self.isWatching) log(addLog, name, `[进场] 当前 state=watching, 执行进场`);
        await sendCmd(tokenStore, tokenId, "payload_enterbf", { bfId }, addLog, name);
        entered = true;
        await sleep(commandDelay);
        if (!teamDeployed) {
          const ok = await deployTeam(tokenStore, tokenId, bfId, rid, addLog, name);
          if (ok) teamDeployed = true;
          else log(addLog, name, `[阵容] 本次设置失败, 下轮重试`, "warning");
        }
      }

      // 7. 目标选择
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
          marchOrder = null;
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

      // 8. 是否已在目标船上 / 行军中(避免重复刷行军命令)
      const onShip =
        self.isOnCar === true || (self.carId != null && self.carId === targetShip.shipId);
      const marching = self.state === "march";

      // 未在目标船且未行军中才发行军; 同一目标仅发一次, MARCH_RETRY_MS 后可重发
      const marchToTargetOnce = async (reason) => {
        if (!self?.position || onShip || marching) return;
        const need =
          !marchOrder ||
          marchOrder.shipId !== targetShip.shipId ||
          Date.now() - marchOrder.at > MARCH_RETRY_MS;
        if (!need) return;
        const carId = boardCar ? targetShip.shipId : 0;
        log(addLog, name,
          `[行军] ${reason} → 船#${targetShip.shipId} (进度${targetShip.progress}%)` +
          `${boardCar ? " [带carId上船]" : ""}`);
        try {
          await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name, carId);
        } catch (e) {
          if (carId > 0) {
            log(addLog, name,
              `[行军] 带carId上船失败(${e.message}), 回退为陆地行军 carId=0`, "warning");
            await marchTo(tokenStore, tokenId, bfId, self.position, targetShip.position, addLog, name, 0);
          } else {
            throw e;
          }
        }
        marchOrder = { shipId: targetShip.shipId, at: Date.now() };
        await sleep(commandDelay);
      };

      // 9. 敌人检测(排除阵亡/未进场; 血最低优先)
      const enemiesOnShip = players
        .filter((p) => {
          if (p.legionId === self?.legionId || p.isDie || p.isWatching) return false;
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

      // 10. 决策执行
      const isEnemyControlled = targetShip.controlLegionId !== self?.legionId;

      if (enemiesOnShip.length > 0 && !noAttackPlayers) {
        await marchToTargetOnce("接近目标船");
        const target = enemiesOnShip[0];
        log(addLog, name,
          `[攻击] 船#${targetShip.shipId} 敌人#${target.roleId} HP:${target.hp}/${target.maxHp}` +
          `(最低血) state=${target.state}`);
        await sendCmd(tokenStore, tokenId, "payload_startbattle",
          { bfId, targetId: target.roleId }, addLog, name);
        await sleep(commandDelay * 2);
      } else if (enemiesOnShip.length > 0 && noAttackPlayers) {
        // 只上船不打人: 船上有敌人也照常上船, 只是不发起攻击
        await marchToTargetOnce("只上船不打人");
        await sleep(pollInterval);
      } else if (isEnemyControlled) {
        await marchToTargetOnce(noAttackPlayers ? "敌控船(不打人)" : "逼近敌控船待战");
      } else if (onShip) {
        if (loopCount % 20 === 1) {
          log(addLog, name, `[等待] 已在船#${targetShip.shipId} 无敌人 (进度${targetShip.progress}%)`);
        }
      } else if (marching) {
        if (loopCount % 20 === 1) {
          log(addLog, name, `[等待] 行军中 → 船#${targetShip.shipId} (进度${targetShip.progress}%)`);
        }
      } else {
        // 己方船护送: 未上船且未行军中 → 行军跟随
        await marchToTargetOnce("护送己方船");
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