/**
 * official-version-sync.js — 开机自动跟随官方 h5web 版本 (GAME_VERSION)
 *
 * 背景(2026-10-05):
 *   /login/manifest 通道已由 manifest-override.js 钉死 0.32.0-android（服务端唯一返回
 *   isLast+完整 bundleVers 的口径），GAME_VERSION 唯一剩下的作用是 WS 登录时上报
 *   clientVersion，服务端核验 platform=h5web 必须搭配官方当前版本号（「检测到您使用的
 *   客户端数据异常」弹窗的根因）。旧做法是手动把 game-defines.a175e.js 里的
 *   gt.GAME_VERSION 钉成官方值 —— 官方一 bump 就过期，盐场/蟠桃直接挂。
 *
 * 做法（纯前端，官方 CDN 全开放 CORS: Access-Control-Allow-Origin: *）：
 *   1. fetch 官方入口页 https://xxz-xyzw-res.hortorgames.com/h5web/
 *      → 解析当前 game-defines.<hash>.js / src/settings.<hash>.js / main.<hash>.js 文件名
 *   2. fetch 官方 game-defines.<hash>.js（仅 ~700B 纯常量块）
 *      → 正则提取 gt.GAME_VERSION（官方值永远最新）
 *   3. 本地 game-defines.a175e.js 已在本脚本之前同步执行完毕，此处用官方值覆盖
 *      gt.GAME_VERSION；window.boot() 由页面 await 本脚本的 ready promise 后再调用，
 *      保证游戏内任何读取（WS 登录 clientVersion / manifest 上报源）都拿到定稿值。
 *   4. 任何一步失败（网络/改版/超时 5s）→ 保留本地钉死值兜底，行为与旧版完全一致。
 *
 *   顺带检查 main.<hash>.js / cocos2d-js-min.<hash>.js 官方 hash 与本地补丁版是否漂移：
 *   这两个文件含本地补丁（main 的 3 处正则改写等），不能自动跟随，漂移时 console.warn
 *   提醒重新抓取重打补丁。
 *
 * 页面接入约定：
 *   - <script src="official-version-sync.js"> 必须排在 game-defines.a175e.js 之后、
 *     main.2a00e.js 之前（index.html 与 multi-game.html 均已接入）
 *   - 调用 window.boot() 前必须 await window.__xyzwVersionSyncReady
 *     （promise 永不 reject，最长阻塞 TIMEOUT_MS）
 *   - 同步结果挂 window.__xyzwVersionSync（同源 iframe 可从宿主页面读取做界面提示）
 *   - 最近一次成功探测记录在 localStorage["xyzw_official_version_v1"]
 */
