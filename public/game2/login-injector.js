/**
 * login-injector.js — v2 上号登录注入(修正版)。
 *
 * 目标: 解决"点击启动的账号与实际登录角色不一致(串号)"。
 *
 * 原理: v2 壳的登录链是
 *   server-switch.js 拦 login/serverlist → 提交 bin → 服务端返回该账号全部服务器,
 *   游戏会自动选择"最近在玩"的那个 → 导致登录成别的角色。
 *
 * v1 的验证结论: bin 本身就是一张完整登录凭据, 解码后含 {platformExt, info, serverId},
 * serverId 即"该账号真正要登录的目标服"。v1 靠 LoginService 注入强制 serverId 解决串号。
 *
 * v2 的正确做法(不依赖 v1 的 LoginService API):
 *   runtime-patch.js 已经在 login/authuser 请求里实现了"targetServerId 非空时, 用
 *   XXL.decryptLX + BON.decode 解码 bin → 改 serverId → 重新编码→加密→提交"的强制改写链。
 *   我们只需要解码 bin 得到真正的 serverId, 通过 GameBridge.onServerIdChange() 写入
 *   targetServerId, 让 runtime-patch 自动生效。
 *
 * 依赖: game2 自带的 assets/lx-cipher.js(window.XXL)、assets/packet-codec.js(window.BON),
 * 二者由 index.html/multi.html 在本脚本之后、boot-loader 之前同步加载, 本脚本内部轮询等待其就绪。
 * (注意: v2 没有 window.lz4, 解密必须走 window.XXL.decryptLX; LZ4 库暴露的是 window.lz4js)
 *
 * 用法(由 bridge-shim.js 调用): window.__V1LoginInjector.install(binBase64, binId)
 */
(function () {
  "use strict";
  if (window.__V1LoginInjector) return;

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[登录注入]");
    try { console.log.apply(console, args); } catch (e) {}
  }

  var injectedBinId = "";

  function base64ToBytes(binBase64) {
    var raw = atob(binBase64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  // 用 v2 自带库解码 bin: XXL.decryptLX(XOR+LZ4 解密) → BON.decode(BON 反序列化)
  function decodeBin(binBase64) {
    var XXL = window.XXL;
    var BON = window.BON;
    if (!XXL || typeof XXL.decryptLX !== "function") return { error: "window.XXL.decryptLX 未就绪" };
    if (!BON || typeof BON.decode !== "function") return { error: "window.BON.decode 未就绪" };
    var decrypted;
    try {
      decrypted = XXL.decryptLX(base64ToBytes(binBase64));
    } catch (e) {
      return { error: "decryptLX 抛出: " + (e && e.message) };
    }
    if (!decrypted || !decrypted.length) return { error: "decryptLX 返回空" };
    var info;
    try {
      info = BON.decode(decrypted);
    } catch (e) {
      return { error: "BON.decode 抛出: " + (e && e.message) };
    }
    if (!info || typeof info !== "object") return { error: "BON.decode 结果非对象: " + typeof info };
    return { info: info };
  }

  // 调试状态(供浏览器取证/browser_evaluate 读取)
  var debug = { ready: false, binId: "", serverId: null, keys: [], error: "" };

  function tryInject(binBase64, binId) {
    // XXL/BON 在本脚本之后才加载, 未就绪则继续轮询
    if (typeof window.XXL === "undefined" || typeof window.BON === "undefined") return "wait";

    var result = decodeBin(binBase64);
    if (result.error) {
      log("bin 解析失败:", result.error);
      debug.error = result.error;
      return "failed";
    }

    var info = result.info;
    var serverId = info.serverId;
    log("bin 解析成功 serverId:", serverId, "keys:", Object.keys(info).join(","));
    debug.ready = true;
    debug.binId = binId;
    debug.serverId = serverId;
    debug.keys = Object.keys(info);

    // 关键: 把 bin 真正的 serverId 写入 targetServerId 并锁定, 交给 runtime-patch 在 authuser 时强制改写。
    // 必须用 lockServerId 锁定, 否则游戏自带切服脚本(server-switch.js)会用"最近在玩"角色覆盖, 导致串号。
    var sid = (serverId === undefined || serverId === null) ? "" : String(serverId);
    if (window.GameBridge && typeof window.GameBridge.lockServerId === "function") {
      window.GameBridge.lockServerId(sid);
      log("已锁定 targetServerId =", sid || "(空: bin 无 serverId 字段)");
    } else if (window.GameBridge && typeof window.GameBridge.onServerIdChange === "function") {
      window.GameBridge.onServerIdChange(sid);
      log("已设置 targetServerId =", sid);
    } else {
      log("GameBridge 不可用, 无法设置 targetServerId");
    }

    return "ok";
  }

  window.__V1LoginInjector = {
    /**
     * @param {string} binBase64 登录 bin (base64)
     * @param {string} binId      bin 标识(日志/去重用)
     */
    install: function (binBase64, binId) {
      if (!binBase64) return;
      if (injectedBinId === binId) return;
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        var state = tryInject(binBase64, binId);
        if (state === "ok" || state === "failed") {
          // 依赖库已就绪且已实际尝试(成功或真正解码失败), 不再重试
          injectedBinId = binId;
          clearInterval(timer);
          return;
        }
        if (tries >= 600) {
          clearInterval(timer);
          log("等待 XXL/BON 就绪超时(60s), 放弃注入");
        }
      }, 100);
    },

    // 供调试取证
    _decodeBin: decodeBin,
    _debug: debug,
  };

  log("已加载, 等待 install()");
})();