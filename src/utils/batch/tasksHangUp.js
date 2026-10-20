import { workerSleep } from "../workerTimer.js";
import { $emit } from "../../stores/events/index";

/**
 * 挂机、答题、签到类任务
 * 包含: claimHangUpRewards, batchAddHangUpTime, batchStudy, batchclubsign
 */

// ===== 本地答题完成记录（每周一0点自动过期）=====
const STUDY_RECORD_KEY = "batchStudyCompletionRecord";

// 本周一 0 点的时间戳（周一为一周开始）
const getWeekStartTime = () => {
  const d = new Date();
  const day = d.getDay(); // 0=周日
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const readStudyRecord = () => {
  try {
    return JSON.parse(localStorage.getItem(STUDY_RECORD_KEY) || "{}");
  } catch {
    return {};
  }
};

// 本周是否已完成答题并领取奖励
// 仅信任 verified=true 的记录（由服务器角色信息或完整答题流程确认）；
// 旧版本可能因多账号共用状态而写入误判记录，那些纯数字记录一律忽略并重新校验。
const isStudyCompletedThisWeek = (tokenId) => {
  const entry = readStudyRecord()[tokenId];
  if (!entry || typeof entry !== "object") return false;
  return entry.week === getWeekStartTime() && entry.verified === true;
};

// 记录本周已完成（值为所在周的周一0点，跨周自动失效）
const markStudyCompletedThisWeek = (tokenId) => {
  try {
    const record = readStudyRecord();
    record[tokenId] = { week: getWeekStartTime(), verified: true };
    localStorage.setItem(STUDY_RECORD_KEY, JSON.stringify(record));
  } catch {
    /* 忽略存储异常 */
  }
};

/**
 * 创建挂机、答题、签到类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksHangUp(deps) {
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
    hangUpAddTimes,
    cdkCode,
  } = deps;

  // ===== 按账号读取/重置答题状态（与 stores/events/study.ts 的 studyStatusByToken 对应）=====
  // 批量答题时多个账号并发，不能共用同一份状态，否则会出现
  // “某个账号答完 → 其他账号也被判定为已完成”的误判。
  const getTokenStudyStatus = (tokenId) =>
    tokenStore.gameData?.studyStatusByToken?.[tokenId];

  const resetTokenStudyStatus = (tokenId) => {
    if (!tokenStore.gameData.studyStatusByToken) {
      tokenStore.gameData.studyStatusByToken = {};
    }
    tokenStore.gameData.studyStatusByToken[tokenId] = {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: "",
      timestamp: null,
    };
  };

  /**
   * 领取挂机奖励
   * @param {number} times 弹框选择的加钟次数（0=仅领取），未传则用 hangUpAddTimes
   */
  const claimHangUpRewards = async (times) => {
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取挂机: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 1. Claim reward
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励`,
          type: "info",
        });
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "system_claimhangupreward",
          {},
          5000,
        );
        await workerSleep(500);

        // 2. Add time（次数由弹框选择，0=仅领取不加钟）
        const addTimes = Number.isFinite(Number(times))
          ? Number(times)
          : (hangUpAddTimes?.value ?? 2);
        if (addTimes > 0) {
          for (let i = 0; i < addTimes; i++) {
            if (shouldStop.value) break;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 挂机加钟 ${i + 1}/${addTimes}`,
              type: "info",
            });
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "system_mysharecallback",
              { isSkipShareCard: true, type: 2 },
              5000,
            );
            await workerSleep(500);
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 加钟次数为0，跳过加钟`,
            type: "info",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励失败: ${error.message}`,
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
    message.success("批量领取挂机结束");
  };

  /**
   * 一键加钟
   * @param {number} times 弹框选择的次数，未传则用 hangUpAddTimes
   */
  const batchAddHangUpTime = async (times) => {
    if (selectedTokens.value.length === 0) return;
    const addTimes = Number.isFinite(Number(times))
      ? Number(times)
      : (hangUpAddTimes?.value ?? 2);
    if (addTimes <= 0) {
      message.info("加钟次数为0，不执行加钟");
      return;
    }
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键加钟: ${token.name} (共${addTimes}次) ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        for (let i = 0; i < addTimes; i++) {
          if (shouldStop.value) break;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 执行加钟 ${i + 1}/${addTimes}`,
            type: "info",
          });
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "system_mysharecallback",
            { isSkipShareCard: true, type: 2 },
            5000,
          );
          await workerSleep(500);
        }
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 加钟完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 加钟失败: ${error.message || "未知错误"}`,
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
    message.success("批量加钟结束");
  };

  /**
   * 一键答题
   */
  const batchStudy = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
      // 清掉上一次运行残留的单账号答题状态，避免"已完成"状态跨账号/跨轮次残留
      resetTokenStudyStatus(id);
    });

    const { preloadQuestions } = await import("@/utils/studyQuestionsFromJSON.js");
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在加载题库...`,
      type: "info",
    });
    await preloadQuestions();

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      // 本地记录：本周已完成答题并领取奖励 → 直接跳过（不建连）
      if (isStudyCompletedThisWeek(tokenId)) {
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 本周答题已完成，跳过 ===`,
          type: "success",
        });
        return;
      }

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始答题: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 兜底判断（per-token 响应，不受并发覆盖影响）：
        // 服务器数据显示本周已答满10题（beginTime 在本周一0点后）→ 补领奖励后跳过
        try {
          const roleRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "role_getroleinfo",
            {},
            5000,
          );
          const study = roleRes?.role?.study;
          if (
            study &&
            study.maxCorrectNum >= 10 &&
            study.beginTime * 1000 >= getWeekStartTime()
          ) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周答题已完成（服务器确认），补领奖励后跳过`,
              type: "info",
            });
            for (let rewardId = 1; rewardId <= 10; rewardId++) {
              try {
                tokenStore.sendMessage(tokenId, "study_claimreward", {
                  rewardId,
                });
              } catch {
                /* 忽略单个领奖失败 */
              }
              await workerSleep(200);
            }
            markStudyCompletedThisWeek(tokenId);
            tokenStatus.value[tokenId] = "completed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 本周答题已完成，跳过 ===`,
              type: "success",
            });
            return;
          }
        } catch (roleErr) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 查询答题状态失败，继续尝试答题: ${roleErr.message}`,
            type: "warning",
          });
        }

        // Reset local study status（只重置当前账号，避免互相干扰）
        resetTokenStudyStatus(tokenId);

        // Send start command
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "study_startgame",
          {},
          5000,
        );

        // Wait for completion（轮询当前账号自己的状态）
        let maxWait = 90;
        let completed = false;
        let lastStatus = "";

        while (maxWait > 0 && !shouldStop.value) {
          const status = getTokenStudyStatus(tokenId);

          if (!status) {
            await workerSleep(1000);
            maxWait--;
            continue;
          }

          if (status.status !== lastStatus) {
            lastStatus = status.status;
            if (status.status === "answering") {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 开始答题...`,
                type: "info",
              });
            } else if (status.status === "claiming_rewards") {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取奖励...`,
                type: "info",
              });
            }
          }

          if (status.status === "completed") {
            completed = true;
            break;
          }

          await workerSleep(1000);
          maxWait--;
        }

        if (completed) {
          // 二次确认：答题流程结束不代表答对数量达标（可能答案不全/答错），
          // 必须向服务器核对当前账号本周是否真的答满 10 题，避免误记“已完成”。
          let verified = false;
          for (let attempt = 0; attempt < 2 && !verified; attempt++) {
            try {
              const checkRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "role_getroleinfo",
                {},
                5000,
              );
              const st = checkRes?.role?.study;
              verified = !!(
                st &&
                st.maxCorrectNum >= 10 &&
                st.beginTime * 1000 >= getWeekStartTime()
              );
            } catch {
              /* 查询失败则继续重试一次 */
            }
            if (!verified) await workerSleep(1000);
          }

          if (verified) {
            // 答题+领奖流程全部走完且服务器确认达标，记录本周已完成（下次直接跳过）
            markStudyCompletedThisWeek(tokenId);
            tokenStatus.value[tokenId] = "completed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 答题完成 ===`,
              type: "success",
            });
          } else {
            tokenStatus.value[tokenId] = "failed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 答题流程结束，但服务器未确认答满10题，未标记完成`,
              type: "error",
            });
          }
        } else {
          if (shouldStop.value) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 已停止`,
              type: "warning",
            });
          } else {
            tokenStatus.value[tokenId] = "failed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 答题超时或未开始`,
              type: "error",
            });
          }
        }
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `答题失败: ${error.message}`,
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
    message.success("批量答题结束");
  };

  /**
   * 一键俱乐部签到
   */
  const batchclubsign = async () => {
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键俱乐部签到: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        if (shouldStop.value) return;
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_signin",
          {},
          5000,
        );
        await workerSleep(500);
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 俱乐部签到已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 俱乐部签到失败: ${error.message || "未知错误"}`,
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
    message.success("批量俱乐部签到结束");
  };

  /**
   * 批量兑换码
   * system_claimcdkreward {key, platformType:"h5web"}，响应为 syncrewardresp
   * 实测（2026-10-17）：人工连接 52ms 秒回；重复兑换时服务器静默不回包（奖励此前已发）；
   * cdk 已兑换标记只出现在 syncrewardresp 增量同步里，role_getroleinfo 全量可能查不到，
   * 故用 $emit 监听 syncrewardresp 广播 + 本地提交记录双重兜底
   */
  // 奖励 itemId → 中文名（未收录的显示原始 id）
  const CDK_ITEM_NAMES = {
    1001: "招募令",
    1003: "进阶石",
    1006: "精铁",
    1013: "珍珠",
    1014: "军团币",
    1016: "晶石",
    1021: "扫荡魔毯",
    1022: "白玉",
    1023: "彩玉",
    2001: "木制宝箱",
    2002: "青铜宝箱",
    2003: "黄金宝箱",
    2004: "铂金宝箱",
    2005: "钻石宝箱",
    3001: "金币袋子",
    3002: "金砖袋子",
    3011: "白玉袋子",
    37001: "怪异塔钥匙",
  };
  const batchClaimCdk = async () => {
    if (selectedTokens.value.length === 0) return;
    const code = (cdkCode?.value || "").trim();
    if (!code) {
      message.warning("请输入兑换码");
      return;
    }

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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始兑换码: ${token.name} (${code}) ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        if (shouldStop.value) return;

        // 本地提交记录：同一兑换码此前已提交过的账号，重跑时服务器会静默
        let priorTs = null;
        let record = {};
        try {
          record = JSON.parse(
            localStorage.getItem("batchCdkClaimRecord") || "{}",
          );
          priorTs = record[code]?.[tokenId] || null;
        } catch {
          /* 忽略 */
        }
        try {
          record[code] = record[code] || {};
          record[code][tokenId] = Date.now();
          localStorage.setItem("batchCdkClaimRecord", JSON.stringify(record));
        } catch {
          /* 忽略 */
        }

        // 监听 syncrewardresp 广播（不依赖 promise 匹配链路），按 tokenId 过滤
        let syncreward = null;
        const listener = (session) => {
          if (session?.tokenId !== tokenId) return;
          const body = session?.body ?? session;
          if (body?.reward || body?.statistics) syncreward = body;
        };
        $emit.on("syncrewardresp", listener);

        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "system_claimcdkreward",
            { key: code, platformType: "h5web" },
            5000,
          ).catch(() => {});
          // 人工实测 52ms 回包，给足 3 秒广播窗口
          await workerSleep(3000);
        } finally {
          $emit.off("syncrewardresp", listener);
        }

        // 成功路径1：syncrewardresp 带 reward 数组 [{type,itemId,value}]
        const rewards = Array.isArray(syncreward?.reward)
          ? syncreward.reward
          : [];
        if (rewards.length > 0) {
          const rewardText = rewards
            .map((r) => `${CDK_ITEM_NAMES[r.itemId] || r.itemId}×${r.value}`)
            .join(", ");
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 兑换成功: ${rewardText}`,
            type: "success",
          });
          return;
        }

        // 成功路径2：syncrewardresp 带 statistics 的 cdk 标记（此前已兑换的重放同步）
        const statKey = `cdk:${code}_0`;
        if (syncreward?.statistics && syncreward.statistics[statKey]) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 已兑换过该码（标记确认）`,
            type: "success",
          });
          return;
        }

        // 成功路径3（兜底）：role_getroleinfo 全量里若含 cdk 标记
        try {
          const roleRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "role_getroleinfo",
            {},
            5000,
          );
          if (
            roleRes?.role?.statistics &&
            roleRes.role.statistics[statKey] !== undefined
          ) {
            tokenStatus.value[tokenId] = "completed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 已兑换过该码（角色数据确认）`,
              type: "success",
            });
            return;
          }
        } catch (e) {
          /* 确认查询失败按未确认处理 */
        }

        if (priorTs) {
          // 此前提交过且服务器静默 → 大概率已兑换成功，不标 failed 挡批量
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 兑换请求已提交，服务器未回包（重复兑换时服务器静默，此前 ${new Date(priorTs).toLocaleTimeString()} 已提交过），请游戏内核对奖励`,
            type: "warning",
          });
        } else {
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 兑换码未确认成功（服务器无响应，请人工核对该账号）`,
            type: "error",
          });
        }
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 兑换码失败: ${error.message || "未知错误"}`,
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
    message.success("批量兑换码结束");
  };

  /**
   * 月赛助威
   * @param {number} legionId - 俱乐部ID
   * @param {number} guessCoin - 竞猜币数量
   */
  const batchWarGuessCheer = async (legionId, guessCoin) => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择账号");
      return;
    }
    if (!legionId) {
      message.warning("请选择要助威的俱乐部");
      return;
    }
    
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
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始助威: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        
        // 尝试领取拍手器
        try {
          const rewardRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "warguess_getguesscoinreward",
            {},
            3000 // 短超时，因为这不是关键步骤
          );
          if (rewardRes && rewardRes.reward) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 领取拍手器成功 ===`,
              type: "success",
            });
          }
        } catch (e) {
          // 忽略领取失败
          // console.warn("领取拍手器失败", e);
        }

        // 获取助威数据以判断次数
        const rankRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "warguess_getrank",
          { bfId: '' },
          5000,
        );

        let totalGuessNum = 0;
        if (rankRes && rankRes.list) {
          let list = [];
          if (Array.isArray(rankRes.list)) {
            list = rankRes.list;
          } else {
            list = Object.values(rankRes.list);
          }
          totalGuessNum = list.reduce((sum, item) => sum + (item.guessNum || 0), 0);
        }

        if (totalGuessNum === 20) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威次数已满 (${totalGuessNum}/20)，跳过 ===`,
                type: "warning",
              });
             tokenStatus.value[tokenId] = "completed";
             return;
        }

        let coinToUse = Number(guessCoin);
        const remaining = 20 - totalGuessNum;
        
        if (coinToUse > remaining) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 剩余助威次数不足，调整为 ${remaining} 次 (原计划: ${coinToUse}) ===`,
                type: "info",
            });
            coinToUse = remaining;
        }

        if (coinToUse <= 0) {
             tokenStatus.value[tokenId] = "completed";
             return;
        }

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "warguess_startguess",
          { guessCoin: coinToUse, legionId: legionId },
          5000,
        );

        if (result && result.guessLegion) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威成功 (当前次数: ${result.guessLegion.guessNum}/20) ===`,
                type: "success",
              });
             tokenStatus.value[tokenId] = "completed";
        } else {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威失败 ===`,
                type: "error",
              });
             tokenStatus.value[tokenId] = "failed";
        }
      } catch (error) {
        console.error(error);
        
        // Handle specific error: 400000 - Item does not exist (feature locked)
        if (error.code === 400000 || (error.message && error.message.includes("400000"))) {
          tokenStatus.value[tokenId] = "completed"; // Mark as completed (skipped)
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 助威失败: 未解锁该功能===`,
            type: "warning",
          });
        } else {
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 助威失败: ${error.message || "未知错误"}`,
            type: "error",
          });
        }
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量助威结束");
  };

  return {
    claimHangUpRewards,
    batchAddHangUpTime,
    batchStudy,
    batchclubsign,
    batchClaimCdk,
    batchWarGuessCheer,
  };
}
