import { workerSleep } from "../workerTimer.js";
import {
  compareBlackMarketPurchaseLists,
  normalizeBlackMarketPurchaseList,
  toStorePurchaseItemList,
} from "./blackMarketConfig";
import { blackMarketWeekShops } from "./constants";

// 本地已购记录（服务端 record 里 goodsId 与 goodsIndex 的对应关系尚未确认时的兜底）
const BLACK_MARKET_LEDGER_KEY = "black_market_week_bought_v1";

// 本周标识（以周一为起点），按周隔离已购记录
const getWeekKey = () => {
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - offset,
  );
  return `${monday.getFullYear()}${String(monday.getMonth() + 1).padStart(2, "0")}${String(
    monday.getDate(),
  ).padStart(2, "0")}`;
};

const readBoughtLedger = (tokenId, weekKey) => {
  try {
    const all = JSON.parse(localStorage.getItem(BLACK_MARKET_LEDGER_KEY) || "{}");
    return new Set(all?.[tokenId]?.[weekKey] || []);
  } catch {
    return new Set();
  }
};

const writeBoughtLedger = (tokenId, weekKey, indexes) => {
  try {
    const all = JSON.parse(localStorage.getItem(BLACK_MARKET_LEDGER_KEY) || "{}");
    all[tokenId] = { [weekKey]: indexes };
    localStorage.setItem(BLACK_MARKET_LEDGER_KEY, JSON.stringify(all));
  } catch {
    // 本地记录写入失败不影响购买
  }
};

// activity_get 响应解包（promise 可能 resolve 成 body 或整个报文）
const unwrapActivityResp = (resp) => resp?.body ?? resp;

// 已购状态：activity.myStoreInfo[activityId].complete 以 goodsIndex 为键，值为 1 即本周已购买
// 例: {"0":1,"1":1,"2":1,"4":1,"6":1}
const getShopCompleteMap = (resp, activityId) =>
  unwrapActivityResp(resp)?.activity?.myStoreInfo?.[activityId]?.complete || null;

/**
 * 商店类任务
 * 包含: legion_storebuygoods, legionStoreBuySkinCoins, store_purchase,
 * store_syncpurchaseconfig, collection_claimfreereward, batchBuyJianghuBlackMarket
 */

// 江湖黑市奖励物品名（仅用于日志展示，未收录的回退显示原始 itemId）
const JIANGHU_ITEM_NAMES = {
  2: "金砖",
  1001: "招募令",
  1003: "进阶石",
  1006: "精铁",
  1011: "普通鱼竿",
  1012: "黄金鱼竿",
  2001: "木质宝箱",
  2002: "青铜宝箱",
  2003: "黄金宝箱",
  2004: "铂金宝箱",
};

// syncrewardresp 的 reward 字段转成 "招募令×5、精铁×1000"
const formatJianghuReward = (resp) => {
  const reward = resp?.reward;
  if (!Array.isArray(reward) || reward.length === 0) return "";
  return reward
    .map(
      ({ itemId, value }) =>
        `${JIANGHU_ITEM_NAMES[Number(itemId)] || itemId}×${value}`,
    )
    .join("、");
};

// 月度商店采购清单（统一走 legion_storebuygoods: {id, num}）
// 依据 2026-10-03 实测抓包（log5.txt）：
//   盐晶商店·斑点蛋   id 205，num 4 一次性购买 4 个
//   助威商店·红色随机碎片 id 7，num 0 买 1 次得 100 片
//   助威商店·白玉       id 8，num 0 买 1 次得 2000 个
const MONTHLY_STORE_PURCHASES = [
  { id: 205, num: 4, times: 1, name: "斑点蛋", itemId: 37011 },
  { id: 7, num: 0, times: 1, name: "随机红将碎片", itemId: 3007 },
  { id: 8, num: 0, times: 1, name: "白玉", itemId: 1022 },
];

// 月度商店奖励物品名（仅用于日志展示，未收录的回退显示原始 itemId）
const MONTHLY_STORE_ITEM_NAMES = {
  37011: "斑点蛋",
  3007: "随机红将碎片",
  1022: "白玉",
};

// 聚合响应 reward 里同 itemId 的数量，转成 "斑点蛋×2"
const formatStoreReward = (resp) => {
  const reward = resp?.reward;
  if (!Array.isArray(reward) || reward.length === 0) return "";
  const totals = {};
  for (const { itemId, value } of reward) {
    const key = Number(itemId);
    totals[key] = (totals[key] || 0) + Number(value || 0);
  }
  return Object.entries(totals)
    .map(
      ([itemId, value]) =>
        `${MONTHLY_STORE_ITEM_NAMES[itemId] || itemId}×${value}`,
    )
    .join("、");
};

