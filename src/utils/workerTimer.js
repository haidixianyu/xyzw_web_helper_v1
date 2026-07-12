/**
 * Web Worker 计时器工具
 *
 * 浏览器在标签页失去焦点（切到后台）时会对 setTimeout/setInterval 进行节流，
 * 最低限制为 1000ms，长时间后台可能被节流到 1 分钟。
 * Web Worker 不受此限制，因此使用 Worker 实现的计时器可以在后台标签页中正常运行。
 *
 * 用法与原生 setTimeout/setInterval 一致，但返回的 ID 类型为 number，
 * 需使用对应的 workerClearTimeout / workerClearInterval 清除。
 */

let worker = null;
let timerIdCounter = 0;
const callbacks = new Map();

// Worker 内联脚本
const workerScript = `
  const timers = new Map();

  self.onmessage = function(e) {
    const { type, id, delay } = e.data;

    if (type === 'setTimeout') {
      const timer = setTimeout(() => {
        self.postMessage({ id, type: 'timeout' });
        timers.delete(id);
      }, delay);
      timers.set(id, { timer, type: 'timeout' });
    } else if (type === 'setInterval') {
      const timer = setInterval(() => {
        self.postMessage({ id, type: 'interval' });
      }, delay);
      timers.set(id, { timer, type: 'interval' });
    } else if (type === 'clear') {
      const t = timers.get(id);
      if (t) {
        if (t.type === 'timeout') clearTimeout(t.timer);
        else clearInterval(t.timer);
        timers.delete(id);
      }
    }
  };
`;

function ensureWorker() {
  if (worker) return worker;
  try {
    const blob = new Blob([workerScript], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    worker.onmessage = (e) => {
      const { id } = e.data;
      const cb = callbacks.get(id);
      if (cb) {
        try {
          cb();
        } catch (err) {
          console.error("[workerTimer] callback error:", err);
        }
        if (e.data.type === "timeout") {
          callbacks.delete(id);
        }
      }
    };
    worker.onerror = (e) => {
      console.error("[workerTimer] Worker error:", e);
    };
  } catch (e) {
    console.error(
      "[workerTimer] Failed to create worker, falling back to main thread timers:",
      e,
    );
    worker = null;
  }
  return worker;
}

/**
 * 后台标签页不受节流影响的 setTimeout
 * @param {Function} callback - 回调函数
 * @param {number} delay - 延迟毫秒数
 * @returns {number} 计时器ID，用于 workerClearTimeout
 */
export function workerSetTimeout(callback, delay) {
  const w = ensureWorker();
  if (!w) {
    return setTimeout(callback, delay);
  }
  const id = ++timerIdCounter;
  callbacks.set(id, callback);
  w.postMessage({ type: "setTimeout", id, delay });
  return id;
}

/**
 * 后台标签页不受节流影响的 setInterval
 * @param {Function} callback - 回调函数
 * @param {number} delay - 间隔毫秒数
 * @returns {number} 计时器ID，用于 workerClearInterval
 */
export function workerSetInterval(callback, delay) {
  const w = ensureWorker();
  if (!w) {
    return setInterval(callback, delay);
  }
  const id = ++timerIdCounter;
  callbacks.set(id, callback);
  w.postMessage({ type: "setInterval", id, delay });
  return id;
}

/**
 * 清除 worker setTimeout
 * @param {number} id - workerSetTimeout 返回的ID
 */
export function workerClearTimeout(id) {
  if (!worker) {
    return clearTimeout(id);
  }
  callbacks.delete(id);
  worker.postMessage({ type: "clear", id });
}

/**
 * 清除 worker setInterval
 * @param {number} id - workerSetInterval 返回的ID
 */
export function workerClearInterval(id) {
  if (!worker) {
    return clearInterval(id);
  }
  callbacks.delete(id);
  worker.postMessage({ type: "clear", id });
}

/**
 * Promise 版 sleep，后台标签页不受节流影响
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function workerSleep(ms) {
  return new Promise((resolve) => {
    workerSetTimeout(resolve, ms);
  });
}
