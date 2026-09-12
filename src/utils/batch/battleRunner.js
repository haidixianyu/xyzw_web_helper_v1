import { XyzwLegionWarWebSocketClient } from "../xyzwLegionWarWebSocket.js";
import { workerSleep } from "../workerTimer.js";
import { getLineupType } from "../HeroList.js";
import { accountName } from "@/utils/accountName";

/**
 * 盐场自动战斗运行器
 *
 * 通过主通道获取战场信息(sid/battlefieldId), 再建立战斗专用通道,
 * 执行: 进场 -> 获取地图 -> 设置战斗阵容 -> 招募 -> 进场战斗 -> 行军/攻击 -> 自动复活(免费/用丹)。
 *
 * 依赖注入(deps):
 *   - tokenStore          主通道 WebSocket 存储(可用于发送主通道指令)
 *   - ensureConnection    确保主通道已连接
 *   - addLog              写日志 {time,message,type}
 *   - workerSleep         延时
 *   - commandDelay        指令间延时(ms)
 *   - shouldStop          停止标记回调 () => boolean
 */

const BATTLE_WSS_HOST = "wss://xxz-xyzw-new.hortorgames.com/agent";

// 免费复活安全余量(秒): 发送 war_resurrect 时本地时间必须比 reviveTime 大这么多,
// 保证服务端判定为免费复活, 绝不消耗复活丹
const FREE_REVIVE_GUARD_SECONDS = 3;

// 每个玩家的免费复活次数上限
const FREE_REVIVE_MAX = 5;

// 设置战斗队伍后的招募队员总预算(秒):
// 逐个 war_invitejointeam 邀请队伍成员入队, 到达该时长仍未满员则停止招募, 直接进场战斗
const RECRUIT_TIMEOUT_SECONDS = 60;

/**
 * 等待战斗通道就绪: 已连接立即返回 true; 否则主动重连并接管 onConnect 等待恢复,
 * 超时返回 false。接管期间会保存并恢复 battleClient.onConnect(connectBattleChannel 用它 resolve)。
 * 目的: 发送 war_getbattlefieldinfo 前确保通道已连, 否则请求会滞留发送队列直至重连,
 * 而 waitForBattleInfo 的独立计时已先行超时(导致"获取战场地图超时"反复出现)。
 */
function waitForBattleConnected(battleClient, timeoutMs = 6000) {
  if (battleClient.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const prevOnConnect = battleClient.onConnect;
    battleClient.onConnect = (...args) => {
      clearTimeout(timer);
      battleClient.onConnect = prevOnConnect;
      if (typeof prevOnConnect === "function") {
        try {
          prevOnConnect(...args);
        } catch (_) {}
      }
      resolve(true);
    };
    try {
      battleClient.reconnect();
    } catch (_) {
      clearTimeout(timer);
      battleClient.onConnect = prevOnConnect;
      resolve(false);
    }
  });
}

/**
 * 等待 battle 通道的 war_getbattlefieldinfo 响应, 返回战场原始数据
 */
function waitForBattleInfo(battleClient, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const prev = battleClient.messageListener;
    const timer = setTimeout(() => {
      battleClient.setMessageListener(prev);
      reject(new Error("获取战场地图超时"));
    }, timeoutMs);
    battleClient.setMessageListener((packet) => {
      const cmd = packet?.cmd || "";
      if (cmd.includes("war_getbattlefieldinfo")) {
        clearTimeout(timer);
        battleClient.setMessageListener(prev);
        const data =
          packet.rawData !== undefined
            ? packet.rawData
            : packet.decodedBody !== undefined
              ? packet.decodedBody
              : packet.body;
        resolve(data);
      } else if (prev) {
        prev(packet);
      }
    });
  });
}

/** 从战场数据中找到自己的角色 */
function findSelfRole(battlefield, roleId) {
  if (!battlefield?.roles) return null;
  return (
    Object.values(battlefield.roles).find(
      (r) => String(r.id) === String(roleId),
    ) || null
  );
}

/** 判断角色是否阵亡(state=over) */
function isDead(role) {
  return role?.state === "over";
}

/**
 * 敌方"精力"度量(越小越弱): 首选战场角色的 energy 字段(攻击玩家-5/建筑-1);
 * 缺失时依次退化为 hp / 剩余免费复活次数(FREE_REVIVE_MAX - 已用)
 */
function enemyStamina(role) {
  const energy = Number(role?.energy ?? NaN);
  if (Number.isFinite(energy)) return energy;
  const hp = Number(role?.hp ?? role?.hP ?? NaN);
  if (Number.isFinite(hp)) return hp;
  return FREE_REVIVE_MAX - Number(role?.revive || 0);
}

/**
 * 自动检测可攻击的敌人: 不同俱乐部的存活玩家(id>0, 排除Boss/怪物), 已阵亡(over)的剔除
 */