(function () {
  "use strict";
  if (window.__xyzwVersionSyncReady) return;

  // gt 即 globalThis（game-defines 头部定义），本地常量文件必须先于此脚本执行
  if (typeof window.gt !== "object" || !window.gt) {
    console.warn(
      "[verSync] window.gt 不存在，脚本时序错误：必须排在 game-defines.a175e.js 之后"
    );
    window.__xyzwVersionSyncReady = Promise.resolve();
    return;
  }

  var OFFICIAL_INDEX_URL = "https://xxz-xyzw-res.hortorgames.com/h5web/";
  var TIMEOUT_MS = 5000;
  var SYNC_KEY = "xyzw_official_version_v1";
  // 本地补丁版文件 hash（main 含 3 处正则改写 + boot 链改造；引擎引擎少变）
  var LOCAL_MAIN_HASH = "2a00e";
  var LOCAL_COCOS_HASH = "a5841";

  var localVersion = window.gt.GAME_VERSION || "";
  var status = {
    ok: false,
    applied: false,
    officialVersion: "",
    localVersion: localVersion,
    officialGameDefinesHash: "",
    officialSettingsHash: "",
    officialMainHash: "",
    officialCocosHash: "",
    error: "",
    ts: 0,
  };
  window.__xyzwVersionSync = status;

  function fetchWithTimeout(url) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      ctrl.abort();
    }, TIMEOUT_MS);
    return fetch(url, { cache: "no-store", signal: ctrl.signal }).finally(
      function () {
        clearTimeout(timer);
      }
    );
  }

  // 永不 reject：失败/超时一律回落本地值，绝不阻塞游戏启动
  window.__xyzwVersionSyncReady = (async function () {
    try {
      // 1) 官方入口页 → 解析 bootstrap 文件当前 hash
      var res = await fetchWithTimeout(OFFICIAL_INDEX_URL);
      if (!res.ok) throw new Error("官方入口页 HTTP " + res.status);
      var html = await res.text();

      var mGD = html.match(/game-defines\.([0-9a-f]+)\.js/);
      if (!mGD) throw new Error("官方入口页未找到 game-defines.<hash>.js");
      status.officialGameDefinesHash = mGD[1];

      var mSet = html.match(/src\/settings\.([0-9a-f]+)\.js/);
      if (mSet) status.officialSettingsHash = mSet[1];
      var mMain = html.match(/\bmain\.([0-9a-f]+)\.js/);
      if (mMain) status.officialMainHash = mMain[1];
      var mCocos = html.match(/cocos2d-js-min\.([0-9a-f]+)\.js/);
      if (mCocos) status.officialCocosHash = mCocos[1];

      // 2) 官方 game-defines 纯常量块 → 提取 GAME_VERSION
      var jsUrl = new URL("game-defines." + mGD[1] + ".js", OFFICIAL_INDEX_URL)
        .href;
      var resJs = await fetchWithTimeout(jsUrl);
      if (!resJs.ok) throw new Error("官方 game-defines HTTP " + resJs.status);
      var jsText = await resJs.text();
      var mVer = jsText.match(/gt\.GAME_VERSION\s*=\s*["']([^"']+)["']/);
      if (!mVer) throw new Error("官方 game-defines 未提取到 GAME_VERSION");

      status.officialVersion = mVer[1];
      status.ok = true;
      status.ts = Date.now();

      // 3) 覆盖本地值（本地 game-defines 已执行完，此处定稿；boot 前 gateway 已 await）
      if (mVer[1] !== localVersion) {
        window.gt.GAME_VERSION = mVer[1];
        status.applied = true;
        console.info(
          "[verSync] GAME_VERSION 已跟随官方: " +
            localVersion +
            " -> " +
            mVer[1]
        );
      } else {
        console.info("[verSync] GAME_VERSION 与官方一致: " + mVer[1]);
      }
      try {
        localStorage.setItem(
          SYNC_KEY,
          JSON.stringify({ version: mVer[1], hash: mGD[1], ts: status.ts })
        );
      } catch (e) {}

      // 4) 本地补丁版漂移提醒（不能自动跟随，需人工重抓重打补丁）
      if (status.officialMainHash && status.officialMainHash !== LOCAL_MAIN_HASH) {
        console.warn(
          "[verSync] 官方 main." +
            status.officialMainHash +
            ".js 与本地补丁版 main." +
            LOCAL_MAIN_HASH +
            ".js 不一致！需重新抓取官方 main 并重打补丁（删 loadAny/loadBundle 禁用、强制 IsLastVersion、boot 链），否则游戏可能白屏"
        );
      }
      if (status.officialCocosHash && status.officialCocosHash !== LOCAL_COCOS_HASH) {
        console.warn(
          "[verSync] 官方 cocos2d-js-min." +
            status.officialCocosHash +
            ".js 与本地 " +
            LOCAL_COCOS_HASH +
            " 不一致，建议同步"
        );
      }
    } catch (e) {
      status.error =
        (e &&
          (e.name === "AbortError"
            ? "探测超时(" + TIMEOUT_MS + "ms)"
            : e.message)) ||
        String(e);
      console.warn(
        "[verSync] 探测官方版本失败，沿用本地值 " +
          localVersion +
          " : " +
          status.error
      );
    }
    return status;
  })();
})();
