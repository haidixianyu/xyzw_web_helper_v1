/**
 * 比赛房间任务
 * 包含: batchPkRoomAppoint
 */
import { workerSleep } from "../workerTimer.js";

/**
 * 创建比赛房间任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksPkRoom(deps) {
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

  /**
   * 批量预约当期比赛（对应游戏内比赛房间的红心按钮）
   */
  const batchPkRoomAppoint = async () => {
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
          message: `=== 开始预约比赛: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        // 当期比赛房间（全服同一场，roomId 由服务端下发）
        const roomInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_getfightroominfo",
          {},
          5000,
        );
        const roomId = roomInfo?.roomId;
        if (!roomId) {
          throw new Error("未获取到当期比赛房间");
        }
        await workerSleep(delayConfig.command);

        // 与游戏内点击路径保持一致：先拉房间详情，再发起预约
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_getfightroomdetail",
          { roomId },
          5000,
        );
        await workerSleep(delayConfig.command);

        // 预约结果通过 syncresp 返回：role.statistics["pk:appoint:room:id"]
        const appointResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_appoint",
          {},
          8000,
        );
        const appointedRoomId =
          appointResp?.role?.statistics?.["pk:appoint:room:id"];

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 预约成功: ${roomInfo?.roomName || ""}(${roomId})${
            appointedRoomId ? ` 已记录:${appointedRoomId}` : ""
          } ===`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 预约比赛失败: ${error.message || "未知错误"}`,
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
    message.success("批量预约比赛结束");
  };

  return { batchPkRoomAppoint };
}