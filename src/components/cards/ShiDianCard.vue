<template>
  <div class="status-card shidian-card">
    <!-- 卡片头部 -->
    <div class="card-header">
      <img src="/icons/moonPalace.png" alt="十殿图标" class="status-icon" />
      <div class="status-info">
        <h3>十殿</h3>
        <p>十殿信息与房间管理（单账号）</p>
      </div>
      <div class="status-badge" :class="{ active: isConnected }">
        <div class="status-dot" />
        <span>{{ isConnected ? "已连接" : "未连接" }}</span>
      </div>
    </div>

    <!-- 信息展示 -->
    <div class="info-grid">
      <div class="info-item">
        <span class="label">十殿层数</span>
        <span class="value">{{ info.nightmareLevel }}层</span>
      </div>
      <div class="info-item">
        <span class="label">转盘次数</span>
        <span class="value">{{ info.turntableLeftCnt }}</span>
      </div>
      <div class="info-item">
        <span class="label">枕头数量</span>
        <span class="value">{{ info.pillowCount }}</span>
      </div>
      <div class="info-item">
        <span class="label">队伍号</span>
        <span class="value">{{ info.teamId }}</span>
      </div>
      <div class="info-item">
        <span class="label">房间号</span>
        <span class="value">{{ info.roomId }}</span>
      </div>
      <div class="info-item">
        <span class="label">当前殿级</span>
        <span class="value">{{ info.currentLevel }}</span>
      </div>
    </div>

    <!-- 出战队员选择 -->
    <div class="join-row" style="margin-top: 8px;">
      <span class="label" style="white-space: nowrap;">出战队员</span>
      <n-select
        v-model:value="selectedFighterId"
        :options="fighterOptions"
        filterable
        clearable
        placeholder="选择出战的队员账号"
        size="small"
        style="flex: 1"
      />
    </div>

    <!-- 操作按钮 -->
    <div class="op-grid">
      <n-button size="small" :loading="busy === 'refresh'" :disabled="!isConnected || !!busy" @click="refreshInfo">
        刷新信息
      </n-button>
      <n-button size="small" type="primary" :loading="busy === 'claim'" :disabled="!isConnected || !!busy" @click="claimRewards">
        领取奖励
      </n-button>
      <n-button size="small" :loading="busy === 'switchTeam1'" :disabled="!isConnected || !!busy" @click="switchToTeam1">
        切换阵1
      </n-button>
      <n-button size="small" :loading="busy === 'createRoom'" :disabled="!isConnected || !!busy" @click="createRoom">
        创建房间
      </n-button>
      <n-button size="small" :loading="busy === 'setFighter'" :disabled="!isConnected || !!busy" @click="setFighter">
        出战人员
      </n-button>
      <n-button size="small" ghost :loading="busy === 'roomMembers'" :disabled="!isConnected || !!busy" @click="refreshRoomMembers">
        房间成员
      </n-button>
      <n-button size="small" type="warning" :loading="busy === 'startFight'" :disabled="!isConnected || !!busy" @click="startFight">
        开始十殿
      </n-button>
      <n-button size="small" type="primary" ghost :loading="busy === 'fightNext'" :disabled="!isConnected || !!busy" @click="fightNextLevel">
        打下一关
      </n-button>
      <n-button size="small" type="error" :loading="busy === 'dismissRoom'" :disabled="!isConnected || !!busy" @click="dismissRoom">
        解散十殿
      </n-button>
      <n-button size="small" :loading="busy === 'resetPillow'" :disabled="!!busy" @click="resetPillow">
        重置枕头
      </n-button>
    </div>

    <!-- 加入房间 -->
    <div class="join-row">
      <n-input
        v-model:value="joinTeamId"
        size="small"
        type="text"
        placeholder="输入要加入的队伍号（TeamID）"
        :disabled="!!busy"
        @keyup.enter="joinRoom"
      />
      <n-button
        size="small"
        type="primary"
        :loading="busy === 'joinRoom'"
        :disabled="!isConnected || !!busy"
        @click="joinRoom"
      >
        加入房间
      </n-button>
    </div>

    <!-- 操作日志 -->
    <div class="log-box" ref="logBox">
      <div v-if="logs.length === 0" class="log-empty">暂无操作日志</div>
      <div v-for="(log, i) in logs" :key="i" class="log-line" :class="log.type">
        <span class="log-time">{{ log.time }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useMessage } from "naive-ui";
