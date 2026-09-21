/**
 * 逐鹿盐山任务
 * 包含: 一键批量竞猜（自动选助威最高队伍）、领取竞猜奖励、逐鹿助威
 */

// 助威单次请求票数上限（分批投出，避免单次过大被服务端拒绝）
const APEX_VOTE_CHUNK = 10;

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
          } catch (err) {
            failCount++;
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

  /**
   * 拉取某轮次(场次)的对阵，返回 teamId -> 队伍信息
   * idx 为组偏移，客户端步长为 5；找齐待领取队伍即停止
   */
  const fetchRoundTeams = async (tokenId, sid, pendingIds) => {
    const map = new Map();
    const need = new Set(pendingIds || []);
    let emptyStreak = 0;
    for (let idx = 0; idx <= 40; idx += 5) {
      if (shouldStop.value) break;
      let groups = [];
      try {
        const resp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getguesslist",
          { scheduleId: Number(sid), idx },
          8000,
        );
        groups = resp?.apexGuessList || [];
      } catch (e) {
        groups = [];
      }
      if (groups.length === 0) {
        // 连续两页为空才判定无数据（避免偶发失败误判）
        emptyStreak++;
        if (emptyStreak >= 2) break;
      } else {
        emptyStreak = 0;
        for (const g of groups) {
          for (const t of g || []) {
            if (t?.teamId && !map.has(t.teamId)) map.set(t.teamId, t);
          }
        }
        if ([...need].every((id) => map.has(id))) break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return map;
  };

  /**
   * 领取逐鹿盐山竞猜奖励（预测成功的场次）
   * 依据 apex_getroleinfo 的 guessMap(已竞猜队伍) + guessClaimMap(已领取标记)，
   * 逐场次拉取 apex_getguesslist 判断 isWin，再对未领取的获胜队伍调用 apex_guessclaim。
   * @param {number} inputScheduleId - >0 只处理该场次；<=0 处理本届各轮次
   */
  const batchApexClaimRewards = async (inputScheduleId = 0) => {
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
          message: `=== 开始领取逐鹿盐山竞猜奖励: ${token.name} ===`,
          type: "info",
        });

        // 1. 获取角色竞猜记录
        const roleResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getroleinfo",
          {},
          8000,
        );
        const apexInfo = roleResp?.apexRoleInfo || {};
        const guessMap = apexInfo.guessMap || {};
        const guessClaimMap = apexInfo.guessClaimMap || {};

        // 2. 确定要领取的轮次：每场次=一个大轮次(64强/32强/16强...)
        //    默认取最新场次起连续的本届轮次（更早一届的场次已过期，不再遍历）
        const input = Number(inputScheduleId);
        let rounds;
        if (Number.isFinite(input) && input > 0) {
          rounds = [String(input)];
        } else {
          rounds = [];
          const nums = Object.keys(guessMap)
            .map(Number)
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => b - a);
          if (nums.length > 0) {
            let cur = nums[0];
            while (guessMap[String(cur)] && rounds.length < 8) {
              rounds.push(String(cur));
              cur -= 1;
            }
          }
        }

        if (rounds.length === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有竞猜记录，无需领取`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        let claimCount = 0;
        let skipCount = 0;
        let failCount = 0;
        let rewardTotal = 0;
        const emptyRounds = [];

        for (const sid of rounds) {
          if (shouldStop.value) break;

          const guessedTeamIds = guessMap[sid] || [];
          if (guessedTeamIds.length === 0) continue;

          // 已领取队伍集合（服务端键可能带 "_" 前缀，需归一化）
          const claimedSet = new Set();
          for (const [k, v] of Object.entries(guessClaimMap[sid] || {})) {
            if (v !== true) continue;
            claimedSet.add(k.startsWith("_") ? k.slice(1) : k);
          }
          const pending = guessedTeamIds.filter((id) => !claimedSet.has(id));
          if (pending.length === 0) {
            skipCount += guessedTeamIds.length;
            continue;
          }

          // 3. 拉取该轮对阵判定胜负
          const winMap = await fetchRoundTeams(tokenId, sid, pending);
          if (winMap.size === 0) {
            emptyRounds.push(sid);
            continue;
          }

          // 4. 逐队领取（仅领取未领取且预测成功的队伍）
          let roundClaim = 0;
          for (const teamId of pending) {
            if (shouldStop.value) break;

            const teamInfo = winMap.get(teamId);
            // 明确未获胜的不领
            if (teamInfo && teamInfo.isWin !== true) {
              skipCount++;
              continue;
            }

            try {
              const resp = await tokenStore.sendMessageWithPromise(
                tokenId,
                "apex_guessclaim",
                { scheduleId: Number(sid), teamId },
                8000,
              );
              claimCount++;
              roundClaim++;
              for (const item of resp?.reward || []) {
                rewardTotal += Number(item?.value) || 0;
              }
            } catch (err) {
              failCount++;
            }

            await new Promise((r) => setTimeout(r, 500));
          }

          if (roundClaim > 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 场次 ${sid} 领取成功 ${roundClaim} 队`,
              type: "success",
            });
          }
        }

        if (emptyRounds.length > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 场次 ${emptyRounds.join("/")} 暂无对阵数据（结果未出或已过期），跳过`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 竞猜领奖完成: 成功${claimCount} 跳过${skipCount} 失败${failCount} 奖励${rewardTotal} ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 竞猜领奖失败: ${error.message}`,
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
    message.success("批量竞猜领奖结束");
  };

  /**
   * 拉取某届某页助威候选队伍（groupId 固定 0，idx 步长 10 与客户端一致）
   */
  const fetchVoteList = async (tokenId, round, idx) => {
    try {
      const resp = await tokenStore.sendMessageWithPromise(
        tokenId,
        "apex_getvotelist",
        { groupId: 0, idx, round },
        8000,
      );
      return resp?.apexVoteList || [];
    } catch (e) {
      return [];
    }
  };

  /**
   * 逐鹿盐山助威：把助威券投给当前届助威数最高的队伍（或指定队伍）
   * 助威轮次 round 为"届数"，由 apex_getroleinfo.voteMap 的已投届数推测；
   * 券余额取自 apexRoleInfo.voteItemCnt，逐批发券避免单次过大被拒。
   * @param {string} target - 队伍名称或 teamId；为空则选助威数最高的队伍
   * @param {number} inputVoteCount - 本次投出票数（>0 按该票数，超过券余额则投完为止；<=0 全部投出）
   */
  const batchApexVote = async (target = "", inputVoteCount = 3) => {
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
          message: `=== 开始逐鹿盐山助威: ${token.name} ===`,
          type: "info",
        });

        const roleResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "apex_getroleinfo",
          {},
          8000,
        );
        const apexInfo = roleResp?.apexRoleInfo || {};
        let voteItemCnt = Number(apexInfo.voteItemCnt) || 0;
        const voteMap = apexInfo.voteMap || {};

        if (voteItemCnt <= 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有助威券，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        // 本次投出票数：输入 >0 按其值（不超过券余额），否则全部投出
        const wantCnt = Number(inputVoteCount);
        const quota =
          Number.isFinite(wantCnt) && wantCnt > 0
            ? Math.min(wantCnt, voteItemCnt)
            : voteItemCnt;

        // 1. 确定当前助威届数：优先试最新已投届数+1（新一届），再回退到最新已投届数
        const votedRounds = Object.keys(voteMap)
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => b - a);
        const roundCandidates =
          votedRounds.length > 0
            ? [votedRounds[0] + 1, votedRounds[0]]
            : [1, 2, 3, 4];

        let round = roundCandidates[0];
        let firstPage = [];
        for (const r of roundCandidates) {
          if (shouldStop.value) break;
          firstPage = await fetchVoteList(tokenId, r, 0);
          if (firstPage.length > 0) {
            round = r;
            break;
          }
          await new Promise((res) => setTimeout(res, 400));
        }

        if (firstPage.length === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未找到可助威的队伍（助威未开启或已结束）`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        // 2. 选取目标队伍：默认榜首（列表按助威数降序），否则按名称/teamId 查找
        let team = firstPage[0];
        if (target && String(target).trim()) {
          const want = String(target).trim();
          team = null;
          for (let idx = 0; idx <= 40; idx += 10) {
            if (shouldStop.value) break;
            const page = idx === 0 ? firstPage : await fetchVoteList(tokenId, round, idx);
            if (page.length === 0) break;
            const hit = page.find((t) => t.teamId === want || t.name === want);
            if (hit) {
              team = hit;
              break;
            }
            if (idx > 0) await new Promise((res) => setTimeout(res, 400));
          }
          if (!team) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 未找到助威队伍「${want}」`,
              type: "warning",
            });
            tokenStatus.value[tokenId] = "completed";
            return;
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 目标: ${team.name}(${team.teamId}) 现有助威 ${team.cheerCnt}，券 ${voteItemCnt} 张，本次投 ${quota} 张`,
          type: "info",
        });

        // 3. 分批投出（每批不超过 APEX_VOTE_CHUNK 张）
        let voted = 0;
        let failCount = 0;
        const rewardMap = {};
        while (quota - voted > 0 && !shouldStop.value) {
          const cnt = Math.min(APEX_VOTE_CHUNK, quota - voted);
          try {
            const resp = await tokenStore.sendMessageWithPromise(
              tokenId,
              "apex_vote",
              { teamId: team.teamId, round, voteCnt: cnt },
              8000,
            );
            voted += cnt;
            const left = Number(resp?.apexRoleInfo?.voteItemCnt);
            voteItemCnt = Number.isFinite(left) ? left : voteItemCnt - cnt;
            for (const item of resp?.reward || []) {
              const key = item?.itemId ? `物品${item.itemId}` : "银币";
              rewardMap[key] = (rewardMap[key] || 0) + (Number(item?.value) || 0);
            }
          } catch (err) {
            failCount++;
            // 被拒（如每日上限）就停止，避免连续报错
            break;
          }
          await new Promise((res) => setTimeout(res, 400));
        }

        const rewardText = Object.entries(rewardMap)
          .map(([k, v]) => `${k}×${v}`)
          .join(" ");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 助威完成: 投出${voted}票 失败${failCount} 剩余券${voteItemCnt}${rewardText ? " 奖励 " + rewardText : ""} ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 逐鹿助威失败: ${error.message}`,
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
    message.success("批量逐鹿盐山助威结束");
  };

  return {
    batchApexGuess,
    batchApexClaimRewards,
    batchApexVote,
    resolveActiveScheduleId,
    fetchAllGuessGroups,
  };
}
