/**
 * 盐场/蟠桃「超距视野」补丁（本地客户端注入）
 *
 * 功能（移植自第三方脚本「天天开心」的「盐场缩放/蟠桃缩放」，已去除混淆与反调试代码）：
 *  1. 通过修改 Cocos 地图场景的 mapScale 缩小渲染比例，从而在同屏看到更大战场范围；
 *     注意这不是「滑动镜头」，而是引擎级视野拉远（滑动受 camera 边界钳制无法越界，故无效）。
 *  2. 盐场与蟠桃共用同一个开关与缩放值（用户要求）。
 *  3. 开关/缩放值写入 localStorage，游戏内浮动面板可实时调节，刷新/切场景后自动保持。
 *
 * 仅修改本地游戏客户端的渲染表现，不伪造任何服务器指令，不影响战斗结算。
 * 需通过本系统「打开游戏」加载 public/game/index.html 才会注入生效。
 */
(function () {
  "use strict";

  var ENABLE_KEY = "map_zoom_enabled_v1";
  var SCALE_KEY = "map_zoom_scale_v1";
  var MIN = 0.35;
  var MAX = 2;
  var STEP = 0.05;
  var DEFAULT = 0.85;
  var APPLY_INTERVAL = 1000; // 保活轮询(毫秒): 游戏切场景/重绘会重置 mapScale, 需周期性补回
  var PATCHED_FLAG = "__xyzwMapZoomPatched__";

  // ============ localStorage 读写(multi-game 下按账号隔离, 回退顶层窗口) ============
  function readRaw(key) {
    try {
      var v = localStorage.getItem(key);
      if (v === null && window.top !== window) {
        try {
          v = window.top.localStorage.getItem(key);
        } catch (e) {}
      }
      return v;
    } catch (e) {
      return null;
    }
  }
  function writeRaw(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
    try {
      if (window.top !== window) window.top.localStorage.setItem(key, val);
    } catch (e) {}
  }

  function clamp(v) {
    v = Number(v);
    if (!isFinite(v)) return DEFAULT;
    v = Math.max(MIN, Math.min(MAX, v));
    return Number((Math.round(v / STEP) * STEP).toFixed(2));
  }
  function isEnabled() {
    return readRaw(ENABLE_KEY) === "1";
  }
  function setEnabled(on) {
    writeRaw(ENABLE_KEY, on ? "1" : "0");
  }
  function getScale() {
    var s = Number(readRaw(SCALE_KEY));
    return isFinite(s) && s > 0 ? clamp(s) : DEFAULT;
  }
  function setScale(v) {
    writeRaw(SCALE_KEY, String(clamp(v)));
  }

  // ============ 游戏引擎访问 ============
  function requireModule(name) {
    try {
      return typeof window.__require === "function" ? window.__require(name) : null;
    } catch (e) {
      return null;
    }
  }
  function safeRead(t, k) {
    try {
      return t ? t[k] : null;
    } catch (e) {
      return null;
    }
  }
  function gRootReady() {
    var g = window.fgui && window.fgui.GRoot;
    return !!(g && (g._inst || g._instance || g._root));
  }
  function getSourceMap(scene) {
    return safeRead(scene, "_sourceMap") || safeRead(scene, "sourceMap");
  }
  function isPeachScene(scene, sm) {
    var ctor = sm && sm.constructor ? sm.constructor.name : "";
    return (
      ctor === "LegionPayloadSourceMap" ||
      (scene && scene._flowPaths instanceof Map && Array.isArray(scene.MOVEABLE_LAYERS))
    );
  }
  // 收集候选地图场景: 当前场景 + 代理池 + 盐场三类 MapScene 代理
  function collectScenes(ui) {
    var list = [];
    var manager = ui && ui.UIManager ? ui.UIManager.instance : null;
    function add(s) {
      if (s && list.indexOf(s) === -1) list.push(s);
    }
    add(safeRead(manager, "_curScene"));
    var proxies = safeRead(manager, "_proxies");
    if (proxies && typeof proxies === "object") {
      Object.keys(proxies).forEach(function (k) {
        var s = proxies[k];
        if (s && s.ui && s.ui.m_map) add(s);
      });
    }
    ["MapScene", "ELeagueMapScene", "LeagueMapScene"].forEach(function (mn) {
      var mod = requireModule(mn);
      var cls = mod && (mod[mn] || mod["default"] || mod);
      if (ui && typeof ui.GET_PROXY === "function" && cls) {
        try {
          add(ui.GET_PROXY(cls, false));
        } catch (e) {}
      }
    });
    return list;
  }
  // 取当前生效的战场场景: 蟠桃场景恒可命中; 盐场场景仅在 curSceneType===LEGION_WA 时命中
  // (主城等非战场场景两者都不满足, 不会被误缩放)
  function getActiveMapScene(ui) {
    var manager = ui && ui.UIManager ? ui.UIManager.instance : null;
    if (!manager) return null;
    var isSalt = !!(ui.SceneType && manager.curSceneType === ui.SceneType.LEGION_WA);
    var candidates = collectScenes(ui);
    for (var i = 0; i < candidates.length; i++) {
      var scene = candidates[i];
      if (!scene || !scene.ui || !scene.ui.m_map || scene.isShow === false) continue;
      var sm = getSourceMap(scene);
      if (!sm) continue;
      if (isPeachScene(scene, sm)) return scene;
      if (isSalt) return scene;
    }
    return null;
  }

  function applyZoom(scale, force) {
    if (!gRootReady()) return;
    var ui = requireModule("index-ui");
    if (!ui || !ui.UIManager || !ui.UIManager.instance) return;
    var scene = getActiveMapScene(ui);
    if (!scene) return;
    var sm = getSourceMap(scene);
    if (!sm) return;
    if (!force && scene.__xyzwMapZoomScale === scale) return;
    try {
      sm.mapScale = scale;
      if (typeof scene._updateScale === "function") {
        scene._updateScale(scale);
      } else if (scene.ui && scene.ui.m_map && typeof scene.ui.m_map.setScale === "function") {
        scene.ui.m_map.setScale(scale, scale);
      }
      if (typeof scene._fixScope === "function") scene._fixScope();
      scene.__xyzwMapZoomScale = scale;
      sm.__xyzwMapZoomScale = scale;
    } catch (e) {}
  }
  function restoreZoom() {
    // 关闭时把当前战场场景恢复到默认比例
    if (!gRootReady()) return;
    var ui = requireModule("index-ui");
    if (!ui || !ui.UIManager || !ui.UIManager.instance) return;
    var scene = getActiveMapScene(ui);
    if (!scene) return;
    var sm = getSourceMap(scene);
    if (!sm) return;
    try {
      sm.mapScale = DEFAULT;
      if (typeof scene._updateScale === "function") scene._updateScale(DEFAULT);
      else if (scene.ui && scene.ui.m_map) scene.ui.m_map.setScale(DEFAULT, DEFAULT);
      if (typeof scene._fixScope === "function") scene._fixScope();
      scene.__xyzwMapZoomScale = null;
    } catch (e) {}
  }

  // 保活: 周期性补回缩放(切场景/重绘会重置)
  setInterval(function () {
    if (isEnabled()) applyZoom(getScale(), false);
  }, APPLY_INTERVAL);

  // ============ 游戏内浮动控制面板 ============
  function buildPanel() {
    if (window[PATCHED_FLAG]) return;
    window[PATCHED_FLAG] = true;

    var css =
      "#xyzw-mz-fab{position:fixed;left:10px;bottom:120px;z-index:2147483000;width:40px;height:40px;" +
      "border-radius:50%;background:rgba(0,0,0,.6);color:#4ade80;border:1px solid rgba(74,222,128,.5);" +
      "font-size:18px;line-height:38px;text-align:center;cursor:pointer;user-select:none;font-family:sans-serif;}" +
      "#xyzw-mz-panel{position:fixed;left:10px;bottom:168px;z-index:2147483000;width:230px;padding:10px 12px;" +
      "background:rgba(20,20,28,.92);color:#fff;border:1px solid rgba(74,222,128,.4);border-radius:10px;" +
      "font-family:sans-serif;font-size:12px;display:none;box-shadow:0 4px 16px rgba(0,0,0,.5);}" +
      "#xyzw-mz-panel.show{display:block;}" +
      "#xyzw-mz-panel .mz-row{display:flex;align-items:center;gap:8px;margin-top:8px;}" +
      "#xyzw-mz-panel .mz-title{font-weight:700;color:#4ade80;font-size:13px;}" +
      "#xyzw-mz-panel .mz-val{min-width:44px;text-align:right;color:#fbbf24;font-variant-numeric:tabular-nums;}" +
      "#xyzw-mz-panel input[type=range]{flex:1;accent-color:#4ade80;}" +
      "#xyzw-mz-panel .mz-reset{padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.25);" +
      "background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:12px;}" +
      "#xyzw-mz-panel .mz-hint{margin-top:6px;color:#9ca3af;font-size:10px;line-height:1.4;}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var fab = document.createElement("div");
    fab.id = "xyzw-mz-fab";
    fab.textContent = "🔍";
    fab.title = "视野缩放";

    var panel = document.createElement("div");
    panel.id = "xyzw-mz-panel";
    panel.innerHTML =
      '<div class="mz-title">战场视野缩放（盐场/蟠桃共用）</div>' +
      '<div class="mz-row"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;">' +
      '<input type="checkbox" id="xyzw-mz-on"> 启用</label></div>' +
      '<div class="mz-row"><input type="range" id="xyzw-mz-slider" min="' +
      MIN +
      '" max="' +
      MAX +
      '" step="' +
      STEP +
      '" value="' +
      DEFAULT +
      '"><span class="mz-val" id="xyzw-mz-val">--</span></div>' +
      '<div class="mz-row"><button class="mz-reset" id="xyzw-mz-reset">重置 ' +
      DEFAULT +
      '</button></div>' +
      '<div class="mz-hint">数值越小视野越大。仅在盐场/蟠桃战场生效，主城内不受影响。</div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var onEl = panel.querySelector("#xyzw-mz-on");
    var sliderEl = panel.querySelector("#xyzw-mz-slider");
    var valEl = panel.querySelector("#xyzw-mz-val");
    var resetEl = panel.querySelector("#xyzw-mz-reset");

    function pct(scale) {
      return Math.round(scale * 100) + "%";
    }
    function syncUI() {
      onEl.checked = isEnabled();
      var s = getScale();
      sliderEl.value = String(s);
      valEl.textContent = pct(s);
      sliderEl.disabled = !isEnabled();
    }

    fab.addEventListener("click", function () {
      panel.classList.toggle("show");
      syncUI();
    });
    onEl.addEventListener("change", function () {
      setEnabled(onEl.checked);
      if (onEl.checked) applyZoom(getScale(), true);
      else restoreZoom();
      syncUI();
    });
    sliderEl.addEventListener("input", function () {
      var s = clamp(sliderEl.value);
      setScale(s);
      valEl.textContent = pct(s);
      if (isEnabled()) applyZoom(s, true);
    });
    resetEl.addEventListener("click", function () {
      setScale(DEFAULT);
      syncUI();
      if (isEnabled()) applyZoom(DEFAULT, true);
    });

    syncUI();
  }

  function whenUiReady(cb) {
    if (gRootReady() && document.body) {
      cb();
      return;
    }
    var n = 0;
    var iv = setInterval(function () {
      n++;
      if (gRootReady() && document.body) {
        clearInterval(iv);
        cb();
      } else if (n > 120) {
        clearInterval(iv);
      }
    }, 500);
  }

  whenUiReady(buildPanel);
})();
