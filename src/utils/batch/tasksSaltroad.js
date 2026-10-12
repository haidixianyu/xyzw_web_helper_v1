/**
 * 天宫助威任务（赛季瑞士轮军团对阵助威）
 * 包含: 拉取可助威军团名单(fetchSaltroadCheerCandidates)、批量天宫助威(batchSaltroadCheer)
 *
 * 协议依据(2026-10-12 抓包 log_{_tag___ma}.txt + 2026-10-13 实测):
 * - saltroad_getoutopponent params {"phase":"261016"} → resp.opponentList[]
 *   每项含 battlefieldId("SEASON_SWISS_ROUND_OF_3-261016:356800002")、groupId、
 *   leftLegion / rightLegion（legionId/name/serverId/power/goldenScore/goldenRank 等）
 * - saltroad_outcheer params {"legionId":326051} → 无独立应答包，
 *   生效确认走 syncresp: role.statistics["sr:out:cheer:*"] = 助威军团 legionId
 *   （与 pkroom_appoint 的 syncresp 确认模式一致）
 * - 期号 phase 为 YYMMDD（2026-10-12 周一查询时为 261016，即当周周五），
 *   无法从静态数据取得时按日期候选自动探测
 * - 助威统计键跨期累积（实测同时存在 261003=本期 与 260718=上期天宫），
 *   判断"本期已助威"须按期号前 4 位（YYMM）过滤；重复助威服务端报 2300080
 */
import { workerSleep } from "../workerTimer.js";

// 助威确认统计键前缀（syncresp: role.statistics["sr:out:cheer:<期>"] = legionId）
const CHEER_STAT_PREFIX = "sr:out:cheer:";