function detectAttackableEnemies(battlefield, selfLegionId) {
  const roles = battlefield?.roles || {};
  const list = [];
  for (const role of Object.values(roles)) {
    const id = Number(role?.id);
    if (!(id > 0)) continue; // 跳过Boss/怪物(负id)与缺失
    if (selfLegionId && role?.legionID === selfLegionId) continue; // 同俱乐部友军
    if (role?.state === "over") continue; // 已阵亡
    list.push(role);
  }
  return list;
}

/**
 * 自动检测可攻击建筑: 非道路(9)/非大本营(4)、非本俱乐部、还有血量的据点/核心(1-6)
 * @returns {Array} building 列表中每一项含 id("x_y"串)/type/belongsLegionId/hP/maxHP
 */
function detectAttackableBuildings(battlefield, selfLegionId) {
  const data = battlefield?.buildingData || {};
  const list = [];
  for (const b of Object.values(data)) {
    const type = Number(b?.type);
    if (type === 9 || type === 4) continue; // 道路/大本营跳过
    if (type < 1 || type > 6) continue;
    if (selfLegionId && b?.belongsLegionId === selfLegionId) continue; // 已方建筑
    if (Number(b?.hP) <= 0) continue; // 已被摧毁
    list.push(b);
  }
  return list;
}

/** Map 或普通对象统一取值数组 */
function valuesOf(mapOrObj) {
  if (!mapOrObj) return [];
  if (mapOrObj instanceof Map) return Array.from(mapOrObj.values());
  if (Array.isArray(mapOrObj)) return mapOrObj;
  return Object.values(mapOrObj);
}

/** 两坐标间距离(曼哈顿) */
function dist(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * 通过主通道查询角色的阵容类型(吴国/毒爆/姜维等), 结果按 roleId 缓存。
 * 依赖 rank_getroleinfo(includeHero), 用 getLineupType 判定。
 * @param {string} tokenId 主通道账号
 * @param {object} tokenStore
 * @param {string|number} roleId
 * @param {Map} cache roleId -> 阵容类型
 * @returns {Promise<string>} 阵容类型名("其他"兜底)
 */
async function getRoleLineupType(tokenId, tokenStore, roleId, cache) {
  const key = String(roleId);
  if (cache.has(key)) return cache.get(key);
  let type = "其他";
  try {
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "rank_getroleinfo",
      {
        roleId: Number(roleId),
        includeBottleTeam: false,
        isSearch: false,
        bottleType: 0,
        includeHero: true,
        includeHeroDetail: true,
        includePearl: true,
      },
      8000,
    );
    const heroes = res?.roleInfo?.heroes;
    const heroList = Object.values(heroes || {}).map((h) => ({
      heroId: h?.heroId || h?.id,
    }));
    type = getLineupType(heroList);
  } catch (_) {}
  cache.set(key, type);
  return type;
}

/**
 * 通过主通道获取自身 roleId -> 在战场中找到自己的角色, 返回 selfRole 或 null
 */
async function getSelfRole(battlefield, tokenId, tokenStore) {
  let roleId = null;
  try {
    const roleRes = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
      10000,
    );
    roleId = roleRes?.role?.roleId;
  } catch (_) {}
  if (roleId == null) return null;
  return findSelfRole(battlefield, roleId);
}

/**
 * 自动行军策略-由近到远(大建筑优先):
 * 从战场 buildingData 中筛出可攻打/可占领的敌方建筑(type 1-6 非道路, 非本俱乐部, hP>0),
 * 按优先级(大建筑分高优先, 同分由近到远)排序, 返回第一个目标坐标 {x,y} 或 null
 */
function pickNearToFarTarget(battlefield, selfRole, selfLegionId) {
  if (!battlefield?.buildingData || !selfRole) return null;
  const selfPos = selfRole.position || selfRole.svrPosition || null;
  if (!selfPos) return null;
  const candidates = [];
  for (const b of valuesOf(battlefield.buildingData)) {
    const type = Number(b?.type);
    if (type === 9 || type === 4) continue; // 道路/大本营跳过
    if (type < 1 || type > 6) continue;
    if (selfLegionId && b?.belongsLegionId === selfLegionId) continue;
    if (Number(b?.hP) <= 0) continue;
    let pos = b?.position || null;
    if (!pos) {
      const [bx, by] = String(b?.id || "").split("_").map(Number);
      if (Number.isFinite(bx) && Number.isFinite(by)) pos = { x: bx, y: by };
    }
    if (!pos) continue;
    candidates.push({ b, pos, priority: Number(b?.point) || 0 });
  }
  if (candidates.length === 0) return null;
  // 大建筑优先(分高), 同分由近到远
  candidates.sort((a, c) => c.priority - a.priority || dist(selfPos, a.pos) - dist(selfPos, c.pos));
  return candidates[0].pos;
}

/**
 * 自动行军策略-跟随: 从战场 marches 中找出选中成员当前的行军。
 * followRoleIds 可为 roleId 数组, 也可为 [{id, power}] 数组(带战力);
 * 多人同时行军时跟随战力最高的, 战力信息缺失时随机选一个。
 * 返回目标坐标 {x,y} 或 null
 */