import { useTokenStore, gameTokens } from "@/stores/tokenStore";

const tokenStore = useTokenStore();
const message = useMessage();

// 当前选中账号（单账号上下文，由 GameStatus 页面选择）
const token = computed(() => tokenStore.selectedToken || null);
const isConnected = computed(
  () =>
    !!token.value &&
    tokenStore.getWebSocketStatus(token.value.id) === "connected",
);

// 十殿信息
const info = ref({
  nightmareLevel: 0, // 本周十殿层数
  turntableLeftCnt: 0, // 转盘次数
  pillowCount: 0, // 枕头数量（物品5054）
  teamId: 0, // 队伍号
  roomId: 0, // 房间号
  currentLevel: 0, // 当前殿级
});

const joinTeamId = ref("");
// 出战的队员账号（可选，供"打下一关"使用）
const selectedFighterId = ref("");
// 当前十殿房间成员（点「房间成员」后刷新）
const roomMembers = ref([]);
// 出战队员下拉选项：优先房间成员；未刷新时退回账号列表
const fighterOptions = computed(() =>
  roomMembers.value.length
    ? roomMembers.value
    : gameTokens.value.map((t) => ({
        label: `${t.name}${t.server ? `(${t.server})` : ""}${t.id === token.value?.id ? "（当前）" : ""}`,
        value: t.id,
      })),
);
const busy = ref(""); // 当前执行中的操作标识
const commandDelay = 300; // 命令间隔（毫秒）
const logs = ref([]);
const logBox = ref(null);

// ============ 工具函数 ============
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const addLog = (msg, type = "info") => {
  logs.value.push({
    time: new Date().toLocaleTimeString(),
    message: msg,
    type,
  });
  nextTick(() => {
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
  });
};

const handleErr = (op, e) => {
  console.error(`十殿${op}失败:`, e);
  const msg = e?.message || e || "未知错误";
  addLog(`${op}失败: ${msg}`, "error");
  message.error(`${op}失败: ${msg}`);
};

const ensureToken = () => {
  if (!token.value) {
    message.warning("请先选择账号");
    return false;
  }
  if (!isConnected.value) {
    message.warning("WebSocket未连接，请先连接账号");
    return false;
  }
  return true;
};

// 物品数量解析（兼容数组/对象两种结构）
const getItemCount = (items, id) => {
  if (!items) return 0;
  if (Array.isArray(items)) {
    const found = items.find(
      (it) => Number(it?.id ?? it?.itemId) === Number(id),
    );
    return found
      ? Number(found.num ?? found.count ?? found.quantity ?? 0)
      : 0;
  }
  const node = items[String(id)] ?? items[id];
  if (node == null) {
    const match = Object.values(items).find(
      (v) => Number(v?.itemId ?? v?.id) === Number(id),
    );
    return match
      ? Number(match.num ?? match.count ?? match.quantity ?? 0)
      : 0;
  }
  return typeof node === "number"
    ? node
    : Number(node.quantity ?? node.num ?? node.count ?? 0);
};

// 日期字符串解析（如 20260101）
const parseDateString = (s) => {
  if (!s || s.length < 8) return null;
  return new Date(
    parseInt(s.substring(0, 4)),
    parseInt(s.substring(4, 6)) - 1,
    parseInt(s.substring(6, 8)),
  );
};

