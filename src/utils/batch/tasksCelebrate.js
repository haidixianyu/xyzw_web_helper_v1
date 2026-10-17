/**
 * 周年活动批量任务
 * 祝福(签到) / 领取(个人 + 分享) / 抽奖(单抽 + 十连抽) / 入镜任务领取
 *
 * 入镜任务复用“通行证(warOrder)”活动框架（命令 activity_warordertaskclaim），
 * 与 tasksXuanwuBlessing.js 同构；区别是活动ID后缀与只领取任务序号 01-05。
 */

import { getXuanwuActBase } from "@/utils/towerActId";

// 入镜任务活动ID后缀（前缀 = 活动起始日期 YYMMDD，如 "261016" + "9" = 2610169）
const WAR_ORDER_SUFFIX = "9";

// 入镜任务只领取序号 01-05（906-914 暂不处理）
const MAX_MISSION_INDEX = 5;

// 十连抽次数
const DRAW_BATCH_TIMES = 10;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatReward = (reward = []) =>
  reward
    .map((r) => {
      if (r.type === 2) return `金砖x${r.value}`;
      if (r.type === 3) return `道具${r.itemId}x${r.value}`;
      return `类型${r.type}x${r.value}`;
    })
    .join(", ");

// 周年签到按“天”记录在 signCelebrate.personalSignMap，键为服务端日期 YYMMDD
// （同游戏端 judgeCelebrationSignRed: getFormatBySecond(serverTime,11)）。
// 因此“当日是否已祝福”== personalSignMap 中是否存在今日 YYMMDD 键。
const formatYYMMDD = (ts = Date.now()) => {
  const d = new Date(ts);
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
};

/** 归一化 personalSignMap 的日期键（兼容对象 / 数组两种序列化形态） */
const signDayKeys = (info) => {
  const map = info?.personalSignMap;
  if (!map) return [];
  if (Array.isArray(map)) return map.map((e) => String(e?.key ?? e?.k ?? e));
  return Object.keys(map);
};

/** 当日是否已祝福 */
const hasSignedToday = (info) => signDayKeys(info).includes(formatYYMMDD());

/**
 * 创建周年活动批量任务执行器
 * @param {Object} deps - 依赖项（与其它任务模块一致）
 * @returns {Object} 任务函数集合
 */