function pickFollowTarget(battlefield, followRoleIds) {
  if (!battlefield?.marches || !followRoleIds?.length) return null;
  const powerMap = new Map();
  const ids = new Set();
  for (const item of followRoleIds) {
    if (item && typeof item === "object") {
      const id = Number(item.id ?? item.roleId);
      if (!Number.isFinite(id)) continue;
      ids.add(id);
      powerMap.set(id, Number(item.power) || 0);
    } else {
      const id = Number(item);
      if (Number.isFinite(id)) ids.add(id);
    }
  }
  const marches = valuesOf(battlefield.marches).filter(
    (m) => m?.to && ids.has(Number(m?.roleId)),
  );
  if (marches.length === 0) return null;
  if (marches.length === 1) return marches[0].to;
  const hasPower = marches.some(
    (m) => (powerMap.get(Number(m.roleId)) || 0) > 0,
  );
  if (hasPower) {
    // 跟随战力最高的正在行军的成员
    marches.sort(
      (a, b) =>
        (powerMap.get(Number(b.roleId)) || 0) -
        (powerMap.get(Number(a.roleId)) || 0),
    );
    return marches[0].to;
  }
  const pick = marches[Math.floor(Math.random() * marches.length)];
  return pick.to;
}

/**
 * 刷新战场快照(发 war_getbattlefieldinfo 并等响应), 返回 new battlefield 数据或 null
 */
async function refreshBattlefieldInfo(battleClient, battlefieldId, timeoutMs = 8000, addLog) {
  // 发送前确保通道已连接: 否则 war_getbattlefieldinfo 会滞留发送队列, 等重连成功才发出,
  // 而 waitForBattleInfo 已先行超时(通道断线重连导致反复"获取战场地图超时")。
  const ready = await waitForBattleConnected(
    battleClient,
    Math.min(timeoutMs, 6000),
  );
  if (!ready) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `刷新战场信息失败: 战斗通道未连接(重连超时)`,
      type: "warn",
    });
    return null;
  }
  const infoPromise = waitForBattleInfo(battleClient, Math.max(timeoutMs, 12000));
  battleClient.send("war_getbattlefieldinfo", { battlefieldId });
  try {
    const raw = await infoPromise;
    return raw?.battlefield || null;
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `刷新战场信息失败: ${error.message}`,
      type: "warn",
    });
    // 通道可能已断开, 触发重连以便下次刷新恢复
    if (!battleClient.connected) {
      try {
        battleClient.reconnect();
      } catch (_) {}
    }
    return null;
  }
}

/**
 * 发送 war_invitejointeam 邀请成员加入队伍
 * (源码: WarService.inviteJoinTeam({ battlefieldId, targetCodeId }), 参数名为 targetCodeId)
 */
function inviteBattleTeamMember(battleClient, battlefieldId, roleId) {
  battleClient.send("war_invitejointeam", {
    battlefieldId,
    targetCodeId: roleId,
  });
}

/**
 * 逐个体发送 war_invitejointeam(邀请成员加入盐场队伍), 总预算 RECRUIT_TIMEOUT_SECONDS 秒
 * @returns {boolean} 是否在预算内完成邀请(未被停止)
 */
async function recruitTeam(battleClient, battlefieldId, team, shouldStop, sleep, commandDelay, addLog, name) {
  if (!team || team.length === 0) return false;
  const recruitDeadline = Date.now() + RECRUIT_TIMEOUT_SECONDS * 1000;
  let invited = 0;
  for (const roleId of team) {
    if (shouldStop()) break;
    if (Date.now() >= recruitDeadline) break;
    inviteBattleTeamMember(battleClient, battlefieldId, roleId);
    invited++;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${name} 邀请入队 roleId=${roleId} (${invited}/${team.length})`,
      type: "info",
    });
    await sleep(commandDelay);
  }
  const remaining = recruitDeadline - Date.now();
  if (remaining > 0 && !shouldStop()) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${name} 已邀请 ${invited} 名成员, 等待入队 (最多 ${Math.round(remaining / 1000)}s)...`,
      type: "info",
    });
    await waitWithStop(remaining, shouldStop, sleep);
  }
  return true;
}

/**
 * 解析应参与战斗的队伍成员 roleId 列表。
 * teamMode=random: 通过主通道 legion_getinfo 拉取该账号自身俱乐部的成员,
 *   筛选未上线成员(isOnline 为 false)作为队伍;
 * teamMode=specified: 直接用页面勾选的 options.team。
 */
async function resolveBattleTeam(options, tokenId, tokenStore, name, addLog) {
  // 未开启招募队员, 直接返回空队伍(不邀请任何成员)
  if (options.recruitTeam === false) return [];
  if (options.teamMode === "random") {
    try {
      const legionRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "legion_getinfo",
        {},
        8000,
      );
      const raw =
        legionRes?.body?.info?.members || legionRes?.info?.members || {};
      const list = Array.isArray(raw) ? raw : Object.values(raw || {});
      // 注意: legion_getinfo 的 members 不带实时在线状态(isOnline 恒不可靠),
      // 真正在线可参战成员需从战场快照 battlefield.roles[].isOnline 判断。
      // 这里只取全体俱乐部成员 roleId 作为候选, 实际招募时再按战场快照筛选在线队友。
      const team = list.map((m) => Number(m.roleId)).filter((id) => id > 0);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 俱乐部候选成员 ${team.length} 人(在线状态以战场快照为准)`,
        type: "info",
      });
      return team;
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 拉取俱乐部成员失败, 跳过设置战斗队伍: ${error.message}`,
        type: "warn",
      });
      return [];
    }
  }
  return Array.isArray(options.team) ? options.team : [];
}

