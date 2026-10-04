/**
 * ws-capture.js — 游戏内 WebSocket 命令级日志抓取工具(按账号开关)
 *
 * 用途: 记录游戏 rpc 的**明文请求 cmd + 输入参数**与**响应 cmd + code + 数据**,
 *       供在 v1 中复现/模拟功能, 以及排查「检测到您使用的客户端数据异常」等弹窗。
 *
 * 抓取点: 包装 window.__require, 把返回的模块对象入队(启动期不扫描), 等首个场景启动后
 *   再分批扫描, 找到 WebSocketClient 原型(特征: 同时具有 send / doReceive / sendHeartbeat
 *   三个原型方法)后包一层记录:
 *     - send(e):  e = {cmd, params, ...}  → 记录 ">>" 请求(明文参数)
 *     - doReceive(e): e = {cmd, code, rawData(解码响应体)} → 记录 "<<" 响应
 *   心跳/ack 走 doSend 而非 send, 且 cmd 以 "_sys/" 开头, 这里统一过滤, 不占日志空间。
 *
 * 附带"盐场邀请"专项诊断: 游戏侧 _InviteJoinTeamResp 以 `e.data.code||(...)` 开头,
 *   邀请失败(服务端返回非 0 错误码)会被静默丢弃, 表现为"点邀请没反应也没报错"。
 *   这里对 `params.targetCodeId` 出帧与 `*invitejointeam*` 响应code 各弹一次屏幕提示,
 *   并在缓冲区记为 ">>invite" 条目, 便于在盐场开放时段直接看到失败原因。
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
  // 启动完成前禁止自动导出: 启动期游戏会打大量含「客户端/异常」的日志, 若此时自动导出
  // (JSON.stringify 数 MB + console.table + 剪贴板写入 + localStorage 落盘) 会把主线程卡死,
  // 表现为「开了 WS 日志后游戏直接没反应」。
  var allowAutoDump = false;

  // ============ 0.1) 连接健康诊断 ============
  // 盲点: 命令级 ">>" 是在引擎 send 包装层记录的, 不看 socket 的 readyState, 所以
  // 「往已断开的连接里写」和「连接正常但服务端不回包」在日志里长得一模一样。
  // 这里补上 socket 生命周期(open/close/error)与 readyState, 并在「发出请求后长时间
  // 零入站」时告警, 用于区分服务端静默与客户端僵尸连接。
  var WS_STATE_NAMES = { 0: "CONNECTING", 1: "OPEN", 2: "CLOSING", 3: "CLOSED" };
  var STALL_MS = 15000; // 有未回包请求且超过该时长无任何入站帧, 判定为僵尸连接
  var lastSendAt = 0;
  var lastRecvAt = 0;
  var pendingSinceRecv = 0; // 自上次收到任何入站帧以来发出的帧数
  var stallAlerted = false;
  var sockets = [];
  function wsState(ws) {
    try {
      return WS_STATE_NAMES[ws.readyState] || String(ws.readyState);
    } catch (e) {
      return "?";
    }
  }
  function socketOverview() {
    return sockets.map(function (s) {
      return {
        id: s.id,
        url: s.url,
        state: wsState(s.ws),
        sent: s.sent,
        recv: s.recv,
        aliveMs: (s.closedAt || Date.now()) - s.bornAt,
        close: s.close,
      };
    });
  }

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

  // ============ 1) 命令级抓取: 包装 __require 收集模块, 启动完成后再扫描 ============
  // 重要约束(2026-10-04 修复「开了 WS 日志后游戏完全没反应」):
  //   启动期不能同步扫描模块 —— 对每个 require 同步 Object.keys + 读取导出属性, 会提前触发
  //   大量懒初始化(执行顺序错乱), 直接把游戏启动卡死; 启动期调用 __require('net') 之类的
  //   名称探测同理。改为: require 时仅把模块对象入队(O(1) push, 不读任何属性), 等首个
  //   场景真正启动后再分批扫描, 找到 WebSocketClient 原型一次即可(登录/战斗握手前完成)。
  var protoPatched = false;
  var instSendPatched = 0;
  var moduleQueue = [];
  var MAX_QUEUE = 20000;
  function enqueueModule(mod) {
    if (protoPatched || !mod || typeof mod !== "object") return;
    if (moduleQueue.length >= MAX_QUEUE) return;
    moduleQueue.push(mod);
  }
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
            // 只有业务命令才参与「僵尸连接」判定: 心跳不计, 避免空闲时误报
            lastSendAt = Date.now();
            pendingSinceRecv++;
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
          // 盐场邀请专项诊断: 邀请报文参数为 { battlefieldId, targetCodeId }
          // 游戏侧点击邀请既无出帧提示、响应错误码又被静默吞掉, 这里显式提示便于定位
          if (e.params && typeof e.params === "object" && e.params.targetCodeId !== undefined) {
            push({ k: ">>invite", params: brief(e.params, 500) });
            toast(
              "盐场邀请请求已发出\ntargetCodeId=" + e.params.targetCodeId +
                "\nbattlefieldId=" + e.params.battlefieldId,
              true
            );
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
            // 服务端错误文案: 游戏侧 _onWSMessage 对「偶数且非 0 的 code」执行 SHOW_TIP(e.error),
            // 直接把服务端返回的原文弹到屏幕上(例: 「检测到您使用的客户端数据异常，请使用官方最新客户端」)。
            // 该文案不存在于任何客户端代码, 属服务端下发; 旧实现只记 code + rawData, 而错误响应
            // rawData 常为 null, 导致弹窗时无法反查是哪个 cmd 触发。这里补记 error 并高亮。
            var errText = "";
            try {
              if (e.error != null) errText = String(e.error);
              else if (e.data && e.data.error != null) errText = String(e.data.error);
              else if (data && typeof data === "object" && data.error != null) errText = String(data.error);
            } catch (_) {}
            var rec = {
              k: "<<",
              cmd: e.cmd,
              code: e.code,
              data: data === undefined || data === null ? null : brief(data, 8000),
            };
            if (errText) {
              rec.k = "<<!";
              rec.error = brief(errText, 300);
            }
            push(rec);
            if (errText && /客户端|数据异常|官方最新|异常/.test(errText)) {
              toast("服务端提示(" + e.cmd + "): " + brief(errText, 60), false);
            }
            // 盐场邀请专项诊断: 游戏侧 _InviteJoinTeamResp 以 `e.data.code||(...)` 开头,
            // 任何非 0 错误码都会被静默丢弃(点击后无任何提示), 这里把 code 显式弹出来
            if (/invitejointeam/i.test(e.cmd)) {
              toast("盐场邀请响应 code=" + e.code, !e.code);
            }
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
  // 分批扫描队列(仅在启动完成后调用), 命中即停
  function drainQueue(batch) {
    if (protoPatched) return true;
    var n = 0;
    while (moduleQueue.length && n < batch) {
      scanModule(moduleQueue.shift());
      n++;
      if (protoPatched) break;
    }
    return protoPatched;
  }
  // 包装 window.__require(游戏 bundle 在后续脚本里赋值), 只入队不扫描
  function installRequireTrap() {
    var real = window.__require;
    if (typeof real === "function") {
      // 已存在: 包一层(注: 若游戏已跑起来, 直接包一层即可, 队列由 drainQueue 处理)
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
          enqueueModule(mod);
        } catch (e) {}
        return mod;
      };
      wrapped.__xyzwReqWrapped__ = true;
      // 用 wrapped 覆盖(window.__require 或属性)
      try {
        window.__require = wrapped;
      } catch (e) {}
      // 注意: 这里不能同步扫描或探测模块名(会破坏启动时序), 统一交给启动后的 drainQueue
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

  // 启动期只收集不扫描。等首个场景真正跑起来(cc.director.getScene() 非空)后, 再分批扫描队列;
  // 队列排空仍未命中时, 才用常见模块名兜底探测(此时启动已完成, 调用 __require 才是安全的)。
  var hookingStarted = false;
  function startHooking() {
    if (hookingStarted) return;
    hookingStarted = true;
    allowAutoDump = true; // 启动完成, 允许自动导出
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      if (drainQueue(200)) {
        clearInterval(iv);
        moduleQueue.length = 0;
        return;
      }
      // 队列已排空: 每 ~3s 用常见模块名兜底探测一次
      if (!moduleQueue.length && ticks % 20 === 0) {
        probeKnownNames();
        if (protoPatched) clearInterval(iv);
      }
    }, 150);
    // 兜底上限: 5 分钟后停止轮询, 避免长驻定时器
    setTimeout(function () {
      clearInterval(iv);
    }, 300000);
  }
  (function waitFirstScene() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var ready = false;
      try {
        ready = !!(
          window.cc &&
          cc.director &&
          typeof cc.director.getScene === "function" &&
          cc.director.getScene()
        );
      } catch (e) {}
      // getScene() 非空 = 首个场景已 launch; 90s 超时兜底(极端情况下也要尝试挂钩)
      if (ready || tries > 300) {
        clearInterval(iv);
        startHooking();
      }
    }, 300);
  })();

  // ============ 2) 连接 URL + 控制台 error/warn ============
  var NativeWS = window.WebSocket;
  if (NativeWS) {
    var PatchedWS = function (url, protocols) {
      var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
      try {
        var sock = {
          id: sockets.length + 1,
          ws: ws,
          url: String(url).slice(0, 200),
          bornAt: Date.now(),
          closedAt: 0,
          sent: 0,
          recv: 0,
          close: null,
        };
        sockets.push(sock);
        push({ k: "ws-open", sock: sock.id, url: sock.url });
        // 新建连接视为活跃起点, 避免刚开局就误报僵尸
        lastRecvAt = Date.now();
        pendingSinceRecv = 0;
        stallAlerted = false;

        // 用原生 addEventListener 挂生命周期, 不覆盖游戏自己的 onopen/onclose/onerror
        ws.addEventListener("open", function () {
          try {
            push({ k: "ws-onopen", sock: sock.id, ms: Date.now() - sock.bornAt });
          } catch (_) {}
        });
        ws.addEventListener("close", function (ev) {
          try {
            sock.closedAt = Date.now();
            sock.close = {
              code: ev && ev.code,
              reason: (ev && ev.reason) || "",
              clean: ev && ev.wasClean,
            };
            // 关键证据: 服务端主动断连会在这里留下 code/reason
            push({
              k: "ws-onclose",
              sock: sock.id,
              code: ev && ev.code,
              reason: (ev && ev.reason) || "",
              clean: ev && ev.wasClean,
              aliveMs: sock.closedAt - sock.bornAt,
              sent: sock.sent,
              recv: sock.recv,
            });
          } catch (_) {}
        });
        ws.addEventListener("error", function () {
          try {
            push({
              k: "ws-onerror",
              sock: sock.id,
              state: wsState(ws),
              sent: sock.sent,
              recv: sock.recv,
            });
          } catch (_) {}
        });
        ws.addEventListener("message", function () {
          // 任意入站字节(含被过滤掉的 _sys/ 心跳)都算连接活跃, 这是判定僵尸连接的主依据
          sock.recv++;
          lastRecvAt = Date.now();
          pendingSinceRecv = 0;
          if (stallAlerted) {
            stallAlerted = false;
            push({ k: "ws-recv-resumed", sock: sock.id, recv: sock.recv });
          }
        });

        // 诊断: 统计原生 socket 真实发出的帧(引擎 doSend 直发时不经过 send, 这里兜底计数)
        var rawSend = ws.send;
        ws.send = function (d) {
          try {
            var n = typeof d === "string" ? d.length : d && d.byteLength !== undefined ? d.byteLength : -1;
            if (ws.__xyzwOutFrames === undefined) ws.__xyzwOutFrames = 0;
            ws.__xyzwOutFrames++;
            sock.sent++;
            if (ws.__xyzwOutFrames <= 30) {
              push({ k: ">>bin", bytes: n, state: wsState(ws) });
            }
            // 关键证据: 往非 OPEN 的连接里写, 数据被静默丢弃(不抛错也不回包)
            if (ws.readyState !== 1) {
              push({ k: ">>dead", sock: sock.id, bytes: n, state: wsState(ws) });
            }
          } catch (_) {}
          try {
            return rawSend.apply(ws, arguments);
          } catch (err) {
            // CONNECTING 态下 send 会抛 InvalidStateError: 原样抛回, 但留下证据
            try {
              push({ k: ">>fail", sock: sock.id, state: wsState(ws), err: String(err) });
            } catch (_) {}
            throw err;
          }
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
    if (!allowAutoDump) return; // 启动期不自动导出(见 allowAutoDump 说明)
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

  // 僵尸连接看门狗: 已经发出过帧, 但超过 STALL_MS 一帧入站都没有 → 告警一次
  setInterval(function () {
    try {
      if (pendingSinceRecv <= 0 || !lastRecvAt) return;
      var idle = Date.now() - lastRecvAt;
      if (idle < STALL_MS) return;
      var last = sockets.length ? sockets[sockets.length - 1] : null;
      var state = last ? wsState(last.ws) : "none";
      if (stallAlerted) return;
      stallAlerted = true;
      push({
        k: "ws-stall",
        idleMs: idle,
        state: state,
        pending: pendingSinceRecv,
        sockets: socketOverview(),
      });
      toast(
        "⚠ 连接疑似僵尸: 已发出 " + pendingSinceRecv + " 帧, " +
          Math.round(idle / 1000) + " 秒内零回包 (socket=" + state + ")\n点 📡 导出日志即可定位",
        false
      );
    } catch (_) {}
  }, 5000);

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
      // 连接健康: 用于区分「服务端不回包」与「连接已断/僵尸」
      conn: {
        state: sockets.length ? wsState(sockets[sockets.length - 1].ws) : "none",
        lastRecvAt: lastRecvAt ? new Date(lastRecvAt).toISOString() : null,
        lastSendAt: lastSendAt ? new Date(lastSendAt).toISOString() : null,
        silentMs: lastRecvAt ? Date.now() - lastRecvAt : null,
        pending: pendingSinceRecv,
        stalled: stallAlerted,
        sockets: socketOverview(),
      },
      events: rows,
    });
    try {
      localStorage.setItem("xyzw_ws_capture", json);
    } catch (e) {}
    console.log(
      "%c[ws-capture] 导出 " + rows.length + " 条 (" + (tag || "manual") + ", 挂钩=" + (protoPatched ? "✓" : "✗") +
        ", 连接=" + (sockets.length ? wsState(sockets[sockets.length - 1].ws) : "无") +
        ", 静默=" + (lastRecvAt ? Math.round((Date.now() - lastRecvAt) / 1000) + "s" : "-") + ")",
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
