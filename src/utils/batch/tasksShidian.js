/**
 * 十殿转盘任务
 * 包含: 一键批量领取十殿奖励（转盘循环、图鉴奖励、周奖励）
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 从 night_mare_getroleinfo 响应中提取转盘次数（与 ShiDianCard 保持一致）
function getTurntableCnt(res) {
  if (!res) return 0;
  if (res.turntableLeftCnt !== undefined && res.turntableLeftCnt !== null) {
    return res.turntableLeftCnt;
  }
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
  if (nm.turntableLeftCnt !== undefined && nm.turntableLeftCnt !== null) {
    return nm.turntableLeftCnt;
  }
  return 0;
}

/**
 * 创建十殿转盘任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksShidian(deps) {
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

  const commandDelay = () => delayConfig?.command || 500;

  // 领取类命令为尽力而为，服务器可能在条件未满足时返回错误（如 200020），
  // 不应因单项失败中断整个流程，记录后继续。
  const safeClaim = async (tokenName, tokenId, cmd, desc) => {
    try {
      await tokenStore.sendMessageWithPromise(tokenId, cmd, {}, 8000);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${desc}成功`,
        type: "success",
      });
      return true;
    } catch (error) {
      const msg = String(error?.message || error || "");
      // 服务器业务错误(如 200020)视为“暂未满足条件”，仅提示不中断
      const isBusinessErr = /服务器错误|2000\d\d/.test(msg);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${desc}失败: ${msg}${isBusinessErr ? "（视为暂不可领取，继续）" : ""}`,
        type: isBusinessErr ? "warning" : "error",
      });
      return false;
    }
  };

  /**
   * 一键批量领取十殿奖励（转盘循环）
   */
  const batchShidianReward = async () => {
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
        await ensureConnection(tokenId);

        // 读取角色 roleId（nightmare_getroleinfo 需传入 roleId 参数，与 ShiDianCard 一致）
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const roleId = roleInfo?.role?.roleId
          ? String(roleInfo.role.roleId)
          : tokenId;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取十殿奖励: ${token.name} ===`,
          type: "info",
        });

        // 1. 领取转盘奖励次数
        await safeClaim(token.name, tokenId, "nightmare_claimturnrewardtimes", "领取转盘奖励次数");
        await sleep(commandDelay());

        // 2. 领取图鉴奖励
        await safeClaim(token.name, tokenId, "nightmare_claimbook", "领取图鉴奖励");
        await sleep(commandDelay());

        // 3. 领取周奖励
        await safeClaim(token.name, tokenId, "nightmare_claimweekreward", "领取周奖励");
        await sleep(commandDelay());

        // 4. 转盘循环：直到转盘次数为 0
        let bookScore = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 100;
        while (!shouldStop.value && iterations < MAX_ITERATIONS) {
          // 读取转盘状态（尽力而为，读取失败视为需停止）
          let info;
          try {
            info = await tokenStore.sendMessageWithPromise(
            tokenId,
            "nightmare_getroleinfo",
            { roleId: parseInt(roleId) },
            8000,
          );
          } catch (readErr) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 读取十殿信息失败: ${readErr?.message}，停止转盘`,
              type: "warning",
            });
            break;
          }
          const turntable = Number(getTurntableCnt(info)) || 0;
          if (!turntable) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 转盘次数已用完`,
              type: "info",
            });
            break;
          }

          const nm = info?.nightMareData || info?.nightmareData || {};
          if (nm.bookScore !== undefined) bookScore = Number(nm.bookScore) || 0;

          // bookScore 为 5 的倍数时领取转盘奖励次数
          if (bookScore > 0 && bookScore % 5 === 0) {
            await safeClaim(token.name, tokenId, "nightmare_claimturnrewardtimes", "转盘奖励次数(bookScore倍数)");
            await sleep(commandDelay());
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} bookScore为5的倍数，转盘奖励次数+1`,
              type: "info",
            });
          }

          // bookScore 达到 50 时领取图鉴奖励
          if (bookScore === 50) {
            await safeClaim(token.name, tokenId, "nightmare_claimbook", "图鉴奖励(bookScore=50)");
            await sleep(commandDelay());
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} bookScore=50，已领取十殿图鉴奖励`,
              type: "success",
            });
          }

          // 转盘点击（尽力而为，失败即停止，避免无限重试）
          const clicked = await safeClaim(
            token.name,
            tokenId,
            "nightmare_clickturntable",
            "转盘旋转",
          );
          if (!clicked) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 转盘执行失败，停止转盘`,
              type: "warning",
            });
            break;
          }
          await sleep(commandDelay());
          iterations++;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 转盘执行成功 (${iterations})，剩余次数：${turntable - 1}`,
            type: "info",
          });
        }

        if (iterations >= MAX_ITERATIONS) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 转盘操作达到最大迭代次数，已停止`,
            type: "error",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 十殿奖励领取完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 十殿奖励领取失败: ${error.message}`,
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
    message.success("批量十殿奖励领取结束");
  };

  return {
    batchShidianReward,
  };
}