/**
 * 获取账号出战阵容: 优先用主通道缓存的角色阵容, 否则重新拉取 role_getroleinfo,
 * 把 role.battleTeam(槽位->{heroId}) 转为 Map<槽位, heroId>, 并附带 lordWeaponId
 */
async function getBattleFormation(tokenId, tokenStore, name, addLog) {
  const cachedRole = tokenStore?.gameData?.roleInfo?.role;
  let role = cachedRole;
  if (!role || !role.battleTeam) {
    try {
      const res = await tokenStore.sendGetRoleInfo(tokenId);
      role = res?.role || {};
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 获取角色阵容失败: ${error.message}`,
        type: "warn",
      });
      return null;
    }
  }
  const btRaw = role?.battleTeam || {};
  const battleTeam = new Map();
  let hasEntry = false;
  for (const [slot, entry] of Object.entries(btRaw)) {
    const heroId = Number(entry?.heroId ?? entry);
    if (heroId > 0) {
      battleTeam.set(Number(slot), heroId);
      hasEntry = true;
    }
  }
  if (!hasEntry) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${name} 角色未配置出战阵容(battleTeam 为空), 跳过设置`,
      type: "warn",
    });
    return null;
  }
  const petUId = String(
    role?.petUId ??
      role?.pet?.petUId ??
      role?.pet?.uId ??
      role?.petId ??
      role?.pet?.petId ??
      "",
  );
  return {
    battleTeam,
    lordWeaponId: Number(role?.lordWeaponId || 0),
    petUId,
  };
}

/** 计算还需等待多少毫秒才能以免费复活 (0 表示已就绪) */
function freeReviveWaitMs(selfRole) {
  const reviveTime = Number(selfRole?.reviveTime || 0);
  if (reviveTime <= 0) return 0;
  const readyAtSec = reviveTime + FREE_REVIVE_GUARD_SECONDS;
  const diff = readyAtSec - Date.now() / 1000;
  return diff > 0 ? Math.ceil(diff * 1000) : 0;
}

/**
 * 分片等待, 期间支持停止
 */
async function waitWithStop(ms, shouldStop, sleep) {
  const step = 1000;
  let remaining = ms;
  while (remaining > 0 && !shouldStop()) {
    const chunk = Math.min(step, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
  return !shouldStop();
}

/**
 * 等待战斗通道连接成功
 */
function connectBattleChannel({ token, sid, battlefieldId, addLog, workerSleep, commandDelay }) {
  return new Promise((resolve, reject) => {
    const url =
      `${BATTLE_WSS_HOST}?p=${encodeURIComponent(token)}&e=x&sid2=${sid}&lang=chinese&sid2=${sid}`;
    const client = new XyzwLegionWarWebSocketClient({
      url,
      utils: null,
      hint: battlefieldId,
      heartbeatMs: 5000,
    });

    const timeout = setTimeout(() => {
      if (!client.connected) {
        client.disconnect();
        reject(new Error("战斗通道连接超时"));
      }
    }, 15000);

    client.onConnect = async () => {
      clearTimeout(timeout);
      addLog({ time: new Date().toLocaleTimeString(), message: "战斗通道已连接", type: "success" });
      await workerSleep(commandDelay);

      // 不在连接时立即进场: 进场必须排在「布阵 -> 组队」之后(见 runSaltFieldBattle 主流程)
      resolve(client);
    };

    client.onError = (error) => {
      clearTimeout(timeout);
      client.disconnect();
      reject(new Error(`战斗通道错误: ${error?.message || error}`));
    };

    client.init();
  });
}

/**
 * 建立临时战斗通道拉取一次战场快照(用完即断), 供盐场信息弹窗等场景使用
 */
export function fetchSaltBattlefieldSnapshot({
  token,
  sid,
  battlefieldId,
  timeoutMs = 12000,
}) {
  return new Promise((resolve, reject) => {
    const url = `${BATTLE_WSS_HOST}?p=${encodeURIComponent(token)}&e=x&sid2=${sid}&lang=chinese&sid2=${sid}`;
    const client = new XyzwLegionWarWebSocketClient({
      url,
      utils: null,
      hint: battlefieldId,
      heartbeatMs: 5000,
    });
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.disconnect();
      } catch (_) {}
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("战场快照获取超时")),
      timeoutMs,
    );
    client.onConnect = async () => {
      try {
        const infoPromise = waitForBattleInfo(client, timeoutMs);
        client.send("war_enterbattlefield", { battlefieldId, useGzip: true });
        // 必须主动请求战场快照, 否则服务端不会下发 war_getbattlefieldinfo 响应
        client.send("war_getbattlefieldinfo", { battlefieldId });
        const raw = await infoPromise;
        finish(resolve, raw?.battlefield || null);
      } catch (error) {
        finish(reject, error);
      }
    };
    client.onError = (error) =>
      finish(reject, new Error(`战斗通道错误: ${error?.message || error}`));
    client.init();
  });
}

