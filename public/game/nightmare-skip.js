/**
 * 十殿跳过/加速补丁（本地客户端注入）
 *
 * 功能（移植自第三方脚本的"十殿跳过"，已去除混淆与反调试代码）：
 *  1. 在十殿战斗面板中强制显示游戏原生的"跳过"按钮，点击后调用游戏内部速战接口直接结算；
 *  2. 在战斗面板中显示"倍速"按钮（1倍/99倍切换），并对战斗对象施加 timeScale 加速；
 *  3. 开关状态由宿主页面通过 localStorage 键 nightmare_skip_enabled_v1 控制（'1' 开启）。
 *
 * 仅修改本地游戏客户端的动画/结算表现，不伪造任何服务器指令，战斗结果仍由服务器结算。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "nightmare_skip_enabled_v1";
  var DEFAULT_SPEED = 1.4;
  var FAST_SPEED = 99;
  var KEEPALIVE_INTERVAL = 1000;
  var PATCHED_FLAG = "__xyzwNightmareSkipPatched__";

  function isEnabled() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v !== null) return v === "1";
      // multi-game 模式下 localStorage 被按账号隔离，回退读取顶层窗口的全局开关
      if (window.top !== window) {
        v = window.top.localStorage.getItem(STORAGE_KEY);
        if (v !== null) return v === "1";
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function requireModule(name) {
    try {
      return typeof window.__require === "function" ? window.__require(name) : null;
    } catch (e) {
      return null;
    }
  }

  function getBattleManager() {
    return requireModule("manager-factory");
  }

  // 直接对战斗对象施加倍速（兼容不同字段命名）
  function applyDirectBattleSpeed(battle, speed) {
    if (!battle) return;
    try {
      if (battle.timeScale !== undefined) battle.timeScale = speed;
      if (battle.options && battle.options.timeScale !== undefined) battle.options.timeScale = speed;
      if (battle.world && battle.world.timeScale !== undefined) battle.world.timeScale = speed;
      if (battle._world && battle._world.timeScale !== undefined) battle._world.timeScale = speed;
      if (typeof battle.changeTimeScale === "function") battle.changeTimeScale(speed);
      if (typeof battle.setTimeScale === "function") battle.setTimeScale(speed);
    } catch (e) {}
  }

  // 通过游戏内部战斗管理器对指定战斗设置倍速
  function applyAnimationSpeed(battleUIData, speed) {
    if (!battleUIData) return;
    var bm = getBattleManager();
    if (!bm) return;
    try {
      if (bm.BATTLE_SPEED) bm.BATTLE_SPEED(battleUIData, speed);
      var battleData = battleUIData && battleUIData.battleData;
      if (battleData && bm.BATTLE_SPEED_BY_ID) bm.BATTLE_SPEED_BY_ID(battleData.id, speed);
      if (battleData && bm.BATTLE_SPEED_BY_TYPE) bm.BATTLE_SPEED_BY_TYPE(battleData.mode, speed);
      if (bm.GET_BATTLE) applyDirectBattleSpeed(bm.GET_BATTLE(battleUIData), speed);
      if (battleData && bm.GET_BATTLE_BY_ID) applyDirectBattleSpeed(bm.GET_BATTLE_BY_ID(battleData.id), speed);
    } catch (e) {}
  }

  function currentSpeed(panel) {
    return panel && panel.__xyzwSpeedFast ? FAST_SPEED : DEFAULT_SPEED;
  }

  // 记住原生按钮的初始状态，便于关闭时还原
  function rememberButtonState(panel, key, button) {
    if (panel[key]) return;
    panel[key] = {
      visible: button.visible,
      touchable: button.touchable,
      internalVisible: button._internalVisible,
      x: button.x,
      y: button.y,
      alpha: button.alpha,
    };
  }

  function restoreButton(panel, key, button) {
    if (!button) return;
    var state = panel[key];
    if (!state) {
      button.visible = false;
      button.touchable = false;
      return;
    }
    button.visible = state.visible;
    button.touchable = state.touchable;
    if (state.internalVisible !== undefined) button._internalVisible = state.internalVisible;
    if (button.setPosition) button.setPosition(state.x, state.y);
    else { button.x = state.x; button.y = state.y; }
    if (state.alpha !== undefined) button.alpha = state.alpha;
  }

  function forceButtonVisible(button) {
    try {
      if (button.parent && button.parent.setChildIndex && button.parent.numChildren) {
        button.parent.setChildIndex(button, button.parent.numChildren - 1);
      }
      if (button._internalVisible !== undefined) button._internalVisible = true;
      if (typeof button.handleVisibleChanged === "function") button.handleVisibleChanged();
      else if (button.node) button.node.active = true;
    } catch (e) {}
  }

  function setButtonText(target, text, depth) {
    if (!target || (depth || 0) > 3) return;
    try {
      if (target.title !== undefined) target.title = text;
      if (target.m_title && target.m_title.text !== undefined) target.m_title.text = text;
    } catch (e) {}
  }

  // 同步"跳过"按钮（m_btnIgnore）
  function syncSkipButton(panel) {
    var button = panel && panel.ui && panel.ui.m_btnIgnore;
    if (!button) return;
    rememberButtonState(panel, "__xyzwSkipState", button);

    if (!isEnabled()) {
      unbindSkipClick(panel, button);
      restoreButton(panel, "__xyzwSkipState", button);
      return;
    }

    var inRoom = Boolean(panel.module && panel.module.roomData && panel.module.roomData.roomInfo);
    var canSkip = Boolean(panel.battleUIData);
    button.visible = inRoom;
    button.touchable = inRoom && canSkip;
    if (!inRoom) return;

    forceButtonVisible(button);
    setButtonText(button, "跳过");
    if (canSkip) bindSkipClick(panel, button);
    else unbindSkipClick(panel, button);
  }

  function bindSkipClick(panel, button) {
    if (panel.__xyzwSkipBound) return;
    panel.__xyzwSkipBound = true;
    var handler = function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!isEnabled() || !panel.battleUIData) return;
      // 开战 1.2 秒内忽略点击，避免误触跳过（与原版行为一致）
      if (panel.__xyzwSkipEnableAt && Date.now() < panel.__xyzwSkipEnableAt) return;
      var bm = getBattleManager();
      if (!bm) return;
      try {
        if (bm.QUICK_BATTLE) bm.QUICK_BATTLE(panel.battleUIData);
        var battleData = panel.battleUIData && panel.battleUIData.battleData;
        if (battleData && bm.QUICK_BATTLE_BY_ID) bm.QUICK_BATTLE_BY_ID(battleData.id);
        if (battleData && bm.QUICK_BATTLES_BY_TYPE) bm.QUICK_BATTLES_BY_TYPE(battleData.mode);
      } catch (e) {}
    };
    panel.__xyzwSkipHandler = handler;
    try {
      if (typeof button.setClick === "function") button.setClick(handler);
      else if (typeof button.on === "function" && window.fgui && window.fgui.Event) button.on(window.fgui.Event.CLICK, handler, panel);
      else if (button.node && window.cc && window.cc.Node) button.node.on(window.cc.Node.EventType.TOUCH_END, handler, panel);
    } catch (e) {}
  }

  function unbindSkipClick(panel, button) {
    panel.__xyzwSkipBound = false;
    var handler = panel.__xyzwSkipHandler;
    if (!handler) return;
    try {
      if (typeof button.clearClick === "function") button.clearClick();
      if (typeof button.off === "function" && window.fgui && window.fgui.Event) button.off(window.fgui.Event.CLICK, handler, panel);
      if (button.node && window.cc && window.cc.Node) button.node.off(window.cc.Node.EventType.TOUCH_END, handler, panel);
    } catch (e) {}
    panel.__xyzwSkipHandler = null;
  }

  // 同步"倍速"按钮（m_btnSpeed）
  function syncSpeedButton(panel) {
    var button = panel && panel.ui && panel.ui.m_btnSpeed;
    if (!button) return;
    rememberButtonState(panel, "__xyzwSpeedState", button);

    if (!isEnabled()) {
      unbindSpeedClick(panel, button);
      restoreButton(panel, "__xyzwSpeedState", button);
      return;
    }

    var inRoom = Boolean(panel.module && panel.module.roomData && panel.module.roomData.roomInfo);
    button.visible = inRoom;
    button.touchable = inRoom;
    if (!inRoom) return;

    forceButtonVisible(button);
    setButtonText(button, panel.__xyzwSpeedFast ? "99倍" : "1倍");
    bindSpeedClick(panel, button);
  }

  function bindSpeedClick(panel, button) {
    if (panel.__xyzwSpeedBound) return;
    panel.__xyzwSpeedBound = true;
    var handler = function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!isEnabled()) return;
      panel.__xyzwSpeedFast = !panel.__xyzwSpeedFast;
      setButtonText(button, panel.__xyzwSpeedFast ? "99倍" : "1倍");
      syncBattleSpeed(panel);
    };
    panel.__xyzwSpeedHandler = handler;
    try {
      if (typeof button.setClick === "function") button.setClick(handler);
      else if (typeof button.on === "function" && window.fgui && window.fgui.Event) button.on(window.fgui.Event.CLICK, handler, panel);
    } catch (e) {}
  }

  function unbindSpeedClick(panel, button) {
    panel.__xyzwSpeedBound = false;
    var handler = panel.__xyzwSpeedHandler;
    if (!handler) return;
    try {
      if (typeof button.clearClick === "function") button.clearClick();
      if (typeof button.off === "function" && window.fgui && window.fgui.Event) button.off(window.fgui.Event.CLICK, handler, panel);
    } catch (e) {}
    panel.__xyzwSpeedHandler = null;
  }

  // 应用战斗倍速
  function syncBattleSpeed(panel) {
    if (!panel) return;
    var speed = currentSpeed(panel);
    try { panel.DEFAULT_TIMESCALE = speed; } catch (e) {}
    if (panel.battleUIData) applyAnimationSpeed(panel.battleUIData, speed);
  }

  function syncAll(panel) {
    syncSkipButton(panel);
    syncSpeedButton(panel);
    syncBattleSpeed(panel);
  }

  // 保活定时器：游戏可能重置倍速/按钮可见性，需要周期性重新应用
  function startKeepAlive(panel) {
    if (panel.__xyzwKeepAlive) return;
    panel.__xyzwKeepAlive = setInterval(function () {
      if (!panel.battleUIData) {
        stopKeepAlive(panel);
        return;
      }
      syncAll(panel);
    }, KEEPALIVE_INTERVAL);
  }

  function stopKeepAlive(panel) {
    if (panel.__xyzwKeepAlive) {
      clearInterval(panel.__xyzwKeepAlive);
      panel.__xyzwKeepAlive = null;
    }
  }

  function patchPanelClass() {
    var mod = requireModule("NightmareBattlePanel");
    var Klass = mod && mod.NightmareBattlePanel;
    if (!Klass || !Klass.prototype) return false;
    if (Klass.prototype[PATCHED_FLAG]) return true;
    Klass.prototype[PATCHED_FLAG] = true;

    window.__xyzwNightmareInstalledFlag = true;
    var proto = Klass.prototype;
    var original = {
      onShow: proto.onShow,
      onHide: proto.onHide,
      _refresh: proto._refresh,
      _startBattle: proto._startBattle,
    };

    function afterRender(panel) {
      openPanels.add(panel);
      // 面板渲染后延后几帧再同步，等待 battleUIData 就绪
      [0, 200, 500, 1000, 1500, 2000].forEach(function (delay) {
        setTimeout(function () { syncAll(panel); }, delay);
      });
      startKeepAlive(panel);
    }

    proto.onShow = function () {
      var r = typeof original.onShow === "function" ? original.onShow.apply(this, arguments) : undefined;
      afterRender(this);
      return r;
    };
    proto.onHide = function () {
      stopKeepAlive(this);
      syncAll(this);
      var r = typeof original.onHide === "function" ? original.onHide.apply(this, arguments) : undefined;
      return r;
    };
    proto._refresh = function () {
      var r = typeof original._refresh === "function" ? original._refresh.apply(this, arguments) : undefined;
      afterRender(this);
      return r;
    };
    proto._startBattle = function () {
      this.__xyzwSkipEnableAt = Date.now() + 1200;
      var r = typeof original._startBattle === "function" ? original._startBattle.apply(this, arguments) : undefined;
      afterRender(this);
      return r;
    };
    return true;
  }

  // 宿主页面切换开关时（同域 storage 事件），立即同步所有已打开的面板
  // 注意：multi-game 模式下宿主写入的是带 "multi-game:<scope>:" 前缀的原始键
  var openPanels = new Set();
  window.addEventListener("storage", function (event) {
    var key = String(event.key || "");
    if (key !== STORAGE_KEY && !key.endsWith(":" + STORAGE_KEY)) return;
    openPanels.forEach(function (panel) {
      try { syncAll(panel); } catch (e) {}
    });
  });

  // 游戏模块可能延迟加载，低频轮询直到 NightmareBattlePanel 可获取后停止
  var installAttempts = 0;
  var installer = setInterval(function () {
    installAttempts++;
    if (patchPanelClass() || installAttempts > 300) clearInterval(installer);
  }, 2000);

  // 暴露一个手动触发入口，便于宿主页面确认补丁状态
  window.__XYZW_NIGHTMARE_SKIP__ = {
    isInstalled: function () { return Boolean(window.__xyzwNightmareInstalledFlag); },
    patch: patchPanelClass,
  };

  if (patchPanelClass()) {
    clearInterval(installer);
  }
})();
