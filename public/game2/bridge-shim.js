/**
 * bridge-shim.js — 为新版游戏壳(game2, 微信渠道 wx/xyzw_mix/0.1.0-androidh5)提供
 * window.GameBridge 适配层，让它像在原宿主 App 里一样运行于浏览器。
 *
 * 职责(对应游戏壳的调用点)：
 *  - ready / shouldDeferBoot / reportBootStage : boot-loader.js 的安全启动链
 *  - getBinData()           : 返回登录 Bin(base64)。数据源与 v1 完全一致：
 *                             单人模式 localStorage["bin_data_" + current_bin_id]
 *                             批量模式 multi-game-storage-bridge.js 安装的
 *                             作用域化 localStorage["bin_data_" + binId]
 *                             (hex 字符串 → 字节 → base64)
 *  - getTargetServerId()    : 目标服 ID(切服时 runtime-patch 改写 authuser 包体)
 *  - onServerIdChange(id)   : 游戏内选择服务器时回传(记入 localStorage 供宿主读取)
 *  - setClipboard(text)     : 剪贴板桥
 *  - loadSelectedFeatures() : v2 暂无注入功能脚本，no-op
 *  - showAuthorizationError(msg) : 启动失败提示；批量模式下向父页发 fatal
 *  - getBootManifest(Async) : 拉取/缓存官方启动 manifest(原 session-gate 职责，
 *                             缓存键 xyfb_h5_boot_manifest_v1，main.js 启动时读取)
 *
 * 注意: 必须跳过 session-gate.js —— 它会用自己的 GameBridge 覆盖本 shim，且其
 * 会话门禁依赖原宿主后端(/api/h5/sessions/*)，在 v1 环境必然失败。
 *
 * 加载顺序: 必须排在 boot-loader.js 之前(其余游戏脚本之前亦可)。
 */
