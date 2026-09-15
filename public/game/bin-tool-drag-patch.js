/**
 * bin-tool-drag-patch.js — 上号器(sh1.js) 拖拽补丁
 *
 * 背景: sh1.js 为 VM 字节码混淆无法直接改源码; 其面板(#binTool)自带拖拽与雪花(xh.js)
 * 的 DragManager 不一致: touch 监听是 passive:true(移动端 preventDefault 无效, 拖动会
 * 带动游戏画布)、mousedown 不 stopPropagation、无 rAF 保活/节流/transform 复位。
 *
 * 本补丁在 document 捕获阶段拦截 #binTool 上的 mousedown/touchstart(非按钮区域),
 * 阻断 sh1 自带拖拽启动, 并以与雪花 DragManager 完全一致的实现接管拖动:
 *   - preventDefault + stopPropagation
 *   - 移动即 1:1 跟随, 结束按 moveDistance<5 判定点击(交给原 click 逻辑)
 *   - touch 16ms 节流, requestAnimationFrame 保活, transform:'none'
 *   - 位置仍读写 localStorage['bin_tool_position'](与原版兼容)
 * 需加载顺序: sh1.js 之后。
 */
(function () {
  "use strict";
  if (window.__XYZW_BIN_DRAG_PATCHED__) return;
  window.__XYZW_BIN_DRAG_PATCHED__ = true;

  var POS_KEY = "bin_tool_position";

  // 关键修复: #binTool 自带 `transition: all 0.2s ease`, 拖动时每次 left/top 变更都被
  // CSS 缓动追赶, 面板永远滞后光标 200ms(手感差的根因)。雪花 DragManager 在 .dragging
  // 态显式关掉位移过渡, 这里对齐: 拖拽期间禁用 transition + grabbing 光标。
  var style = document.createElement("style");
  style.textContent =
    "#binTool.dragging{transition:none!important;cursor:grabbing!important;will-change:left,top;}" +
    // 最小化图标缩小: 44px -> 30px(原样式在混淆的 sh1.js 内, 这里用更高优先级覆盖)
    "#binTool.minimized{width:30px!important;height:30px!important;}" +
    "#binTool.minimized::after{font-size:15px!important;}";
  document.head.appendChild(style);

  function getPanel() {
    var el = document.getElementById("binTool");
    if (el && el.offsetParent !== null) return el;
    return el || null;
  }

  var drag = {
    active: false,
    isTouch: false,
    touchId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    lastMoveTime: 0,
    rafId: null,
    el: null,
  };

  function place(el, left, top) {
    var maxLeft = Math.max(0, window.innerWidth - (el.offsetWidth || 50));
    var maxTop = Math.max(0, window.innerHeight - (el.offsetHeight || 50));
    el.style.left = Math.max(0, Math.min(left, maxLeft)) + "px";
    el.style.top = Math.max(0, Math.min(top, maxTop)) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  function startDragging(el, clientX, clientY) {
    drag.active = true;
    drag.el = el;
    drag.startX = clientX;
    drag.startY = clientY;
    var ls = el.style.left;
    var ts = el.style.top;
    if (ls && ts && ls !== "auto" && ts !== "auto") {
      drag.startLeft = parseFloat(ls) || 0;
      drag.startTop = parseFloat(ts) || 0;
    } else {
      var rect = el.getBoundingClientRect();
      drag.startLeft = rect.left;
      drag.startTop = rect.top;
    }
    el.classList.add("dragging");
    var update = function () {
      if (drag.active) drag.rafId = requestAnimationFrame(update);
    };
    drag.rafId = requestAnimationFrame(update);
  }

  function updatePosition(clientX, clientY) {
    var now = Date.now();
    if (drag.isTouch && now - drag.lastMoveTime < 16) return;
    drag.lastMoveTime = now;
    place(
      drag.el,
      drag.startLeft + (clientX - drag.startX),
      drag.startTop + (clientY - drag.startY)
    );
  }

  function endDragging() {
    if (!drag.active) return -1;
    drag.active = false;
    var el = drag.el;
    drag.el = null;
    if (el) el.classList.remove("dragging");
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }
    if (!el) return -1;
    var left = parseFloat(el.style.left) || 0;
    var top = parseFloat(el.style.top) || 0;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: left, top: top }));
    } catch (e) {}
    return Math.sqrt(
      Math.pow(Math.abs(left - drag.startLeft), 2) +
        Math.pow(Math.abs(top - drag.startTop), 2)
    );
  }

  function shouldIgnore(target, el) {
    // 按钮/输入框/列表项不启动拖拽(与原版 closest('button') 排除一致, 并放宽到交互控件)
    if (!target || !target.closest) return true;
    return !!target.closest("button, input, select, textarea, a, li, .clickable");
  }

  // 捕获阶段拦截: 阻断 sh1 自带拖拽的 mousedown/touchstart, 由本补丁接管
  document.addEventListener(
    "mousedown",
    function (e) {
      if (e.button === 2) return;
      var el = getPanel();
      if (!el || !el.contains(e.target) || shouldIgnore(e.target, el)) return;
      e.stopPropagation(); // 阻止 sh1 的 element mousedown 启动
      drag.isTouch = false;
      startDragging(el, e.clientX, e.clientY);
      e.preventDefault();
    },
    true
  );
  document.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length > 1) return;
      var el = getPanel();
      if (!el || !el.contains(e.target) || shouldIgnore(e.target, el)) return;
      e.stopPropagation();
      drag.isTouch = true;
      drag.touchId = e.touches[0].identifier;
      startDragging(el, e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    },
    { capture: true, passive: false }
  );

  document.addEventListener("mousemove", function (e) {
    if (!drag.active || drag.isTouch) return;
    updatePosition(e.clientX, e.clientY);
    e.preventDefault();
  });
  document.addEventListener(
    "touchmove",
    function (e) {
      if (!drag.active || !drag.isTouch) return;
      var touch = null;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === drag.touchId) {
          touch = e.touches[i];
          break;
        }
      }
      if (!touch) return;
      updatePosition(touch.clientX, touch.clientY);
      e.preventDefault();
    },
    { passive: false }
  );

  function finishPointer(e) {
    if (!drag.active || drag.isTouch) return;
    endDragging();
  }
  function finishTouch(e) {
    if (!drag.active || !drag.isTouch) return;
    for (var i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === drag.touchId) return; // 该手指未抬起
    }
    drag.touchId = null;
    endDragging();
  }
  document.addEventListener("mouseup", finishPointer);
  document.addEventListener("touchend", finishTouch);
  document.addEventListener("touchcancel", function () {
    drag.touchId = null;
    endDragging();
  });

  // 恢复保存的位置(sh1 自己也会恢复, 这里兜底其时机早于补丁的情况)
  function restore() {
    var el = getPanel();
    if (!el) return;
    try {
      var pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (pos && isFinite(pos.left) && isFinite(pos.top)) {
        place(el, Number(pos.left), Number(pos.top));
      }
    } catch (e) {}
  }
  var n = 0;
  var iv = setInterval(function () {
    n++;
    if (document.getElementById("binTool")) {
      clearInterval(iv);
      restore();
    } else if (n > 120) {
      clearInterval(iv);
    }
  }, 500);
})();
