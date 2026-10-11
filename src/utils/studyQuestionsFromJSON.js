/**
 * 从 answer.json 文件加载题目数据的答题工具
 * 用于一键答题功能，从公共目录读取题目数据
 */

let questionsData = null;
let isLoading = false;

const fetchQuestions = async () => {
  // Try loading from the app base URL first (supports Vite `base` config / GitHub Pages subpaths),
  // then fall back to common locations.
  const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL)
    ? import.meta.env.BASE_URL
    : "/";

  const candidates = [
    `${base.replace(/\/$/, "")}/answer.json`,
    `/answer.json`,
    `answer.json`,
  ];

  isLoading = true;
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // try next
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        // If server returned HTML (like a 404 page), skip
        try {
          const text = await response.text();
          console.warn(`studyQuestionsFromJSON: ${url} returned non-JSON response (length ${text.length})`);
        } catch (e) {
          // ignore
        }
        continue;
      }

      const data = await response.json();
      isLoading = false;
      return data;
    } catch (error) {
      // try next candidate
      console.warn(`studyQuestionsFromJSON: failed to fetch ${url}:`, error);
      continue;
    }
  }

  isLoading = false;
  console.error("❌ 加载答题数据失败: 无法找到 answer.json（尝试了多个路径）");
  return [];
};

let queryPromise = fetchQuestions();

/**
 * 异步加载答题数据
 * @returns {Promise<Array>} 题目数据数组
 */
export async function loadQuestionsData() {
  return queryPromise;
}

/**
 * 题库未命中的题目收集（用于后续补充题库）
 */
const unknownQuestions = new Set();

/**
 * 获取已收集的未命中题目列表
 * @returns {string[]}
 */
export function getUnknownQuestions() {
  return [...unknownQuestions];
}

/**
 * 归一化题目文本：去空白、统一小写、去标点/引号/书名号等装饰符号
 * 使「桃园三结义」与"桃园三结义"、全角/半角标点等差异不影响匹配
 * @param {string} text
 * @returns {string}
 */
export function normalizeQuestion(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,、。．·？?！!：:；;（(）)「」『』“”"'‘’《》〈〉【】\[\]—\-～~]/g, "");
}

/**
 * 字符二元组（bigram）相似度：衡量 b 被 a 覆盖的程度
 * 用于兜底匹配题库中的错别字/措辞差异（如 马谩/马谡、荀或/荀彧）
 * @returns {number} 0-1
 */
function bigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const grams = new Set();
  for (let i = 0; i < a.length - 1; i++) {
    grams.add(a.slice(i, i + 2));
  }

  let hit = 0;
  const total = b.length - 1;
  for (let i = 0; i < total; i++) {
    if (grams.has(b.slice(i, i + 2))) {
      hit++;
    }
  }

  return total > 0 ? hit / total : 0;
}

// 相似度兜底阈值：单字错别字的题目相似度约0.9+，措辞相近但答案相反的题（如 闭月/羞花）约0.6，取0.75区分两者
const SIMILARITY_THRESHOLD = 0.75;
// 长度差超过该值的题目不做相似度匹配，避免误匹配
const MAX_LENGTH_DIFF = 6;

/**
 * 模糊匹配函数 - 查找题目中的关键词
 * @param {string} questionFromDB - 数据库中的题目
 * @param {string} actualQuestion - 实际收到的题目
 * @param {number} threshold - 匹配阈值（1表示包含匹配）
 * @returns {boolean} - 是否匹配
 */
export function matchQuestion(questionFromDB, actualQuestion, threshold = 1) {
  if (!questionFromDB || !actualQuestion) return false;

  const cleanDB = normalizeQuestion(questionFromDB);
  const cleanActual = normalizeQuestion(actualQuestion);
  if (!cleanDB || !cleanActual) return false;

  // 简单的包含匹配
  if (threshold === 1) {
    return cleanActual.includes(cleanDB) || cleanDB.includes(cleanActual);
  }

  return false;
}

/**
 * 查找题目答案
 * 先精确包含匹配，未命中再用字符相似度兜底（容错题库错别字）
 * @param {string} question - 题目文本
 * @returns {Promise<number|null>} - 答案选项(1-4)，未找到返回null
 */
export async function findAnswer(question) {
  try {
    const questions = await loadQuestionsData();

    if (!questions || questions.length === 0) {
      // 降噪
      return null;
    }

    const target = normalizeQuestion(question);
    if (!target) return null;

    // 第一轮：包含匹配
    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];
      if (!item.name || !item.value) continue;

      // 降噪
      const name = normalizeQuestion(item.name);
      if (!name) continue;

      if (target.includes(name) || name.includes(target)) {
        return item.value;
      }
    }

    // 第二轮：相似度兜底，处理题库与游戏文本的错别字/细微差异
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];
      if (!item.name || !item.value) continue;

      const name = normalizeQuestion(item.name);
      if (!name) continue;
      if (Math.abs(name.length - target.length) > MAX_LENGTH_DIFF) continue;

      const score = bigramSimilarity(target, name);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (best && bestScore >= SIMILARITY_THRESHOLD) {
      return best.value;
    }

    // 记录未命中题目，便于后续补充题库
    unknownQuestions.add(String(question).trim());
    return null;
  } catch (error) {
    console.error("❌ 查找答案时出错:", error);
    return null;
  }
}

/**
 * 获取已加载的题目数量
 * @returns {Promise<number>} 题目数量
 */
export async function getQuestionCount() {
  const questions = await loadQuestionsData();
  return questions ? questions.length : 0;
}

/**
 * 预加载答题数据（可选，用于提前加载）
 * @returns {Promise<void>}
 */
export async function preloadQuestions() {
  try {
    await loadQuestionsData();
    // 降噪
  } catch (error) {
    console.error("❌ 答题数据预加载失败:", error);
  }
}

/**
 * 清除缓存，强制重新加载（用于调试）
 */
export function clearCache() {
  questionsData = null;
  queryPromise = fetchQuestions();
}