(function () {
  "use strict";
  if (window.GameBridge) return;

  var multiBridge = window.__MULTI_GAME_BRIDGE_READY__ || null;

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[GameBridgeShim]");
    try { console.log.apply(console, args); } catch (e) {}
  }

  // ---- Bin 数据解析：hex(hex 字符串) -> base64 ----
  var binDataCache = null;
  var resolvedBinId = "";

  // 单人模式支持显式指定账号：/game?env=v2&bin=<tokenId>
  // (由 Token 页"单个游戏"启动时携带，优先于 current_bin_id，避免直接输 URL
  //  时误用上次启动遗留的账号)
  var urlBinId = "";
  try {
    urlBinId = new URLSearchParams(window.location.search).get("bin") || "";
  } catch (e) {}

  function resolveBinHex() {
    try {
      if (multiBridge && multiBridge.binId) {
        resolvedBinId = String(multiBridge.binId);
        return window.localStorage.getItem("bin_data_" + multiBridge.binId) || "";
      }
      var currentId = urlBinId || window.localStorage.getItem("current_bin_id");
      if (!currentId) return "";
      resolvedBinId = String(currentId);
      return window.localStorage.getItem("bin_data_" + currentId) || "";
    } catch (e) {
      return "";
    }
  }

  // 左下角账号角标：直观显示本次登录用的账号，点击隐藏
  function showAccountBadge(binId) {
    if (multiBridge || !binId) return;
    var name = "";
    try {
      var list = JSON.parse(window.localStorage.getItem("bin_file_list") || "[]");
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(binId)) { name = list[i].name || ""; break; }
      }
    } catch (e) {}
    try {
      var el = document.createElement("div");
      el.textContent = "当前账号: " + (name || "未知(" + binId.slice(0, 8) + ")") + (urlBinId ? "" : " ·上次启动");
      el.title = "点击隐藏";
      el.style.cssText =
        "position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:9999;" +
        "background:rgba(0,0,0,.55);color:#9ef;padding:4px 10px;border-radius:6px;" +
        "font:12px/1.6 sans-serif;cursor:pointer;user-select:none;";
      el.addEventListener("click", function () { if (el.parentNode) el.parentNode.removeChild(el); });
      (document.body || document.documentElement).appendChild(el);
    } catch (e) {}
  }

  function hexToBase64(hex) {
    if (!hex || hex.length < 2 || hex.length % 2 !== 0) return "";
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    var chunk = 0x8000;
    var str = "";
    for (var j = 0; j < bytes.length; j += chunk) {
      str += String.fromCharCode.apply(null, bytes.subarray(j, Math.min(j + chunk, bytes.length)));
    }
    return btoa(str);
  }

  // ---- 目标服 ID ----
  var targetServerId = "";
  try {
    var urlServerId = new URLSearchParams(window.location.search).get("server_id");
    if (urlServerId) targetServerId = String(urlServerId);
  } catch (e) {}

  // 权威服务器 ID 锁定：login-injector 解码 bin 得到的 serverId 是上号器要登录的目标角色，
  // 必须优先于游戏自带切服脚本(server-switch.js)在 authUser 时回传的"最近在玩"服务器 ID。
  // 一旦锁定，onServerIdChange 后续收到的游戏自选值会被忽略，避免串号。
  var authoritativeServerId = "";
  var serverIdLocked = false;

  function notifyFatal(code) {
    if (!multiBridge || !(window.parent && window.parent !== window)) return;
    try {
      window.parent.postMessage(
        { channel: "multi-game", version: 1, type: "fatal", scope: multiBridge.scope, code: code || "bridge-error" },
        window.location.origin
      );
    } catch (e) {}
  }

  // ---- 官方启动 manifest(原 session-gate 职责) ----
  var MANIFEST_URL = "https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.1.0-androidh5";
  var MANIFEST_CACHE_KEY = "xyfb_h5_boot_manifest_v1";
  var MANIFEST_CACHE_TTL_MS = 0x5265c00; // 16 天，与原 session-gate 一致

  function isValidManifestText(text) {
    try {
      var parsed = JSON.parse(text);
      return Boolean(parsed && parsed.body && typeof parsed.body.bundleVers === "string");
    } catch (e) {
      return false;
    }
  }

  function readManifestCache() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(MANIFEST_CACHE_KEY) || "null");
      if (raw && typeof raw.text === "string" && isValidManifestText(raw.text)) {
        return { text: raw.text, savedAt: Number(raw.savedAt) || 0 };
      }
    } catch (e) {}
    return null;
  }

  function fetchManifestText() {
    return fetch(MANIFEST_URL, {
      method: "POST",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/json;charset=UTF-8",
      },
    }).then(function (res) {
      if (!res.ok) throw new Error("manifest HTTP " + res.status);
      return res.text();
    }).then(function (text) {
      if (!isValidManifestText(text)) throw new Error("manifest 响应不含 bundleVers");
      try {
        window.localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify({ text: text, savedAt: Date.now() }));
      } catch (e) {}
      return text;
    });
  }

  var cachedManifest = readManifestCache();
  var manifestPromise;
  if (cachedManifest && Date.now() - cachedManifest.savedAt < MANIFEST_CACHE_TTL_MS) {
    manifestPromise = Promise.resolve(cachedManifest.text);
    fetchManifestText().catch(function () {});
  } else {
    manifestPromise = fetchManifestText().catch(function (err) {
      if (cachedManifest) return cachedManifest.text;
      throw err;
    });
  }

  // ---- 功能脚本: 雪花(脚本管理器) ----
  // 与 v1 共用同一份 ../game/xh.js(同源, 避免重复维护)。
  // 展示受 token 页的账号级开关控制: 「⋯→关闭❄️图标」会写
  // snow_icon_enabled:<binId> = "0", 此时直接不加载; 缺省或 "1" 时加载。
  // (批量模式下开关写在顶层窗口, 回退读 window.top)
  var SNOW_SCRIPT_URL = "../game/xh.js?v=1017b";
  var snowScriptPromise = null;

  function readAccountFlag(key) {
    try {
      var value = window.localStorage.getItem(key);
      if (value === null && window.top && window.top !== window) {
        try { value = window.top.localStorage.getItem(key); } catch (e) {}
      }
      return value;
    } catch (e) {
      return null;
    }
  }

  function resolveCurrentBinId() {
    try {
      if (multiBridge && multiBridge.binId) return String(multiBridge.binId);
      var currentId = urlBinId || window.localStorage.getItem("current_bin_id") || "";
      return String(currentId);
    } catch (e) {
      return "";
    }
  }

  function loadSnowflake() {
    if (snowScriptPromise) return snowScriptPromise;

    var binId = resolveCurrentBinId();
    if (binId && readAccountFlag("snow_icon_enabled:" + binId) === "0") {
      log("雪花: 当前账号已关闭, 跳过加载 (binId:", binId.slice(0, 10), ")");
      snowScriptPromise = Promise.resolve(false);
      return snowScriptPromise;
    }

    snowScriptPromise = loadFeatureScript(SNOW_SCRIPT_URL).then(function (ok) {
      if (ok) log("雪花脚本已加载");
      return ok;
    });
    return snowScriptPromise;
  }

  // ---- 功能脚本: 十殿跳过/倍速 ----
  // 与 v1 共用 ../game/nightmare-skip.js。启用状态由 token 页「跳过十殿」开关
  // 控制(localStorage 键 nightmare_skip_enabled_v1), 脚本内部实时判断,
  // 所以始终加载: 开关打开后无需重进游戏即可生效(v1 同款行为)。
  var NIGHTMARE_SCRIPT_URL = "../game/nightmare-skip.js?v=1017b";
  var nightmareScriptPromise = null;

  function loadNightmareSkip() {
    if (nightmareScriptPromise) return nightmareScriptPromise;
    nightmareScriptPromise = loadFeatureScript(NIGHTMARE_SCRIPT_URL).then(function (ok) {
      if (!ok) return false;
      log("十殿脚本已加载 (开关键: nightmare_skip_enabled_v1)");
      // 补丁需等游戏模块就绪后按名查找, 稍后汇报结果, 便于排查 v2 模块名差异
      setTimeout(function () {
        try {
          if (window.__XYZW_NIGHTMARE_SKIP__) {
            log("十殿脚本状态:", window.__XYZW_NIGHTMARE_SKIP__.isInstalled() ? "已安装" : "未安装(未找到 NightmareBattlePanel 模块)");
          }
        } catch (e) {}
      }, 15000);
      return true;
    });
    return nightmareScriptPromise;
  }

  function loadFeatureScript(url) {
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = url;
      script.charset = "utf-8";
      script.onload = function () { resolve(true); };
      script.onerror = function () {
        log("功能脚本加载失败:", url);
        resolve(false);
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // ---- 功能脚本: 盐场/蟠桃 视野缩放 ----
  // 与 v1 共用 ../game/map-zoom.js, 机制完全一致:
  //  - 开关/缩放值: map_zoom_enabled_v1 / map_zoom_scale_v1 (游戏内 🔍 面板实时调节)
  //  - 账号级图标显隐: zoom_icon_enabled:{账号id}=0 (token页「⋯→🔍缩放图标」)
  // 始终加载: 缩放状态由脚本内部 1s 保活轮询维持, 面板可随时开关(v1 同款行为)
  var MAP_ZOOM_SCRIPT_URL = "../game/map-zoom.js?v=1017b";
  var mapZoomScriptPromise = null;

  function loadMapZoom() {
    if (mapZoomScriptPromise) return mapZoomScriptPromise;
    mapZoomScriptPromise = loadFeatureScript(MAP_ZOOM_SCRIPT_URL).then(function (ok) {
      if (ok) log("地图缩放脚本已加载 (开关键: map_zoom_enabled_v1)");
      return ok;
    });
    return mapZoomScriptPromise;
  }

  // ---- 功能脚本: 自动蟠桃 ----
  // 与 v1 共用 ../game/peach-auto.js, 机制完全一致:
  //  - 面板/自动化由脚本自身管理(选项存 XYZW_PEACH_AUTO_BOARD_OPTIONS_V2)
  //  - 账号级图标显隐: peach_icon_enabled:{账号id}=0 (token页「⋯→🍑蟠桃图标」)
  var PEACH_AUTO_SCRIPT_URL = "../game/peach-auto.js?v=1017b";
  var peachAutoScriptPromise = null;

  function loadPeachAuto() {
    if (peachAutoScriptPromise) return peachAutoScriptPromise;
    peachAutoScriptPromise = loadFeatureScript(PEACH_AUTO_SCRIPT_URL).then(function (ok) {
      if (ok) log("自动蟠桃脚本已加载");
      return ok;
    });
    return peachAutoScriptPromise;
  }

  window.GameBridge = {
    // 启动链：立即可用，无需授权门禁
    ready: Promise.resolve(true),

    shouldDeferBoot: function () {
      return false;
    },

    reportBootStage: function (stage) {
      log("boot stage:", stage);
      if (stage === "prewarm-error") notifyFatal("prewarm-error");
    },

    // 登录 Bin(切服脚本提交 serverlist / runtime-patch 提交 authuser 均使用)
    getBinData: function () {
      if (binDataCache === null) {
        binDataCache = hexToBase64(resolveBinHex());
        if (binDataCache) {
          log("Bin 数据就绪 (binId:", resolvedBinId.slice(0, 10), "base64 长度:", binDataCache.length, "来源:", multiBridge ? "multi" : urlBinId ? "url-bin" : "current_bin_id", ")");
          showAccountBadge(resolvedBinId);
        } else {
          log("未找到 Bin 数据(localStorage bin_data_*)，登录将不可用");
        }
      }
      return binDataCache;
    },

    getTargetServerId: function () {
      return targetServerId || null;
    },

    // 供 login-injector 调用：锁定本次上号的目标服务器，阻止游戏切服脚本覆盖
    lockServerId: function (serverId) {
      var sid = serverId == null ? "" : String(serverId);
      if (!sid) {
        log("lockServerId: serverId 为空，不锁定，交由游戏默认选择");
        serverIdLocked = false;
        return;
      }
      authoritativeServerId = sid;
      serverIdLocked = true;
      targetServerId = sid;
      log("锁定目标服务器 ID:", sid);
      try { window.localStorage.setItem("game2_target_server_id", targetServerId); } catch (e) {}
    },

    onServerIdChange: function (serverId) {
      if (serverIdLocked) {
        log("忽略游戏切服回传的服务器 ID:", serverId, "(保持锁定)", authoritativeServerId);
        return;
      }
      targetServerId = serverId == null ? "" : String(serverId);
      log("用户选择服务器 ID:", targetServerId);
      try { window.localStorage.setItem("game2_target_server_id", targetServerId); } catch (e) {}
    },

    setClipboard: function (text) {
      var value = text == null ? "" : String(text);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(
          function () { log("已复制到剪贴板"); },
          function () { log("剪贴板写入失败"); }
        );
        return;
      }
      try {
        var ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        log("已复制到剪贴板(降级)");
      } catch (e) {
        log("剪贴板写入失败(降级)");
      }
    },

    // v2 功能脚本: 雪花(脚本管理器) + 十殿跳过/倍速 + 盐场/蟠桃视野缩放 + 自动蟠桃,
    // 游戏场景就绪后才加载, 不影响启动速度
    // (WS 日志抓取 ws-capture.js 需在游戏 bundle 前安装 __require 拦截, 由 index.html 静态加载)
    loadSelectedFeatures: function () {
      return Promise.all([loadSnowflake(), loadNightmareSkip(), loadMapZoom(), loadPeachAuto()]).then(function (results) {
        return results.some(function (ok) { return Boolean(ok); });
      });
    },

    showAuthorizationError: function (msg) {
      console.error("[GameBridgeShim] 启动失败:", msg);
      notifyFatal("boot-failed");
      try { alert("游戏启动失败: " + (msg || "未知错误")); } catch (e) {}
    },

    // 启动 manifest(main.js 启动时读取；原由 session-gate 提供)
    getBootManifest: function () {
      return cachedManifest ? cachedManifest.text : "";
    },

    getBootManifestAsync: function () {
      return manifestPromise;
    },
  };

  // v1 上号器登录注入: 解析 bin 强制 serverId, 防止游戏自动选"最近在玩"角色导致串号
  // (login-injector.js 内部轮询等待游戏 LoginService 模块就绪; LZ4 库此时也已加载)
  function startLoginInjector() {
    try {
      if (!window.__V1LoginInjector) return false;
      var bootBinHex = resolveBinHex();
      if (!bootBinHex) return false;
      window.__V1LoginInjector.install(hexToBase64(bootBinHex), resolvedBinId);
      log("登录注入已启动 (binId:", resolvedBinId.slice(0, 10), ")");
      return true;
    } catch (e) {
      log("登录注入启动失败:", e && e.message);
      return true;
    }
  }
  if (!startLoginInjector()) {
    // bin 数据可能尚未写入(直接输 URL / 数据异步落盘等场景), 稍后重试
    var injectorRetries = 0;
    var injectorTimer = setInterval(function () {
      injectorRetries++;
      if (startLoginInjector() || injectorRetries >= 20) {
        clearInterval(injectorTimer);
        if (injectorRetries >= 20) log("登录注入未启动: 10s 内未取得 bin 数据");
      }
    }, 500);
  }

  log("已安装 (模式:", multiBridge ? "multi@" + multiBridge.scope : "single", ")");
})();