// 是否同一周（周一为一周开始）
const isSameWeek = (a, b) => {
  if (!a || !b) return false;
  const startOfWeek = (d) => {
    const c = new Date(d);
    const day = (c.getDay() + 6) % 7;
    c.setDate(c.getDate() - day);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
};

// 解析 nightmare_getroleinfo 响应
// 从 nightmare_getroleinfo 响应中提取转盘次数（兼容多种字段路径）
const getTurntableCnt = (res) => {
  if (!res) return 0;
  // 1. 顶层直接字段
  if (res.turntableLeftCnt !== undefined && res.turntableLeftCnt !== null) {
    return res.turntableLeftCnt;
  }
  // 2. weekAward（可能带日期键，取最新一条）
  const pickFromWeekAward = (weekAward) => {
    if (!weekAward || typeof weekAward !== "object") return undefined;
    if (weekAward.turntableLeftCnt !== undefined && weekAward.turntableLeftCnt !== null) {
      return weekAward.turntableLeftCnt;
    }
    const keys = Object.keys(weekAward).sort().reverse();
    return keys.length ? weekAward[keys[0]]?.turntableLeftCnt : undefined;
  };
  const nm = res?.nightMareData || res?.nightmareData || {};
  const fromWeekAward =
    pickFromWeekAward(nm.weekAward) ?? pickFromWeekAward(res.weekAward);
  if (fromWeekAward !== undefined && fromWeekAward !== null) {
    return fromWeekAward;
  }
  // 3. nightMareData 顶层字段
  if (nm.turntableLeftCnt !== undefined && nm.turntableLeftCnt !== null) {
    return nm.turntableLeftCnt;
  }
  return 0;
};

const parseNightmareStats = (res) => {
  const nm = res?.nightMareData || res?.nightmareData || {};
  const weekAward = nm.weekAward || res?.weekAward;
  let maxLevel = 0;
  let turntable = 0;
  if (weekAward && typeof weekAward === "object") {
    const keys = Object.keys(weekAward).sort().reverse();
    if (keys.length) {
      const latest = keys[0];
      const d = weekAward[latest];
      maxLevel = d?.maxLevel ?? 0;
      turntable = d?.turntableLeftCnt ?? 0;
      // 本周层数仅在同一周内有效
      if (maxLevel && !isSameWeek(new Date(), parseDateString(latest))) {
        maxLevel = 0;
      }
    }
  }
  if (!maxLevel) maxLevel = nm.maxLevel ?? res?.maxLevel ?? 0;
  if (!turntable) turntable = getTurntableCnt(res);
  return {
    nightmareLevel: Number(maxLevel) || 0,
    turntableLeftCnt: Number(turntable) || 0,
    currentLevel: Number(res?.nightmare?.level) || 0,
    roomId: Number(nm.roomId) || Number(res?.nightmare?.roomId) || 0,
  };
};

// ============ 十殿接口 ============
// 获取 roleId（优先使用角色信息中的，否则回退 token.id）
const getRoleId = async () => {
  const roleInfo = await tokenStore.sendGetRoleInfo(token.value.id);
  return roleInfo?.role?.roleId
    ? String(roleInfo.role.roleId)
    : token.value.id;
};

// 获取十殿信息
const getNightmareInfo = async (roleId) => {
  return await tokenStore.sendMessageWithPromise(
    token.value.id,
    "nightmare_getroleinfo",
    { roleId: parseInt(roleId) },
    10000,
  );
};

// 获取队伍号
const getTeamId = async () => {
  const roleId = await getRoleId();
  const result = await tokenStore.sendMessageWithPromise(
    token.value.id,
    "matchteam_getroleteaminfo",
    { roleID: parseInt(roleId) },
    10000,
  );
  const gDMTData = result?.roleMTData?.gDMTData;
  let teamId = 0;
  if (gDMTData && typeof gDMTData === "object") {
    const keys = Object.keys(gDMTData);
    if (keys.length) {
      teamId = gDMTData[keys[0]]?.teamId || 0;
    }
  }
  if (!teamId) teamId = Number(localStorage.getItem("shidian_teamId")) || 0;
  info.value.teamId = Number(teamId);
  return Number(teamId);
};

// 刷新当前十殿房间的成员名单（同队账号）
const refreshRoomMembers = async () => {
  if (!ensureToken()) return;
  busy.value = "roomMembers";
  try {
    const roleId = await getRoleId();
    const mine = await tokenStore.sendMessageWithPromise(
      token.value.id,
      "matchteam_getroleteaminfo",
      { roleID: parseInt(roleId) },
      12000,
    );
    const myTeams = mine?.roleMTData?.gDMTData || {};
    // 十殿队伍：优先 teamCfgId===7（十殿配置），否则非 cfg1 的队伍，再退化为全部
    const myKeys = Object.keys(myTeams);
    const sDianTeamKey =
      myKeys.find((k) => Number(myTeams[k]?.teamCfgId) === 7) ||
      myKeys.find((k) => Number(myTeams[k]?.teamCfgId) !== 1) ||
      (myKeys.length ? myKeys[0] : "");
    if (!sDianTeamKey) {
      message.warning("当前账号未加入任何队伍，请先加入十殿队伍");
      roomMembers.value = [];
      return;
    }
    const sDianTeamId = String(sDianTeamKey);
    addLog(`当前十殿队伍 ${sDianTeamId}，正在匹配同队成员...`);
    const members = [];
    // 房主本身算一名成员
    members.push({
      label: `${token.value.name}${token.value.server ? `(${token.value.server})` : ""}（房主）`,
      value: token.value.id,
    });
    // 依次检查其他账号是否也在该十殿队伍
    for (const t of gameTokens.value) {
      if (t.id === token.value.id) continue;
      let inTeam = false;
      try {
        if (tokenStore.getWebSocketStatus(t.id) !== "connected") {
          await tokenStore.createWebSocketConnection(t.id, t.token, t.wsUrl);
          let n = 0;
          while (tokenStore.getWebSocketStatus(t.id) !== "connected" && n < 20) {
            await sleep(600);
            n++;
          }
        }
        const res = await tokenStore.sendMessageWithPromise(
          t.id,
          "matchteam_getroleteaminfo",
          {},
          8000,
        );
        const theirTeams = res?.roleMTData?.gDMTData || {};
        inTeam = Object.keys(theirTeams).some(
          (k) => String(k) === sDianTeamId,
        );
      } catch (e) {
        addLog(`检查账号「${t.name}」失败，跳过: ${e?.message || e}`);
      }
      if (inTeam) {
        members.push({
          label: `${t.name}${t.server ? `(${t.server})` : ""}`,
          value: t.id,
        });
      }
    }
    roomMembers.value = members;
    addLog(`房间成员：${members.map((m) => m.label).join("、")}`);
    message.success(`已获取房间成员 ${members.length} 人`);
  } catch (e) {
    handleErr("房间成员", e);
  } finally {
    busy.value = "";
  }
};

// ============ 操作函数 ============
// 刷新信息
const refreshInfo = async () => {
  if (!ensureToken()) return;
  busy.value = "refresh";
  try {
    addLog("正在获取十殿信息...");
    const roleId = await getRoleId();
    const roleInfo = tokenStore.gameData?.roleInfo;
    const pillow = getItemCount(roleInfo?.role?.items, 5054);
    const res = await getNightmareInfo(roleId);
    const stats = parseNightmareStats(res);
    info.value = { ...info.value, ...stats, pillowCount: pillow };
    addLog(
      `十殿信息获取成功：层数${info.value.nightmareLevel}层，转盘${info.value.turntableLeftCnt}次，枕头${info.value.pillowCount}，房间号${info.value.roomId}，当前殿级${info.value.currentLevel}`,
    );
    message.success("十殿信息获取成功");
  } catch (e) {
    handleErr("刷新信息", e);
  } finally {
    busy.value = "";
  }
};

// 切换阵1
const switchToTeam1 = async () => {
  if (!ensureToken()) return;
  busy.value = "switchTeam1";
  try {
    addLog("正在切换阵容1...");
    await tokenStore.sendMessageWithPromise(
      token.value.id,
      "presetteam_saveteam",
      { teamId: 1 },
      10000,
    );
    await sleep(commandDelay);
    const teamId = await getTeamId();
    addLog(`已切换到阵容1，队伍号：${teamId}`);
    message.success("已切换到阵容1");
  } catch (e) {
    handleErr("切换阵1", e);
  } finally {
    busy.value = "";
  }
};

// 创建房间
const createRoom = async () => {
  if (!ensureToken()) return;
  busy.value = "createRoom";
  try {
    addLog("正在创建房间...");
    await tokenStore.sendGameMessage(token.value.id, "matchteam_create", {
      teamCfgId: 1,
      setting: {
        name: "相符的队伍",
        notice: "",
        secret: 1,
        apply: 0,
        applyList: [],
      },
    });
    await sleep(commandDelay);
    const teamId = await getTeamId();
    addLog(`房间创建成功，队伍号：${teamId}`);
    message.success("房间创建成功");
  } catch (e) {
    handleErr("创建房间", e);
  } finally {
    busy.value = "";
  }
};

// 加入房间并准备
const joinRoom = async () => {
  if (!ensureToken()) return;
  const teamId = Number(joinTeamId.value.trim() || info.value.teamId);
  if (!teamId) {
    message.warning("请先输入或获取队伍号");
    return;
  }
  busy.value = "joinRoom";
  try {
    addLog(`正在切换阵1并加入队伍 ${teamId}...`);
    // 切换阵1失败(如本周未解锁/阵容为空导致的200020)时不中断，仍继续尝试加入
    try {
      await tokenStore.sendMessageWithPromise(
        token.value.id,
        "presetteam_saveteam",
        { teamId: 1 },
        10000,
      );
      await sleep(commandDelay);
    } catch (e) {
      addLog(`切换阵1失败(${e?.message || e})，继续尝试加入队伍 ${teamId}...`);
    }
    await tokenStore.sendGameMessage(token.value.id, "matchteam_join", {
      teamId,
    });
    await sleep(commandDelay);
    await tokenStore.sendGameMessage(token.value.id, "matchteam_memberprepare", {
      teamId,
    });
    info.value.teamId = teamId;
    localStorage.setItem("shidian_teamId", String(teamId));
    addLog(`加入队伍 ${teamId} 并准备完成`);
    message.success("成功加入十殿并准备完成");
  } catch (e) {
    handleErr("加入房间", e);
  } finally {
    busy.value = "";
  }
};

// 开始十殿战斗
const startFight = async () => {
  if (!ensureToken()) return;
  if (!info.value.teamId) {
    message.warning("请先获取队伍号");
    return;
  }
  busy.value = "startFight";
  try {
    addLog("正在开始十殿战斗...");
    await tokenStore.sendGameMessage(token.value.id, "matchteam_openteam", {
      teamId: info.value.teamId,
      extParam: 0,
    });
    addLog("十殿战斗开始成功");
    message.success("十殿战斗开始成功");
  } catch (e) {
    handleErr("开始十殿", e);
  } finally {
    busy.value = "";
  }
};

// 打下一关：由队内的一个队员账号出战，房主发起（自动判断下一殿）
const fightNextLevel = async () => {
  if (!ensureToken()) return;
  if (!selectedFighterId.value) {
    message.warning("请先选择出战的队员账号");
    return;
  }
  const fighter = gameTokens.value.find((t) => t.id === selectedFighterId.value);
  if (!fighter) {
    message.warning("未找到所选队员账号");
    return;
  }
  busy.value = "fightNext";
  try {
    const roleId = await getRoleId(); // 房主 roleId，用于获取房间
    // 获取当前进度，自动判断下一殿（当前殿级+1）
    const nmRes = await getNightmareInfo(roleId);
    const stats = parseNightmareStats(nmRes);
    // 房间号：优先用刚拉取到的真实房间号，其次才回落
    const roomId = Number(stats.roomId) || Number(info.value.roomId) || Number(info.value.teamId);
    if (!roomId) {
      message.warning("未获取到房间号，请先点「刷新信息」");
      return;
    }
    const nextLevel = (Number(stats.currentLevel) || 0) + 1;
    // 出战的队员 roleId：账号名/ID 形如「名字-服务器-角色ID」，取末尾数字
    // 取不到再实时查询该队员 roleId，兜底用其 token.id
    const extractRoleId = (str) => {
      const parts = String(str || "").split("-");
      const tail = Number(parts[parts.length - 1]);
      return Number.isInteger(tail) && tail > 0 ? String(tail) : "";
    };
    let fighterRoleId =
      extractRoleId(fighter.name) || extractRoleId(fighter.id);
    if (!fighterRoleId) {
      try {
        const fRole = await tokenStore.sendGetRoleInfo(fighter.id);
        fighterRoleId = fRole?.role?.roleId
          ? String(fRole.role.roleId)
          : fighter.id;
      } catch (e) {
        fighterRoleId = fighter.id;
      }
    }
    addLog(`房间号${roomId}，出战队员「${fighter.name}」roleId=${fighterRoleId}，目标第 ${nextLevel} 殿`);
    // 由房主（当前选中账号）发出：设置队员出战 + 开始战斗
    // 步骤1：房主设置队员出战（该命令服务器不回 ack，用 fire-and-forget 不等回包）
    tokenStore.sendGameMessage(token.value.id, "nightmare_setfighter", {
      roomId,
      roleId: parseInt(fighterRoleId),
    });
    addLog("设置出战指令已发出");
    // 步骤2：房主发起战斗
    try {
      await tokenStore.sendMessageWithPromise(
        token.value.id,
        "nightmare_fight",
        { roomId, roleId: parseInt(fighterRoleId) },
        20000,
      );
      addLog("开始战斗指令已发送并收到回包");
      message.success(`第 ${nextLevel} 殿已由 ${fighter.name} 开始`);
    } catch (e) {
      addLog(`开始战斗超时/无回包: ${e?.message || e}（以游戏内实际为准）`);
      message.info(`第 ${nextLevel} 殿指令已发出，请到游戏内确认`);
    }
  } catch (e) {
    handleErr("打下一关", e);
  } finally {
    busy.value = "";
  }
};

// 设置出战人员
const setFighter = async () => {
  if (!ensureToken()) return;
  if (!info.value.teamId) {
    message.warning("请先获取队伍号");
    return;
  }
  busy.value = "setFighter";
  try {
    // 出战人员：从所选队员中挑 1 个作为出战（5 人中的 1 个）
    if (!selectedFighterId.value) {
      message.warning("请先选择出战的队员账号");
      return;
    }
    const fighter = gameTokens.value.find((t) => t.id === selectedFighterId.value);
    if (!fighter) {
      message.warning("未找到所选队员账号");
      return;
    }
    const extractRoleId = (str) => {
      const parts = String(str || "").split("-");
      const tail = Number(parts[parts.length - 1]);
      return Number.isInteger(tail) && tail > 0 ? String(tail) : "";
    };
    const fighterRoleId =
      extractRoleId(fighter.name) ||
      extractRoleId(fighter.id) ||
      fighter.id;
    addLog(`设置出战: 队员「${fighter.name}」roleId=${fighterRoleId}，房间号${info.value.teamId}`);
    await tokenStore.sendGameMessage(token.value.id, "nightmare_setfighter", {
      roomId: info.value.teamId,
      roleId: parseInt(fighterRoleId),
    });
    addLog("出战人员设置成功");
    message.success(`出战人员已设为 ${fighter.name}`);
  } catch (e) {
    handleErr("出战人员", e);
  } finally {
    busy.value = "";
  }
};

// 解散十殿
const dismissRoom = async () => {
  if (!ensureToken()) return;
  if (!info.value.teamId) {
    message.warning("请先获取队伍号");
    return;
  }
  busy.value = "dismissRoom";
  try {
    addLog("正在解散十殿...");
    await tokenStore.sendGameMessage(token.value.id, "nightmare_dismiss", {
      roomId: info.value.teamId,
    });
    addLog("解散十殿执行成功");
    message.success("解散十殿执行成功");
  } catch (e) {
    handleErr("解散十殿", e);
  } finally {
    busy.value = "";
  }
};

// 重置枕头（清空本地枕头计数缓存）
const resetPillow = async () => {
  if (busy.value) return;
  busy.value = "resetPillow";
  try {
    const key = "pageTokenData_shidian";
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      v.tokenPillowCount = {};
      localStorage.setItem(key, JSON.stringify(v));
    }
    info.value.pillowCount = 0;
    addLog("十殿枕头数量已重置");
    message.success("十殿枕头数量已重置");
  } catch (e) {
    message.error("重置十殿枕头数量失败");
    console.error("重置十殿枕头数量失败:", e);
  } finally {
    busy.value = "";
  }
};

