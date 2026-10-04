/**
 * manifest-override.js — 页面级拦截 /login/manifest 请求, 强制 version=0.32.0-android
 *
 * 背景(2026-10-04 实证):
 *   线上 POST https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=X 只有
 *   version=0.32.0-android 返回 isLast=true + 完整 bundleVers; 换成 1.90.3-h5web / 1.89.8-wx 等
 *   既无 isLast(游戏侧 IsLastVersion=false → 弹「版本异常, 请下载最新版本」)也无 bundleVers
 *   (启动器 ensureBundleVers 抛错 → 白屏)。
 *
 *   而版本号被两处同时使用: 启动器自身的登录请求(LoginService.manifest, 取自 GAME_VERSION)
 *   和 main.2a00e.js 的拉包请求。任何一处口径不一致都会复现上面两个故障。
 *
 * 做法(等效于桌面版在主进程做网络层拦截, 但纯浏览器页面也能实现):
 *   在游戏任何脚本执行前包一层原生 XMLHttpRequest / fetch, 只对 /login/manifest 的 URL 做
 *   version 参数改写。这样 GAME_VERSION 取什么值都不再影响结果 —— 两处请求统一被兜底到
 *   服务端唯一认可的 android 通道。
 *
 * 加载顺序: 必须排在所有游戏脚本之前 (index.html 第一个 <script>; multi-game.html runtime 首项)。
 */
(function () {
  "use strict";
  if (window.__XYZW_MANIFEST_OVERRIDE__) return;
  window.__XYZW_MANIFEST_OVERRIDE__ = true;

  var FORCE_VERSION = "0.32.0-android";
  var MANIFEST_RE = /\/login\/manifest(?:[?#]|$)/i;

  // 只改写 /login/manifest 的 version 查询参数, 其余 URL 原样返回
  function rewriteUrl(url) {
    try {
      if (typeof url !== "string" || !MANIFEST_RE.test(url)) return url;
      if (/[?&]version=[^&#]*/i.test(url)) {
        return url.replace(/([?&]version=)[^&#]*/i, "$1" + encodeURIComponent(FORCE_VERSION));
      }
      return (
        url +
        (url.indexOf("?") >= 0 ? "&" : "?") +
        "version=" +
        encodeURIComponent(FORCE_VERSION)
      );
    } catch (e) {
      return url;
    }
  }
  window.__xyzwRewriteManifestUrl = rewriteUrl;

  // 1) 原生 XMLHttpRequest: 启动器的 Http 类经此发出登录 manifest 请求
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = rewriteUrl(url);
      return origOpen.apply(this, args);
    };
  } catch (e) {
    console.warn("[manifestOverride] 包装 XMLHttpRequest 失败", e);
  }

  // 2) fetch: main.2a00e.js 的 loadRemoteBundleVers 走这条通道
  try {
    if (typeof window.fetch === "function") {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          if (typeof input === "string") {
            input = rewriteUrl(input);
          } else if (typeof Request !== "undefined" && input instanceof Request) {
            var next = rewriteUrl(input.url);
            if (next !== input.url) input = new Request(next, input);
          }
        } catch (e) {}
        return origFetch.call(this, input, init);
      };
    }
  } catch (e) {
    console.warn("[manifestOverride] 包装 fetch 失败", e);
  }

  console.log("[manifestOverride] 已接管 /login/manifest, version 强制 = " + FORCE_VERSION);
})();