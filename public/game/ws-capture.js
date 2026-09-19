/**
 * ws-capture.js — 游戏内 WebSocket 命令级日志抓取工具(按账号开关)
 *
 * 用途: 记录游戏 rpc 的**明文请求 cmd + 输入参数**与**响应 cmd + code + 数据**,
 *       供在 v1 中复现/模拟功能, 以及排查「检测到您使用的客户端数据异常」等弹窗。
 *
 * 抓取点: 通过 trap window.__require, 扫描返回模块中找到 WebSocketClient 原型
 *   (特征: 同时具有 send / doReceive / sendHeartbeat 三个原型方法), 包一层记录:
 *     - send(e):  e = {cmd, params, ...}  → 记录 ">>" 请求(明文参数)
 *     - doReceive(e): e = {cmd, code, rawData(解码响应体)} → 记录 "<<" 响应
 *   心跳/ack 走 doSend 而非 send, 且 cmd 以 "_sys/" 开头, 这里统一过滤, 不占日志空间。
 *
 * 开关(需求#4): 仅当账号开启 WS 日志时才注入、显示 📡 雷达、记录日志。
 *   读取键: localStorage['ws_log_enabled:' + current_bin_id] === '1'
 *   (multi-game 下 current_bin_id 走账号隔离作用域; 开关值由 token 页写入顶层, 回退读 window.top)
 *
 * 使用: 弹窗/操作后点左上角 📡(或控制台 __wsDump()), 最近事件 console.table +
 *       JSON 复制剪贴板 + 存 localStorage['xyzw_ws_capture']。
 */