// 领取奖励（含转盘循环）
const claimRewards = async () => {
  if (!ensureToken()) return;
  busy.value = "claim";
  try {
    addLog("=== 开始领取十殿奖励 ===");
    const roleId = await getRoleId();

    addLog("执行转盘奖励次数领取...");
    await tokenStore.sendGameMessage(
      token.value.id,
      "nightmare_claimturnrewardtimes",
      {},
    );
    await sleep(commandDelay);

    addLog("领取十殿图鉴奖励...");
    await tokenStore.sendGameMessage(token.value.id, "nightmare_claimbook", {});
    await sleep(commandDelay);

    addLog("领取十殿周奖励...");
    await tokenStore.sendGameMessage(
      token.value.id,
      "nightmare_claimweekreward",
      {},
    );
    await sleep(commandDelay);

    // 转盘循环：直到转盘次数为0
    const initial = await getNightmareInfo(roleId);
    let bookScore =
      initial?.nightMareData?.bookScore ?? initial?.bookScore ?? 0;
    let iterations = 0;
    while (iterations < 100) {
      const res = await getNightmareInfo(roleId);
      const turntable = Number(getTurntableCnt(res)) || 0;
      if (!turntable) {
        addLog("转盘次数已用完");
        break;
      }
      // bookScore为5的倍数时领取转盘奖励次数
      if (bookScore > 0 && bookScore % 5 === 0) {
        await tokenStore.sendGameMessage(
          token.value.id,
          "nightmare_claimturnrewardtimes",
          {},
        );
        await sleep(commandDelay);
        addLog("bookScore为5的倍数，转盘奖励次数+1");
      }
      // bookScore达到50时领取十殿图鉴奖励
      if (bookScore === 50) {
        await tokenStore.sendGameMessage(token.value.id, "nightmare_claimbook", {});
        await sleep(commandDelay);
        addLog("bookScore=50，已领取十殿图鉴奖励");
      }
      await tokenStore.sendGameMessage(
        token.value.id,
        "nightmare_clickturntable",
        {},
      );
      await sleep(commandDelay);
      bookScore++;
      addLog(`转盘执行成功，剩余次数：${turntable - 1}`);
      iterations++;
    }
    if (iterations >= 100) {
      addLog("转盘操作达到最大迭代次数，已停止", "error");
    }

    // 更新展示信息
    const roleInfo = tokenStore.gameData?.roleInfo;
    const pillow = getItemCount(roleInfo?.role?.items, 5054);
    info.value.pillowCount = pillow;
    addLog("=== 十殿奖励领取完成 ===");
    message.success("十殿奖励领取完成");
  } catch (e) {
    handleErr("领取奖励", e);
  } finally {
    busy.value = "";
  }
};

