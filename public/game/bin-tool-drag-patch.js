/**
 * bin-tool-drag-patch.js — 上号器(sh1.js) 拖拽补丁
 *
 * 背景: sh1.js 为 VM 字节码混淆无法直接改源码; 其面板(#binTool)自带拖拽与雪花(xh.js)
 * 的 DragManager 不一致: touch 监听是 passive:true(移动端 preventDefault 无效, 拖动会
 * 带动游戏画布)、mousedown 不 stopPropagation、无 rAF 保活/节流/transform 复位。
 *
 * 本补丁在 document 捕获阶段接管 #binTool 的指针交互:
 *   - 仅「标题栏 .title」与「收起态小圆球(#binTool.minimized)」是拖拽把手,
 *     preventDefault + stopPropagation 后以与雪花 DragManager 一致的实现拖动
 *     (移动即 1:1 跟随, touch 16ms 节流, rAF 保活, transform:'none')
 *   - 面板其他区域(账号列表 .content/底部信息)只 stopPropagation 阻断 sh1 自带
 *     拖拽启动, 绝不 preventDefault —— 否则移动端列表原生滚动会被杀掉
 *   - 收起态轻点(moveDistance<5)时,iOS 上 touchstart.preventDefault() 会抑制
 *     兼容 click, 需手动补派发一个 click 给 #binTool 才能触发展开
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
    "#binTool.minimized::after{font-size:15px!important;}" +
    // #binTool 自带 touch-action:none, 部分 WebKit 会连带掐断内部滚动容器的手势;
    // 显式给账号列表区域放回纵向 pan, 并开启 iOS 惯性滚动
    "#binTool .content{touch-action:pan-y!important;-webkit-overflow-scrolling:touch;}" +
    "#binTool .content *{touch-action:pan-y!important;}";
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
    // 拖拽起始时是否处于收起态(收起态轻点需要补 click 触发展开)
    fromMinimized: false,
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
    drag.fromMinimized = el.classList.contains("minimized");
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

  function isInteractive(target) {
    // 按钮/输入框/列表项等交互控件完全放行(与原版 closest('button') 排除一致, 并放宽)
    return !!(
      target &&
      target.closest &&
      target.closest("button, input, select, textarea, a, li, .clickable")
    );
  }

  // 判定触点落点:
  //   'handle'  -> 收起态整个圆球 / 展开态标题栏: 可拖拽, 阻断默认行为
  //   'blocked' -> 面板内其余区域(账号列表等): 只阻断 sh1 拖拽启动, 保留默认行为(滚动/点击)
  //   null      -> 不在面板内 / 交互控件上: 不干预
  function classify(target, el) {
    if (!el || !el.contains(target)) return null;
    if (isInteractive(target)) return null;
    if (el.classList.contains("minimized")) return "handle";
    if (target.closest && target.closest(".title")) return "handle";
    return "blocked";
  }

  // 捕获阶段拦截
  document.addEventListener(
    "mousedown",
    function (e) {
      if (e.button === 2) return;
      var el = getPanel();
      var kind = classify(e.target, el);
      if (!kind) return;
      // 无论哪种区域都要阻断 sh1 的 element mousedown, 防止其启动自带拖拽
      e.stopPropagation();
      if (kind !== "handle") return; // 列表区域保留聚焦/选择等默认行为
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
      var kind = classify(e.target, el);
      if (!kind) return;
      // 阻断 sh1 的 element touchstart(否则列表滚动时它会 passive 地把面板拖走)
      e.stopPropagation();
      if (kind !== "handle") {
        // 关键: 列表/信息区域绝不能 preventDefault, 否则原生滚动与点击全部失效
        return;
      }
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
      if (!drag.active || !drag.isTouch) return; // 非拖拽中: 放行列表原生滚动
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

  // 收起态轻点: iOS 上 touchstart 被 preventDefault 后不会再产生兼容 click,
  // sh1 靠 click 切换展开, 这里手动补派发一个(bubbles, 让其元素/委托监听都能收到)
  function fireTapClick(el, clientX, clientY) {
    try {
      var ev = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clientX,
        clientY: clientY,
      });
      el.dispatchEvent(ev);
    } catch (err) {
      var ev2 = document.createEvent("MouseEvents");
      ev2.initMouseEvent(
        "click",
        true,
        true,
        window,
        1,
        clientX,
        clientY,
        clientX,
        clientY,
        false,
        false,
        false,
        false,
        0,
        null
      );
      el.dispatchEvent(ev2);
    }
  }

  // 兜底: 实际 sh1 为 VM 混淆版, 若其未在 click 中自行展开收起态,
  // 补丁在事件循环尾部检测仍为 minimized 时直接移除 class(还原版即无 restore 绑定)
  function scheduleRestoreFallback(el) {
    setTimeout(function () {
      if (el && el.isConnected && el.classList.contains("minimized")) {
        el.classList.remove("minimized");
      }
    }, 60);
  }

  document.addEventListener("mouseup", function () {
    if (!drag.active || drag.isTouch) return;
    var wasMinimized = drag.fromMinimized;
    var el = drag.el;
    endDragging();
    // 桌面端 mousedown.preventDefault 不抑制 click, 收起态由原生 click 触发展开;
    // 若实际 sh1 未绑定 restore(版本差异), 下一轮事件后兜底自行展开
    if (wasMinimized && el) scheduleRestoreFallback(el);
  });
  document.addEventListener(
    "touchend",
    function (e) {
      if (!drag.active || !drag.isTouch) return;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === drag.touchId) return; // 该手指未抬起
      }
      var el = drag.el;
      var fromMinimized = drag.fromMinimized;
      var endX = drag.startX;
      var endY = drag.startY;
      if (e.changedTouches && e.changedTouches.length) {
        for (var j = 0; j < e.changedTouches.length; j++) {
          if (e.changedTouches[j].identifier === drag.touchId) {
            endX = e.changedTouches[j].clientX;
            endY = e.changedTouches[j].clientY;
            break;
          }
        }
      }
      drag.touchId = null;
      var distance = endDragging();
      if (fromMinimized && el && distance < 5) {
        fireTapClick(el, endX, endY);
        scheduleRestoreFallback(el);
      }
    },
    true
  );
  document.addEventListener(
    "touchcancel",
    function () {
      if (!drag.active) return;
      drag.touchId = null;
      endDragging();
    },
    true
  );

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