(function () {
  "use strict";
  if (window.__XYZW_WS_CAPTURE__) return;

  // ============ 0) 账号级开关判定 ============
  function readFlag(key) {
    try {
      var v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch (e) {}
    // multi-game: 开关写在顶层窗口, 当前 iframe 的 localStorage 被按 scope 隔离
    try {
      if (window.top && window.top !== window) {
        v = window.top.localStorage.getItem(key);
        if (v !== null) return v;
      }
    } catch (e) {}
    return null;
  }
  function currentBinId() {
    try {
      return localStorage.getItem("current_bin_id") || "";
    } catch (e) {
      return "";
    }
  }
  function wsLogEnabled() {
    var id = currentBinId();
    if (!id) {
      // 无账号上下文(极少数情况): 允许一个全局兜底键
      return readFlag("ws_log_enabled_all") === "1";
    }
    return readFlag("ws_log_enabled:" + id) === "1";
  }
  if (!wsLogEnabled()) {
    // 未开启: 不注入、不显示雷达、不记录。仅保留一个空壳 __wsDump 防外部调用报错。
    window.__XYZW_WS_CAPTURE__ = true;
    window.__wsDump = function () {
      return "";
    };
    return;
  }
  window.__XYZW_WS_CAPTURE__ = true;

  var CAP = [];
  var MAX = 400;
  var AUTO_RE = /异常|客户端|封禁|illegal|forbidden/i;

  function now() {
    var d = new Date();
    var ms = String(d.getMilliseconds());
    while (ms.length < 3) ms = "0" + ms;
    return d.toLocaleTimeString("zh-CN", { hour12: false }) + "." + ms;
  }
  function push(entry) {
    entry.t = now();
    CAP.push(entry);
    if (CAP.length > MAX) CAP.splice(0, CAP.length - MAX);
    return entry;
  }
  function brief(v, cap) {
    cap = cap || 800;
    try {
      if (typeof v === "string") return v.length > cap ? v.slice(0, cap) + "…" : v;
      if (v && typeof v === "object") {
        var s = JSON.stringify(v);
        return s && s.length > cap ? s.slice(0, cap) + "…" : s;
      }
      return String(v);
    } catch (e) {
      return "[unstringifiable]";
    }
  }
  function isSys(cmd) {
    return typeof cmd === "string" && (cmd.indexOf("_sys/") === 0 || cmd === "heartbeat");
  }

  // ============ 1) 命令级抓取: trap __require 找 WebSocketClient 原型 ============
  var protoPatched = false;
  var instSendPatched = 0;
  function looksLikeWsClientProto(p) {
    try {
      return (
        p &&
        typeof p.send === "function" &&
        typeof p.doReceive === "function" &&
        typeof p.sendHeartbeat === "function"
      );
    } catch (e) {
      return false;
    }
  }
  function patchProto(proto) {
    if (protoPatched) return;
    try {
      if (proto.__xyzwWsPatched__) {
        protoPatched = true;
        return;
      }
      proto.__xyzwWsPatched__ = true;
      protoPatched = true;

      // 游戏协议层发请求多用数字命令号 e.c 而非字符串 e.cmd(引擎: r.c=e.c, r.c||(r.cmd=e.cmd))
      // 记录时 cmd 取字符串, 无则记 "c:<数字>"; 响应侧服务端回带字符串 cmd 可对照解析
      function recordSend(e) {
        try {
          if (!e) return;
          if (e.cmd || e.c !== undefined) {
            if (isSys(e.cmd)) return;
            push({
              k: ">>",
              cmd: e.cmd || "c:" + e.c,
              c: e.c,
              params: e.params === undefined ? null : brief(e.params, 1000),
            });
          } else {
            // 结构未知(既无 cmd 也无 c): 仍记录, 便于诊断真实入参形态
            push({ k: ">>?", keys: brief(Object.keys(e)), raw: brief(e, 500) });
          }
        } catch (_) {}
      }
      function mark(fn) {
        try {
          fn.__xyzwSendPatch__ = true;
        } catch (_) {}
        return fn;
      }
      // 兜底: 派生类/实例在自身(或其原型)上覆盖了 send 时, 原型补丁会被遮蔽。
      // 在收到响应(doReceive)和心跳(sendHeartbeat)时借 this 拿到实例, 把 send 包成实例自有属性。
      function ensureInstanceSend(inst) {
        try {
          var f = inst.send;
          if (typeof f === "function" && !f.__xyzwSendPatch__) {
            inst.send = mark(function (e) {
              recordSend(e);
              return f.apply(inst, arguments);
            });
            instSendPatched++;
          }
        } catch (_) {}
      }

      var origSend = proto.send;
      proto.send = mark(function (e) {
        recordSend(e);
        return origSend.apply(this, arguments);
      });

      // 实际 bundle 版本可能与本地副本不同: 部分请求可能直接走 sendAsync
      if (typeof proto.sendAsync === "function") {
        var origSendAsync = proto.sendAsync;
        proto.sendAsync = mark(function (e) {
          recordSend(e);
          return origSendAsync.apply(this, arguments);
        });
      }

      var origHb = proto.sendHeartbeat;
      if (typeof origHb === "function") {
        proto.sendHeartbeat = function () {
          ensureInstanceSend(this);
          return origHb.apply(this, arguments);
        };
      }

      // 一次性诊断: 打印真实收发对象的形态, 定位请求为何绕过 send
      var diagDone = false;
      function diagClient(inst) {
        if (diagDone) return;
        diagDone = true;
        try {
          var ownFns = [];
          for (var k in inst) {
            if (Object.prototype.hasOwnProperty.call(inst, k) && typeof inst[k] === "function") {
              ownFns.push(k + (inst[k].__xyzwSendPatch__ ? "*" : ""));
            }
          }
          var chain = [];
          var p = Object.getPrototypeOf(inst);
          var depth = 0;
          while (p && depth < 5) {
            chain.push((p.constructor && p.constructor.name) || "?");
            if (p === proto) {
              chain.push("sendPatched=" + !!proto.send.__xyzwSendPatch__);
              break;
            }
            p = Object.getPrototypeOf(p);
            depth++;
          }
          push({
            k: "diag",
            ctor: (inst.constructor && inst.constructor.name) || "?",
            ownFns: ownFns.join(","),
            protoChain: chain.join("->"),
            hasSendOnInst: Object.prototype.hasOwnProperty.call(inst, "send"),
            sendIsPatched: typeof inst.send === "function" && !!inst.send.__xyzwSendPatch__,
          });
        } catch (e) {
          push({ k: "diag", err: String(e) });
        }
      }

      var origRecv = proto.doReceive;
      proto.doReceive = function (e) {
        try {
          diagClient(this);
          ensureInstanceSend(this);
          if (e && e.cmd && !isSys(e.cmd)) {
            var data = null;
            try {
              data = e.rawData; // getter: 解码后的响应体(用于模拟)
            } catch (_) {}
            push({
              k: "<<",
              cmd: e.cmd,
              code: e.code,
              data: data === undefined || data === null ? null : brief(data, 8000),
            });
          }
        } catch (_) {}
        return origRecv.apply(this, arguments);
      };
      console.log("%c[ws-capture] 已挂钩 WebSocketClient.send/doReceive", "color:#4ade80");
    } catch (e) {
      console.warn("[ws-capture] 挂钩失败", e);
    }
  }
  function scanModule(mod) {
    if (protoPatched || !mod || typeof mod !== "object") return;
    var keys;
    try {
      keys = Object.keys(mod);
    } catch (e) {
      return;
    }
    for (var i = 0; i < keys.length; i++) {
      var v;
      try {
        v = mod[keys[i]];
      } catch (e) {
        continue;
      }
      if (typeof v === "function" && v.prototype && looksLikeWsClientProto(v.prototype)) {
        patchProto(v.prototype);
        return;
      }
    }
  }
  // trap window.__require(游戏 bundle 在后续脚本里赋值), 每次返回模块都扫描
  function installRequireTrap() {
    var real = window.__require;
    if (typeof real === "function") {
      // 已存在: 直接扫一次 + 包一层
      wrapExisting(real);
      return;
    }
    try {
      var stored;
      Object.defineProperty(window, "__require", {
        configurable: true,
        get: function () {
          return stored;
        },
        set: function (fn) {
          stored = fn;
          if (typeof fn === "function") wrapExisting(fn);
        },
      });
    } catch (e) {}
  }
  function wrapExisting(fn) {
    if (fn.__xyzwReqWrapped__) return;
    try {
      var wrapped = function (name) {
        var mod = fn.apply(this, arguments);
        try {
          scanModule(mod);
        } catch (e) {}
        return mod;
      };
      wrapped.__xyzwReqWrapped__ = true;
      // 用 wrapped 覆盖(window.__require 或属性)
      try {
        window.__require = wrapped;
      } catch (e) {}
      // 兜底: 主动扫描已加载模块的常见名字
      probeKnownNames();
    } catch (e) {}
  }
  function probeKnownNames() {
    if (protoPatched) return;
    var names = ["net", "rpc", "socket", "WebSocketClient", "network", "ws", "index-net"];
    var req = window.__require;
    if (typeof req !== "function") return;
    for (var i = 0; i < names.length; i++) {
      try {
        scanModule(req(names[i]));
      } catch (e) {}
      if (protoPatched) return;
    }
  }
  installRequireTrap();
  // 游戏可能延迟 require, 轮询探测直到挂钩成功或超时
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    probeKnownNames();
    if (protoPatched || tries > 60) clearInterval(iv);
  }, 500);

  // ============ 2) 连接 URL + 控制台 error/warn ============
  var NativeWS = window.WebSocket;
  if (NativeWS) {
    var PatchedWS = function (url, protocols) {
      var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
      try {
        push({ k: "ws-open", url: String(url).slice(0, 200) });
        // 诊断: 统计原生 socket 真实发出的帧(引擎 doSend 直发时不经过 send, 这里兜底计数)
        var rawSend = ws.send;
        ws.send = function (d) {
          try {
            var n = typeof d === "string" ? d.length : d && d.byteLength !== undefined ? d.byteLength : -1;
            if (ws.__xyzwOutFrames === undefined) ws.__xyzwOutFrames = 0;
            ws.__xyzwOutFrames++;
            if (ws.__xyzwOutFrames <= 30) {
              push({ k: ">>bin", bytes: n });
            }
          } catch (_) {}
          return rawSend.apply(ws, arguments);
        };
      } catch (e) {}
      return ws;
    };
    PatchedWS.prototype = NativeWS.prototype;
    PatchedWS.CONNECTING = NativeWS.CONNECTING;
    PatchedWS.OPEN = NativeWS.OPEN;
    PatchedWS.CLOSING = NativeWS.CLOSING;
    PatchedWS.CLOSED = NativeWS.CLOSED;
    window.WebSocket = PatchedWS;
  }

  function scheduleAutoDump() {
    if (scheduleAutoDump.timer) return;
    scheduleAutoDump.timer = setTimeout(function () {
      scheduleAutoDump.timer = null;
      dump("auto");
    }, 300);
  }
  ["error", "warn"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        var msg = Array.prototype.map.call(arguments, function (a) {
          return brief(a, 400);
        }).join(" ");
        push({ k: "console." + level, msg: msg });
        if (AUTO_RE.test(msg)) scheduleAutoDump();
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  });

  // ============ 3) 导出 ============
  function toast(msg, ok) {
    try {
      var t = document.createElement("div");
      t.textContent = msg;
      t.style.cssText =
        "position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:2147483002;" +
        "max-width:80%;padding:10px 16px;border-radius:8px;font-size:13px;line-height:1.5;" +
        "white-space:pre-line;" +
        "background:rgba(20,20,28,.92);color:" + (ok === false ? "#f87171" : "#4ade80") + ";" +
        "border:1px solid rgba(74,222,128,.4);box-shadow:0 4px 16px rgba(0,0,0,.5);" +
        "font-family:sans-serif;pointer-events:none;text-align:center;";
      document.body.appendChild(t);
      setTimeout(function () {
        t.style.transition = "opacity .4s";
        t.style.opacity = "0";
        setTimeout(function () {
          t.remove();
        }, 450);
      }, 2200);
    } catch (e) {}
  }
  function copyText(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      return false;
    }
  }
  function dump(tag) {
    var rows = CAP.slice(-300);
    var json = JSON.stringify({
      tag: tag || "manual",
      at: new Date().toISOString(),
      bin: currentBinId(),
      hooked: protoPatched,
      instSend: instSendPatched,
      ver: typeof GAME_VERSION !== "undefined" ? GAME_VERSION : "?",
      events: rows,
    });
    try {
      localStorage.setItem("xyzw_ws_capture", json);
    } catch (e) {}
    console.log(
      "%c[ws-capture] 导出 " + rows.length + " 条 (" + (tag || "manual") + ", 挂钩=" + (protoPatched ? "✓" : "✗") + ")",
      "color:#4ade80;font-weight:bold"
    );
    try {
      console.table(rows);
    } catch (e) {}
    if (copyText(json)) {
      toast("📡 已导出 " + rows.length + " 条命令日志\nJSON 已复制到剪贴板, 直接粘贴发送即可", true);
    } else {
      toast("📡 已导出 " + rows.length + " 条日志\n(复制失败, 可从 localStorage['xyzw_ws_capture'] 取)", false);
    }
    return json;
  }
  window.__wsDump = dump;
  window.__wsCap = CAP;

  function clearLog() {
    CAP.length = 0;
    try {
      localStorage.removeItem("xyzw_ws_capture");
    } catch (e) {}
    toast("🗑 日志已清除, 可开始记录最新操作", true);
  }

  // ============ 4) 📡 悬浮导出按钮(可拖动, 默认左上角避开 /game 的"返回"按钮) ============
  var RADAR_POS_KEY = "ws_capture_radar_pos_v1";
  var RADAR_SIZE = 28;
  function buildBtn() {
    if (!document.body) {
      setTimeout(buildBtn, 500);
      return;
    }
    var b = document.createElement("div");
    b.textContent = "📡";
    b.title = protoPatched
      ? "导出 WS 命令日志(可拖动)"
      : "导出日志(尚未挂钩到游戏网络层, 请稍后再点)";
    b.style.cssText =
      "position:fixed;z-index:2147483001;width:28px;height:28px;" +
      "border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:13px;" +
      "line-height:28px;text-align:center;cursor:pointer;user-select:none;opacity:.6;" +
      "touch-action:none;font-family:sans-serif;";
    function placeRadar(left, top) {
      var maxLeft = Math.max(0, window.innerWidth - (b.offsetWidth || RADAR_SIZE));
      var maxTop = Math.max(0, window.innerHeight - (b.offsetHeight || RADAR_SIZE));
      b.style.left = Math.max(0, Math.min(left, maxLeft)) + "px";
      b.style.top = Math.max(0, Math.min(top, maxTop)) + "px";
      b.style.right = "auto";
      b.style.bottom = "auto";
      b.style.transform = "none";
    }
    function restoreRadarPos() {
      var pos = null;
      try {
        pos = JSON.parse(localStorage.getItem(RADAR_POS_KEY) || "null");
      } catch (e) {}
      if (pos && isFinite(pos.left) && isFinite(pos.top)) {
        placeRadar(Number(pos.left), Number(pos.top));
      } else {
        // 默认避开 /game 左上角的"← 返回"按钮(其高度约 32px)
        placeRadar(8, 48);
      }
    }
    restoreRadarPos();
    window.addEventListener("resize", restoreRadarPos);

    // 点击弹出的操作菜单: 复制日志 / 清除日志
    var menu = document.createElement("div");
    menu.style.cssText =
      "position:fixed;z-index:2147483003;display:none;flex-direction:column;min-width:120px;" +
      "background:rgba(20,20,28,.95);border:1px solid rgba(74,222,128,.4);border-radius:8px;" +
      "overflow:hidden;font-family:sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);";
    menu.innerHTML =
      '<div data-act="copy" style="padding:9px 14px;color:#4ade80;font-size:13px;cursor:pointer;">📋 复制日志</div>' +
      '<div data-act="clear" style="padding:9px 14px;color:#f87171;font-size:13px;cursor:pointer;border-top:1px solid rgba(255,255,255,.12);">🗑 清除日志</div>';
    document.body.appendChild(menu);
    function positionMenu() {
      var rect = b.getBoundingClientRect();
      var mw = menu.offsetWidth || 128;
      var mh = menu.offsetHeight || 76;
      var left = rect.right + 6;
      if (left + mw > window.innerWidth - 4) left = rect.left - mw - 6;
      left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
      var top = Math.max(4, Math.min(rect.top, window.innerHeight - mh - 4));
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    }
    function hideMenu() {
      menu.style.display = "none";
    }
    function toggleMenu() {
      if (menu.style.display === "flex") {
        hideMenu();
        return;
      }
      positionMenu();
      menu.style.display = "flex";
    }
    menu.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    menu.addEventListener("click", function (e) {
      e.stopPropagation();
      var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "copy") dump("manual");
      else if (act === "clear") clearLog();
      hideMenu();
    });
    // 点击菜单外部关闭
    document.addEventListener(
      "mousedown",
      function (e) {
        if (menu.style.display !== "flex") return;
        if (menu.contains(e.target) || e.target === b) return;
        hideMenu();
      },
      true
    );

    // 拖拽: 与雪花 DragManager 一致(移动即 1:1 跟随, 结束按距离<5 判点击)
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
    };
    function startDragging(clientX, clientY) {
      drag.active = true;
      drag.startX = clientX;
      drag.startY = clientY;
      var rect = b.getBoundingClientRect();
      drag.startLeft = rect.left;
      drag.startTop = rect.top;
      b.style.opacity = "0.85";
      var update = function () {
        if (drag.active) drag.rafId = requestAnimationFrame(update);
      };
      drag.rafId = requestAnimationFrame(update);
    }
    function updatePosition(clientX, clientY) {
      var nowMs = Date.now();
      if (drag.isTouch && nowMs - drag.lastMoveTime < 16) return;
      drag.lastMoveTime = nowMs;
      placeRadar(drag.startLeft + (clientX - drag.startX), drag.startTop + (clientY - drag.startY));
    }
    function endDragging() {
      if (!drag.active) return -1;
      drag.active = false;
      b.style.opacity = "0.6";
      if (drag.rafId) {
        cancelAnimationFrame(drag.rafId);
        drag.rafId = null;
      }
      var left = parseFloat(b.style.left) || 0;
      var top = parseFloat(b.style.top) || 0;
      try {
        localStorage.setItem(RADAR_POS_KEY, JSON.stringify({ left: left, top: top }));
      } catch (e) {}
      return Math.sqrt(
        Math.pow(Math.abs(left - drag.startLeft), 2) + Math.pow(Math.abs(top - drag.startTop), 2)
      );
    }

    b.addEventListener("mousedown", function (e) {
      if (e.button === 2) return;
      drag.isTouch = false;
      startDragging(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener("mousemove", function (e) {
      if (!drag.active || drag.isTouch) return;
      updatePosition(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener("mouseup", function () {
      if (!drag.active || drag.isTouch) return;
      if (endDragging() < 5) toggleMenu();
    });
    b.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length > 1) return;
        drag.isTouch = true;
        drag.touchId = e.touches[0].identifier;
        startDragging(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false }
    );
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
    document.addEventListener("touchend", function (e) {
      if (!drag.active || !drag.isTouch) return;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === drag.touchId) return;
      }
      drag.touchId = null;
      if (endDragging() < 5) toggleMenu();
    });
    document.addEventListener("touchcancel", function () {
      drag.touchId = null;
      endDragging();
    });
    b.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });
    document.body.appendChild(b);
  }
  buildBtn();
})();
