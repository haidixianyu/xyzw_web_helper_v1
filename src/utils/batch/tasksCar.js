/**
 * 车辆类任务
 * 包含: batchSmartSendCar, batchClaimCars
 */

import { CarresearchItem } from "./constants.js";
import { workerSleep } from "../workerTimer.js";

/**
 * 创建车辆类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksCar(deps) {
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
    normalizeCars,
    gradeLabel,
    shouldSendCar,
    canClaim,
    isBigPrize,
    countRacingRefreshTickets,
    delayConfig,
  } = deps;

  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  /**
   * 智能发车
   */
  const batchSmartSendCar = async () => {
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
          message: `=== 开始智能发车: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 1. Fetch Car Info
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 获取车辆信息...`,
          type: "info",
        });
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "car_getrolecar",
          {},
          10000,
        );
        let carList = normalizeCars(res?.body ?? res);

        // 2. Fetch Tickets & Role Info
        let refreshTickets = 0;
        let currentRoleId = null;
        try {
          const roleRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "role_getroleinfo",
            {},
            10000,
          );
          const qty = roleRes?.role?.items?.[35002]?.quantity;
          refreshTickets = Number(qty || 0);
          currentRoleId = roleRes?.role?.roleId ? String(roleRes.role.roleId) : null;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 剩余刷新次数: ${refreshTickets}`,
            type: "info",
          });
        } catch (_) {}

        // 2.5 Fetch Helper Data (Club Members & Usage)
        let helperUsageMap = {};
        let sortedHelpers = [];
        // 最终护卫池：已设置逻辑取指定护卫，未设置逻辑取俱乐部全部成员（均按红淬排序）
        let guardPool = [];
        // true = 已设置逻辑（仅用指定护卫）；false = 未设置逻辑（全部成员）；两者护卫满4辆均停止发车
        let useDesignatedOnly = false;

        // 封装获取护卫使用情况的方法
        const updateHelperUsage = async () => {
          try {
            const usageRes = await tokenStore.sendMessageWithPromise(
              tokenId,
              "car_getmemberhelpingcnt",
              {},
              5000
            );
            helperUsageMap =
              usageRes?.body?.memberHelpingCntMap ||
              usageRes?.memberHelpingCntMap ||
              {};
          } catch (e) {
            // 忽略更新失败，使用旧数据或空数据
          }
        };

        try {
          // Initial fetch of usage
          await updateHelperUsage();

          // Fetch club members
          const legionRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_getinfo",
            {},
            5000
          );
          const membersMap =
            legionRes?.body?.info?.members || legionRes?.info?.members || {};
          
          // Sort members by Red Quench (desc)
          sortedHelpers = Object.values(membersMap)
            .filter(
              (m) =>
                !currentRoleId || String(m.roleId) !== currentRoleId
            )
            .map((m) => ({
              id: String(m.roleId),
              name: m.name || m.nickname || String(m.roleId),
              redQuench: m.custom?.red_quench_cnt || 0,
            }))
            .sort((a, b) => b.redQuench - a.redQuench);

          // 指定护卫："设置"中存的是账号名（如 "名称-序号-角色ID"），
          // 需解析为 角色ID / 游戏内角色名 的匹配集合，再与俱乐部成员比对，
          // 否则账号名带后缀时永远匹配不上，无法真正理解指定护卫设置
          const designatedGuards = (batchSettings.designatedGuards || [])
            .map((s) => String(s).trim())
            .filter(Boolean);
          const guardMatchKeys = new Set();
          designatedGuards.forEach((g) => {
            guardMatchKeys.add(g);
            // 1. 从账号列表中找到对应 token，取其角色ID与游戏内角色名
            const t = tokens.value.find((t) => t.name === g || t.id === g);
            if (t) {
              if (t.id) guardMatchKeys.add(String(t.id));
              if (t.roleName) guardMatchKeys.add(String(t.roleName));
            }
            // 2. 兼容 "名称-序号-角色ID" 账号名，提取末尾数字角色ID
            const m = g.match(/-(\d{6,12})$/);
            if (m) guardMatchKeys.add(m[1]);
            // 3. 账号名本身可能就是角色ID
            if (/^\d{6,12}$/.test(g)) guardMatchKeys.add(g);
          });
          const designatedMembers = sortedHelpers.filter(
            (h) =>
              (h.id && guardMatchKeys.has(h.id)) ||
              (h.name && guardMatchKeys.has(h.name)),
          );
          // true = 已设置逻辑（仅用指定护卫，全部满4辆即停止发车）
          // false = 未设置逻辑（俱乐部全部成员按红数优先，不因护卫满而停止）
          useDesignatedOnly = designatedMembers.length > 0;
          guardPool = useDesignatedOnly ? designatedMembers : sortedHelpers;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: useDesignatedOnly
              ? `${token.name} 已设置指定护卫 ${designatedMembers.length} 位（同俱乐部），按已设置逻辑发车`
              : `${token.name} 未设置指定护卫或均不在该俱乐部，按未设置逻辑发车（按红数最多的人选择，${sortedHelpers.length} 位潜在护卫）`,
            type: "info",
          });
        } catch (e) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 获取护卫数据失败: ${e.message}，需要护卫的车辆将停止发车`,
            type: "warning",
            code: e.code // Log code if available
          });
        }

        // Helper function to assign guard.
        // 返回 true = 可以发车（无需护卫 / 已分配护卫 / 已有护卫）；
        // 返回 false = 需要护卫但无可用护卫（已设置/未设置逻辑均停止发车）
        const assignHelperIfNeeded = async (car) => {
          const color = Number(car.color || 0);
          // Only Red(5) and above need guards
          if (color < 5) return true;
          // Skip if already has helper
          if (car.helperId) return true;

          // 每次分配前刷新护卫状态，避免并发导致的使用次数超标
          await updateHelperUsage();

          if (!guardPool.length) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 车辆[${gradeLabel(car.color)}]需要护卫，但未获取到可用护卫列表，停止发车`,
              type: "warning",
            });
            return false;
          }

          // Find best available helper (按红数排序后取第一个未满4辆的)
          const bestHelper = guardPool.find((h) => {
            const used = Number(helperUsageMap[h.id] || 0);
            return used < 4;
          });

          if (bestHelper) {
            car.helperId = bestHelper.id;
            // Update local usage count (optimistic update)
            helperUsageMap[bestHelper.id] = Number(helperUsageMap[bestHelper.id] || 0) + 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 车辆[${gradeLabel(car.color)}]自动分配护卫: ${bestHelper.name} (已助战: ${helperUsageMap[bestHelper.id]}/4)`,
              type: "success",
            });
            return true;
          }

          // 已设置/未设置逻辑：护卫池中所有护卫均已满4辆 → 停止发车
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 车辆[${gradeLabel(car.color)}]需要护卫，但所有护卫次数已满，停止发车`,
            type: "warning",
          });
          return false;
        };

        // 3. Process Cars
        // 账号级守卫耗尽标志：一旦指定护卫已满，终止该账号整个智能发车
        let guardExhausted = false;
        for (const car of carList) {
          if (shouldStop.value || guardExhausted) break;

          if (Number(car.sendAt || 0) !== 0) continue;

          try {
            // 当启用金砖保底时，强制使用高票数的判断逻辑（严格模式），避免因票数不足而提前发车
            const effectiveTickets = batchSettings.useGoldRefreshFallback ? 999 : refreshTickets;
            
            const customConditions = {
              gold: batchSettings.smartDepartureGoldThreshold,
              recruit: batchSettings.smartDepartureRecruitThreshold,
              jade: batchSettings.smartDepartureJadeThreshold,
              ticket: batchSettings.smartDepartureTicketThreshold,
            };

            if (shouldSendCar(car, effectiveTickets, batchSettings.carMinColor, customConditions, batchSettings.useGoldRefreshFallback, batchSettings.smartDepartureMatchAll)) {
              const canSend = await assignHelperIfNeeded(car);
              if (!canSend) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 车辆[${gradeLabel(car.color)}]满足条件，但无可用指定护卫，终止该账号智能发车`,
                  type: "warning",
                });
                guardExhausted = true;
                break;
              }
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 车辆[${gradeLabel(car.color)}]满足条件，直接发车`,
                type: "info",
              });
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "car_send",
                {
                  carId: String(car.id),
                  helperId: car.helperId ? String(car.helperId) : 0,
                  text: "",
                  isUpgrade: false,
                },
                10000,
              );
              await workerSleep(delayConfig.action);
              continue;
            }

            let shouldRefresh = false;
            const free = Number(car.refreshCount ?? 0) === 0;
            // 启用金砖刷新保底：当且仅当设置了保底且无免费次数、无刷新券时，允许继续刷新
            const useGoldFallback = batchSettings.useGoldRefreshFallback && !free && refreshTickets < 6;
            
            if (refreshTickets >= 6) shouldRefresh = true;
            else if (free) shouldRefresh = true;
            else if (useGoldFallback) {
              shouldRefresh = true;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 车辆[${gradeLabel(car.color)}]仍不满足条件且无刷新次数，将启用金砖刷新`,
                type: "warning",
              });
            }
            else {
              const canSend = await assignHelperIfNeeded(car);
              if (!canSend) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 车辆[${gradeLabel(car.color)}]需要护卫但无可用指定护卫，终止该账号智能发车`,
                  type: "warning",
                });
                guardExhausted = true;
                break;
              }
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 车辆[${gradeLabel(car.color)}]不满足条件且无刷新次数，直接发车`,
                type: "warning",
              });
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "car_send",
                {
                  carId: String(car.id),
                  helperId: car.helperId ? String(car.helperId) : 0,
                  text: "",
                  isUpgrade: false,
                },
                10000,
              );
              await workerSleep(delayConfig.action);
              continue;
            }

            while (shouldRefresh && !shouldStop.value) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 车辆[${gradeLabel(car.color)}]尝试刷新...`,
                type: "info",
              });
              const resp = await tokenStore.sendMessageWithPromise(
                tokenId,
                "car_refresh",
                { carId: String(car.id) },
                10000,
              );
              const data = resp?.car || resp?.body?.car || resp;

              if (data && typeof data === "object") {
                if (data.color != null) car.color = Number(data.color);
                if (data.refreshCount != null)
                  car.refreshCount = Number(data.refreshCount);
                if (data.rewards != null) car.rewards = data.rewards;
              }

              try {
                const roleRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "role_getroleinfo",
                  {},
                  5000,
                );
                refreshTickets = Number(
                  roleRes?.role?.items?.[35002]?.quantity || 0,
                );
              } catch (_) {}

              if (shouldSendCar(car, batchSettings.useGoldRefreshFallback ? 999 : refreshTickets, batchSettings.carMinColor, customConditions, batchSettings.useGoldRefreshFallback, batchSettings.smartDepartureMatchAll)) {
                const canSend = await assignHelperIfNeeded(car);
                if (!canSend) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 刷新后车辆[${gradeLabel(car.color)}]满足条件，但无可用指定护卫，终止该账号智能发车`,
                    type: "warning",
                  });
                  guardExhausted = true;
                  break;
                }
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 刷新后车辆[${gradeLabel(car.color)}]满足条件，发车`,
                  type: "success",
                });
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "car_send",
                  {
                    carId: String(car.id),
                    helperId: car.helperId ? String(car.helperId) : 0,
                    text: "",
                    isUpgrade: false,
                  },
                  10000,
                );
                await workerSleep(delayConfig.action);
                break;
              }

              const freeNow = Number(car.refreshCount ?? 0) === 0;
              const useGoldFallback = batchSettings.useGoldRefreshFallback && !freeNow && refreshTickets < 6;

              if (refreshTickets >= 6) shouldRefresh = true;
              else if (freeNow) shouldRefresh = true;
              else if (useGoldFallback) {
                shouldRefresh = true;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 刷新后车辆[${gradeLabel(car.color)}]仍不满足条件且无刷新次数，将启用金砖刷新`,
                  type: "warning",
                });
              }
              else {
                const canSend = await assignHelperIfNeeded(car);
                if (!canSend) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 刷新后车辆[${gradeLabel(car.color)}]需要护卫但无可用指定护卫，终止该账号智能发车`,
                    type: "warning",
                  });
                  guardExhausted = true;
                  break;
                }
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 刷新后车辆[${gradeLabel(car.color)}]仍不满足条件且无刷新次数，发车`,
                  type: "warning",
                });
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "car_send",
                  {
                    carId: String(car.id),
                    helperId: car.helperId ? String(car.helperId) : 0,
                    text: "",
                    isUpgrade: false,
                  },
                  10000,
                );
                await workerSleep(delayConfig.action);
                break;
              }

              await workerSleep(delayConfig.refresh);
            }
          } catch (carError) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 车辆[${gradeLabel(car.color)}]处理失败: ${carError.message}，跳过该车辆`,
              type: "error",
            });
            continue;
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 智能发车完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `智能发车失败: ${error.message}`,
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
    message.success("批量智能发车结束");
  };

  /**
   * 一键收车
   */
  const batchClaimCars = async () => {
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
          message: `=== 开始一键收车: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 获取车辆信息...`,
          type: "info",
        });
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "car_getrolecar",
          {},
          10000,
        );
        let carList = normalizeCars(res?.body ?? res);
        let refreshlevel = res?.roleCar?.research?.[1] || 0;

        let claimedCount = 0;
        for (const car of carList) {
          if (shouldStop.value) break;
          if (canClaim(car)) {
            try {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "car_claim",
                { carId: String(car.id) },
                10000,
              );
              claimedCount++;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 收车成功: ${gradeLabel(car.color)}`,
                type: "success",
              });
              const roleRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "role_getroleinfo",
                {},
                5000,
              );
              let refreshpieces = Number(
                roleRes?.role?.items?.[35009]?.quantity || 0,
              );
              while (
                refreshlevel < CarresearchItem.length &&
                refreshpieces >= CarresearchItem[refreshlevel] &&
                !shouldStop.value
              ) {
                try {
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "car_research",
                    { researchId: 1 },
                    5000,
                  );
                  refreshlevel++;

                  const updatedRoleRes = await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "role_getroleinfo",
                    {},
                    5000,
                  );
                  refreshpieces = Number(
                    updatedRoleRes?.role?.items?.[35009]?.quantity || 0,
                  );

                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 执行车辆改装升级，当前等级: ${refreshlevel}`,
                    type: "success",
                  });

                  await workerSleep(delayConfig.action);
                } catch (e) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 车辆改装升级失败: ${e.message}`,
                    type: "error",
                  });
                  break;
                }
              }

              // 尝试领取改装升级累计奖励
              try {
                const rewardRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "car_claimpartconsumereward",
                  {},
                  5000,
                );
                if (rewardRes && rewardRes.reward) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 领取改装升级累计奖励成功`,
                    type: "success",
                  });
                }
              } catch (e) {
                // 忽略错误
              }
            } catch (e) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 收车失败: ${e.message}`,
                type: "warning",
              });
            }
            await workerSleep(delayConfig.action);
          }
        }

        if (claimedCount === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有可收取的车辆`,
            type: "info",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 收车完成，共收取 ${claimedCount} 辆 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 收车失败: ${error.message}`,
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
    message.success("批量一键收车结束");
  };

  return {
    batchSmartSendCar,
    batchClaimCars,
  };
}
