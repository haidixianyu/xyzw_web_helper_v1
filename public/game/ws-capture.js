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
  var MAX = 800;
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

      var origSend = proto.send;
      proto.send = function (e) {
        try {
          if (e && e.cmd && !isSys(e.cmd)) {
            push({ k: ">>", cmd: e.cmd, params: e.params === undefined ? null : brief(e.params, 1000) });
          }
        } catch (_) {}
        return origSend.apply(this, arguments);
      };

      var origRecv = proto.doReceive;
      proto.doReceive = function (e) {
        try {
          if (e && e.cmd && !isSys(e.cmd)) {
            var data = null;
            try {
              data = e.rawData; // getter: 解码后的响应体(用于模拟)
            } catch (_) {}
            push({
              k: "<<",
              cmd: e.cmd,
              code: e.code,
              data: data === undefined || data === null ? null : brief(data, 1200),
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

  // ============ 4) 📡 悬浮导出按钮(左上角) ============
  function buildBtn() {
    if (!document.body) {
      setTimeout(buildBtn, 500);
      return;
    }
    var b = document.createElement("div");
    b.textContent = "📡";
    b.title = protoPatched
      ? "导出 WS 命令日志(请求cmd+参数/响应)"
      : "导出日志(尚未挂钩到游戏网络层, 请稍后再点)";
    b.style.cssText =
      "position:fixed;left:8px;top:8px;z-index:2147483001;width:28px;height:28px;" +
      "border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:13px;" +
      "line-height:28px;text-align:center;cursor:pointer;user-select:none;opacity:.6;";
    b.addEventListener("click", function () {
      dump("manual");
    });
    document.body.appendChild(b);
  }
  buildBtn();
})();
