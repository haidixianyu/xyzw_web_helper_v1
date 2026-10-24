// ==UserScript==
// @name         模拟对战(雪花版骨架)
// @namespace    xyzw.local
// @version      0.3.0
// @description  按「故人_模拟对战.jsc」常量表还原 + 胜率统计(实测 fight_level + 本地模拟 manager-factory)
// @run-at       document-end
// ==/UserScript==

/**
 * 来源: 对 故人_模拟对战.jsc (V8 字节码) 的常量表提取结果。
 * 原脚本契约(从字节码字符串表读出的真实符号):
 *   electronAPI / getGameWindow / getGameWs / ensureWsSendAsync
 *   readRoleIdFromGame / isGameSessionReady / waitForGameReady
 *   gameResults / mapId / openedByScript / scriptName
 *   openPanel / panel / panelX / panelY / panelPrefs / panelDragState / mainPanelHookInstalled
 *   playbackPanelSuppressed / gameButton / downloadTextFile
 *   配置键前缀: Conf_ | _name_ | _desc_ | ^ACT_ | ^skin_ | ^emojiConf_ | ^MULTI_
 *
 * 注意: 原脚本依赖游戏客户端的 electronAPI 桥(Electron 侧)。在雪花(浏览器)环境里
 * 这层不存在, 所以本骨架把它抽象成 ADAPTER, 由接入方提供等价通道。
 */