export function createTasksCelebrate(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    delayConfig,
  } = deps;

  const commandDelay = delayConfig?.command || delayConfig?.action || 300;

  // tokenId -> 本轮已确认未达标的「任务:进度」集合（每轮开始清空）
  const claimMissCache = new Map();

  const log = (msg, type = "info") =>
    addLog({ time: new Date().toLocaleTimeString(), message: msg, type });

  /**
   * 批量执行外壳：建连 -> 执行 handler -> 释放连接
   * @param {string} label 任务名（用于日志）
   * @param {Function} handler (token, tokenId) => Promise<void>
   */
  const runBatch = async (label, handler) => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      try {
        log(`=== 开始${label}: ${token.name} ===`);
        claimMissCache.set(tokenId, new Set());
        await ensureConnection(tokenId);
        if (shouldStop.value) return;

        await handler(token, tokenId);
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        log(`${token.name} ${label}失败: ${error.message || "未知错误"}`, "error");
      } finally {
        claimMissCache.delete(tokenId);
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        log(`${token.name} 连接已关闭`);
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success(`${label}结束`);
  };

  // ---------------- 周年祝福 / 领取 ----------------

  /** 取 signCelebrate 信息（sign 与 getcelebrateinfo 响应结构一致） */
  const pickSignCelebrate = (res) =>
    res?.signCelebrate || res?.celebrateInfoResp?.signCelebrate || null;

  /** 周年祝福（签到）：celebrate_sign，响应即活动信息 */
  const sendCelebrateSign = async (tokenId) =>
    pickSignCelebrate(
      await tokenStore.sendMessageWithPromise(tokenId, "celebrate_sign", {}, 8000),
    );

  /** 拉取周年活动信息 */
  const fetchCelebrateInfo = async (tokenId) =>
    pickSignCelebrate(
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "celebrate_getcelebrateinfo",
        {},
        8000,
      ),
    );

  /** 从 personalClaimMap 取可领取的档位 key（canClaimCnt > claimCnt） */
  const claimableKeys = (claimMap = {}) =>
    Object.entries(claimMap)
      .filter(([, v]) => (v?.canClaimCnt ?? 0) > (v?.claimCnt ?? 0))
      .map(([k]) => Number(k))
      .filter((n) => Number.isFinite(n) && n > 0);

  /** 领取个人奖励（签到档位） */
  const claimPersonal = async (tokenId, idList, tokenName) => {
    if (!idList.length) return 0;
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "celebrate_claimpersonal",
        { idList },
        8000,
      );
      if (res?.reward?.length) {
        log(
          `${tokenName} 周年个人领取[${idList.join(",")}]: ${formatReward(res.reward)}`,
          "success",
        );
        return res.reward.length;
      }
      return 0;
    } catch (error) {
      log(
        `${tokenName} 周年个人领取[${idList.join(",")}]跳过: ${error.message || "不可领取"}`,
        "info",
      );
      return 0;
    }
  };

  /** 分享领取 */
  const shareCelebrate = async (tokenId, id, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "celebrate_share",
        { id },
        8000,
      );
      if (res?.reward?.length) {
        log(
          `${tokenName} 周年分享领取[${id}]: ${formatReward(res.reward)}`,
          "success",
        );
        return 1;
      }
      return 0;
    } catch (error) {
      log(
        `${tokenName} 周年分享[${id}]跳过: ${error.message || "不可分享"}`,
        "info",
      );
      return 0;
    }
  };

  /** 周年祝福（签到）：先只读拉取信息，当日已祝福则跳过 celebrate_sign */
  const batchCelebrateSign = async () =>
    runBatch("周年祝福", async (token, tokenId) => {
      // celebrate_getcelebrateinfo 为只读查询，响应与 sign 同构（含 personalSignMap）
      const pre = await fetchCelebrateInfo(tokenId);
      if (hasSignedToday(pre)) {
        log(
          `${token.name} 周年祝福今日已完成，跳过 (已签到 ${signDayKeys(pre).length} 天)`,
          "info",
        );
        return;
      }

      const info = await sendCelebrateSign(tokenId);
      if (info) {
        log(
          `${token.name} 周年祝福完成: 已签到 ${signDayKeys(info).length} 天`,
          "success",
        );
      } else {
        log(`${token.name} 周年祝福已发送（无返回信息）`, "info");
      }
    });

  /** 周年领取：签到档位 -> 个人领取 -> 分享领取 */
  const batchCelebrateClaim = async () =>
    runBatch("周年领取", async (token, tokenId) => {
      const info = await fetchCelebrateInfo(tokenId);
      if (!info) {
        log(`${token.name} 未取到周年信息，跳过领取`, "warning");
        return;
      }

      const keys = claimableKeys(info.personalClaimMap || {});
      let claimed = 0;
      let shared = 0;

      if (keys.length) {
        claimed = await claimPersonal(tokenId, keys, token.name);
        await delay(commandDelay);
      }

      // 分享领取：对本次可领/已领的档位逐个尝试（已分享过的服务端会拒绝）
      for (const id of keys) {
        if (shouldStop.value) break;
        shared += await shareCelebrate(tokenId, id, token.name);
        await delay(commandDelay);
      }

      log(
        `${token.name} 周年领取完成: 个人${claimed}, 分享${shared}, 档位[${keys.join(",") || "无"}]`,
        claimed + shared > 0 ? "success" : "info",
      );
    });

  // ---------------- 周年抽奖 ----------------

  /** 发送抽奖请求（times: 10 或 1），不打印日志 */
  const sendLottery = async (tokenId, times) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_maydaylottery",
        { times },
        8000,
      );
      return {
        ok: true,
        reward: res?.reward || [],
        lotteryNum:
          res?.mayDayLotteryInfo?.lotteryNum ?? res?.lotteryNum ?? undefined,
      };
    } catch (error) {
      return { ok: false, error: error.message || "未知错误" };
    }
  };

  /** 周年单抽：抽 1 次（times: 1） */
  const batchCelebrateSingleLottery = async () =>
    runBatch("周年单抽", async (token, tokenId) => {
      const res = await sendLottery(tokenId, 1);
      if (!res.ok) {
        log(`${token.name} 周年单抽失败: ${res.error}`, "warning");
        return;
      }
      log(
        `${token.name} 周年单抽: ${formatReward(res.reward) || "无奖励"} (累计${res.lotteryNum ?? "?"}次)`,
        "success",
      );
    });

  /** 周年十连抽：抽 10 次（times: 10） */
  const batchCelebrateTenLottery = async () =>
    runBatch("周年十连抽", async (token, tokenId) => {
      const res = await sendLottery(tokenId, DRAW_BATCH_TIMES);
      if (!res.ok) {
        log(`${token.name} 周年十连抽失败: ${res.error}`, "warning");
        return;
      }
      log(
        `${token.name} 周年十连抽: ${formatReward(res.reward) || "无奖励"} (累计${res.lotteryNum ?? "?"}次)`,
        "success",
      );
    });

  // ---------------- 周年入镜任务（通行证框架，仅 01-05） ----------------

  /** 拉取通行证活动信息 */
  const fetchWarOrder = async (tokenId, actId) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_warorderget",
        { actId },
        8000,
      );
      const info =
        res?.activity?.warOrderActivityInfo?.[actId] ||
        res?.warOrderActivityInfo?.[actId] ||
        null;
      if (info) return { info, error: null };
      return { info: null, error: "无该活动数据" };
    } catch (error) {
      return { info: null, error: error.message || "请求失败" };
    }
  };

  /** 从 activity_get 取当前开启的通行证活动ID */
  const listWarOrderActIds = async (tokenId) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_get",
        {},
        8000,
      );
      const activity = res?.activity || res || {};
      const map = activity.warOrderActivityInfo || {};
      return Object.keys(map)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    } catch {
      return [];
    }
  };

  /** 解析周年入镜任务活动ID：先按日期前缀+后缀推导，再回退活动列表枚举 */
  const resolveWarOrder = async (tokenId, tokenName) => {
    const candidates = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      candidates.push(Number(getXuanwuActBase(date) + WAR_ORDER_SUFFIX));
    }
    // 活动列表枚举中，仅取后缀匹配的（避免误领其它通行证活动）
    const listed = (await listWarOrderActIds(tokenId)).filter((n) =>
      String(n).endsWith(WAR_ORDER_SUFFIX),
    );
    const actIds = [...new Set([...candidates, ...listed])];

    const tried = [];
    for (const actId of actIds) {
      if (shouldStop.value) return null;
      const { info, error } = await fetchWarOrder(tokenId, actId);
      if (info) return { actId, info };
      tried.push(`${actId}: ${error}`);
    }

    log(
      `${tokenName} 未找到周年入镜任务活动，探测结果: ${tried.join(" | ")}`,
      "warning",
    );
    return null;
  };

  /** 领取入镜任务（仅 missionId 末两位 01-05，未领取且进度>0） */
  const claimCelebrateTasks = async (tokenId, actId, info, tokenName) => {
    const complete = info?.complete || {};
    const claimedMap = info?.taskClaimed || {};
    const missed = claimMissCache.get(tokenId) || new Set();
    let claimed = 0;
    let skipped = 0;

    for (const [missionIdStr, progress] of Object.entries(complete)) {
      if (shouldStop.value) break;
      if (claimedMap[missionIdStr] === true) continue;
      if (!(progress > 0)) continue;

      const missionIndex = Number(String(missionIdStr).slice(-2));
      if (!(missionIndex >= 1 && missionIndex <= MAX_MISSION_INDEX)) continue;

      const missKey = `${missionIdStr}:${progress}`;
      if (missed.has(missKey)) continue;

      let granted = false;
      let rejected = false;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_warordertaskclaim",
          { actId, missionId: Number(missionIdStr) },
          8000,
        );
        const latest = res?.activity?.warOrderActivityInfo?.[actId]?.taskClaimed;
        if (latest) Object.assign(claimedMap, latest);

        if (res?.reward?.length) {
          log(
            `${tokenName} 入镜任务${missionIdStr}领取: ${formatReward(res.reward)}`,
            "success",
          );
          claimed++;
          granted = true;
        } else {
          skipped++;
          rejected = true;
        }
      } catch (error) {
        skipped++;
        rejected = String(error?.message || "").includes("服务器错误");
      }

      if (granted) {
        await delay(commandDelay);
      } else if (rejected) {
        missed.add(missKey);
      }
    }

    log(
      `${tokenName} 入镜任务: 领取 ${claimed}, 跳过 ${skipped}`,
      claimed > 0 ? "success" : "info",
    );
    return claimed;
  };

  /** 周年入镜任务领取（901-905） */
  const batchCelebrateWarOrderClaim = async () =>
    runBatch("周年入镜任务", async (token, tokenId) => {
      const resolved = await resolveWarOrder(tokenId, token.name);
      if (!resolved) {
        throw new Error("未找到周年入镜任务活动，请确认活动是否开启");
      }
      const claimed = await claimCelebrateTasks(
        tokenId,
        resolved.actId,
        resolved.info,
        token.name,
      );
      log(
        `${token.name} 周年入镜任务完成: 领取 ${claimed} 个 (活动${resolved.actId})`,
        "success",
      );
    });

  return {
    batchCelebrateSign,
    batchCelebrateClaim,
    batchCelebrateSingleLottery,
    batchCelebrateTenLottery,
    batchCelebrateWarOrderClaim,
  };
}
