/**
 * 玄武赐福（通行证活动）批量任务
 * 顺序执行：任务领取 -> 通行证奖励 -> 免费珍宝 -> 抽奖 -> 点卯 -> 抽奖后二次领取
 * 抽奖会推进任务进度（如"抽奖X次"类任务），故抽奖后需重新拉取并再领一轮
 */

import { getXuanwuActBase } from "@/utils/towerActId";

// 活动ID后缀（前缀为当天日期 YYMMDD）
const WAR_ORDER_SUFFIX = "1";
const SIGN_SUFFIX = "5";
const GOODS_SUFFIX = "41";

// 抽奖批次数：抽奖券满10张按10连抽，不足10张逐次单抽
const DRAW_BATCH_TIMES = 10;

// 抽奖轮数上限（每轮抽奖后重新领取，领取产出的抽奖券可继续抽）
const MAX_DRAW_ROUNDS = 20;

// 累次（累计抽奖次数）奖励最大档位
const MAX_CUMULATIVE_ID = 20;

// 通行证奖励领取最大轮数
const MAX_REWARD_ROUNDS = 10;

// 点卯补领天数（patchDay 0-6）
const SIGN_MAX_DAY = 6;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatReward = (reward = []) =>
  reward
    .map((r) => {
      if (r.type === 2) return `金砖x${r.value}`;
      if (r.type === 3) return `道具${r.itemId}x${r.value}`;
      return `类型${r.type}x${r.value}`;
    })
    .join(", ");

