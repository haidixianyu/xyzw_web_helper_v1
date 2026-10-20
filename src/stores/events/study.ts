import { isInCurrentWeek, sleep } from "@/utils/base";
import { gameLogger } from "@/utils/logger";
import { findAnswer } from "@/utils/studyQuestionsFromJSON";
import type { EVM, XyzwSession } from ".";

// 每个账号的答题状态独立存放：批量答题时多个账号并发，共用一份状态会互相覆盖，
// 导致“A 账号答完 → B 账号也被判定为已完成”。
const getTokenStudyStatus = (gameData: any, tokenId: string) => {
  if (!gameData.value.studyStatusByToken) {
    gameData.value.studyStatusByToken = {};
  }
  const map = gameData.value.studyStatusByToken;
  if (!map[tokenId]) {
    map[tokenId] = {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: '',
      timestamp: null
    };
  }
  return map[tokenId];
};

export const StudyPlugin = ({
  onSome,
  $emit
}: EVM) => {
  onSome(['study', 'studyresp', 'study_startgame', 'study_startgameresp'], async (data: XyzwSession) => {
    gameLogger.verbose(`收到学习答题事件: ${data.tokenId}`, data);
    const { body, gameData, client } = data;
    if (!body) {
      return;
    }

    gameLogger.info('开始处理学习答题响应')
    // 获取题目列表和学习ID
    const questionList = body.questionList
    const studyId = body.role?.study?.id

    if (!questionList || !Array.isArray(questionList)) {
      gameLogger.error('未找到题目列表')
      return
    }

    if (!studyId) {
      gameLogger.error('未找到学习ID')
      return
    }
    gameLogger.info(`找到 ${questionList.length} 道题目，学习ID: ${studyId}`)
    // 更新答题状态（按账号独立）
    const tokenStatus = getTokenStudyStatus(gameData, data.tokenId)
    tokenStatus.isAnswering = true
    tokenStatus.questionCount = questionList.length
    tokenStatus.answeredCount = 0
    tokenStatus.status = 'answering'
    tokenStatus.timestamp = Date.now()
    // 兼容旧 UI：全局状态仍记录最近一次答题
    gameData.value.studyStatus = { ...tokenStatus }
    try {
      // 遍历题目并回答
      for (let i = 0; i < questionList.length; i++) {
        const question = questionList[i]
        const questionText = question.question
        const questionId = question.id

        gameLogger.debug(`题目 ${i + 1}: ${questionText.substring(0, 20)}...`)

        // 查找答案（异步）
        let answer = await findAnswer(questionText)

        if (answer === null) {
          answer = 1
          gameLogger.verbose(`未找到匹配答案，使用默认答案: ${answer}`)
        } else {
          gameLogger.debug(`找到答案: ${answer}`)
        }

        // 发送答案
        try {
          client?.send('study_answer', {
            id: studyId,
            option: [answer],
            questionId: [questionId]
          })
          gameLogger.verbose(`已提交题目 ${i + 1} 的答案: ${answer}`)
        } catch (error) {
          gameLogger.error(`提交答案失败 (题目 ${i + 1}):`, error)
        }

        // 更新已回答题目数量
        tokenStatus.answeredCount = i + 1
        gameData.value.studyStatus = { ...tokenStatus }

        // 添加短暂延迟，避免请求过快
        if (i < questionList.length - 1) {
          await sleep(300)
        }
      }
      // 延迟1500ms后领取奖励
      await sleep(1500)
      $emit.emit('I-study-week-forward', data)
    } catch (error) {
      gameLogger.error('处理学习答题响应失败:', error)
    }
  });
  //
  onSome(['I-study'], (data: XyzwSession) => {
    const { body, gameData } = data;
    const maxCorrectNum = body.role.study.maxCorrectNum
    const beginTime = body.role.study.beginTime
    const isStudyCompleted = maxCorrectNum >= 10 && isInCurrentWeek(beginTime * 1000)

    // 按账号独立记录
    const tokenStatus = getTokenStudyStatus(gameData, data.tokenId)
    tokenStatus.thisWeek = isStudyCompleted
    tokenStatus.isCompleted = isStudyCompleted
    tokenStatus.maxCorrectNum = maxCorrectNum

    // 更新答题完成状态（兼容旧 UI）
    if (!gameData.value.studyStatus) {
      gameData.value.studyStatus = {}
    }
    gameData.value.studyStatus.thisWeek = isStudyCompleted
    gameData.value.studyStatus.isCompleted = isStudyCompleted
    gameData.value.studyStatus.maxCorrectNum = maxCorrectNum

    gameLogger.info(`答题状态更新: maxCorrectNum=${maxCorrectNum}, 完成状态=${isStudyCompleted}`)
  });
  // 
  onSome(['I-study-week-forward'], async (data: XyzwSession) => {
    gameLogger.info('开始领取答题奖励')
    const { gameData, client } = data;
    // 按账号独立记录
    const tokenStatus = getTokenStudyStatus(gameData, data.tokenId)
    // 更新状态为正在领取奖励
    tokenStatus.status = 'claiming_rewards'
    gameData.value.studyStatus.status = 'claiming_rewards'
    // 领取所有等级的奖励 (1-10)
    for (let rewardId = 1; rewardId <= 10; rewardId++) {
      try {
        client?.send('study_claimreward', {
          rewardId: rewardId
        })
        await new Promise(resolve => setTimeout(resolve, 200))
        gameLogger.verbose(`已发送奖励领取请求: rewardId=${rewardId}`)
      } catch (error) {
        gameLogger.error(`发送奖励领取请求失败 (rewardId=${rewardId}):`, error)
      }
    }

    gameLogger.info('一键答题完成！已尝试领取所有奖励')

    // 更新状态为完成
    tokenStatus.status = 'completed'
    gameData.value.studyStatus.status = 'completed'

    // 3秒后重置状态
    await new Promise(resolve => setTimeout(resolve, 1000))
    // 注意：按账号的状态保留 status='completed'，供批量任务读取；
    // 下次批量答题开始前会由 batchStudy 主动重置。
    gameData.value.studyStatus = {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: '',
      timestamp: null
    }

    // 1秒后更新游戏数据
    try {
      // client?.send('role_getroleinfo', {})
      client?.debounceSend('role_getroleinfo', {})
      gameLogger.debug('已请求更新角色信息')
    } catch (error) {
      gameLogger.error('请求角色信息更新失败:', error)
    }
  });
}