// ============ 生命周期 ============
// 切换账号时重置并自动刷新
watch(
  () => token.value?.id,
  () => {
    info.value = {
      nightmareLevel: 0,
      turntableLeftCnt: 0,
      pillowCount: 0,
      teamId: Number(localStorage.getItem("shidian_teamId")) || 0,
      roomId: 0,
      currentLevel: 0,
    };
    joinTeamId.value = "";
  },
);

// 连接成功后自动刷新一次
let autoLoaded = false;
watch(
  isConnected,
  (v) => {
    if (v && !autoLoaded) {
      autoLoaded = true;
      refreshInfo();
    }
    if (!v) autoLoaded = false;
  },
  { immediate: true },
);

onMounted(() => {
  const savedTeamId = localStorage.getItem("shidian_teamId");
  if (savedTeamId) {
    info.value.teamId = Number(savedTeamId);
    joinTeamId.value = savedTeamId;
  }
});
</script>

<style scoped lang="scss">
.shidian-card {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.card-header {
  display: flex;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);

  .status-icon {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: 12px;
    margin-right: 16px;
  }

  .status-info {
    flex: 1;

    h3 {
      margin: 0 0 4px 0;
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
    }

    p {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
    }
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--bg-tertiary, #f5f5f5);
    font-size: 12px;
    color: var(--text-tertiary, #999);

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-tertiary, #999);
    }

    &.active {
      color: #18a058;
      background: rgba(24, 160, 88, 0.1);

      .status-dot {
        background: #18a058;
        box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.2);
      }
    }
  }
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-tertiary, #f5f5f5);
    border: 1px solid var(--border-light, #ebebeb);

    .label {
      font-size: 12px;
      color: var(--text-tertiary, #999);
    }

    .value {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, #333);
    }
  }
}

.op-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.join-row {
  display: flex;
  gap: 8px;

  .n-input {
    flex: 1;
  }
}

.log-box {
  height: 280px;
  overflow-y: auto;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-tertiary, #f8f8f8);
  border: 1px solid var(--border-light, #ebebeb);
  font-family: "SF Mono", "Monaco", "Consolas", monospace;
  font-size: 12px;

  .log-empty {
    color: var(--text-tertiary, #999);
    text-align: center;
    padding: 24px 0;
  }

  .log-line {
    display: flex;
    gap: 8px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;

    .log-time {
      color: var(--text-tertiary, #999);
      flex-shrink: 0;
    }

    &.error .log-msg {
      color: #d03050;
    }

    &.info .log-msg {
      color: var(--text-primary, #333);
    }
  }
}
</style>
