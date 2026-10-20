/**
 * 周年活动批量任务
 * 祝福(签到) / 领取(个人 + 分享) / 抽奖(单抽、十连抽) / 入镜任务领取
 *
 * 入镜任务复用“通行证(warOrder)”活动框架（命令 activity_warordertaskclaim），
 * 与 tasksXuanwuBlessing.js 同构；区别是活动ID后缀，领取范围由服务端
 * complete / taskClaimed 数据决定，不再硬编码任务序号。
 */

import { getXuanwuActBase } from "@/utils/towerActId";

// 入镜任务活动ID后缀（前缀 = 活动起始日期 YYMMDD，如 "261016" + "9" = 2610169）
const WAR_ORDER_SUFFIX = "9";

// 胶片(放入胶卷)活动ID后缀（同前缀，如 "261016" + "8" = 2610168）
const PHOTO_SUFFIX = "8";
// 胶卷道具ID
const FILM_ITEM_ID = 5290;
// 每次最多放入 10 个；凑满 10 个自动兑换一次礼物
const PHOTO_BATCH_SIZE = 10;

// 十连抽次数
const DRAW_BATCH_TIMES = 10;

// 全服签到奖励最多连续探测档位数（服务端异常时不至于无限循环）
const FULL_SERVER_MAX_PROBE = 50;

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

  /** 全服签到已领取档位（fullServerClaimMap 键为档位号，值为领取时间戳） */
  const fullServerClaimedIds = (info) => {
    const map = info?.fullServerClaimMap;
    if (!map) return [];
    const keys = Array.isArray(map)
      ? map.map((e) => e?.key ?? e?.k ?? e)
      : Object.keys(map);
    return keys.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  };

  /**
   * 领取全服签到奖励（celebrate_claimfullserver）
   *
   * 服务端只下发“已领取”的 fullServerClaimMap，不提供可领清单。
   * 抓包日志中表现为：领完一档后下一档立即可领（8→9→10…14），
   * 即后续档位会动态增加。因此从已领最大档位的下一档开始逐个尝试，
   * 一旦服务端拒绝（未解锁/已领完）即停止，避免盲目枚举。
   *
   * @returns {Promise<number>} 本次成功领取的档位数
   */
  const claimFullServer = async (tokenId, info, tokenName) => {
    const claimedIds = fullServerClaimedIds(info);
    const startId = (claimedIds.length ? Math.max(...claimedIds) : 0) + 1;
    let claimed = 0;
    let nextId = startId;

    for (let probe = 0; probe < FULL_SERVER_MAX_PROBE; probe++) {
      if (shouldStop.value) break;
      let res;
      try {
        res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "celebrate_claimfullserver",
          { idList: [nextId] },
          8000,
        );
      } catch (error) {
        // 服务端拒绝即代表当前没有更多可领档位
        log(
          `${tokenName} 全服领取[${nextId}]结束: ${error.message || "不可领取"}`,
          "info",
        );
        break;
      }

      if (!res?.reward?.length) break;

      log(
        `${tokenName} 周年全服领取[${nextId}]: ${formatReward(res.reward)}`,
        "success",
      );
      claimed++;
      nextId++;
      await delay(commandDelay);
    }

    if (claimed > 0) {
      log(
        `${tokenName} 周年全服领取完成: ${claimed} 档 (${startId}-${nextId - 1})`,
        "success",
      );
    }
    return claimed;
  };

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

  /** 周年领取：个人领取 -> 全服领取（动态续领） -> 分享领取 */
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
      let fullServer = 0;

      if (keys.length) {
        claimed = await claimPersonal(tokenId, keys, token.name);
        await delay(commandDelay);
      }

      // 全服签到奖励：领完一档会解锁下一档，循环领取直到服务端拒绝
      fullServer = await claimFullServer(tokenId, info, token.name);
      if (fullServer > 0) await delay(commandDelay);

      // 分享领取：对本次可领/已领的档位逐个尝试（已分享过的服务端会拒绝）
      for (const id of keys) {
        if (shouldStop.value) break;
        shared += await shareCelebrate(tokenId, id, token.name);
        await delay(commandDelay);
      }

      log(
        `${token.name} 周年领取完成: 个人${claimed}, 全服${fullServer}, 分享${shared}, 档位[${keys.join(",") || "无"}]`,
        claimed + shared + fullServer > 0 ? "success" : "info",
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

  // ---------------- 周年放入胶卷 ----------------

  /**
   * 解析胶片活动ID与当前进度
   * photoActivityInfo[activityId] = { num: 本张已放入数量, pieceId: 当前胶片编号 }
   */
  const resolvePhotoActivity = async (tokenId, tokenName) => {
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "activity_get",
      {},
      8000,
    );
    const photoMap = res?.activity?.photoActivityInfo || {};

    // 活动ID前缀为开启日期 YYMMDD；只接受最近 30 天内开启且后缀匹配的活动，
    // 避免误取其它以 8 结尾的旧活动。
    const isRecentAct = (actId) => {
      const s = String(actId);
      if (s.length < 7) return false;
      const d = new Date(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)));
      if (Number.isNaN(d.getTime())) return false;
      const days = (Date.now() - d.getTime()) / 86400000;
      return days >= -1 && days <= 30;
    };

    const listed = Object.keys(photoMap)
      .map(Number)
      .filter(
        (n) =>
          Number.isFinite(n) &&
          n > 0 &&
          String(n).endsWith(PHOTO_SUFFIX) &&
          isRecentAct(n),
      )
      // 越新的活动越靠前
      .sort((a, b) => b - a);

    // 回退：按活动起始日期推导（活动可能持续多日，向前探测 7 天）
    const candidates = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      candidates.push(Number(getXuanwuActBase(date) + PHOTO_SUFFIX));
    }

    for (const actId of [...new Set([...listed, ...candidates])]) {
      const info = photoMap[actId];
      if (info) return { actId, info };
    }

    // 最后兜底：活动后缀规则若有变化，直接取活动数据中最新的一条胶片进度
    const anyIds = Object.keys(photoMap)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a);
    for (const actId of anyIds) {
      if (photoMap[actId]) return { actId, info: photoMap[actId] };
    }

    log(
      `${tokenName} 未找到周年胶片活动（候选: ${[...new Set([...listed, ...candidates])].join(",")}）`,
      "warning",
    );
    return null;
  };

  /** 读取当前账号的胶卷数量 */
  const fetchFilmCount = async (tokenId) => {
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
      8000,
    );
    const qty = res?.role?.items?.[FILM_ITEM_ID]?.quantity;
    return Number(qty) || 0;
  };

  /** 兑换一次胶片礼物 */
  const claimPhotoReward = async (tokenId, actId, pieceId, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_claimphotoreward",
        { activityId: actId, pieceId },
        8000,
      );
      log(
        `${tokenName} 胶片礼物兑换: ${formatReward(res?.reward || []) || "无奖励"}`,
        "success",
      );
      return { ok: true, info: res?.activity?.photoActivityInfo?.[actId] || null };
    } catch (error) {
      log(
        `${tokenName} 胶片礼物兑换失败: ${error.message || "未知错误"}`,
        "warning",
      );
      return { ok: false, info: null };
    }
  };

  /**
   * 周年放入胶卷：每次最多放 10 个，凑满 10 个自动兑换一次礼物。
   * 协议：activity_photo {activityId, num, pieceId} ->
   *       activity_claimphotoreward {activityId, pieceId}
   */
  const batchCelebratePhoto = async () =>
    runBatch("周年放入胶卷", async (token, tokenId) => {
      const resolved = await resolvePhotoActivity(tokenId, token.name);
      if (!resolved) {
        throw new Error("未找到周年胶片活动，请确认活动是否开启");
      }

      const { actId } = resolved;
      let pieceId = Number(resolved.info?.pieceId) || 0;
      let inPiece = Number(resolved.info?.num) || 0;
      let films = await fetchFilmCount(tokenId);

      if (films <= 0) {
        log(`${token.name} 没有胶卷，跳过 (活动${actId})`, "info");
        return;
      }

      log(
        `${token.name} 胶卷 ${films} 个，当前胶片${pieceId} 已放 ${inPiece}/10`,
      );

      let placed = 0;
      let claimed = 0;
      let stallCount = 0;

      while (films > 0 && !shouldStop.value) {
        // 当前胶片已满：先兑换礼物，换到下一张
        if (inPiece >= PHOTO_BATCH_SIZE) {
          const res = await claimPhotoReward(tokenId, actId, pieceId, token.name);
          if (res.ok) claimed++;
          if (res.info) {
            pieceId = Number(res.info.pieceId ?? pieceId);
            inPiece = Number(res.info.num) || 0;
          } else if (!res.ok) {
            // 兑换失败时不再重复尝试同一张，避免死循环
            break;
          } else {
            pieceId += 1;
            inPiece = 0;
          }
          await delay(commandDelay);
          continue;
        }

        const num = Math.min(PHOTO_BATCH_SIZE - inPiece, films);
        let res;
        try {
          res = await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_photo",
            { activityId: actId, num, pieceId },
            8000,
          );
        } catch (error) {
          log(
            `${token.name} 放入胶卷失败: ${error.message || "未知错误"}`,
            "error",
          );
          break;
        }

        const info = res?.activity?.photoActivityInfo?.[actId];
        const prevInPiece = inPiece;
        const prevFilms = films;
        if (info) {
          pieceId = Number(info.pieceId ?? pieceId);
          inPiece = Number(info.num) || 0;
        } else {
          inPiece += num;
        }
        placed += num;

        // 响应里带最新胶卷数量（null 表示已用完），优先以服务端为准
        const qty = res?.role?.items?.[FILM_ITEM_ID]?.quantity;
        films = qty === null ? 0 : Number.isFinite(Number(qty)) ? Number(qty) : films - num;

        // 防护：服务端既没推进本张进度也没扣胶卷（活动结束/参数不被接受）时避免死循环
        if (inPiece <= prevInPiece && films >= prevFilms) {
          stallCount++;
          if (stallCount >= 3) {
            log(`${token.name} 胶卷进度未推进，停止本次放入`, "warning");
            break;
          }
        } else {
          stallCount = 0;
        }

        log(
          `${token.name} 放入胶卷 ${num} 个 (剩余 ${films}，胶片${pieceId} ${inPiece}/10)`,
        );

        if (inPiece >= PHOTO_BATCH_SIZE) {
          const claimRes = await claimPhotoReward(tokenId, actId, pieceId, token.name);
          if (claimRes.ok) claimed++;
          if (claimRes.info) {
            pieceId = Number(claimRes.info.pieceId ?? pieceId);
            inPiece = Number(claimRes.info.num) || 0;
          } else if (!claimRes.ok) {
            break;
          } else {
            pieceId += 1;
            inPiece = 0;
          }
          await delay(commandDelay);
        }

        await delay(commandDelay);
      }

      log(
        `${token.name} 放入胶卷完成: 放入 ${placed} 个，兑换礼物 ${claimed} 次 (活动${actId})`,
        placed > 0 ? "success" : "info",
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

  /**
   * 领取入镜任务：遍历活动内全部任务，跳过已领取(taskClaimed)与零进度(complete<=0)，
   * 其余尝试领取；服务端对“未达成完成条件”返回错误(700010)即视为未完成跳过，
   * 因此无需硬编码任务序号或后续手动补充。
   */
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

  /** 周年入镜任务领取（按服务端数据自动判定） */
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
    batchCelebratePhoto,
  };
}
