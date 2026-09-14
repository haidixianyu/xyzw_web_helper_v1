/**
 * 盐场/蟠桃「超距视野」补丁（本地客户端注入）
 *
 * 功能（移植自第三方脚本「天天开心」的「盐场缩放/蟠桃缩放」，已去除混淆与反调试代码）：
 *  1. 通过修改 Cocos 地图场景的 mapScale 缩小渲染比例，从而在同屏看到更大战场范围；
 *     注意这不是「滑动镜头」，而是引擎级视野拉远（滑动受 camera 边界钳制无法越界，故无效）。
 *  2. 盐场与蟠桃共用同一个开关与缩放值（用户要求）。
 *  3. 开关/缩放值写入 localStorage，游戏内浮动面板可实时调节，刷新/切场景后自动保持。
 *
 * 生效机制（与参考实现一致，缺一则缩放会被游戏自身刷新覆盖而"不生效"）：
 *  a. 给 SourceMap/ELeagueSourceMap/LeagueSourceMap/LegionPayloadSourceMap 原型的
 *     mapScale 装访问器补丁：游戏每帧/刷新时读到的就是我们覆盖的值；
 *  b. 给 MapScene/ELeagueMapScene/LeagueMapScene/LPMapPanel 原型的 onShow/onShown 装钩子：
 *     进场即时补应用缩放，并捕获蟠桃战场面板 LPMapPanel 实例（_curScene/代理池中取不到它）；
 *  c. 1s 保活轮询补回（游戏内部重置 mapScale/节点 scale 时纠偏）。
 *
 * 仅修改本地游戏客户端的渲染表现，不伪造任何服务器指令，不影响战斗结算。
 * 需通过本系统「打开游戏」加载 public/game/index.html 才会注入生效。
 */