// 服务端「已购买/超出限购」类错误统一按文案识别，避免依赖未收录的错误码
const isAlreadyBoughtError = (text) =>
  /已购买|已领取|重复|上限|超出限制/.test(String(text || ""));

/**
 * 创建商店类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksStore(deps) {
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
    delayConfig,
  } = deps;

  const getBlackMarketPurchaseConfig = () =>
    normalizeBlackMarketPurchaseList(batchSettings.blackMarketPurchaseList);

  const readBlackMarketPurchaseConfig = async (tokenId) => {
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_getpurchase",
      {},
      5000,
    );

    return {
      purchaseCnt: Number(result?.purchaseCnt || 0),
      purchaseItemList: normalizeBlackMarketPurchaseList(
        result?.purchaseItemList || [],
      ),
    };
  };

  const updateBlackMarketPurchaseConfig = async (tokenId, tokenName) => {
    const configuredPurchaseList = getBlackMarketPurchaseConfig();

    if (configuredPurchaseList.length === 0) {
      throw new Error("未配置黑市采购清单");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在读取当前黑市采购清单...`,
      type: "info",
    });

    const currentPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 当前黑市清单: ${currentPurchaseConfig.purchaseItemList.length} 项，共 ${currentPurchaseConfig.purchaseCnt} 次`,
      type: "info",
    });

    if (
      compareBlackMarketPurchaseLists(
        currentPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 黑市采购清单已是目标配置，跳过下发`,
        type: "info",
      });

      return;
    }

    const purchaseCnt = Math.max(1, currentPurchaseConfig.purchaseCnt || 1);
    const purchaseItemList = toStorePurchaseItemList(configuredPurchaseList);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在下发黑市采购清单...`,
      type: "info",
    });

    await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_setpurchase",
      {
        purchaseCnt,
        purchaseItemList,
      },
      5000,
    );

    await workerSleep(delayConfig.action);

    const verifiedPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    if (
      !compareBlackMarketPurchaseLists(
        verifiedPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      throw new Error("黑市采购清单写回后校验失败");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 黑市采购清单已更新 ${purchaseItemList.length} 项`,
      type: "success",
    });
  };

  /**
   * 一键购买四圣碎片
   */
  const legion_storebuygoods = async () => {
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
          message: `=== 开始购买四圣碎片: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_storebuygoods",
          { id: 6 },
          5000,
        );

        await workerSleep(delayConfig.action);

        if (result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过四圣碎片，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得四圣碎片`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 月度商店购买
   * 盐晶商店·斑点蛋×4 + 助威商店·随机红将碎片×100、白玉×2000
   * 详见 MONTHLY_STORE_PURCHASES / log5.txt
   */
  const batchMonthlyStoreBuy = async () => {
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
          message: `=== 开始月度商店购买: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        let successCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const goods of MONTHLY_STORE_PURCHASES) {
          for (let i = 0; i < goods.times; i++) {
            if (shouldStop.value) break;

            try {
              const result = await tokenStore.sendMessageWithPromise(
                tokenId,
                "legion_storebuygoods",
                { id: goods.id, num: goods.num },
                5000,
              );

              successCount++;
              const gainedText = formatStoreReward(result);
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${goods.name} 购买成功${
                  gainedText ? `: ${gainedText}` : ""
                }`,
                type: "success",
              });
            } catch (error) {
              const reason = error?.message || String(error);
              if (isAlreadyBoughtError(reason)) {
                skippedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${goods.name} 已达上限或已购买，跳过`,
                  type: "info",
                });
              } else {
                failedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${goods.name} 购买失败: ${reason}`,
                  type: "error",
                });
              }
            }

            await workerSleep(delayConfig.action);
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 月度商店完成: 成功 ${successCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
          type: failedCount > 0 ? "warning" : "success",
        });
        tokenStatus.value[tokenId] = failedCount > 0 ? "failed" : "completed";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 月度商店购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键购买俱乐部5皮肤币
   */
  const legionStoreBuySkinCoins = async () => {
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
          message: `=== 开始购买俱乐部5皮肤币: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        let result = null;
        for (let i = 0; i < 5; i++) {
          if (shouldStop.value) break;
          result = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_storebuygoods",
            { id: 1 },
            5000,
          );

          await workerSleep(delayConfig.action);
        }

        if (result && result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过皮肤币，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得皮肤币`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 免费领取珍宝阁每日奖励
   */
  const collection_claimfreereward = async () => {
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
          message: `=== 开始免费领取珍宝阁: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送珍宝阁免费领取请求...`,
          type: "info",
        });
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "collection_claimfreereward",
          {},
          5000,
        );

        await workerSleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 珍宝阁领取过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键配置黑市采购清单
   */
  const store_syncpurchaseconfig = async () => {
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
          message: `=== 开始配置黑市采购清单: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        await updateBlackMarketPurchaseConfig(tokenId, token.name);
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 配置黑市采购清单失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 黑市一键采购
   */
  const store_purchase = async () => {
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
          message: `=== 开始黑市一键采购: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送黑市采购请求...`,
          type: "info",
        });
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "store_purchase",
          {},
          5000,
        );

        await workerSleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市采购过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键黑市周购买（金砖商店的金砖回馈 + 江湖黑市商品，price=0 即免费领取）
   * 清单见 constants.js 的 blackMarketWeekShops
   * 购买前依次用「服务端购买记录 → 本地已购记录」判断，命中则跳过；
   * 两者都判不出时按服务端错误（已购买/超出上限）兜底，避免重复扣金砖
   */
  const batchBuyJianghuBlackMarket = async () => {
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
          message: `=== 开始黑市周购买: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 1. 登录时的 activity_get 就带着活动商店购买记录，先取一份用于判断是否已购
        const weekKey = getWeekKey();
        const ledger = readBoughtLedger(tokenId, weekKey);

        let activityResp = null;
        try {
          activityResp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_get",
            {},
            10000,
          );
        } catch (error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} activity_get 失败: ${error.message}（改用本地记录判定）`,
            type: "warning",
          });
        }

        // 2. 逐个商店购买（已购跳过）
        let boughtCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const shop of blackMarketWeekShops) {
          if (shouldStop.value) break;

          const completeMap = getShopCompleteMap(activityResp, shop.activityId);
          const skippedNames = [];

          for (const goods of shop.goods) {
            if (shouldStop.value) break;

            // 本地记录以「活动ID:商品下标」为键，避免两个商店的下标互相干扰
            const ledgerKey = `${shop.activityId}:${goods.goodsIndex}`;
            const serverBought = Number(completeMap?.[goods.goodsIndex]) > 0;

            if (serverBought || ledger.has(ledgerKey)) {
              skippedCount++;
              skippedNames.push(goods.name);
              if (!ledger.has(ledgerKey)) {
                ledger.add(ledgerKey);
                writeBoughtLedger(tokenId, weekKey, [...ledger]);
              }
              continue;
            }

            const actionText = goods.price > 0 ? "购买" : "领取";

            try {
              const resp = await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_buystoregoods",
                {
                  activityId: shop.activityId,
                  goodsIndex: goods.goodsIndex,
                  buyNum: 1,
                },
                10000,
              );

              boughtCount++;
              ledger.add(ledgerKey);
              writeBoughtLedger(tokenId, weekKey, [...ledger]);
              const gainedText = formatJianghuReward(resp);

              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${shop.shopName}-${goods.name} ${actionText}成功${
                  gainedText ? `: ${gainedText}` : ""
                }`,
                type: "success",
              });
            } catch (error) {
              const reason = error?.message || String(error);
              if (isAlreadyBoughtError(reason)) {
                skippedCount++;
                skippedNames.push(goods.name);
                ledger.add(ledgerKey);
                writeBoughtLedger(tokenId, weekKey, [...ledger]);
              } else {
                failedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${shop.shopName}-${goods.name} ${actionText}失败: ${reason}`,
                  type: "error",
                });
              }
            }

            await workerSleep(delayConfig.action);
          }

          if (skippedNames.length > 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${shop.shopName} 已购买跳过: ${skippedNames.join("、")}`,
              type: "info",
            });
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市周完成: 成功 ${boughtCount}，已购跳过 ${skippedCount}，失败 ${failedCount}`,
          type: failedCount > 0 ? "warning" : "success",
        });
        tokenStatus.value[tokenId] = failedCount > 0 ? "failed" : "completed";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市周购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
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

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  return {
    legion_storebuygoods,
    batchMonthlyStoreBuy,
    legionStoreBuySkinCoins,
    store_purchase,
    store_syncpurchaseconfig,
    readBlackMarketPurchaseConfig,
    collection_claimfreereward,
    batchBuyJianghuBlackMarket,
  };
}
