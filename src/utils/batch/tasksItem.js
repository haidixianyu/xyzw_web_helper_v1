import { HERO_DICT, FishMap } from "@/utils/HeroList";
import { PEACH_TASKS } from "@/utils/PeachTaskIds";
import { workerSleep } from "../workerTimer.js";

/**
 * 开箱、钓鱼、招募类任务
 * 包含: batchOpenBox, batchClaimBoxPointReward, batchFish, batchRecruit
 */

/**
 * 创建物品类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksItem(deps) {
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
    helperSettings,
    delayConfig,
  } = deps;

  const boxNames = {
    2001: "木质宝箱",
    2002: "青铜宝箱",
    2003: "黄金宝箱",
    2004: "铂金宝箱",
  };

  const fishNames = { 1: "普通鱼竿", 2: "黄金鱼竿" };

  const heroIds = Object.keys(HERO_DICT).map(Number);

  // 武将ID -> 中文名，未收录的ID回退显示原始数字，便于日志直观查看
  const heroName = (heroId) => HERO_DICT[heroId]?.name || String(heroId);

  // 鱼/神器道具ID(5位) -> 中文名：前4位是鱼ID，查 FishMap；未收录回退显示原始数字
  const fishName = (itemId) =>
    FishMap[String(itemId).substring(0, 4)]?.name || String(itemId);

  // 鱼品质档位（按鱼ID前缀划分）-> 每次升星消耗的「本体」数量
  // 1601-1604 稀有20只 / 1501-1506 史诗5只 / 1401-1412 传说2只
  // 1301-1305 神话1只 / 1201-1220 传奇1只
  const FISH_STAR_TIERS = [
    { min: 1601, max: 1604, cost: 20, name: "稀有" },
    { min: 1501, max: 1506, cost: 5, name: "史诗" },
    { min: 1401, max: 1412, cost: 2, name: "传说" },
    { min: 1301, max: 1305, cost: 1, name: "神话" },
    { min: 1201, max: 1220, cost: 1, name: "传奇" },
  ];

  /**
   * 取鱼升星所需本体数量
   * @param {number} itemId 鱼/神器道具ID(5位)
   * @returns {{cost:number,name:string}|null} 品质未知(如神器)时返回 null，不预检交由服务端判断
   */
  const getFishStarCost = (itemId) => {
    const fishId = Number(String(itemId).substring(0, 4));
    if (!Number.isFinite(fishId)) return null;
    const tier = FISH_STAR_TIERS.find(
      (t) => fishId >= t.min && fishId <= t.max,
    );
    return tier ? { cost: tier.cost, name: tier.name } : null;
  };

  // 升星安全上限：正常情况下靠客户端档位预检 + 服务端拒绝结束循环，
  // 这里只作为防止死循环的兜底。
  const HERO_STAR_MAX_ATTEMPTS = 60;
  // 鱼/神器每轮每个道具只会尝试一次升星，因此需要多轮才能把同一批低星道具逐级升上去
  const FISH_PASS_MAX = 40;

  // 英雄升星碎片消耗档位表（按当前星级所在档位取每次升星所需碎片）
  // 黄星1-5星: 8个(档内累计40) / 紫星6-10星: 40个(200) / 橙星11-15星: 80个(400)
  // 红星16-20星: 200个(1000) / 皇冠21-25星: 400个(2000) / 紫晶26-30星: 400个(2000)
  const HERO_STAR_TIERS = [
    { max: 5, cost: 8, name: "黄星" },
    { max: 10, cost: 40, name: "紫星" },
    { max: 15, cost: 80, name: "橙星" },
    { max: 20, cost: 200, name: "红星" },
    { max: 25, cost: 400, name: "皇冠" },
    { max: 30, cost: 400, name: "紫晶" },
  ];
  // 最高星级，达到后无法再升星
  const HERO_STAR_MAX = HERO_STAR_TIERS[HERO_STAR_TIERS.length - 1].max;

  /**
   * 根据当前星级取升星所需碎片
   * @param {number} star 当前星级
   * @returns {{cost:number,name:string,isMax:boolean}|null} 星级未知时返回 null
   */
  const getHeroStarCost = (star) => {
    if (!Number.isFinite(star) || star <= 0) return null;
    if (star >= HERO_STAR_MAX) return { cost: 0, name: "已满星", isMax: true };
    const tier =
      HERO_STAR_TIERS.find((t) => star <= t.max) ||
      HERO_STAR_TIERS[HERO_STAR_TIERS.length - 1];
    return { cost: tier.cost, name: tier.name, isMax: false };
  };

  /**
   * 批量英雄升星
   */
  const batchHeroUpgrade = async () => {
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
          message: `=== 开始英雄升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 拉取角色数据，优先只处理账号实际拥有的武将（取不到则回退到全量武将表）
        let targetHeroIds = heroIds;
        let initialRole = null;
        try {
          const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          initialRole = roleInfo?.role || roleInfo;
          const ownedHeroIds = Object.keys(initialRole?.heroes || {})
            .map(Number)
            .filter((n) => Number.isFinite(n));
          if (ownedHeroIds.length > 0) targetHeroIds = ownedHeroIds;
        } catch (err) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 获取角色信息失败，改用全量武将表: ${err.message}`,
            type: "warning",
          });
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 待检查武将 ${targetHeroIds.length} 个`,
          type: "info",
        });

        let upgradedTotal = 0;
        let upgradedHeroCount = 0;
        // 跳过原因统计，便于排查“明明能升星却没有全部升星”的问题
        const reasonStats = new Map();

        for (const heroId of targetHeroIds) {
          if (shouldStop.value) break;

          let star = Number(initialRole?.heroes?.[heroId]?.star);
          let qty = Number(initialRole?.items?.[heroId]?.quantity);
          let qtyKnown = Number.isFinite(qty);
          let count = 0;
          let stopReason = null;
          let stopPacketInfo = "";

          // 一直升到服务端拒绝（碎片不足/已满星）为止，最多 HERO_STAR_MAX_ATTEMPTS 次兜底
          for (let i = 0; i < HERO_STAR_MAX_ATTEMPTS; i++) {
            if (shouldStop.value) break;

            // 按档位表预检：已满星或碎片不足时直接跳过，不调用服务器接口
            const starCost = getHeroStarCost(star);
            if (starCost?.isMax) {
              stopReason = `已满星(${star}星)`;
              break;
            }
            if (qtyKnown && starCost && qty < starCost.cost) {
              stopReason = `碎片不足(${starCost.name}需${starCost.cost}个)`;
              break;
            }

            try {
              // 成功时 Promise 会 resolve（响应体不含 code），失败会 reject 进入 catch
              const res = await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_heroupgradestar",
                { heroId },
                8000,
              );
              const newStar = Number(res?.role?.heroes?.[heroId]?.star);
              const newQty = Number(res?.role?.items?.[heroId]?.quantity);
              if (Number.isFinite(newStar)) star = newStar;
              if (Number.isFinite(newQty)) {
                qty = newQty;
                qtyKnown = true;
              }
              count++;
              upgradedTotal++;
            } catch (err) {
              stopReason = err?.message || String(err);
              stopPacketInfo = err?.packetInfo || "";
              break;
            }
            await workerSleep(delayConfig.action);
          }

          if (count > 0) {
            upgradedHeroCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 武将:${heroName(heroId)}(ID${heroId}) 升星 ${count} 次 (当前星级 ${star || "-"})${stopReason ? `，停止原因: ${stopReason}${stopPacketInfo ? ` [${stopPacketInfo}]` : ""}` : ""}`,
              type: "success",
            });
          } else if (stopReason) {
            let entry = reasonStats.get(stopReason);
            if (!entry) {
              entry = { count: 0, examples: [], packetInfo: stopPacketInfo };
              reasonStats.set(stopReason, entry);
            }
            entry.count++;
            if (entry.examples.length < 6) {
              const st0 = initialRole?.heroes?.[heroId]?.star;
              const qty0 = initialRole?.items?.[heroId]?.quantity;
              entry.examples.push(
                `${heroName(heroId)}(ID${heroId},星级${st0 ?? "?"},碎片${qty0 ?? "?"})`,
              );
            }
          }
        }

        // 汇总各停止原因（含当前星级/碎片与命中报文），用于确认到底是“确实不能升”还是“逻辑漏了”
        for (const [reason, entry] of reasonStats) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未升星武将 ${entry.count} 个，原因: ${reason}${entry.packetInfo ? ` [${entry.packetInfo}]` : ""}${entry.examples.length ? `，示例: ${entry.examples.join("、")}` : ""}`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 英雄升星完成，${upgradedHeroCount} 个武将共升星 ${upgradedTotal} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `英雄升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量英雄升星结束");
  };

  /**
   * 批量鱼/神器升星
   * 命令 artifact_upgradestar {heroId, itemId}。
   * itemId 必须是「账号实际持有的鱼/神器道具ID」，即 role.items 里的 5 位道具ID
   * （规则: 鱼ID(4位) * 10 + 星级，如 14011 = 鱼 1401 的 1 星），
   * 不能用 artifactBooks 里的 artifactId —— 那是图鉴记录的档位，账号未必持有，
   * 直接发会得到 400000(物品不存在)/400160。
   * 升星成功后该道具推进到下一档（itemId + 1）。
   * 采用“多轮扫描”策略：每轮重新拉取角色数据（拿到最新的道具ID与数量），
   * 按道具ID升序（即按鱼分组、星级从低到高）各尝试一次，
   * 直到某一轮没有任何成功为止。
   */
  const batchFishUpgrade = async () => {
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
          message: `=== 开始鱼升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 拉取角色信息：命中限流(200400 操作太快)时退避重试，避免整个账号任务被中断
        const fetchRoleWithBackoff = async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const info = await tokenStore.sendGetRoleInfo(tokenId);
              return info?.role || info;
            } catch (err) {
              const msg = err?.message || String(err);
              const isBusy = /200400|操作太快/.test(msg);
              if (!isBusy || attempt === 1) throw err;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 拉取角色信息被限流(200400 操作太快)，4秒后重试`,
                type: "warning",
              });
              await workerSleep(4000);
            }
          }
        };

        let upgradedTotal = 0;
        // 已尝试失败的道具ID，后续轮次不再重复请求
        const fishFailed = new Set();
        const fishReasonStats = new Map();
        for (let pass = 0; pass < FISH_PASS_MAX; pass++) {
          if (shouldStop.value) break;

          let role;
          try {
            role = await fetchRoleWithBackoff();
          } catch (err) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 拉取角色信息失败，结束鱼升星: ${err.message}`,
              type: "warning",
            });
            break;
          }

          // 鱼ID前缀集合：artifactBooks 的 key 是 4 位鱼ID，道具ID 的前 4 位即鱼ID
          const fishIdSet = new Set();
          for (const key of Object.keys(role?.artifactBooks || {})) {
            const k = String(key).trim();
            if (/^\d{4,5}$/.test(k)) fishIdSet.add(k.substring(0, 4));
          }
          // 兜底：已附身武将的 artifactId 同样是 5 位道具ID，可反推鱼ID
          for (const hero of Object.values(role?.heroes || {})) {
            const aid = String(hero?.artifactId ?? "");
            if (/^\d{5}$/.test(aid)) fishIdSet.add(aid.substring(0, 4));
          }

          // 道具ID -> 附身武将ID（未附身用 -1）
          const holderMap = {};
          for (const [hid, hero] of Object.entries(role?.heroes || {})) {
            const aid = Number(hero?.artifactId);
            if (Number.isFinite(aid) && aid > 0) holderMap[aid] = Number(hid);
          }

          // 同名鱼本体总数：按鱼ID前缀(前4位)跨星级合计，游戏升星是按同名鱼合计算本体数
          const fishTotalQty = {};
          for (const [key, item] of Object.entries(role?.items || {})) {
            const rawId = Number(item?.itemId ?? key);
            if (!Number.isFinite(rawId) || rawId <= 0) continue;
            const qty = Number(item?.quantity ?? 0);
            if (!Number.isFinite(qty) || qty <= 0) continue;
            const prefix = String(rawId).substring(0, 4);
            fishTotalQty[prefix] = (fishTotalQty[prefix] || 0) + qty;
          }

          // 候选 = 实际持有的鱼/神器道具；itemId 升序 == 按鱼分组、星级从低到高
          const candidates = [];
          // itemId -> 本体数量（用于日志展示）
          const fishQty = {};
          for (const [key, item] of Object.entries(role?.items || {})) {
            const itemId = Number(item?.itemId ?? key);
            if (!Number.isFinite(itemId) || itemId <= 0) continue;
            if (!fishIdSet.has(String(itemId).substring(0, 4))) continue;
            const qty = Number(item?.quantity ?? 0);
            if (!Number.isFinite(qty) || qty <= 0) continue;
            if (fishFailed.has(itemId)) continue;
            candidates.push(itemId);
            fishQty[itemId] = qty;
          }
          candidates.sort((a, b) => a - b);

          if (pass === 0) {
            const upgradable = candidates.filter((id) => {
              const c = getFishStarCost(id);
              if (!c) return true;
              return (
                Number(fishTotalQty[String(id).substring(0, 4)] ?? 0) >= c.cost
              );
            }).length;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检测到持有的鱼/神器 ${candidates.length} 种 (够本体可升星 ${upgradable} 种, 图鉴鱼 ${fishIdSet.size} 种)`,
              type: "info",
            });
          }
          if (candidates.length === 0) break;

          let passSuccess = 0;
          // 本轮因限流被延后的道具数：>0 时不应提前结束，让其下一轮重试
          let passDeferred = 0;
          // 记录无法升星的道具（聚合同类原因，示例最多6条）
          const recordFishFailure = (itemId, reason, packetInfo = "") => {
            let entry = fishReasonStats.get(reason);
            if (!entry) {
              entry = { count: 0, examples: [], packetInfo };
              fishReasonStats.set(reason, entry);
            }
            entry.count++;
            if (entry.examples.length < 6)
              entry.examples.push(
                `${fishName(itemId)}(ID${itemId},本级${fishQty[itemId] ?? "?"}只,同鱼共${fishTotalQty[String(itemId).substring(0, 4)] ?? "?"}只)`,
              );
          };
          for (const itemId of candidates) {
            if (shouldStop.value) break;

            const heroId = holderMap[itemId] ?? -1;
            // 品质预检：同名鱼本体合计不足时直接跳过，不调用服务器接口
            const fishCost = getFishStarCost(itemId);
            const totalNow = Number(
              fishTotalQty[String(itemId).substring(0, 4)] ?? 0,
            );
            if (fishCost && totalNow < fishCost.cost) {
              fishFailed.add(itemId);
              recordFishFailure(
                itemId,
                `本体不足(${fishCost.name}需${fishCost.cost}只)`,
              );
              continue;
            }
            try {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "artifact_upgradestar",
                { heroId, itemId },
                8000,
              );
              passSuccess++;
              upgradedTotal++;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 鱼/神器 ${fishName(itemId)}(ID${itemId}) 升星成功`,
                type: "success",
              });
            } catch (err) {
              const reason = err?.message || String(err);
              // 限流(200400 操作太快)是瞬时的：本轮跳过且不拉黑，下一轮会重新尝试
              if (/200400|操作太快/.test(reason)) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 鱼/神器 ${fishName(itemId)}(ID${itemId}) 被限流(200400 操作太快)，延后重试`,
                  type: "warning",
                });
                await workerSleep(3000);
                passDeferred++;
                continue;
              }
              // 该道具本轮无法升星（材料不足/已满星等），记录原因并跳过
              fishFailed.add(itemId);
              recordFishFailure(itemId, reason, err?.packetInfo || "");
            }
            await workerSleep(delayConfig.action);
          }

          if (passSuccess === 0 && passDeferred === 0) break;
        }

        for (const [reason, entry] of fishReasonStats) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 鱼/神器升星失败 ${entry.count} 种，原因: ${reason}${entry.packetInfo ? ` [${entry.packetInfo}]` : ""}${entry.examples.length ? `，示例: ${entry.examples.join("、")}` : ""}`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 鱼升星完成，共升星 ${upgradedTotal} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `鱼升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量鱼升星结束");
  };

  /**
   * 批量图鉴升星
   */
  const batchBookUpgrade = async () => {
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
          message: `=== 开始图鉴升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        let upgradedTotal = 0;
        for (const heroId of heroIds) {
          if (shouldStop.value) break;

          let count = 0;
          // 一直升到服务端拒绝（材料不足/已满星）为止，最多 HERO_STAR_MAX_ATTEMPTS 次兜底
          for (let i = 0; i < HERO_STAR_MAX_ATTEMPTS; i++) {
            if (shouldStop.value) break;

            try {
              // 成功时 Promise 会 resolve（响应体不含 code），失败会 reject 进入 catch
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "book_upgrade",
                { heroId },
                8000,
              );
            } catch (err) {
              // 服务端拒绝（材料不足或满星），停止该武将
              break;
            }
            count++;
            upgradedTotal++;
            await workerSleep(delayConfig.action);
          }

          if (count > 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 英雄:${heroName(heroId)}(ID${heroId}) 图鉴升星 ${count} 次`,
              type: "success",
            });
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 图鉴升星完成，共升星 ${upgradedTotal} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `图鉴升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量图鉴升星结束");
  };

  /**
   * 批量领取图鉴奖励
   */
  const batchClaimStarRewards = async () => {
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
          message: `=== 开始领取图鉴奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 一直领取到服务端拒绝（无可领取奖励）为止，最多 60 次兜底
        for (let i = 0; i < 60; i++) {
          if (shouldStop.value) break;
          try {
            // 成功时 Promise 会 resolve（响应体不含 code），失败会 reject 进入 catch
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "book_claimpointreward",
              {},
              8000,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 领取图鉴奖励成功`,
              type: "success",
            });
          } catch (err) {
            // 领取失败（比如没有奖励可领了），停止尝试
            break;
          }
          await workerSleep(delayConfig.action);
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取图鉴奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取图鉴奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取图鉴奖励结束");
  };

  /**
   * 领取宝箱积分
   */
  const batchClaimBoxPointReward = async () => {
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
          message: `=== 开始领取宝箱积分: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
          {},
          5000,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱积分领取成功`,
          type: "success",
        });

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取失败: ${error.message}`,
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
    message.success("批量领取宝箱积分结束");
  };

  /**
   * 批量领取蟠桃园任务
   */
  const batchClaimPeachTasks = async () => {
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
          message: `=== 开始领取蟠桃园任务奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_getpayloadtask",
          {},
          5000
        );

        const payloadTask = res?.payloadTask || res?.data?.payloadTask;

        if (payloadTask && payloadTask.taskMap) {
          const taskMap = payloadTask.taskMap;
          const tasks = [];
          Object.values(taskMap).forEach((item) => {
            const availableTasks = PEACH_TASKS.filter(
              (t) =>
                t.type === item.typ &&
                item.progress >= t.target &&
                item.claimedProgress < t.target,
            );
            tasks.push(...availableTasks);
          });

          let claimedCount = 0;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 获取到 ${tasks.length} 个任务奖励`,
            type: "info",
          });

          for (const task of tasks) {
            if (shouldStop.value) break;
            // status not reliable or not present, try claim all
            try {
              const claimRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "legion_claimpayloadtask",
                { taskId: task.id },
                5000
              );
              const ok = claimRes && claimRes.payloadTask;
              if (ok) {
                claimedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取${task.desc}任务奖励成功`,
                  type: "success",
                });
              }

            } catch (err) {
              // ignore
            }
            await workerSleep(delayConfig.action);
          }

          // Check and claim point rewards (Moved out of loop to ensure execution)
          try {
            const progressMapres = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_getpayloadtask",
              {},
              5000
            );
            
            if (progressMapres && progressMapres.payloadTask) {
                const legionPoint = progressMapres.payloadTask.legionPoint || 0;
                const selfPoint = progressMapres.payloadTask.selfPoint || 0;
                // progressMap key might be string or number, handle both safely
                const progressMap = progressMapres.payloadTask.progressMap || {};
                const taskGroupprogressMap = progressMap[1] || progressMap["1"] || 0;
                const selfPointprogressMap = progressMap[2] || progressMap["2"] || 0;

                // Club Rewards - Claim all if progress is greater than claimed progress
                if (legionPoint > taskGroupprogressMap && taskGroupprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 1 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励 (当前积分: ${legionPoint})`,
                      type: "success",
                    });
                    await workerSleep(1000);
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }

                // Personal Rewards - Claim all if progress is greater than claimed progress
                if (selfPoint > selfPointprogressMap && selfPointprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 2 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励 (当前积分: ${selfPoint})`,
                      type: "success",
                    });
                    await workerSleep(1000);
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }
            }
          } catch (err) {
             console.error("领取蟠桃园积分奖励异常:", err);
             addLog({
               time: new Date().toLocaleTimeString(),
               message: `${token.name} 领取积分奖励异常: ${err.message}`,
               type: "error",
             });
          }

          if (claimedCount === 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 没有可领取的任务奖励`,
              type: "info",
            });
          }

        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未获取到任务奖励列表`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取蟠桃园任务奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取蟠桃园任务奖励失败: ${error.message}`,
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
    message.success("批量领取蟠桃园任务奖励结束");
  };

  /**
   * 一键灯神扫荡
   */
  const batchGenieSweep = async () => {
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
          message: `=== 开始灯神扫荡: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 获取最新角色信息
        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000
        );
        
        // 解析灯神进度和扫荡券
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const genieData = role.genie || {};
        // 扫荡券 ID 1021
        const sweepTicketCount = role.items?.[1021]?.quantity || 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 当前扫荡券数量: ${sweepTicketCount}`,
          type: "info",
        });

        if (sweepTicketCount <= 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 扫荡券不足，停止扫荡`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        // 计算最高层数
        // 1-4: 魏蜀吴群 (0-16 -> 1-17层)
        // 5: 深海 (0-9 -> 1-10层)
        let maxLayer = -1;
        let bestGenieId = -1;

        // 检查魏蜀吴群 (1-4)
        for (let i = 1; i <= 4; i++) {
          if (genieData[i] !== undefined) {
            // 数据值 0 代表 1 层? 用户说 0-16 代表 1-17 层
            // 假设 genieData[i] 是已通过的层数索引
            const currentLayer = genieData[i] + 1;
            if (currentLayer > maxLayer) {
              maxLayer = currentLayer;
              bestGenieId = i;
            }
          }
        }

        if (bestGenieId === -1) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未找到可扫荡的灯神关卡`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const genieNames = { 1: "魏国", 2: "蜀国", 3: "吴国", 4: "群雄", 5: "深海" };
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 扫荡: ${genieNames[bestGenieId]}灯神 (第${maxLayer}层)`,
          type: "info",
        });

        // 开始扫荡
        let remainingTickets = sweepTicketCount;
        
        while (remainingTickets > 0 && !shouldStop.value) {
          const sweepCnt = Math.min(remainingTickets, 20);
          
          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "genie_sweep",
              { 
                genieId: bestGenieId,
                sweepCnt: sweepCnt 
              },
              5000
            );

            const ok = res && (res.role || res.role.items);
            
            if (ok) {
               addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 扫荡成功 ${sweepCnt} 次`,
                type: "success",
              });
              remainingTickets = res.role.items?.[1021]?.quantity || 0;
            } else {
               addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 扫荡失败: ${res.hint || "未知错误"}`,
                type: "error",
              });
              break; // 失败则停止
            }
          } catch (err) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 扫荡请求异常: ${err.message}`,
              type: "error",
            });
            break;
          }

          if (remainingTickets > 0) {
             await workerSleep(delayConfig.action);
          }
        }

        // 刷新信息
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 灯神扫荡完成 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `灯神扫荡失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键灯神扫荡结束");
  };

  const batchOpenBox = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const boxType = isScheduledTask
      ? batchSettings.defaultBoxType
      : helperSettings.boxType;
    const totalCount = isScheduledTask
      ? batchSettings.boxCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

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
          message: `=== 开始批量开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱类型: ${boxNames[boxType]}, 数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: boxType, number: 10 },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开箱进度: ${(i + 1) * 10}/${totalCount}`,
            type: "info",
          });
          await workerSleep(delayConfig.action);
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: boxType, number: remainder },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开箱进度: ${totalCount}/${totalCount}`,
            type: "info",
          });
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
        );
        await workerSleep(delayConfig.action);
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `开箱失败: ${error.message}`,
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
    message.success("批量开箱结束");
  };

  /**
   * 批量钓鱼
   */
  const batchFish = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const fishType = isScheduledTask
      ? batchSettings.defaultFishType
      : helperSettings.fishType;
    const totalCount = isScheduledTask
      ? batchSettings.fishCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

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
          message: `=== 开始批量钓鱼: ${token.name} ===`,
          type: "info",
        });
        
        await ensureConnection(tokenId);

        // 检查鱼竿数量
        let role = tokenStore.gameData?.roleInfo?.role;
        if (!role) {
           try {
             const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
             role = roleInfo?.role;
           } catch {}
        }
        // 普通鱼竿: 1011, 黄金鱼竿: 1012
        const rodId = fishType === 1 ? 1011 : 1012;
        const rodCount = role?.items?.[rodId]?.quantity || 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 鱼竿类型: ${fishNames[fishType]}, 目标数量: ${totalCount}, 当前库存: ${rodCount}`,
          type: "info",
        });

        let availableCount = totalCount;
        if (rodCount < totalCount) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 库存不足 (${rodCount} < ${totalCount})，将仅消耗现有库存`,
                type: "warning",
             });
             availableCount = rodCount;
        }

        if (availableCount <= 0) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 没有可用的鱼竿，停止任务`,
                type: "warning",
            });
            tokenStatus.value[tokenId] = "completed";
            return;
        }

        const batches = Math.floor(availableCount / 10);
        const remainder = availableCount % 10;

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: 10, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${(i + 1) * 10}/${availableCount}`,
            type: "info",
          });

          // 每5轮（50次）后，重新校验鱼竿数量
          if ((i + 1) % 5 === 0 && i < batches - 1) {
             try {
                const roleRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "role_getroleinfo",
                  {},
                  5000,
                );
                const currentRole = roleRes?.role || roleRes?.data?.role;
                if (currentRole) {
                    const currentRodCount = currentRole.items?.[rodId]?.quantity || 0;
                    
                    // 剩余需要的次数 (不包括当前这轮，因为i已经执行完了，所以剩余次数是 (batches - 1 - i) * 10 + remainder)
                    // 但实际上我们只需要知道下一轮是否有足够的鱼竿
                    // 如果当前库存少于10，说明下一轮可能不够，或者整个任务不够
                    // 重新计算 availableCount 可能会比较复杂，因为循环是基于 batches
                    
                    if (currentRodCount < 10) {
                        addLog({
                            time: new Date().toLocaleTimeString(),
                            message: `${token.name} 同步后发现鱼竿不足 (${currentRodCount} < 10)，停止后续批量任务`,
                            type: "warning",
                        });
                        // 强制停止
                        break; 
                    }
                }
             } catch (e) {
                 // ignore
             }
          }

          await workerSleep(delayConfig.action);
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: remainder, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${availableCount}/${availableCount}`,
            type: "info",
          });
        }
        // 自动领取鱼竿累计奖励
        try {
           const roleRes = await tokenStore.sendMessageWithPromise(
             tokenId,
             "role_getroleinfo",
             {},
             5000,
           );
           const currentRole = roleRes?.role || roleRes?.data?.role;
           if (currentRole) {
              const points = currentRole.statistics?.["artifact:point"] || 0;
              const exchangeCount = Math.floor(points / 20);
              
              if (exchangeCount > 0) {
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`,
                    type: "info",
                 });
                 
                 for (let k = 0; k < exchangeCount && !shouldStop.value; k++) {
                    try {
                       await tokenStore.sendMessageWithPromise(
                         tokenId,
                         "artifact_exchange",
                         {},
                         3000
                       );
                       // 稍微延迟，避免请求过快
                       await workerSleep(500);
                    } catch (err) {
                       addLog({
                          time: new Date().toLocaleTimeString(),
                          message: `${token.name} 领取累计奖励失败 (第${k+1}次): ${err.message}`,
                          type: "warning",
                       });
                       break; // 如果出错可能是不满足条件，停止领取
                    }
                 }
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 累计奖励领取结束`,
                    type: "success",
                 });
              }
           }
        } catch (e) {
           addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检查累计奖励失败: ${e.message}`,
              type: "warning",
           });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 钓鱼完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `钓鱼失败: ${error.message}`,
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
    message.success("批量钓鱼结束");
  };

  /**
   * 批量招募
   */
  const batchRecruit = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const totalCount = isScheduledTask
      ? batchSettings.recruitCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

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
          message: `=== 开始批量招募: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 招募数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "hero_recruit",
            { recruitType: 1, recruitNumber: 10 },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `招募进度: ${(i + 1) * 10}/${totalCount}`,
            type: "info",
          });
          await workerSleep(delayConfig.action);
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "hero_recruit",
            { recruitType: 1, recruitNumber: remainder },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `招募进度: ${totalCount}/${totalCount}`,
            type: "info",
          });
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 招募完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `招募失败: ${error.message}`,
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
    message.success("批量招募结束");
  };

  const batchOpenBoxByPoints = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const targetPoints = isScheduledTask
      ? batchSettings.targetBoxPoints
      : helperSettings.targetPoints;

    const boxPriority = [
      { id: 2001, name: "木质宝箱", points: 1, reserve: 200 },
      { id: 2002, name: "青铜宝箱", points: 10, reserve: 0 },
      { id: 2003, name: "黄金宝箱", points: 20, reserve: 0 },
      { id: 2004, name: "铂金宝箱", points: 50, reserve: 0 },
    ];

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
          message: `=== 开始按积分开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 目标积分: ${targetPoints}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000,
        );
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const items = role.items || {};

        const boxInventory = {};
        let totalAvailablePoints = 0;

        for (const box of boxPriority) {
          const count = items[box.id]?.quantity || 0;
          boxInventory[box.id] = count;
          totalAvailablePoints += count * box.points;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 箱子库存: 木质=${boxInventory[2001]}, 青铜=${boxInventory[2002]}, 黄金=${boxInventory[2003]}, 铂金=${boxInventory[2004]}`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 可获得总积分: ${totalAvailablePoints}`,
          type: "info",
        });

        if (totalAvailablePoints < targetPoints) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 积分不足! 需要 ${targetPoints}, 可获得 ${totalAvailablePoints}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
          return;
        }

        const boxToOpen = {};
        let remainingPoints = targetPoints;

        const woodenAvailable = boxInventory[2001] - 200;
        if (woodenAvailable >= 10) {
          const woodenPoints = woodenAvailable * 1;
          const pointsNeeded = Math.min(woodenPoints, remainingPoints);
          let woodenToOpen = Math.min(pointsNeeded, woodenAvailable);
          woodenToOpen = Math.floor(woodenToOpen / 10) * 10;
          if (woodenToOpen === 0 && woodenAvailable >= 10 && pointsNeeded > 0) {
            woodenToOpen = 10;
          }
          
          if (woodenToOpen >= 10) {
            boxToOpen[2001] = woodenToOpen;
            remainingPoints -= woodenToOpen * 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 计划开 木质宝箱: ${woodenToOpen} 个 (积分: ${woodenToOpen})`,
              type: "info",
            });
          }
        }

        if (remainingPoints > 0) {
          const bronzeAvailable = Math.floor(boxInventory[2002] / 10) * 10;
          const goldAvailable = Math.floor(boxInventory[2003] / 10) * 10;
          const platinumAvailable = Math.floor(boxInventory[2004] / 10) * 10;
          const woodenTotal = Math.floor(boxInventory[2001] / 10) * 10;

          let bestResult = null;
          let minWaste = Infinity;

          for (let bronze = 0; bronze <= bronzeAvailable; bronze += 10) {
            const bronzePoints = bronze * 10;
            if (bronzePoints > remainingPoints) break;
            
            for (let gold = 0; gold <= goldAvailable; gold += 10) {
              const goldPoints = gold * 20;
              if (bronzePoints + goldPoints > remainingPoints) break;
              
              const afterBronzeGold = remainingPoints - bronzePoints - goldPoints;
              
              for (let platinum = 0; platinum <= platinumAvailable; platinum += 10) {
                const platinumPoints = platinum * 50;
                if (platinumPoints > afterBronzeGold) break;
                
                const afterPlatinum = afterBronzeGold - platinumPoints;
                
                let wooden = 0;
                if (afterPlatinum > 0) {
                  wooden = Math.ceil(afterPlatinum / 10) * 10;
                  if (wooden > woodenTotal || wooden > 100) continue;
                }
                
                const totalPoints = bronzePoints + goldPoints + platinumPoints + wooden;
                const waste = totalPoints - targetPoints;
                
                if (waste >= 0 && waste < minWaste) {
                  minWaste = waste;
                  bestResult = { bronze, gold, platinum, wooden, totalPoints };
                  if (waste === 0) break;
                }
              }
              if (minWaste === 0) break;
            }
            if (minWaste === 0) break;
          }

          if (bestResult) {
            if (bestResult.bronze > 0) {
              boxToOpen[2002] = bestResult.bronze;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 青铜宝箱: ${bestResult.bronze} 个 (积分: ${bestResult.bronze * 10})`,
                type: "info",
              });
            }
            if (bestResult.gold > 0) {
              boxToOpen[2003] = bestResult.gold;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 黄金宝箱: ${bestResult.gold} 个 (积分: ${bestResult.gold * 20})`,
                type: "info",
              });
            }
            if (bestResult.platinum > 0) {
              boxToOpen[2004] = bestResult.platinum;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 铂金宝箱: ${bestResult.platinum} 个 (积分: ${bestResult.platinum * 50})`,
                type: "info",
              });
            }
            if (bestResult.wooden > 0) {
              boxToOpen[2001] = (boxToOpen[2001] || 0) + bestResult.wooden;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 木质宝箱: ${bestResult.wooden} 个 (积分: ${bestResult.wooden})`,
                type: "info",
              });
            }
            remainingPoints = 0;
          }
        }

        for (const box of boxPriority) {
          if (shouldStop.value) break;

          const count = boxToOpen[box.id] || 0;
          if (count <= 0) continue;

          const batches = Math.floor(count / 10);
          const remainder = count % 10;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开始开 ${box.name}: ${count} 个`,
            type: "info",
          });

          for (let i = 0; i < batches && !shouldStop.value; i++) {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "item_openbox",
              { itemId: box.id, number: 10 },
              5000,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name} 开箱进度: ${(i + 1) * 10}/${count}`,
              type: "info",
            });
            await workerSleep(delayConfig.action);
          }

          if (remainder > 0 && !shouldStop.value) {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "item_openbox",
              { itemId: box.id, number: remainder },
              5000,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name} 开箱进度: ${count}/${count}`,
              type: "info",
            });
          }
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 按积分开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `按积分开箱失败: ${error.message}`,
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
    message.success("按积分开箱结束");
  };

  return {
    batchOpenBox,
    batchOpenBoxByPoints,
    batchClaimBoxPointReward,
    batchFish,
    batchRecruit,
    batchHeroUpgrade,
    batchFishUpgrade,
    batchBookUpgrade,
    batchClaimStarRewards,
    batchClaimPeachTasks,
    batchGenieSweep,
  };
}