/**
 * 创建天宫助威任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksSaltroad(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
  } = deps;

  /** 日期 → YYMMDD 期号 */
  const fmtPhase = (d) => {
    const y = String(d.getFullYear()).slice(2);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  };

  /**
   * 构建期号探测候选（YYMMDD）
   * 观察: 2026-10-12(周一) 查询期为 261016(当周周五)，故下一周五优先，
   * 其次今天，再扫描前后各若干天兜底
   */
  const buildPhaseCandidates = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextFriday = new Date(today);
    nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7));

    const list = [fmtPhase(nextFriday), fmtPhase(today)];
    for (let i = 1; i <= 11; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      list.push(fmtPhase(d));
    }
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      list.push(fmtPhase(d));
    }
    return [...new Set(list)];
  };

  /** 拉取对阵名单，失败/空期返回 [] */
  const fetchOutOpponent = async (tokenId, phase) => {
    try {
      const resp = await tokenStore.sendMessageWithPromise(
        tokenId,
        "saltroad_getoutopponent",
        { phase },
        8000,
      );
      const list = resp?.opponentList;
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  };

  /** 对阵名单 → 可助威军团候选行（按天宫排名升序） */
  const buildCandidates = (opponentList) => {
    const rows = [];
    for (const bf of opponentList || []) {
      for (const sideKey of ["leftLegion", "rightLegion"]) {
        const lg = bf?.[sideKey];
        if (!lg?.id) continue;
        rows.push({
          legionId: lg.id,
          name: lg.name || `军团${lg.id}`,
          serverId: lg.serverId,
          power: lg.power,
          redQuench: lg.redQuench,
          goldenScore: lg.goldenScore,
          goldenRank: lg.goldenRank,
          sOWinCnt: lg.sOWinCnt,
          groupId: bf.groupId,
          battlefieldId: bf.battlefieldId,
          side: sideKey === "leftLegion" ? "左" : "右",
        });
      }
    }
    rows.sort((a, b) => (a.goldenRank || 999) - (b.goldenRank || 999));
    return rows;
  };

  /**
   * 解析当前期号并对阵名单
   * @param {string} tokenId - 用于查询的账号
   * @param {string} manualPhase - 手动期号(YYMMDD)，为空自动探测
   */
  const resolvePhaseAndList = async (tokenId, manualPhase = "") => {
    const want = String(manualPhase || "").trim();
    if (want) {
      const list = await fetchOutOpponent(tokenId, want);
      return {
        phase: want,
        opponentList: list,
        reason: list.length ? "" : `期号 ${want} 无对阵名单`,
      };
    }

    for (const phase of buildPhaseCandidates()) {
      const list = await fetchOutOpponent(tokenId, phase);
      if (list.length > 0) {
        return { phase, opponentList: list, reason: "" };
      }
      await workerSleep(150);
    }
    return {
      phase: "",
      opponentList: [],
      reason: "自动探测期号未取得对阵名单（助威未开启或已结束），可在期号框手动输入后刷新",
    };
  };

  /**
   * 拉取现有可助威军团名单（用第一个选中账号的连接查询）
   * @param {string} manualPhase - 手动期号，留空自动探测
   * @returns {{phase: string, candidates: Array, reason: string}}
   */
  const fetchSaltroadCheerCandidates = async (manualPhase = "") => {
    if (selectedTokens.value.length === 0) {
      throw new Error("请先选择账号");
    }
    const tokenId = selectedTokens.value[0];
    const token = tokens.value.find((t) => t.id === tokenId);
    let connectedHere = false;
    try {
      await ensureConnection(tokenId);
      connectedHere = true;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 拉取天宫助威名单（${token?.name || tokenId}）===`,
        type: "info",
      });

      const { phase, opponentList, reason } = await resolvePhaseAndList(
        tokenId,
        manualPhase,
      );
      const candidates = buildCandidates(opponentList);
      if (candidates.length > 0) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `期号 ${phase} 共 ${opponentList.length} 场对阵、${candidates.length} 个可助威军团`,
          type: "success",
        });
      }
      return { phase, candidates, reason };
    } finally {
      if (connectedHere) {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token?.name || tokenId} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    }
  };

  /** 从角色信息中提取全部助威统计记录 [{key, legionId, suffix}] */
  const extractCheerEntries = (resp) => {
    const stats = resp?.role?.statistics || resp?.statistics || {};
    return Object.entries(stats)
      .filter(([k]) => k.startsWith(CHEER_STAT_PREFIX))
      .map(([key, v]) => ({
        key,
        legionId: Number(v),
        // 键后缀 6 位数字（如 261003），取不出来时按 0 排序兜底
        suffix: Number(String(key).slice(CHEER_STAT_PREFIX.length)) || 0,
      }));
  };

  /**
   * 挑选"本期"助威记录：统计键跨期累积，须按期号年月（前 4 位 YYMM）过滤
   * 期号未知时退化为取后缀最大的一条；过滤后为空返回 null（视为本期未助威）
   */
  const pickCurrentCheerEntry = (entries, phase) => {
    if (!entries || entries.length === 0) return null;
    const ym = String(phase || "").slice(0, 4);
    const latest = (list) =>
      list.reduce((a, b) => (a.suffix > b.suffix ? a : b));
    if (ym) {
      const current = entries.filter((e) =>
        e.key.startsWith(CHEER_STAT_PREFIX + ym),
      );
      // 期号年月能对上（正常情况）→ 只认本期记录，避免误读上期天宫记录
      return current.length > 0 ? latest(current) : null;
    }
    return latest(entries);
  };

  /** 查询角色助威统计（失败返回 []，不影响主流程） */
  const fetchCheerEntries = async (tokenId) => {
    try {
      const resp = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        8000,
      );
      return extractCheerEntries(resp);
    } catch (e) {
      return [];
    }
  };

  /**
   * 批量天宫助威：对全部选中账号，把助威投给指定军团
   * 助威前先预检角色统计，本期已助威则跳过，不重复发指令
   * @param {Object} target - 候选行 {legionId, name, ...}
   * @param {string} phase - 对阵期号（YYMMDD，用于过滤本期统计键）
   */
  const batchSaltroadCheer = async (target, phase = "") => {
    if (!target?.legionId) {
      message.warning("请先选择助威对象");
      return;
    }
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择账号");
      return;
    }

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const targetLegionId = Number(target.legionId);

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        await ensureConnection(tokenId);

        // 1. 预检：本期已助威则直接跳过（统计键跨期累积，须按期号年月过滤）
        const preCurrent = pickCurrentCheerEntry(
          await fetchCheerEntries(tokenId),
          phase,
        );
        if (preCurrent) {
          tokenStatus.value[tokenId] = "completed";
          if (preCurrent.legionId === targetLegionId) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 本期已助威 ${target.name}（${preCurrent.key}=${preCurrent.legionId}），跳过 ===`,
              type: "info",
            });
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 本期已助威其他军团（${preCurrent.key}=${preCurrent.legionId}），无法变更，跳过 ===`,
              type: "warning",
            });
          }
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始天宫助威: ${token.name} → ${target.name}(${target.legionId}) ===`,
          type: "info",
        });

        // 2. 发起助威（无独立应答包，生效确认随 syncresp 返回）
        let ok = false;
        let detail = "";
        try {
          const resp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "saltroad_outcheer",
            { legionId: target.legionId },
            10000,
          );
          const entry = pickCurrentCheerEntry(
            extractCheerEntries(resp),
            phase,
          );
          ok = true;
          detail = entry
            ? `已记录 ${entry.key}=${entry.legionId}`
            : "服务器已受理(code=0)";
        } catch (err) {
          // 3. 应答超时/被拒（如 2300080 已助威）→ 用角色统计核验实际生效状态
          await workerSleep(1200);
          const cur = pickCurrentCheerEntry(
            await fetchCheerEntries(tokenId),
            phase,
          );
          if (cur && cur.legionId === targetLegionId) {
            ok = true;
            detail = `应答异常但统计已生效（${cur.key}）`;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 助威指令异常: ${err.message}，经统计核验已生效`,
              type: "warning",
            });
          } else if (cur) {
            throw new Error(
              `本轮已助威其他军团（${cur.key}=${cur.legionId}），无法变更`,
            );
          } else {
            throw err;
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 天宫助威成功 → ${target.name}(${target.legionId})${detail ? `: ${detail}` : ""} ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 天宫助威失败: ${error.message || "未知错误"} ===`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量天宫助威结束");
  };

  return {
    fetchSaltroadCheerCandidates,
    batchSaltroadCheer,
    resolvePhaseAndList,
    buildCandidates,
  };
}