(function () {
  "use strict";

  var ENABLE_KEY = "map_zoom_enabled_v1";
  var SCALE_KEY = "map_zoom_scale_v1";
  var FAB_POS_KEY = "map_zoom_fab_pos_v1"; // 🔍 悬浮按钮位置(可拖动)
  var MIN = 0.35;
  var MAX = 2;
  var STEP = 0.05;
  var DEFAULT = 0.85; // 游戏战场原生默认比例
  var EPSILON = 0.001;
  var APPLY_INTERVAL = 1000; // 保活轮询(毫秒): 游戏切场景/重绘会重置 mapScale, 需周期性补回
  var PATCHED_FLAG = "__xyzwMapZoomPatched__";

  var OVERRIDE_FLAG = "__xyzwMapZoomValue";
  var SCENE_APPLIED_FLAG = "__xyzwMapZoomScale";
  var ACCESSOR_PATCHED = "__xyzwMapZoomAccessorPatched__";
  var HOOK_PATCHED = "__xyzwMapZoomSceneHookPatched__";
  var SOURCE_MAP_MODULES = [
    "SourceMap",
    "ELeagueSourceMap",
    "LeagueSourceMap",
    "LegionPayloadSourceMap",
  ];
  var SCENE_MODULES = ["MapScene", "ELeagueMapScene", "LeagueMapScene", "LPMapPanel"];

  // 蟠桃战场面板(LPMapPanel)实例, 由 onShow 钩子捕获; 它是蟠桃场景唯一可靠入口
  var payloadMapPanel = null;

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
  function sameScale(a, b) {
    return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= EPSILON;
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
  function getModuleClass(moduleName) {
    var mod = requireModule(moduleName);
    return mod ? mod[moduleName] || mod["default"] || mod : null;
  }
  function getPrototype(moduleName) {
    var cls = getModuleClass(moduleName);
    return cls && cls.prototype ? cls.prototype : null;
  }
  function findDescriptor(proto, key) {
    var cursor = proto;
    while (cursor) {
      var d = Object.getOwnPropertyDescriptor(cursor, key);
      if (d) return d;
      cursor = Object.getPrototypeOf(cursor);
    }
    return null;
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

  // a. mapScale 访问器补丁: 游戏自身读 sourceMap.mapScale 时返回我们的覆盖值
  function installAccessorPatches() {
    SOURCE_MAP_MODULES.forEach(function (mn) {
      var proto = getPrototype(mn);
      if (!proto || proto[ACCESSOR_PATCHED]) return;
      var descriptor = findDescriptor(proto, "mapScale");
      try {
        Object.defineProperty(proto, "mapScale", {
          configurable: true,
          enumerable: descriptor ? descriptor.enumerable : false,
          get: function () {
            if (typeof this[OVERRIDE_FLAG] === "number") return this[OVERRIDE_FLAG];
            if (descriptor && descriptor.get) return descriptor.get.call(this);
            if (descriptor && "value" in descriptor) return descriptor.value;
            return DEFAULT;
          },
          set: function (value) {
            var next = clamp(value);
            if (this[OVERRIDE_FLAG] !== next) this[OVERRIDE_FLAG] = next;
          },
        });
        proto[ACCESSOR_PATCHED] = true;
      } catch (e) {}
    });
  }

  // b. 场景 onShow/onShown 钩子: 进场即时补应用 + 捕获 LPMapPanel; onHide 释放引用
  function installSceneHooks() {
    SCENE_MODULES.forEach(function (mn) {
      var proto = getPrototype(mn);
      if (!proto || proto[HOOK_PATCHED]) return;
      var patched = false;
      ["onShow", "onShown"].forEach(function (methodName) {
        var original = proto[methodName];
        if (typeof original !== "function") return;
        proto[methodName] = function () {
          if (mn === "LPMapPanel") payloadMapPanel = this;
          var result = original.apply(this, arguments);
          setTimeout(function () {
            if (isEnabled()) applyZoom(getScale(), true);
          }, 0);
          setTimeout(function () {
            if (isEnabled()) applyZoom(getScale(), true);
          }, 295);
          return result;
        };
        patched = true;
      });
      if (mn === "LPMapPanel" && typeof proto.onHide === "function") {
        var originalOnHide = proto.onHide;
        proto.onHide = function () {
          if (payloadMapPanel === this) payloadMapPanel = null;
          return originalOnHide.apply(this, arguments);
        };
      }
      if (patched) proto[HOOK_PATCHED] = true;
    });
  }

  // 收集候选地图场景: 蟠桃面板 + 当前场景 + 代理池 + 盐场三类 MapScene 代理
  function collectScenes(ui) {
    var list = [];
    var manager = ui && ui.UIManager ? ui.UIManager.instance : null;
    function add(s) {
      if (s && list.indexOf(s) === -1) list.push(s);
    }
    add(payloadMapPanel);
    add(safeRead(manager, "_curScene"));
    var proxies = safeRead(manager, "_proxies");
    if (proxies && typeof proxies === "object") {
      Object.keys(proxies).forEach(function (k) {
        var s = proxies[k];
        if (s && s.ui && s.ui.m_map) add(s);
      });
    }
    ["MapScene", "ELeagueMapScene", "LeagueMapScene"].forEach(function (mn) {
      var cls = getModuleClass(mn);
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

  // 是否已生效: 节点实际 scale 与场景标记都须等于目标值(游戏可能只重置节点 scale)
  function isApplied(scene, sm, scale) {
    var map = scene.ui ? scene.ui.m_map : null;
    var srcScale = typeof sm.mapScale === "number" ? sm.mapScale : null;
    var nodeScale = map && typeof map.scaleX === "number" ? map.scaleX : null;
    var srcOk = srcScale === null || sameScale(srcScale, scale);
    var nodeOk = nodeScale === null || sameScale(nodeScale, scale);
    return srcOk && nodeOk && scene[SCENE_APPLIED_FLAG] === scale;
  }

  function applyZoom(scale, force) {
    if (!gRootReady()) return;
    var ui = requireModule("index-ui");
    if (!ui || !ui.UIManager || !ui.UIManager.instance) return;
    installAccessorPatches();
    installSceneHooks();
    var scene = getActiveMapScene(ui);
    if (!scene) return;
    var sm = getSourceMap(scene);
    if (!sm) return;
    var next = clamp(scale);
    if (!force && isApplied(scene, sm, next)) return;
    try {
      sm.mapScale = next; // 经访问器补丁存入覆盖值(未打上补丁时为直接赋值)
      if (typeof scene._updateScale === "function") {
        scene._updateScale(next);
      } else if (scene.ui && scene.ui.m_map && typeof scene.ui.m_map.setScale === "function") {
        scene.ui.m_map.setScale(next, next);
      }
      if (typeof scene._fixScope === "function") scene._fixScope();
      scene[SCENE_APPLIED_FLAG] = next;
    } catch (e) {}
  }
  function restoreZoom() {
    // 关闭时把当前战场场景恢复到游戏原生默认比例
    if (!gRootReady()) return;
    var ui = requireModule("index-ui");
    if (!ui || !ui.UIManager || !ui.UIManager.instance) return;
    var scene = getActiveMapScene(ui);
    if (!scene) return;
    var sm = getSourceMap(scene);
    if (!sm) return;
    try {
      sm[OVERRIDE_FLAG] = null;
      sm.mapScale = DEFAULT;
      if (typeof scene._updateScale === "function") scene._updateScale(DEFAULT);
      else if (scene.ui && scene.ui.m_map) scene.ui.m_map.setScale(DEFAULT, DEFAULT);
      if (typeof scene._fixScope === "function") scene._fixScope();
      scene[SCENE_APPLIED_FLAG] = null;
    } catch (e) {}
  }

  // 保活: 周期性补回缩放(切场景/重绘会重置) + 补丁可能因模块延迟加载需重复安装
  setInterval(function () {
    if (isEnabled()) applyZoom(getScale(), false);
    else installAccessorPatches();
  }, APPLY_INTERVAL);

  // ============ 游戏内浮动控制面板 ============
  function buildPanel() {
    if (window[PATCHED_FLAG]) return;
    window[PATCHED_FLAG] = true;

    var css =
      "#xyzw-mz-fab{position:fixed;left:10px;bottom:120px;z-index:2147483000;width:40px;height:40px;" +
      "border-radius:50%;background:rgba(0,0,0,.6);color:#4ade80;border:1px solid rgba(74,222,128,.5);" +
      "font-size:18px;line-height:38px;text-align:center;cursor:pointer;user-select:none;font-family:sans-serif;" +
      "touch-action:none;}" +
      "#xyzw-mz-fab.dragging{opacity:.75;cursor:grabbing;}" +
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

    // ============ 🔍 按钮可拖动(参照上号器/雪花图标), 位置持久化 ============
    var FAB_SIZE = 40;
    function clampFabPos(left, top) {
      var maxLeft = Math.max(0, window.innerWidth - FAB_SIZE);
      var maxTop = Math.max(0, window.innerHeight - FAB_SIZE);
      return [Math.max(0, Math.min(left, maxLeft)), Math.max(0, Math.min(top, maxTop))];
    }
    function placeFab(left, top) {
      var p = clampFabPos(left, top);
      fab.style.left = p[0] + "px";
      fab.style.top = p[1] + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      return p;
    }
    function restoreFabPos() {
      var pos = null;
      try {
        pos = JSON.parse(readRaw(FAB_POS_KEY) || "null");
      } catch (e) {}
      if (pos && isFinite(pos.left) && isFinite(pos.top)) {
        placeFab(Number(pos.left), Number(pos.top));
      } else {
        // 默认位置: 左下角 left:10 bottom:120
        placeFab(10, window.innerHeight - 120 - FAB_SIZE);
      }
    }
    // 面板锚定在按钮附近: 优先按钮上方, 空间不足则下方; 水平方向贴边收进视口
    function positionPanel() {
      var rect = fab.getBoundingClientRect();
      var pw = panel.offsetWidth || 230;
      var ph = panel.offsetHeight || 150;
      var left = rect.left;
      var top = rect.top - ph - 8;
      if (top < 4) top = rect.bottom + 8;
      left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
      top = Math.max(4, Math.min(top, window.innerHeight - ph - 4));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
    restoreFabPos();
    window.addEventListener("resize", restoreFabPos);

    var drag = { active: false, moved: false, startX: 0, startY: 0, origLeft: 0, origTop: 0, touchId: null };
    function dragStart(clientX, clientY) {
      drag.active = true;
      drag.moved = false;
      drag.startX = clientX;
      drag.startY = clientY;
      var rect = fab.getBoundingClientRect();
      drag.origLeft = rect.left;
      drag.origTop = rect.top;
      fab.classList.add("dragging");
    }
    function dragMove(clientX, clientY) {
      if (!drag.active) return;
      var dx = clientX - drag.startX;
      var dy = clientY - drag.startY;
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 5) return;
      drag.moved = true;
      placeFab(drag.origLeft + dx, drag.origTop + dy);
      if (panel.classList.contains("show")) positionPanel();
    }
    function dragEnd() {
      if (!drag.active) return;
      drag.active = false;
      fab.classList.remove("dragging");
      if (drag.moved) {
        var rect = fab.getBoundingClientRect();
        try {
          writeRaw(FAB_POS_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
        } catch (e) {}
      }
    }

    fab.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      dragStart(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener("mousemove", function (e) {
      if (!drag.active || drag.touchId !== null) return;
      dragMove(e.clientX, e.clientY);
      if (drag.moved) e.preventDefault();
    });
    document.addEventListener("mouseup", function () {
      if (drag.touchId !== null || !drag.active) return;
      var wasMoved = drag.moved;
      dragEnd();
      if (!wasMoved) togglePanelFromFab();
    });

    fab.addEventListener("touchstart", function (e) {
      if (e.touches.length > 1) return;
      drag.touchId = e.touches[0].identifier;
      dragStart(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    document.addEventListener("touchmove", function (e) {
      if (!drag.active || drag.touchId === null) return;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === drag.touchId) {
          dragMove(e.touches[i].clientX, e.touches[i].clientY);
          if (drag.moved) e.preventDefault();
          break;
        }
      }
    }, { passive: false });
    document.addEventListener("touchend", function (e) {
      if (drag.touchId === null) return;
      var stillThere = false;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === drag.touchId) stillThere = true;
      }
      if (stillThere) return;
      var wasMoved = drag.moved;
      drag.touchId = null;
      dragEnd();
      if (!wasMoved) togglePanelFromFab();
    });
    document.addEventListener("touchcancel", function () {
      drag.touchId = null;
      dragEnd();
    });
    fab.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });

    function togglePanelFromFab() {
      panel.classList.toggle("show");
      if (panel.classList.contains("show")) positionPanel();
      syncUI();
    }
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