/**
 * 创建玄武赐福批量任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksXuanwuBlessing(deps) {
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

  // tokenId -> 本轮已确认未达标/不可领的「任务:进度」集合（每轮开始清空）
  const claimMissCache = new Map();

  const log = (msg, type = "info") =>
    addLog({ time: new Date().toLocaleTimeString(), message: msg, type });

  /**
   * 拉取通行证活动信息
   * @returns {Promise<{info: Object|null, error: string|null}>} 失败时带上原因，便于排查
   */
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
      const keys = res ? Object.keys(res).join("/") : "空响应";
      return { info: null, error: `无该活动数据(响应字段: ${keys})` };
    } catch (error) {
      return { info: null, error: error.message || "请求失败" };
    }
  };

  /** 从活动列表(activity_get)中取当前开启的通行证活动ID */
  const listWarOrderActIds = async (tokenId, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_get",
        {},
        8000,
      );
      const activity = res?.activity || res || {};
      const map = activity.warOrderActivityInfo || {};
      const ids = Object.keys(map)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      log(
        `${tokenName} 活动列表通行证ID: ${ids.length ? ids.join(", ") : "无"}${ids.length ? "" : ` (响应字段: ${Object.keys(res || {}).join("/")})`}`,
        ids.length ? "info" : "warning",
      );
      return ids;
    } catch (error) {
      log(
        `${tokenName} 获取活动列表失败: ${error.message || "未知错误"}`,
        "warning",
      );
      return [];
    }
  };

  /** 解析当前活动ID：先按日期推导，再回退到活动列表枚举 */
  const resolveWarOrder = async (tokenId, tokenName) => {
    const candidates = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      candidates.push(Number(getXuanwuActBase(date) + WAR_ORDER_SUFFIX));
    }
    const listed = await listWarOrderActIds(tokenId, tokenName);
    const actIds = [...new Set([...candidates, ...listed])];

    const tried = [];
    for (const actId of actIds) {
      const { info, error } = await fetchWarOrder(tokenId, actId);
      if (info) return { actId, info };
      tried.push(`${actId}: ${error}`);
      if (shouldStop.value) return null;
    }

    log(`${tokenName} 未找到玄武赐福活动，探测结果: ${tried.join(" | ")}`, "warning");
    return null;
  };

  /**
   * 领取通行证任务（每日/每周/本期），返回领取/跳过数
   * 未达标的任务服务端会直接拒绝，故同轮内记录「任务:进度」避免反复试错
   * @param {Function} [filterFn] (missionId, progress) => boolean，仅领取满足条件的任务
   */
  const claimTasks = async (tokenId, actId, info, tokenName, filterFn = null) => {
    const complete = info?.complete || {};
    const claimedMap = info?.taskClaimed || {};
    const missed = claimMissCache.get(tokenId) || new Set();
    let claimed = 0;
    let skipped = 0;

    for (const [missionIdStr, progress] of Object.entries(complete)) {
      if (shouldStop.value) break;
      if (claimedMap[missionIdStr] === true) continue;
      if (!(progress > 0)) continue;
      if (filterFn && !filterFn(missionIdStr, progress)) continue;

      // 进度没变过还是领不了，说明确实未达标，无需再发一次
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
          log(`${tokenName} 任务${missionIdStr}领取: ${formatReward(res.reward)}`, "success");
          claimed++;
          granted = true;
        } else {
          skipped++;
          rejected = true;
        }
      } catch (error) {
        skipped++;
        // 只有服务端明确拒绝(未达标)才记入，超时等临时错误留待下次重试
        rejected = String(error?.message || "").includes("服务器错误");
      }

      if (granted) {
        await delay(commandDelay);
      } else if (rejected) {
        missed.add(missKey);
      }
    }

    if (claimed > 0 || skipped > 0) {
      log(
        `${tokenName} 通行证任务: 领取 ${claimed}, 跳过 ${skipped}`,
        claimed > 0 ? "success" : "info",
      );
    }
    return { claimed, skipped };
  };

  /** 通行证奖励领取（可能产出抽奖券），返回领取轮数 */
  const claimPassRewards = async (tokenId, actId, tokenName) => {
    let rounds = 0;
    for (let round = 0; round < MAX_REWARD_ROUNDS; round++) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_warorderrewardclaim",
          { actId },
          8000,
        );
        if (!res?.reward?.length) break;
        log(`${tokenName} 通行证奖励领取: ${formatReward(res.reward)}`, "success");
        rounds++;
      } catch {
        // 已无可领取奖励
        break;
      }
      await delay(commandDelay);
    }
    if (rounds > 0) {
      log(`${tokenName} 通行证奖励: 领取 ${rounds} 次`, "success");
    }
    return rounds;
  };

  /** 免费珍宝购买（产出抽奖券） */
  const buyFreeGoods = async (tokenId, goodsId, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_commonbuygoods",
        { goodsId },
        8000,
      );
      log(
        `${tokenName} 免费珍宝购买成功${res?.reward?.length ? `: ${formatReward(res.reward)}` : ""}`,
        "success",
      );
      return true;
    } catch {
      log(`${tokenName} 免费珍宝今日已购买或不可购买`);
      return false;
    }
  };

  /** 拉取抽奖信息（含累次奖励已领档位） */
  const fetchLotteryInfo = async (tokenId, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_getlotteryinfo",
        {},
        8000,
      );
      const info = res?.lotteryInfo || null;
      if (info) {
        const ids = Object.keys(info.cumulativeClaimedMap || {});
        log(
          `${tokenName} 抽奖信息: 累计抽奖${info.lotteryNum ?? 0}次, 累次奖励已领[${ids.join(",")}]`,
        );
      }
      return info;
    } catch (error) {
      log(
        `${tokenName} 获取抽奖信息失败: ${error.message || "未知错误"}`,
        "warning",
      );
      return null;
    }
  };

  /**
   * 累次（累计抽奖次数）奖励领取
   * 档位条件随 id 递增，从低到高尝试，领取失败即说明后续档位也未达标
   */
  const claimCumulativeRewards = async (tokenId, claimedMap, tokenName) => {
    let claimed = 0;
    for (let id = 1; id <= MAX_CUMULATIVE_ID; id++) {
      if (shouldStop.value) break;
      if (claimedMap[String(id)] === true) continue;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_claimlotterycumulative",
          { id },
          8000,
        );
        if (!res?.reward?.length) break;
        log(
          `${tokenName} 累次奖励第${id}档领取: ${formatReward(res.reward)}`,
          "success",
        );
        claimed++;
        const latest = res?.lotteryInfo?.cumulativeClaimedMap;
        if (latest) Object.assign(claimedMap, latest);
      } catch {
        // 未达标或已领取，后续档位条件更高，直接结束
        break;
      }
      await delay(commandDelay);
    }
    return claimed;
  };

  /** 领取全部可领取奖励：累次奖励 -> 通行证任务 -> 通行证奖励 */
  const claimAllClaimable = async (tokenId, actId, tokenName, claimedMap) => {
    const cumulative = await claimCumulativeRewards(
      tokenId,
      claimedMap,
      tokenName,
    );
    const info = (await fetchWarOrder(tokenId, actId)).info;
    if (!info) return { cumulative, tasks: 0, pass: 0 };

    const tasks = (await claimTasks(tokenId, actId, info, tokenName)).claimed;
    const pass = await claimPassRewards(tokenId, actId, tokenName);
    return { cumulative, tasks, pass };
  };

  /** 发送抽奖请求（times: 10 或 1），不打印日志，由调用方区分处理 */
  const sendLottery = async (tokenId, times) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_lottery",
        { times },
        8000,
      );
      return {
        ok: true,
        reward: res?.reward || [],
        lotteryNum: res?.lotteryInfo?.lotteryNum,
      };
    } catch (error) {
      return { ok: false, error: error.message || "未知错误" };
    }
  };

  /**
   * 单轮抽奖：优先10连抽（满10张券），不足10张则逐次单抽至抽不动
   * 单抽模式下所有券抽完才返回，由调用方统一检查领取
   * @returns {Promise<number>} 本轮抽奖次数
   */
  const drawLotteryRound = async (tokenId, tokenName) => {
    const batch = await sendLottery(tokenId, DRAW_BATCH_TIMES);
    if (batch.ok) {
      log(
        `${tokenName} 10连抽: ${formatReward(batch.reward) || "无奖励"} (累计${batch.lotteryNum ?? "?"}次)`,
        "success",
      );
      return DRAW_BATCH_TIMES;
    }
    log(`${tokenName} 10连抽不可用(${batch.error})，改为单抽`, "info");

    let count = 0;
    while (!shouldStop.value) {
      const res = await sendLottery(tokenId, 1);
      if (!res.ok) {
        log(
          `${tokenName} 单抽结束(${res.error})`,
          count > 0 ? "info" : "warning",
        );
        break;
      }
      count++;
      log(
        `${tokenName} 单抽第${count}次: ${formatReward(res.reward) || "无奖励"} (累计${res.lotteryNum ?? "?"}次)`,
        "success",
      );
      await delay(commandDelay);
    }
    return count;
  };

  /** 玄武点卯（patchDay 0-6 补领） */
  const claimSign = async (tokenId, signActivityId, tokenName) => {
    let claimed = 0;
    let skipped = 0;
    for (let patchDay = 0; patchDay <= SIGN_MAX_DAY; patchDay++) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_claimsignreward",
          { activityId: signActivityId, patchDay },
          8000,
        );
        if (res?.reward?.length) {
          log(
            `${tokenName} 点卯第${patchDay + 1}天领取: ${formatReward(res.reward)}`,
            "success",
          );
          claimed++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
      await delay(commandDelay);
    }
    log(
      `${tokenName} 玄武点卯: 领取 ${claimed} 天, 跳过 ${skipped} 天`,
      claimed > 0 ? "success" : "info",
    );
    return claimed;
  };

  /**
   * 批量执行外壳：建连 -> 解析活动 -> 执行 handler -> 释放连接
   * @param {string} label 任务名（用于日志）
   * @param {Function} handler (resolved, token, tokenId) => Promise<void>
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

        const resolved = await resolveWarOrder(tokenId, token.name);
        if (!resolved) {
          throw new Error("未找到玄武赐福活动，请确认活动是否开启");
        }

        await handler(resolved, token, tokenId);
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

  /** 任务奖励领取（不含抽奖）：任务 -> 通行证奖励 -> 免费珍宝 -> 点卯 -> 二次领取 */
  const batchXuanwuBlessing = async () =>
    runBatch("玄武赐福任务", async ({ actId, info }, token, tokenId) => {
      const base = String(actId).slice(0, 6);
      const signActivityId = Number(base + SIGN_SUFFIX);
      const goodsId = Number(base + GOODS_SUFFIX);

      // 1. 领取任务 + 通行证奖励
      const first = await claimTasks(tokenId, actId, info, token.name);
      let passRewards = await claimPassRewards(tokenId, actId, token.name);

      // 2. 免费珍宝购买（产出抽奖券）
      await buyFreeGoods(tokenId, goodsId, token.name);
      await delay(commandDelay);

      // 3. 点卯补领（可能推进任务进度）
      const signCnt = await claimSign(tokenId, signActivityId, token.name);

      // 4. 点卯后重新拉取，领取新完成的任务
      let secondClaimed = 0;
      if (signCnt > 0) {
        const latestInfo = (await fetchWarOrder(tokenId, actId)).info;
        if (latestInfo) {
          const second = await claimTasks(tokenId, actId, latestInfo, token.name);
          secondClaimed = second.claimed;
          if (secondClaimed > 0) {
            passRewards += await claimPassRewards(tokenId, actId, token.name);
          }
        }
      }

      log(
        `${token.name} 玄武赐福任务完成: 任务${first.claimed + secondClaimed}, 通行证奖励${passRewards}, 点卯${signCnt}`,
        "success",
      );
    });

  /**
   * 连续抽奖：先领完可领的（累次/任务/通行证）-> 满10张券按10连抽、否则单抽
   * -> 抽奖推进进度后再次检查领取 -> 领取产出的抽奖券继续抽，直到抽不动
   */
  const batchXuanwuLottery = async () =>
    runBatch("玄武赐福连续抽奖", async ({ actId, info }, token, tokenId) => {
      const claimedMap = { ...(info?.cumulativeClaimedMap || {}) };
      const lotteryInfo = await fetchLotteryInfo(tokenId, token.name);
      if (lotteryInfo?.cumulativeClaimedMap) {
        Object.assign(claimedMap, lotteryInfo.cumulativeClaimedMap);
      }

      const total = { draws: 0, cumulative: 0, tasks: 0, pass: 0 };
      const merge = (r) => {
        total.cumulative += r.cumulative;
        total.tasks += r.tasks;
        total.pass += r.pass;
      };

      // 抽奖前先领一轮，领取产出的抽奖券可直接用于抽奖
      merge(await claimAllClaimable(tokenId, actId, token.name, claimedMap));

      for (let round = 0; round < MAX_DRAW_ROUNDS; round++) {
        if (shouldStop.value) break;
        const draws = await drawLotteryRound(tokenId, token.name);
        if (draws <= 0) break;
        total.draws += draws;
        // 抽奖推进任务/累次进度，抽完统一检查并领取
        merge(await claimAllClaimable(tokenId, actId, token.name, claimedMap));
        await delay(commandDelay);
      }

      log(
        `${token.name} 玄武赐福转盘完成: 抽奖${total.draws}, 累次奖励${total.cumulative}, 任务${total.tasks}, 通行证奖励${total.pass}`,
        "success",
      );
    });

  /**
   * 单次抽奖：只抽1次，抽完只领取本次抽奖推进完成的任务（即每日任务"抽奖1次"的300分）
   * 用抽奖前后任务进度差值定位目标，避免误领其他未达标任务
   */
  const batchXuanwuSingleLottery = async () =>
    runBatch("玄武赐福单次抽奖", async ({ actId }, token, tokenId) => {
      const beforeInfo = (await fetchWarOrder(tokenId, actId)).info;
      const before = beforeInfo?.complete || {};

      const res = await sendLottery(tokenId, 1);
      if (!res.ok) {
        log(`${token.name} 单次抽奖失败: ${res.error}`, "warning");
        return;
      }
      log(
        `${token.name} 单次抽奖: ${formatReward(res.reward) || "无奖励"} (累计${res.lotteryNum ?? "?"}次)`,
        "success",
      );
      await delay(commandDelay);

      if (!beforeInfo) {
        log(
          `${token.name} 未取到抽奖前的任务进度，跳过自动领取(可点"任务奖励"补领)`,
          "warning",
        );
        return;
      }

      const info = (await fetchWarOrder(tokenId, actId)).info;
      if (!info) return;
      // 进度变大且未领取的任务 = 本次抽奖推进完成的"抽奖1次"类任务
      const claimed = await claimTasks(
        tokenId,
        actId,
        info,
        token.name,
        (missionId, progress) => progress > (before[missionId] ?? 0),
      );
      log(
        `${token.name} 单次抽奖任务领取: ${claimed.claimed}个`,
        claimed.claimed > 0 ? "success" : "info",
      );
    });

  return {
    batchXuanwuBlessing,
    batchXuanwuLottery,
    batchXuanwuSingleLottery,
  };
}