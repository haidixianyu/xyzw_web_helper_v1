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

// 抽奖次数（默认1次，需要连抽改成10即可）
const DRAW_TIMES = 1;

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

  /** 领取通行证任务（每日/每周/本期），返回领取/跳过数 */
  const claimTasks = async (tokenId, actId, info, tokenName) => {
    const complete = info?.complete || {};
    const claimedMap = info?.taskClaimed || {};
    let claimed = 0;
    let skipped = 0;

    for (const [missionIdStr, progress] of Object.entries(complete)) {
      if (shouldStop.value) break;
      if (claimedMap[missionIdStr] === true) continue;
      if (!(progress > 0)) continue;

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
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
      await delay(commandDelay);
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

  /** 抽奖（会推进抽奖类任务进度） */
  const doLottery = async (tokenId, tokenName) => {
    try {
      const lotteryInfo = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_getlotteryinfo",
        {},
        8000,
      );
      log(`${tokenName} 抽奖信息: ${JSON.stringify(lotteryInfo?.lotteryInfo || {})}`);
    } catch {
      // 抽奖信息获取失败不影响抽奖
    }

    let count = 0;
    for (let i = 0; i < DRAW_TIMES; i++) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_lottery",
          { times: 1 },
          8000,
        );
        log(
          `${tokenName} 抽奖第${i + 1}次: ${formatReward(res?.reward || []) || "无奖励"}`,
          "success",
        );
        count++;
      } catch (error) {
        log(`${tokenName} 抽奖失败: ${error.message || "未知错误"}`, "warning");
        break;
      }
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

  /** 任务奖励领取（不含转盘抽奖）：任务 -> 通行证奖励 -> 免费珍宝 -> 点卯 -> 二次领取 */
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

  /** 转盘抽奖：抽奖 -> 抽奖后领取由此完成的任务与通行证奖励 */
  const batchXuanwuLottery = async () =>
    runBatch("玄武赐福转盘抽奖", async ({ actId }, token, tokenId) => {
      const lotteryCnt = await doLottery(tokenId, token.name);
      if (lotteryCnt <= 0) return;

      // 抽奖会推进"抽奖X次"类任务进度，抽完需再领一轮
      const latestInfo = (await fetchWarOrder(tokenId, actId)).info;
      if (!latestInfo) return;
      const second = await claimTasks(tokenId, actId, latestInfo, token.name);
      let passRewards = 0;
      if (second.claimed > 0) {
        passRewards = await claimPassRewards(tokenId, actId, token.name);
      }
      log(
        `${token.name} 玄武赐福转盘完成: 抽奖${lotteryCnt}, 任务${second.claimed}, 通行证奖励${passRewards}`,
        "success",
      );
    });

  return {
    batchXuanwuBlessing,
    batchXuanwuLottery,
  };
}