(function () {
  'use strict';

  var SCRIPT_NAME = '模拟对战';
  var LOG_PREFIX = '[' + SCRIPT_NAME + ']';
  // 雪花运行时提供 unsafeWindow; 兜底用 window
  var W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift(LOG_PREFIX);
    console.log.apply(console, a);
  }

  // ======================= 0) 游戏通道桥 (原: electronAPI / getGameWs / ensureWsSendAsync) =======================
  // 做法复用 v1 里 ws-capture.js 已验证的经验(2026-10-04 修过「挂钩后游戏卡死」):
  //   1) 包装 window.__require 只做 O(1) 入队, 启动期绝不扫描同步读模块属性(会打乱懒加载时序);
  //   2) 等首个场景启动后再分批扫描, 命中特征(原型同时具备 send/doReceive/sendHeartbeat)才挂钩;
  //   3) 队列排空仍未命中, 才用常见模块名兜底探测(此时启动已完成, 调 __require 才安全)。
  var BRIDGE = (function () {
    var protoPatched = false;
    var client = null;
    var moduleQueue = [];
    var MAX_QUEUE = 20000;
    var scanStarted = false;

    function looksLikeProto(p) {
      try {
        return !!(p && typeof p.send === 'function' && typeof p.doReceive === 'function' && typeof p.sendHeartbeat === 'function');
      } catch (e) { return false; }
    }

    function patchProto(proto) {
      if (protoPatched) return;
      protoPatched = true;
      try {
        if (proto.__sbPatched__) return;
        proto.__sbPatched__ = true;

        var origSend = proto.send;
        proto.send = function (e) {
          try { client = this; } catch (_) {}
          return origSend.apply(this, arguments);
        };
        if (typeof proto.sendAsync === 'function') {
          var origAsync = proto.sendAsync;
          proto.sendAsync = function (e) {
            try { client = this; } catch (_) {}
            return origAsync.apply(this, arguments);
          };
        }
        var origRecv = proto.doReceive;
        proto.doReceive = function (e) {
          try {
            client = this;
            // 心跳/ack 走 doSend 而非 send, cmd 以 _sys/ 开头, 这里不回灌业务分发
            if (e && e.cmd && !(typeof e.cmd === 'string' && e.cmd.indexOf('_sys/') === 0)) {
              var data = null;
              try { data = e.rawData; } catch (_) {}   // getter: 已解码的响应体
              WS.feed({ cmd: e.cmd, code: e.code, data: data === undefined ? null : data });
            }
          } catch (_) {}
          return origRecv.apply(this, arguments);
        };
        log('已挂钩游戏协议客户端 send/doReceive, 通道就绪');
        WS.attach();
      } catch (e) { log('挂钩失败', e); }
    }

    function scanModule(mod) {
      if (protoPatched || !mod || typeof mod !== 'object') return;
      var keys;
      try { keys = Object.keys(mod); } catch (e) { return; }
      for (var i = 0; i < keys.length; i++) {
        var v;
        try { v = mod[keys[i]]; } catch (e) { continue; }
        if (typeof v === 'function' && v.prototype && looksLikeProto(v.prototype)) { patchProto(v.prototype); return; }
      }
    }

    function drainQueue(batch) {
      var n = 0;
      while (moduleQueue.length && n < batch) {
        scanModule(moduleQueue.shift());
        n++;
        if (protoPatched) break;
      }
      return protoPatched;
    }

    function enqueue(mod) {
      if (protoPatched || !mod || typeof mod !== 'object') return;
      if (moduleQueue.length < MAX_QUEUE) moduleQueue.push(mod);
    }

    function wrapRequire(fn) {
      if (!fn || fn.__sbWrapped__) return fn;
      var wrapped = function () {
        var mod = fn.apply(this, arguments);
        try { enqueue(mod); } catch (e) {}
        return mod;
      };
      wrapped.__sbWrapped__ = true;
      try { W.__require = wrapped; } catch (e) {}
      return wrapped;
    }

    function install() {
      if (typeof W.__require === 'function') { wrapRequire(W.__require); return; }
      try {
        var stored;
        Object.defineProperty(W, '__require', {
          configurable: true,
          get: function () { return stored; },
          set: function (fn) { stored = fn; if (typeof fn === 'function') wrapRequire(fn); }
        });
      } catch (e) {}
    }

    function sceneUp() {
      try { return !!(W.cc && W.cc.director && W.cc.director.getScene && W.cc.director.getScene()); }
      catch (e) { return false; }
    }

    function startScan() {
      if (scanStarted) return;
      scanStarted = true;
      var ticks = 0;
      var iv = setInterval(function () {
        ticks++;
        if (drainQueue(200)) { clearInterval(iv); moduleQueue.length = 0; return; }
        // 队列已排空: 每 ~3s 用常见模块名兜底探测一次(启动已完成才安全)
        if (!moduleQueue.length && ticks % 20 === 0) {
          var names = ['net', 'rpc', 'socket', 'WebSocketClient', 'network', 'ws', 'index-net'];
          for (var i = 0; i < names.length && !protoPatched; i++) {
            try { scanModule(W.__require(names[i])); } catch (e) {}
          }
          if (protoPatched) clearInterval(iv);
        }
        if (ticks > 2000) clearInterval(iv);   // 5 分钟上限, 避免长驻定时器
      }, 150);
      // 场景就绪即提前开始扫描, 不必死等定时器
      var s = setInterval(function () {
        if (!sceneUp()) return;
        clearInterval(s);
        drainQueue(0);
        if (protoPatched) clearInterval(iv);
      }, 300);
      setTimeout(function () { clearInterval(s); }, 120000);
    }

    return {
      install: install,
      startScan: startScan,
      get client() { return client; },
      isReady: function () { return !!client; },
      send: function (msg) {
        if (!client || typeof client.send !== 'function') return Promise.reject(new Error('游戏协议客户端未就绪'));
        try { client.send(msg); return Promise.resolve(true); } catch (e) { return Promise.reject(e); }
      }
    };
  })();

  var ADAPTER = {
    // 拿到的是游戏协议客户端(具备 send), 不是裸 WebSocket
    getGameWs: function () { return BRIDGE.client; },
    // 若游戏客户端是 Electron, 这里是 electronAPI; 浏览器环境返回 null
    getElectronAPI: function () { return (W && W.electronAPI) || null; },
    // 原 readRoleIdFromGame: 先取账号上下文, 再退回客户端自身字段
    readRoleId: function () {
      try { var v = localStorage.getItem('current_bin_id'); if (v) return v; } catch (e) {}
      try { var c = BRIDGE.client; if (c && c.roleId) return c.roleId; } catch (e) {}
      return null;
    },
    // 原 isGameSessionReady / waitForGameReady
    isSessionReady: function () { return BRIDGE.isReady(); },
    // 原 ensureWsSendAsync
    send: function (msg) { return BRIDGE.send(msg); }
  };

  // ======================= 1) 配置 (原: Conf_/_name_/_desc_/ACT_/skin_/emojiConf_/MULTI_) =======================
  var KEY_PREFIX = 'simBattle.';
  var CONF_PREFIXES = ['Conf_', '_name_', '_desc_', 'ACT_', 'skin_', 'emojiConf_', 'MULTI_'];

  var CONF = (function () {
    function realKey(k) { return KEY_PREFIX + k; }
    return {
      get: function (k, dft) {
        try {
          var v = (typeof GM_getValue === 'function') ? GM_getValue(realKey(k)) : localStorage.getItem(realKey(k));
          return (v === undefined || v === null || v === '') ? dft : v;
        } catch (e) { return dft; }
      },
      set: function (k, v) {
        try {
          if (typeof GM_setValue === 'function') GM_setValue(realKey(k), v);
          else localStorage.setItem(realKey(k), v);
        } catch (e) {}
      },
      del: function (k) {
        try {
          if (typeof GM_deleteValue === 'function') GM_deleteValue(realKey(k));
          else localStorage.removeItem(realKey(k));
        } catch (e) {}
      },
      // 按原脚本的前缀规则列出全部配置键
      keys: function () {
        var out = [];
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
            var bare = k.slice(KEY_PREFIX.length);
            for (var j = 0; j < CONF_PREFIXES.length; j++) {
              if (bare.indexOf(CONF_PREFIXES[j].replace(/^\^/, '')) === 0) { out.push(bare); break; }
            }
          }
        } catch (e) {}
        return out;
      }
    };
  })();

  // ======================= 2) 会话: 角色/地图/就绪 (原: readRoleIdFromGame/isGameSessionReady) =======================
  var SESSION = {
    roleId: null,
    mapId: null,
    ready: false,

    refresh: function () {
      SESSION.roleId = ADAPTER.readRoleId();
      SESSION.ready = ADAPTER.isSessionReady();
      return SESSION.roleId;
    },
    // 原 waitForGameReady: 轮询直到具备会话
    waitUntilReady: function (timeoutMs) {
      timeoutMs = timeoutMs || 30000;
      var t0 = Date.now();
      return new Promise(function (resolve) {
        (function tick() {
          SESSION.refresh();
          if (SESSION.ready && SESSION.roleId) return resolve(true);
          if (Date.now() - t0 > timeoutMs) return resolve(false);
          setTimeout(tick, 500);
        })();
      });
    }
  };

  // ======================= 3) WS 通道 + 消息分发 (原: getGameWs/ensureWsSendAsync/gameResults) =======================
  var WS = {
    ready: false,
    queue: [],
    handlers: [],   // {type, fn}

    // 桥接层挂钩成功(拿到游戏协议客户端)后调用
    attach: function () {
      if (WS.ready) return;
      WS.ready = true;
      log('游戏通道就绪, 冲刷待发队列', WS.queue.length);
      var q = WS.queue.splice(0);
      q.forEach(function (m) { WS.send(m).catch(function () {}); });
    },
    send: function (msg) {
      if (!WS.ready || !BRIDGE.isReady()) { WS.queue.push(msg); return Promise.resolve(false); }
      return ADAPTER.send(msg);
    },
    on: function (type, fn) { WS.handlers.push({ type: type, fn: fn }); },
    // 桥接层把 doReceive 的响应回灌进来 (原: gameResults / mapId)
    feed: function (m) {
      if (!m) return;
      if (m.data && typeof m.data === 'object' && m.data.mapId !== undefined) SESSION.mapId = m.data.mapId;
      REQ.resolve(m.cmd, m.data, m.code);
      BATTLE.observe(m.cmd, m.data);
      WS.dispatch({ cmd: m.cmd, code: m.code, data: m.data });
    },
    dispatch: function (raw) {
      var msg = raw;
      if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch (e) { return; } }
      if (!msg || typeof msg !== 'object') return;
      var type = msg.type || msg.cmd || msg.act || msg.ACT;
      if (!type) return;
      // 原脚本: mapId 与 gameResults 的追踪
      if (msg.mapId !== undefined) SESSION.mapId = msg.mapId;
      WS.handlers.forEach(function (h) { if (!h.type || h.type === type) { try { h.fn(msg); } catch (e) {} } });
    }
  };

  // ======================= 3.5) 主动请求 + 等响应 (原: ensureWsSendAsync) =======================
  var REQ = {
    pending: Object.create(null),
    seq: 0,
    _remove: function (cmd, item) {
      var list = REQ.pending[cmd];
      if (!list) return;
      var i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) delete REQ.pending[cmd];
    },
    // doReceive 回灌时调用: 精确 cmd 与去 resp 后缀的 base 都尝试唤醒
    resolve: function (cmd, data, code) {
      if (!cmd) return;
      var hit = function (key) {
        var list = REQ.pending[key];
        if (!list || !list.length) return false;
        var item = list.shift();
        if (!list.length) delete REQ.pending[key];
        clearTimeout(item.timer);
        item.resolve({ cmd: key, data: data, code: code });
        return true;
      };
      if (hit(cmd)) return;
      var base = String(cmd).replace(/resp$/i, '');
      if (base !== cmd) hit(base);
    },
    call: function (cmd, params, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var c = BRIDGE.client;
        if (!c || typeof c.send !== 'function') return reject(new Error('游戏连接未就绪'));
        var item = { resolve: resolve, timer: null };
        (REQ.pending[cmd] || (REQ.pending[cmd] = [])).push(item);
        item.timer = setTimeout(function () {
          REQ._remove(cmd, item);
          reject(new Error('请求超时: ' + cmd));
        }, timeoutMs || 15000);
        try {
          var pkt = { ack: 0, cmd: cmd, params: params || {}, seq: Date.now() + (REQ.seq++ % 1000) };
          var ret = typeof c.send === 'function' ? c.send(pkt) : (c.sendAsync ? c.sendAsync(pkt) : null);
          if (ret && typeof ret.catch === 'function') ret.catch(function () {});
        } catch (err) {
          REQ._remove(cmd, item);
          reject(err);
        }
      });
    }
  };

  // ======================= 3.6) 战斗观察: calcleveltime / level 响应捕获 =======================
  function pickField(source, keys) {
    var objs = [source, source && source.body, source && source.role, source && source.body && source.body.role];
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (!o || typeof o !== 'object') continue;
      for (var k = 0; k < keys.length; k++) {
        var v = o[keys[k]];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    return undefined;
  }

  var BATTLE = {
    lastCalc: null,   // fight_calcleveltimeresp 原始 data
    lastInput: null,  // battleData(本地模拟的输入)
    lastLevel: 0,
    battleTime: 0,

    observe: function (cmd, data) {
      if (!cmd || !data || typeof data !== 'object') return;
      var c = String(cmd);
      if (c.indexOf('fight_calcleveltime') >= 0) {
        BATTLE.lastCalc = data;
        BATTLE.lastInput = pickField(data, ['battleData']) || null;
        var lv = pickField(data, ['currLevel', 'levelId', 'level']);
        if (lv !== undefined) BATTLE.lastLevel = Number(lv) || BATTLE.lastLevel;
        var bt = pickField(data, ['battleTime']);
        BATTLE.battleTime = Number(bt) || 0;
        log('捕获战斗数据: 关卡=' + BATTLE.lastLevel + ' 时长=' + BATTLE.battleTime + 's' +
            (BATTLE.lastInput ? ' battleData✓' : ' battleData✗'));
      } else if (c.indexOf('fight_level') >= 0) {
        var win = pickField(data, ['success', 'isWin']);
        if (win !== undefined) {
          var l2 = Number(pickField(data, ['currLevel', 'levelId', 'level'])) || BATTLE.lastLevel;
          STATS.recordReal(l2, Boolean(win));
        }
      }
    },

    // 主动取一份 battleData(仅 calc, 不发 startlevel, 不改变服务端状态)
    fetchInput: function () {
      return REQ.call('fight_calcleveltime', {}, 15000).then(function (resp) {
        BATTLE.observe('fight_calcleveltimeresp', resp.data);
        if (!BATTLE.lastInput) throw new Error('响应里没有 battleData');
        return BATTLE.lastInput;
      });
    }
  };

  // ======================= 3.7) 本地战斗引擎 (原: findBattleFactory) =======================
  // 模块名/接口来自 nightmare-skip.js 已验证经验: __require('manager-factory')
  //   GET_BATTLE(battleUIData) / GET_BATTLE_BY_ID(id) / BATTLE_SPEED(battleUIData, speed)
  // 注意: QUICK_BATTLE* 是游戏自身"速战结算", 会触发真实结算流程 —— 模拟时绝不调用。
  var ENGINE = {
    manager: null,
    factoryName: '',
    runner: null,       // 可注入的单场模拟函数 function(input) -> {win, rounds, stars}
    running: false,
    cancel: false,

    requireManager: function () {
      if (ENGINE.manager) return ENGINE.manager;
      var names = ['manager-factory', 'battle-manager', 'manager_battle'];
      for (var i = 0; i < names.length; i++) {
        var m = null;
        try { m = typeof W.__require === 'function' ? W.__require(names[i]) : null; } catch (e) {}
        if (m && (m.GET_BATTLE || m.QUICK_BATTLE || m.BATTLE_SPEED)) {
          ENGINE.manager = m;
          ENGINE.factoryName = names[i];
          log('战斗管理器已找到: __require("' + names[i] + '")');
          return m;
        }
      }
      return null;
    },

    // 注入自定义单场模拟函数, 覆盖 defaultRunner (字段名未校准前的兜底手段)
    registerRunner: function (fn) {
      if (typeof fn !== 'function') return '需要传入 function(input) -> {win, rounds, stars}';
      ENGINE.runner = fn;
      return 'runner 已注入';
    },

    // 校准: 造一场本地战斗, 把对象形态打到 console, 供确认 win/rounds 字段位置
    probe: function () {
      var bm = ENGINE.requireManager();
      if (!bm) return { ok: false, reason: 'manager-factory 未找到(需先进入一次战斗场景)' };
      if (!BATTLE.lastInput) return { ok: false, reason: '尚无 battleData(先打一场或点「取战斗数据」)' };
      var battle = null;
      try { battle = bm.GET_BATTLE ? bm.GET_BATTLE({ battleData: BATTLE.lastInput }) : null; }
      catch (e) { return { ok: false, reason: 'GET_BATTLE 异常: ' + e }; }
      if (!battle) return { ok: false, reason: 'GET_BATTLE 未返回战斗对象' };
      var keys = [];
      try { keys = Object.keys(battle); } catch (e) {}
      console.log('[模拟对战] battle 对象字段:', keys);
      console.log('[模拟对战] battle 对象:', battle);
      return { ok: true, battleKeys: keys, battle: battle };
    },

    // 默认单场模拟: 依赖 probe 校准结论; 字段形态未确认前返回 null(不计入结果)
    defaultRunner: function (input) {
      var bm = ENGINE.requireManager();
      if (!bm || !bm.GET_BATTLE) return null;
      var battle = null;
      try { battle = bm.GET_BATTLE({ battleData: input }); } catch (e) { return null; }
      if (!battle) return null;
      // 校准后若字段名不同, 用 SimBattle.engine.registerRunner(fn) 覆盖
      var win = pickField(battle, ['win', 'isWin', 'success']);
      if (win === undefined) return null;
      var rounds = pickField(battle, ['rounds', 'roundCount', 'round']);
      var stars = pickField(battle, ['star', 'stars', 'starCount']);
      return { win: !!win, rounds: Number(rounds) || 0, stars: Number(stars) || 0, raw: battle };
    },

    runOne: function (input) {
      var fn = ENGINE.runner || ENGINE.defaultRunner;
      var r = null;
      try { r = fn(input); } catch (e) { log('单场模拟异常', e); return null; }
      if (!r || r.win === undefined) return null;
      return r;
    },

    // 分片跑 N 场(每片 20 场让出主线程, 不卡游戏); 可随时 stop
    simulate: function (times, onProgress) {
      times = Math.max(1, Math.min(2000, Number(times) || 100));
      if (!ENGINE.runner && !ENGINE.requireManager() && !BATTLE.lastInput) {
        return Promise.reject(new Error('引擎未找到且无 battleData; 先取战斗数据或 probe() 校准'));
      }
      var prep = BATTLE.lastInput ? Promise.resolve(BATTLE.lastInput) : BATTLE.fetchInput();
      return prep.then(function (input) {
        return new Promise(function (resolve, reject) {
          var i = 0, wins = 0, roundsSum = 0, fails = 0;
          ENGINE.running = true;
          ENGINE.cancel = false;
          (function chunk() {
            if (ENGINE.cancel) {
              ENGINE.running = false;
              return resolve({ cancelled: true, total: i, wins: wins, winRate: i ? wins / i : 0, avgRounds: 0 });
            }
            var end = Math.min(times, i + 20);
            for (; i < end; i++) {
              var r = ENGINE.runOne(input);
              if (!r) { fails++; continue; }
              if (r.win) wins++;
              roundsSum += r.rounds || 0;
            }
            if (onProgress) { try { onProgress(i, times, wins); } catch (e) {} }
            if (i < times) return setTimeout(chunk, 0);
            ENGINE.running = false;
            if (i && fails === i) return reject(new Error('结果字段未识别(' + fails + ' 场全部无效), 请先 probe() 校准'));
            var summary = { cancelled: false, total: i, wins: wins, losses: i - wins, winRate: i ? wins / i : 0, avgRounds: i ? roundsSum / i : 0 };
            STATS.recordSim(BATTLE.lastLevel, summary);
            resolve(summary);
          })();
        });
      });
    }
  };

  // ======================= 3.8) 胜率统计 (实测 + 模拟, CONF 持久化) =======================
  var STATS = {
    real: {},   // level -> {w, l}
    sim: {},    // level -> {w, t, rs}(t=总场数, rs=回合总数)
    loaded: false,

    load: function () {
      if (STATS.loaded) return;
      try { STATS.real = JSON.parse(CONF.get('statsReal', '{}') || '{}') || {}; } catch (e) { STATS.real = {}; }
      try { STATS.sim = JSON.parse(CONF.get('statsSim', '{}') || '{}') || {}; } catch (e) { STATS.sim = {}; }
      STATS.loaded = true;
    },
    save: function () {
      try {
        CONF.set('statsReal', JSON.stringify(STATS.real));
        CONF.set('statsSim', JSON.stringify(STATS.sim));
      } catch (e) {}
    },
    bucket: function (table, level) {
      var lv = String(level || 0);
      if (!table[lv]) table[lv] = { w: 0, l: 0, rs: 0, t: 0 };
      return table[lv];
    },
    recordReal: function (level, win) {
      STATS.load();
      var b = STATS.bucket(STATS.real, level);
      if (win) b.w++; else b.l++;
      STATS.save();
      PANEL.refreshStats();
      log('实测结算: 关卡 ' + level + ' -> ' + (win ? '胜' : '负'));
    },
    recordSim: function (level, summary) {
      STATS.load();
      var b = STATS.bucket(STATS.sim, level);
      b.w += summary.wins;
      b.t += summary.total;
      b.rs += Math.round((summary.avgRounds || 0) * summary.total);
      STATS.save();
      PANEL.refreshStats();
    },
    rateText: function (b) {
      if (!b) return '0/0';
      var t = b.t || (b.w + b.l);
      if (!t) return '0/0';
      return b.w + '胜/' + (t - b.w) + '负 (' + Math.round(b.w / t * 100) + '%)';
    },
    reset: function () {
      STATS.real = {};
      STATS.sim = {};
      STATS.save();
      PANEL.refreshStats();
    }
  };

  // ======================= 4) 面板 (原: openPanel + panelX/panelY/panelPrefs/panelDragState) =======================
  var PANEL_ID = 'sim-battle-panel';
  var panelPrefs = JSON.parse(CONF.get('panelPrefs', '{}') || '{}');
  var panelDragState = null;

  function ensureStyle() {
    if (document.getElementById('sim-battle-style')) return;
    var css = [
      '#' + PANEL_ID + '{position:fixed;z-index:2147483000;width:260px;background:#1e2229;color:#e6e6e6;',
      'border:1px solid #3a4150;border-radius:8px;font:12px/1.6 system-ui,"Microsoft YaHei";box-shadow:0 6px 20px rgba(0,0,0,.45);user-select:none}',
      '#' + PANEL_ID + ' .sb-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#252b35;cursor:move;border-radius:8px 8px 0 0}',
      '#' + PANEL_ID + ' .sb-bd{padding:10px}',
      '#' + PANEL_ID + ' .sb-close{cursor:pointer;padding:0 4px;color:#9aa4b2}',
      '#' + PANEL_ID + ' .sb-btn{display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;background:#2f3643;border:1px solid #444d5c;border-radius:4px;cursor:pointer}',
      '#' + PANEL_ID + ' .sb-btn.on{background:#2b5c3f;border-color:#3d7f57}',
      '#sim-battle-button{position:fixed;z-index:2147483000;right:12px;top:38%;padding:4px 8px;background:#1e2229;color:#e6e6e6;',
      'border:1px solid #3a4150;border-radius:4px;font:12px/1 system-ui;cursor:pointer;user-select:none}'
    ].join('');
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { var s = document.createElement('style'); s.id = 'sim-battle-style'; s.textContent = css; document.head.appendChild(s); }
  }

  // 拖拽: 与 xh.js 的 DragManager 保持一致的 1:1 跟随 + 位置持久化
  function bindDrag(el, handle, key) {
    handle.addEventListener('mousedown', function (e) {
      panelDragState = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, moved: 0 };
      e.preventDefault();
      function onMove(ev) {
        if (!panelDragState) return;
        var nx = ev.clientX - panelDragState.dx;
        var ny = ev.clientY - panelDragState.dy;
        panelDragState.moved += Math.abs(nx - el.offsetLeft) + Math.abs(ny - el.offsetTop);
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
        panelDragState.x = nx; panelDragState.y = ny;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (panelDragState && panelDragState.x !== undefined) {
          // 持久化: panelX / panelY (与原脚本同名) + panelPrefs 汇总
          CONF.set(key + 'X', panelDragState.x);
          CONF.set(key + 'Y', panelDragState.y);
          panelPrefs[key] = { x: panelDragState.x, y: panelDragState.y };
          CONF.set('panelPrefs', JSON.stringify(panelPrefs));
        }
        panelDragState = null;
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  var PANEL = {
    el: null,
    openPanel: function () {
      if (PANEL.el) return PANEL.el;
      ensureStyle();
      var el = document.createElement('div');
      el.id = PANEL_ID;
      el.style.left = (CONF.get('panelX', 80)) + 'px';
      el.style.top = (CONF.get('panelY', 120)) + 'px';
      el.innerHTML =
        '<div class="sb-hd"><span>' + SCRIPT_NAME + '</span><span class="sb-close">×</span></div>' +
        '<div class="sb-bd"></div>';
      document.body.appendChild(el);
      var bd = el.querySelector('.sb-bd');

      var row1 = document.createElement('div');
      row1.innerHTML = '<span>关卡: <b data-lv>--</b></span>' +
        '<span style="margin-left:10px">次数: <input data-times type="number" value="100" min="1" max="2000" style="width:54px"></span>';
      bd.appendChild(row1);

      var row = document.createElement('div');
      row.innerHTML = '<span class="sb-btn" data-act="start">开始模拟</span>' +
                      '<span class="sb-btn" data-act="stop">停止</span>' +
                      '<span class="sb-btn" data-act="fetch">取战斗数据</span>' +
                      '<span class="sb-btn" data-act="probe">探测引擎</span>' +
                      '<span class="sb-btn" data-act="clear">清空</span>';
      bd.appendChild(row);

      var out = document.createElement('div');
      out.className = 'sb-out';
      out.style.cssText = 'margin-top:6px;line-height:1.8;white-space:pre-wrap';
      bd.appendChild(out);

      PANEL.out = out;
      PANEL.lvEl = row1.querySelector('[data-lv]');
      PANEL.timesEl = row1.querySelector('[data-times]');

      row.addEventListener('click', function (e) {
        var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        ACT[act] && ACT[act]();
      });
      el.querySelector('.sb-close').addEventListener('click', function () { PANEL.close(); });
      bindDrag(el, el.querySelector('.sb-hd'), 'panel');

      PANEL.el = el;
      // 原脚本: mainPanelHookInstalled 防重复挂载
      CONF.set('mainPanelHookInstalled', '1');
      return el;
    },
    close: function () { if (PANEL.el) { PANEL.el.remove(); PANEL.el = null; } },
    toggle: function () { PANEL.el ? PANEL.close() : PANEL.openPanel(); },
    setBusy: function (busy) {
      if (!PANEL.el) return;
      var btns = PANEL.el.querySelectorAll('.sb-btn[data-act]');
      for (var i = 0; i < btns.length; i++) {
        var a = btns[i].getAttribute('data-act');
        btns[i].style.opacity = (busy && (a === 'start' || a === 'fetch' || a === 'probe')) ? '0.5' : '1';
      }
    },
    refreshStats: function () {
      if (!PANEL.out) return;
      STATS.load();
      if (PANEL.lvEl) PANEL.lvEl.textContent = BATTLE.lastLevel || '--';
      var lines = [
        '引擎: ' + (ENGINE.factoryName || '未找到'),
        '实测(真实结算): ' + STATS.rateText(STATS.real[BATTLE.lastLevel]),
        '模拟(本地推演): ' + (STATS.sim[BATTLE.lastLevel] && STATS.sim[BATTLE.lastLevel].t
          ? STATS.rateText(STATS.sim[BATTLE.lastLevel]) + '  平均回合 ' + Math.round(STATS.sim[BATTLE.lastLevel].rs / STATS.sim[BATTLE.lastLevel].t)
          : '0/0')
      ];
      PANEL.out.textContent = lines.join('\n');
    }
  };

  // ======================= 5) 动作 =======================
  var ACT = {
    start: function () {
      if (ENGINE.running) return log('模拟已在进行');
      SESSION.refresh();
      if (!BRIDGE.isReady()) return log('游戏连接未就绪, 先进入游戏');
      var times = PANEL.timesEl ? (Number(PANEL.timesEl.value) || 100) : 100;
      log('开始模拟 ' + times + ' 场...');
      PANEL.setBusy(true);
      ENGINE.simulate(times, function (done, total, wins) {
        if (PANEL.out) PANEL.out.textContent = '模拟中 ' + done + '/' + total + '  胜 ' + wins;
      }).then(function (r) {
        PANEL.setBusy(false);
        PANEL.refreshStats();
        if (r.cancelled) return log('已停止: ' + r.wins + '胜/' + r.total + '场');
        log('模拟完成: ' + r.wins + '胜/' + r.total + '场, 胜率 ' + Math.round(r.winRate * 100) + '%, 平均回合 ' + Math.round(r.avgRounds));
      }).catch(function (e) {
        PANEL.setBusy(false);
        log('模拟失败: ' + ((e && e.message) || e));
        log('提示: SimBattle.engine.probe() 查看战斗对象字段, 或 engine.registerRunner(fn) 注入单场模拟');
      });
    },
    stop: function () {
      if (!ENGINE.running) return log('没有进行中的模拟');
      ENGINE.cancel = true;
      log('停止中...');
    },
    clear: function () { STATS.reset(); log('统计已清空'); },
    probe: function () {
      PANEL.setBusy(true);
      var r = ENGINE.probe();
      PANEL.setBusy(false);
      log(r.ok ? '探测完成, battle 字段: ' + r.battleKeys.join(', ') : '探测失败: ' + r.reason);
      PANEL.refreshStats();
    },
    fetch: function () {
      SESSION.refresh();
      if (!BRIDGE.isReady()) return log('游戏连接未就绪, 先进入游戏');
      BATTLE.fetchInput().then(function () {
        PANEL.refreshStats();
        log('battleData 已就绪(关卡 ' + BATTLE.lastLevel + ', 时长 ' + BATTLE.battleTime + 's)');
      }).catch(function (e) {
        log('取战斗数据失败: ' + ((e && e.message) || e));
      });
    }
  };

  // ======================= 6) 游戏内按钮 (原: gameButton) =======================
  function mountGameButton() {
    if (document.getElementById('sim-battle-button')) return;
    ensureStyle();
    var b = document.createElement('div');
    b.id = 'sim-battle-button';
    b.textContent = '⚔ ' + SCRIPT_NAME;
    b.title = SCRIPT_NAME + ' (雪花版骨架)';
    if (CONF.get('gameButtonX', '') !== '') b.style.left = CONF.get('gameButtonX') + 'px';
    if (CONF.get('gameButtonY', '') !== '') b.style.top = CONF.get('gameButtonY') + 'px';
    b.addEventListener('click', function () { PANEL.toggle(); });
    document.body.appendChild(b);
  }

  // ======================= 7) 启动 =======================
  function boot() {
    BRIDGE.install();
    BRIDGE.startScan();

    if (CONF.get('mainPanelHookInstalled', '') === '1' && document.getElementById(PANEL_ID)) return;
    mountGameButton();
    SESSION.refresh();

    // 原脚本: playbackPanelSuppressed —— 回放/战斗中被抑制时不弹面板
    if (CONF.get('playbackPanelSuppressed', '0') !== '1') PANEL.openPanel();

    // 战斗响应统一在 WS.feed -> BATTLE.observe 捕获(calcleveltime/level), 无需额外注册;
    // gameResults 属于原 Electron 宿主的通道, 浏览器环境不存在。
    STATS.load();
    PANEL.refreshStats();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ======================= 8) 对外调试入口 =======================
  W.SimBattle = {
    panel: PANEL, conf: CONF, session: SESSION, ws: WS, act: ACT, adapter: ADAPTER, bridge: BRIDGE,
    req: REQ, engine: ENGINE, stats: STATS,
    version: '0.3.0'
  };
  log('已加载(含胜率统计), 调试入口: window.SimBattle (engine/stats/req)');
})();