/**
 * 运行单个账号的盐场自动战斗
 * @param {string} tokenId
 * @param {object} token
 * @param {object} options - 战斗配置
 * @param {object} deps
 */
export async function runSaltFieldBattle(tokenId, token, options = {}, deps = {}) {
  const {
    tokenStore,
    ensureConnection,
    addLog = () => {},
    workerSleep: sleep = workerSleep,
    commandDelay = 200,
    arriveTriggerDelay = 2000,
  } = deps;

  const shouldStop = deps.shouldStop || (() => false);
  const name = accountName(token) || tokenId;

  // 战斗通道连接, 在 finally 中务必断开, 否则停止/结束后仍会持续收到战场推送(ProtoMsg 刷屏)
  let battleClient = null;

  try {
    const { gameTokens } = tokenStore || {};
    const tokenList = Array.isArray(gameTokens) ? gameTokens : [];
    await ensureConnection(tokenId, tokenList);
    addLog({ time: new Date().toLocaleTimeString(), message: `${name} 主通道已连接`, type: "info" });

    // 1. 获取战场信息 -> sid + battlefieldId
    const battlefieldRes = await tokenStore.sendMessageWithPromise(
      tokenId,
      "legion_getbattlefield",
      {},
      10000,
    );
    if (!battlefieldRes?.info) {
      throw new Error("无法获取战场信息(battlefield)");
    }
    const battlefieldId = battlefieldRes.info.battlefieldId;
    const sid = battlefieldRes.info.sid;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${name} battlefieldId=${battlefieldId} sid=${sid}`,
      type: "info",
    });

    // 2. 建立战斗通道(不自动进场)
    battleClient = await connectBattleChannel({
      token: token.token,
      sid,
      battlefieldId,
      addLog,
      workerSleep: sleep,
      commandDelay,
    });

    // 2.1 记录战斗通道响应报文, 用于核对判断依据(角色 state/energy/revive/isOnline 等字段)。
    //     盐场仅在周六 20:00-21:00 开放, 无法即时复现问题, 故保留详细日志供事后分析。
    let selfRoleId = null;
    try {
      const ri = await tokenStore.sendMessageWithPromise(tokenId, "role_getroleinfo", {}, 10000);
      selfRoleId = ri?.role?.roleId ?? null;
    } catch (_) {}
    battleClient.setMessageListener((packet) => {
      try {
        const cmd = packet?.cmd;
        if (!cmd || cmd === "war_ping" || cmd === "heart_beat") return;
        const body =
          packet?.decodedBody !== undefined
            ? packet.decodedBody
            : packet?.rawData !== undefined
              ? packet.rawData
              : packet?.body;
        if (body == null) return;
        const code = packet?.code;
        const ts = new Date().toLocaleTimeString();
        if (cmd === "war_getbattlefieldinfo") {
          const bf = body?.battlefield ?? body;
          const roles = bf?.roles
            ? Object.values(bf.roles)
            : Array.isArray(body?.roles)
              ? body.roles
              : [];
          const buildings = bf?.buildingData ? Object.values(bf.buildingData) : [];
          const marches = bf?.marches ? Object.values(bf.marches) : [];
          const sample = roles[0];
          addLog({
            time: ts,
            message: `📨 [${name}] 战场快照 code=${code ?? "?"} roles=${roles.length} buildings=${buildings.length} marches=${marches.length}\n示例role完整字段: ${sample ? JSON.stringify(sample).slice(0, 1000) : "无"}`,
            type: "info",
          });
          const roleList = roles
            .map((r) => {
              const me = String(r?.id) === String(selfRoleId) ? "★自己 " : "";
              return `${me}id=${r?.id} st=${r?.state} en=${r?.energy} rv=${r?.revive} on=${r?.isOnline} lg=${r?.legionID ?? r?.legionId}`;
            })
            .join(" | ");
          addLog({
            time: ts,
            message: `[${name}] 战场角色列表: ${roleList.slice(0, 1800)}`,
            type: "info",
          });
        } else {
          let bodyStr;
          try {
            bodyStr = JSON.stringify(body);
          } catch {
            bodyStr = String(body);
          }
          const TRUNC = 2500;
          const shown =
            bodyStr.length > TRUNC
              ? bodyStr.slice(0, TRUNC) + `…(截断共${bodyStr.length}字符)`
              : bodyStr;
          addLog({
            time: ts,
            message: `📨 [${name}] 响应[${cmd}] code=${code ?? "?"} ${shown}`,
            type: "info",
          });
        }
      } catch (_) {}
    });

    // 3. 布阵参赛: 取角色自身正常阵容(含宠物)后 war_setbattleteam, 必须在「组队」「进场」之前。
    //    注意: 进场后阵容锁定不可再改; 宠物必须从角色自身配置获取。
    const formation = await getBattleFormation(tokenId, tokenStore, name, addLog);
    if (formation) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 设置出战阵容 (${formation.battleTeam.size} 槽位, 武器 ${formation.lordWeaponId}, 宠物 ${formation.petUId || "无"})`,
        type: "info",
      });
      battleClient.send("war_setbattleteam", {
        battlefieldId,
        battleTeam: formation.battleTeam,
        lordWeaponId: formation.lordWeaponId,
        petUId: formation.petUId,
      });
      await sleep(commandDelay);
    }

    // 4. 解析招募名单(俱乐部成员 roleId, 用于 war_invitejointeam 邀请入队):
    //    teamMode=random: 拉取该账号俱乐部成员候选;
    //    teamMode=specified: 使用页面勾选的成员 roleId 列表
    const team = await resolveBattleTeam(
      options,
      tokenId,
      tokenStore,
      name,
      addLog,
    );

    // 5.4 手动行军到坐标(可选, 兼容旧配置); 自动攻击由 5.3 完成
    // 5. 主战斗循环:
    //    招募(每次60s) -> 进场战斗 -> 自动检测敌人/建筑并攻击 -> 检测阵亡 -> 免费复活 -> 再次循环
    //    免费复活次数用尽或手动停止时结束循环
    let loopCount = 0;
    let usedFreeRevive = 0;
    while (!shouldStop()) {
      loopCount++;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} === 第 ${loopCount} 轮战斗 ===`,
        type: "info",
      });

      // 5.1 招募队友(每轮重新邀请)
      // 在线可参战成员以战场快照为准: 从 battlefield.roles 筛同军团且 isOnline 的角色
      if (team && team.length > 0) {
        let teamForRound = team;
        try {
          const bf = await refreshBattlefieldInfo(
            battleClient,
            battlefieldId,
            8000,
            addLog,
          );
          if (bf) {
            const selfRole = await getSelfRole(bf, tokenId, tokenStore);
            const selfLegionId =
              selfRole?.legionID || selfRole?.legionId || null;
            const selfId = Number(selfRole?.id);
            const onlineMates = Object.values(bf.roles || {})
              .filter(
                (r) =>
                  Number(r?.id) > 0 &&
                  r?.legionID === selfLegionId &&
                  r?.isOnline &&
                  Number(r?.id) !== selfId,
              )
              .map((r) => Number(r.id));
            if (onlineMates.length > 0) {
              teamForRound = onlineMates;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${name} 战场快照筛得同军团在线队友 ${onlineMates.length} 人, 仅邀请在线队友`,
                type: "info",
              });
            } else {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${name} 战场快照未筛得在线队友, 退回邀请全体候选 ${team.length} 人`,
                type: "info",
              });
            }
          }
        } catch (error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${name} 招募阶段准备队友名单异常: ${error.message}`,
            type: "warn",
          });
        }
        await recruitTeam(
          battleClient,
          battlefieldId,
          teamForRound,
          shouldStop,
          sleep,
          commandDelay,
          addLog,
          name,
        );
      }

      // 5.2 进场战斗: 发送 war_enterbattlefield, 激活本账号在该战场的战斗状态
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${name} 发送进入战场命令 war_enterbattlefield`,
        type: "info",
      });
      battleClient.send("war_enterbattlefield", { battlefieldId, useGzip: true });
      // 等待进场确认: 轮询战场快照, 确认自己角色已进入战场(出现在 roles 中)
      let entered = false;
      for (let i = 0; i < 6 && !entered && !shouldStop(); i++) {
        await sleep(1000);
        const bfChk = await refreshBattlefieldInfo(
          battleClient,
          battlefieldId,
          8000,
          addLog,
        );
        if (bfChk) {
          const sr = await getSelfRole(bfChk, tokenId, tokenStore);
          if (sr) {
            entered = true;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${name} 已进入战场(角色ID ${sr.id}, state=${sr.state})`,
              type: "success",
            });
          }
        }
        if (!entered) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${name} 进场确认中(${i + 1}/6)...`,
            type: "warn",
          });
        }
      }
      if (!entered) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 进场确认失败(战斗通道不稳定或未真正进场), 本轮跳过自动行军/攻击`,
          type: "error",
        });
      }
      await sleep(commandDelay);

      // 5.3 自动攻击/自动行军: 刷战场快照 -> 自动检测敌人/建筑/目标并行动
      let roundAttacks = 0;
      let roundMarches = 0;
      let roundSpeedUps = 0;
      if (options.autoAttack || options.autoMarch || options.autoSpeedUp) {
        const battlefield = await refreshBattlefieldInfo(
          battleClient,
          battlefieldId,
          8000,
          addLog,
        );
        if (battlefield) {
          const selfRole = await getSelfRole(battlefield, tokenId, tokenStore);
          const selfLegionId =
            selfRole?.legionID || selfRole?.legionId || null;

          if (!selfRole) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${name} 未检测到自己在战场中的角色(未进场), 跳过本轮自动行军/攻击`,
              type: "warn",
            });
          } else {

          // 5.3a 自动行军: 打开后按策略选择目标并 war_startmarch
          if (options.autoMarch) {
            let target = null;
            if (options.marchStrategy === "follow") {
              target = pickFollowTarget(battlefield, options.followMemberIds);
              if (target) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} 自动行军-跟随: 目标 (${target.x},${target.y})`,
                  type: "info",
                });
              } else {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 自动行军-跟随: 未找到选中成员的行军, 跳过`, type: "info" });
              }
            } else {
              target = pickNearToFarTarget(battlefield, selfRole, selfLegionId);
              if (target) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} 自动行军-由近到远: 目标 (${target.x},${target.y})`,
                  type: "info",
                });
              } else {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 自动行军-由近到远: 无可攻打建筑, 跳过`, type: "info" });
              }
            }
            if (target) {
              battleClient.send("war_startmarch", { battlefieldId, target });
              roundMarches++;
              await sleep(arriveTriggerDelay);
            }
          }

          if (options.autoAttackPlayers) {
            const enemies = detectAttackableEnemies(battlefield, selfLegionId);
            // 优先攻击: 勾选了优先阵容类型(吴国/毒爆等)时, 通过主通道查询敌人阵容,
            // 命中优先类型的敌人排到最前
            let list = enemies;
            if (
              options.priorityAttack &&
              options.priorityFormationNames?.length
            ) {
              const wanted = new Set(options.priorityFormationNames);
              const lineupCache = new Map();
              const withLineup = [];
              for (const enemy of enemies) {
                if (shouldStop()) break;
                const lineup = await getRoleLineupType(
                  tokenId,
                  tokenStore,
                  enemy.id,
                  lineupCache,
                );
                withLineup.push({ enemy, lineup });
              }
              const isPriority = (e) => wanted.has(e.lineup);
              const prio = withLineup.filter(isPriority);
              if (prio.length) {
                list = [
                  ...prio.map((e) => e.enemy),
                  ...withLineup.filter((e) => !isPriority(e)).map((e) => e.enemy),
                ];
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} 优先攻击: ${prio.length} 名敌人属于优先阵容(${[...wanted].join("/")}), 优先攻击`,
                  type: "info",
                });
              }
            } else {
              // 未开启优先攻击: 按精力升序, 先打精力少的敌人
              list = [...enemies].sort(
                (a, b) => enemyStamina(a) - enemyStamina(b),
              );
              if (list.length > 0) {
                const first = list[0];
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} 按精力升序攻击, 首选 ${first.name || first.id}(精力 ${enemyStamina(first)})`,
                  type: "info",
                });
              }
            }
            for (const enemy of list) {
              if (shouldStop()) break;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${name} 自动攻击敌人 ${enemy.name || enemy.id}(${enemy.id}) 精力${enemyStamina(enemy)} 复活${Number(enemy.revive || 0)}/5`,
                type: "info",
              });
              battleClient.send("war_startbattle", {
                battlefieldId,
                targetId: Number(enemy.id),
              });
              roundAttacks++;
              await sleep(commandDelay);
            }
          }

          if (options.autoAttackBuildings) {
            const buildings = detectAttackableBuildings(
              battlefield,
              selfLegionId,
            );
            for (const building of buildings) {
              if (shouldStop()) break;
              const [bx, by] = String(building.id || "")
                .split("_")
                .map(Number);
              // 先行军到建筑所在坐标, 再攻击建筑
              const target =
                Number.isFinite(bx) && Number.isFinite(by)
                  ? { x: bx, y: by }
                  : building.position;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${name} 自动攻击建筑 ${building.id}(hP ${building.hP}/${building.maxHP})`,
                type: "info",
              });
              if (target) {
                battleClient.send("war_startmarch", { battlefieldId, target });
                roundMarches++;
                await sleep(arriveTriggerDelay);
              }
              battleClient.send("war_startattackbuilding", {
                battlefieldId,
                buildingId: building.id,
              });
              roundAttacks++;
              await sleep(commandDelay);
            }
          }

          // 5.3c 自动加速: 刷新快照定位自己的行军, 发送 war_speedup(消耗金砖, 服务端校验)
          if (options.autoSpeedUp && !shouldStop()) {
            const bf2 = await refreshBattlefieldInfo(
              battleClient,
              battlefieldId,
              8000,
              addLog,
            );
            if (bf2) {
              let rid = selfRole?.id ?? null;
              if (rid == null) {
                const sr = await getSelfRole(bf2, tokenId, tokenStore);
                rid = sr?.id ?? null;
              }
              const mine =
                rid != null
                  ? valuesOf(bf2.marches || {}).filter(
                      (m) => String(m?.roleId) === String(rid),
                    )
                  : [];
              if (mine.length === 0) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${name} 自动加速: 当前无进行中的行军`,
                  type: "info",
                });
              } else {
                for (const m of mine) {
                  if (shouldStop()) break;
                  const marchId = m?.id ?? m?.marchId;
                  if (!marchId) continue;
                  battleClient.send("war_speedup", { battlefieldId, marchId });
                  roundSpeedUps++;
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${name} 行军加速 marchId=${marchId}`,
                    type: "info",
                  });
                  await sleep(commandDelay);
                }
              }
            }
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${name} 第${loopCount}轮行动统计: 攻击 ${roundAttacks} 次, 行军 ${roundMarches} 次, 加速 ${roundSpeedUps} 次`,
            type: "info",
          });
          }
        } else {
          addLog({ time: new Date().toLocaleTimeString(), message: `${name} 战场信息获取失败, 跳过本轮自动攻击/行军`, type: "warn" });
        }
      }

      // 5.4 手动行军到坐标已移除, 改为自动行军(5.3a)

      // 5.5 若未开启自动复活, 且没有自动攻击/自动行军/自动加速, 单轮后结束
      if (
        !options.autoResurrect &&
        !options.autoAttack &&
        !options.autoMarch &&
        !options.autoSpeedUp
      ) {
        break;
      }

      // 5.6 自动复活: 勾选后阵亡才复活, 复活后进入下一轮循环
      if (options.autoResurrect) {
        const battlefield = await refreshBattlefieldInfo(
          battleClient,
          battlefieldId,
          8000,
          addLog,
        );
        if (battlefield) {
          let roleId = null;
          try {
            const roleRes = await tokenStore.sendMessageWithPromise(
              tokenId,
              "role_getroleinfo",
              {},
              10000,
            );
            roleId = roleRes?.role?.roleId;
          } catch (_) {}

          const selfRole = roleId
            ? findSelfRole(battlefield, roleId)
            : null;

          if (!selfRole) {
            addLog({ time: new Date().toLocaleTimeString(), message: `${name} 无法定位自己在战场中的角色(roleId=${roleId}), 等待 5s 后再试`, type: "warn" });
            await waitWithStop(5000, shouldStop, sleep);
          } else if (!isDead(selfRole)) {
            // 存活, 稍候片刻等待战斗结算后继续下一轮
            await waitWithStop(3000, shouldStop, sleep);
          } else {
            // 阵亡: 选择复活方式
            usedFreeRevive = Number(selfRole.revive || 0);

            // 马上复活: 阵亡后立即用丹复活, 不等待免费复活CD
            if (options.instantRevive) {
              addLog({ time: new Date().toLocaleTimeString(), message: `${name} 阵亡, 马上复活(消耗复活丹)`, type: "info" });
              battleClient.send("war_resurrect", { battlefieldId });
              await sleep(commandDelay);
              continue;
            }

            if (usedFreeRevive >= FREE_REVIVE_MAX) {
              // 免费复活用尽
              if (options.useItem) {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 免费复活已用完(${usedFreeRevive}/${FREE_REVIVE_MAX}), 用丹复活`, type: "info" });
                battleClient.send("war_resurrect", { battlefieldId });
                await sleep(commandDelay);
              } else {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 免费复活次数已用完(${usedFreeRevive}/${FREE_REVIVE_MAX}), 结束战斗循环`, type: "warn" });
                break;
              }
            } else {
              // 免费复活: 等CD后发 war_resurrect
              const waitMs = freeReviveWaitMs(selfRole);
              if (waitMs > 0) {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 阵亡, 免费复活 CD 未到(reviveTime=${selfRole.reviveTime}, 本地+${FREE_REVIVE_GUARD_SECONDS}s), 等待 ${Math.round(waitMs / 1000)}s`, type: "info" });
              }
              const waited = await waitWithStop(waitMs, shouldStop, sleep);
              if (!waited) {
                addLog({ time: new Date().toLocaleTimeString(), message: `${name} 已停止, 放弃复活`, type: "warn" });
                break;
              }
              addLog({ time: new Date().toLocaleTimeString(), message: `${name} 免费复活 (第${usedFreeRevive + 1}/${FREE_REVIVE_MAX}次)`, type: "info" });
              battleClient.send("war_resurrect", { battlefieldId });
              await sleep(commandDelay);
              // 复活后清空复活字段计数由服务端维护, 下一轮重新读取
            }
          }
        } else {
          // 快照拉取失败, 稍候继续
          addLog({ time: new Date().toLocaleTimeString(), message: `${name} 战场信息获取失败, 等待 5s 后继续`, type: "warn" });
          await waitWithStop(5000, shouldStop, sleep);
        }
      } else if (
        !(options.autoAttack || options.autoMarch || options.autoSpeedUp)
      ) {
        break;
      } else {
        // 未开复活但开启了自动攻击/自动行军: 单轮后结束
        break;
      }
    }

    addLog({ time: new Date().toLocaleTimeString(), message: `${name} 盐场战斗执行完毕(共 ${loopCount} 轮)`, type: "success" });
    return { success: true };
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${name} 盐场战斗失败: ${error.message}`,
      type: "error",
    });
    return { success: false, error: error.message };
  } finally {
    if (battleClient) {
      try {
        battleClient.disconnect();
      } catch (_) {}
    }
  }
}
