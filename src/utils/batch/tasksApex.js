/**
 * 逐鹿盐山竞猜任务
 * 包含: 一键批量竞猜（自动选助威最高队伍）
 */

/**
 * 创建逐鹿盐山竞猜任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksApex(deps) {
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

  /**
   * 探测当前活跃竞猜场次
   * 规则：
   * 1. 场次输入值 > 0：只查该场次，无对阵信息则返回 null（调用方应停止并提示）
   * 2. 场次输入值 <= 0：以实时读取的最大场次 N 为起点，从 N+5 开始从大到小逐个
   *    调用 apex_getguesslist，第一个有对阵信息的场次即为当前场次
   * @returns {Promise<{scheduleId: string|null, groups: Array}>}
   */
  const resolveActiveScheduleId = async (tokenId, guessClaimMap, inputScheduleId) => {
    const input = Number(inputScheduleId);

    // 规则 1：手动指定场次，只查该场次
    if (Number.isFinite(input) && input > 0) {
      try {
        const resp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getguesslist",
          { scheduleId: input, idx: 0 },
          8000,
        );
        const groups = resp?.apexGuessList || [];
        if (groups.length > 0) {
          return { scheduleId: String(input), groups };
        }
      } catch (e) {
        // 请求失败视为该场次无对阵信息
      }
      return { scheduleId: null, groups: [], reason: `指定场次 ${input} 无对阵信息` };
    }

    // 规则 2：从实时最大场次 N 的 N+5 开始，从大到小探测
    const nums = Object.keys(guessClaimMap || {})
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    const start = (nums.length > 0 ? nums[0] : 0) + 5;

    for (let sid = start; sid > start - 12; sid--) {
      try {
        const resp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getguesslist",
          { scheduleId: sid, idx: 0 },
          8000,
        );
        const groups = resp?.apexGuessList || [];
        if (groups.length > 0) {
          return { scheduleId: String(sid), groups };
        }
      } catch (e) {
        // 该场次无数据或报错，继续探测下一个
      }
    }
    return {
      scheduleId: null,
      groups: [],
      reason: `从 ${start} 向下探测 12 个场次均无对阵信息`,
    };
  };

  /**
   * 分页拉取某场次全部对阵
   * idx 语义未知（可能是条目下标/页内偏移/页号），用 idx+1 逐次请求并按 teamId 去重，
   * 连续 2 次空响应或全部重复即停止，兼容各种分页实现。
   */
  const fetchAllGuessGroups = async (tokenId, scheduleId, firstGroups = []) => {
    const allGroups = [];
    const seen = new Set();
    const collect = (groups) => {
      let added = 0;
      for (const g of groups || []) {
        // 按组内 teamId 排序后拼接作为去重 key，避免顺序差异导致误判
        const key = (g || [])
          .map((t) => t?.teamId)
          .sort()
          .join("|");
        if (!seen.has(key)) {
          seen.add(key);
          allGroups.push(g);
          added++;
        }
      }
      return added;
    };
    if (collect(firstGroups) === 0 && firstGroups.length > 0) {
      return allGroups;
    }
    let emptyStreak = 0;
    for (let idx = 1; idx <= 64; idx++) {
      if (shouldStop.value) break;
      try {
        const resp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getguesslist",
          { scheduleId: Number(scheduleId), idx },
          8000,
        );
        const groups = resp?.apexGuessList || [];
        if (groups.length === 0) {
          emptyStreak++;
          if (emptyStreak >= 2) break;
          continue;
        }
        emptyStreak = 0;
        if (collect(groups) === 0) break;
      } catch (e) {
        break;
      }
    }
    return allGroups;
  };

  /**
   * 一键批量逐鹿盐山竞猜
   * 自动选每组对阵中助威数最高的队伍
   */
  const batchApexGuess = async (inputScheduleId = 0) => {
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

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始逐鹿盐山竞猜: ${token.name} ===`,
          type: "info",
        });

        // 1. 获取角色信息
        const roleResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getroleinfo",
          {},
          8000,
        );
        const apexInfo = roleResp?.apexRoleInfo || {};
        const guessMap = apexInfo.guessMap || {};
        const guessClaimMap = apexInfo.guessClaimMap || {};

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 抓取到赛季信息 guessClaimMap: ${JSON.stringify(guessClaimMap)}`,
          type: "debug",
        });

        // 2. 按规则确定当前 scheduleId（>0 只用指定场次；<=0 从最大场次+5 向下探测）
        const resolved = await resolveActiveScheduleId(
          tokenId,
          guessClaimMap,
          inputScheduleId,
        );
        const scheduleId = resolved.scheduleId;

        if (!scheduleId) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 停止竞猜: ${resolved.reason || "未找到对阵信息"}（已竞猜记录场次: ${
              Object.keys(guessClaimMap).join(", ") || "无"
            }）`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
          // 手动指定场次无对阵信息时，停止整个批量任务
          if (Number(inputScheduleId) > 0) {
            shouldStop.value = true;
          }
          return;
        }

        // 3. 收集已竞猜的队伍 ID
        const guessedTeamIds = new Set(guessMap[scheduleId] || []);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 当前赛季: ${scheduleId}，已竞猜: ${guessedTeamIds.size} 队`,
          type: "info",
        });

        // 4. 分页获取所有对阵（探测时已拿到首页，直接复用；idx 逐 1 递增+去重，兼容不同分页语义）
        const allGroups = await fetchAllGuessGroups(tokenId, scheduleId, resolved.groups);

        if (allGroups.length === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有对阵数据`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 共 ${allGroups.length} 组对阵`,
          type: "info",
        });

        // 4.1 对阵数不足 32 组（64强阶段）时，抓取 apex_get64oppomap 原始响应，用于分析 64 强对阵结构
        if (allGroups.length < 32) {
          try {
            const oppoResp = await tokenStore.sendMessageWithPromise(
              tokenId,
              "apex_get64oppomap",
              { scheduleId: Number(scheduleId), groupId: 0 },
              8000,
            );
            const raw = JSON.stringify(oppoResp);
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 【64强对阵原始数据】scheduleId=${scheduleId} groupId=0: ${raw.length > 3000 ? raw.slice(0, 3000) + "...(截断)" : raw}`,
              type: "debug",
            });
          } catch (e) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 抓取 apex_get64oppomap 失败: ${e?.message || e}`,
              type: "debug",
            });
          }
        }

        // 5. 遍历对阵，选助威最高的队伍竞猜
        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        for (const group of allGroups) {
          if (shouldStop.value) break;

          const [team0, team1] = group;
          if (!team0 || !team1) continue;

          // 两队都已竞猜则跳过
          if (guessedTeamIds.has(team0.teamId) && guessedTeamIds.has(team1.teamId)) {
            skipCount++;
            continue;
          }

          // 选助威数更高的队伍
          let pick;
          if (guessedTeamIds.has(team0.teamId)) {
            pick = team1;
          } else if (guessedTeamIds.has(team1.teamId)) {
            pick = team0;
          } else {
            pick = team0.cheerCnt >= team1.cheerCnt ? team0 : team1;
          }

          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "apex_guess",
              { teamId: pick.teamId },
              8000,
            );
            guessedTeamIds.add(pick.teamId);
            successCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 竞猜 ${pick.name} (${pick.teamId}) 助威:${pick.cheerCnt} ✓`,
              type: "success",
            });
          } catch (err) {
            failCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 竞猜 ${pick.name} 失败: ${err.message}`,
              type: "error",
            });
          }

          // 竞猜间隔
          await new Promise((r) => setTimeout(r, 500));
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 竞猜完成: 成功${successCount} 跳过${skipCount} 失败${failCount} ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 逐鹿盐山竞猜失败: ${error.message}`,
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
    message.success("批量逐鹿盐山竞猜结束");
  };

  return {
    batchApexGuess,
    resolveActiveScheduleId,
    fetchAllGuessGroups,
  };
}
