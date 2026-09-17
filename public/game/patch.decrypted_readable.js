/**
 * 游戏补丁脚本（已还原）
 * 功能：保护关键游戏方法，防止恶意代码覆盖
 */

(function() {
  "use strict";

  // ========== 反调试机制（已移除）==========
  // 原实现: setInterval 每秒比较两次 new Date(), 差值 >100ms 即进入 while(true){} 死循环。
  // 本还原版不含 debugger 语句, 无法真正检测调试器, 只会在 GC 停顿/重排/复制等主线程
  // 卡顿 >100ms 时误判并永久冻结标签页(表现为"复制文字后假死"), 故整段移除。

  // ========== 工具函数 ==========
  var strings = [
    "0",
    "[Patch] define called for:",
    "[Patch] require called for:",
    "[Patch] Error executing module factory for:",
    "undefined",
    "loadAny",
    "loadBundle",
    "function",
    "",
    "function(){}",
    "[Patch] 检测到尝试禁用 ",
    ", 已拦截并保持原始功能",
    "[Patch] cc.assetManager (loadAny, loadBundle) 已保护",
    "_updateRenderData",
    "[Patch] RenderFlow._updateRenderData 已保护"
  ];

  function getString(index) {
    return strings[index];
  }

  // ========== 环境模拟 ==========
  // 模拟微信小游戏环境
  window.wx = {
    getSystemInfo() {},
    getStorageInfo() {},
    onShow(callback) {
      setTimeout(() => {
        callback({ scene: "0", query: {}, shareTicket: [] });
      }, 1000);
    },
    onHide(callback) {}
  };

  // ========== 剪贴板(H5 浏览器环境实现) ==========
  // launcher 中 PlatformH5.setClipboardData 直接调用 i.setClipboard({text}), i === window.__HORTOR_SDK__;
  // 早期垫片缺少该方法, 游戏内所有「复制」按钮点击即抛 TypeError, 异常穿透 fairygui
  // 触摸派发 → 整页卡死(已修)。当前要解决的是「提示复制成功但粘贴为空」:
  //   a. iOS Safari 对离屏(top:-9999px)/opacity:0/readonly 的临时输入框会
  //      让 execCommand('copy') 返回 true 但实际不写入剪贴板(静默失败);
  //   b. 游戏页 style-mobile.1777a.css 全局 user-select:none, iOS 可能因此拒绝建立选区;
  //   c. 游戏页跑在宿主 <iframe> 内, 未声明 allow="clipboard-write" 时异步 Clipboard API
  //      会被权限策略直接拒绝(宿主 iframe 已补该 allow)。
  // 因此采用「异步 Clipboard API + 视口内可见临时输入框 + 改写 copy 事件数据」三保险,
  // 同步 execCommand 必须在点击手势调用栈内执行; 任何异常都吞掉, 绝不向引擎抛错。
  function browserCopyText(text) {
    var str = text == null ? "" : String(text);
    if (!str) return false;

    // 1) 异步 Clipboard API(HTTPS + iOS 13.4+, iframe 内需宿主 allow="clipboard-write")
    var asyncAttempted = false;
    try {
      if (
        window.navigator &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        asyncAttempted = true;
        var p = navigator.clipboard.writeText(str);
        if (p && typeof p.catch === "function") {
          p.catch(function (e) {
            console.warn("[Patch] clipboard.writeText failed:", e);
          });
        }
      }
    } catch (e1) {
      console.warn("[Patch] clipboard.writeText threw:", e1);
    }

    // 2) 同步 execCommand(iOS 只认这条, 必须在用户手势调用栈内)
    var syncOk = false;
    var ta = null;
    var active = null;
    var sel = null;
    var ranges = [];
    try {
      active = document.activeElement;
      sel = window.getSelection ? window.getSelection() : null;
      if (sel && sel.rangeCount) {
        for (var r = 0; r < sel.rangeCount; r++) ranges.push(sel.getRangeAt(r));
      }
    } catch (e0) {}

    // 拦截 copy 事件直接写入数据: 不依赖选区内容, 是各浏览器最可靠的一条路径
    function onCopy(e) {
      try {
        if (e.clipboardData) {
          e.clipboardData.setData("text/plain", str);
          e.preventDefault();
          syncOk = true;
        } else if (window.clipboardData) {
          window.clipboardData.setData("Text", str);
          e.returnValue = false;
          syncOk = true;
        }
      } catch (e) {
        console.warn("[Patch] copy event setData failed:", e);
      }
    }

    try {
      ta = document.createElement("textarea");
      ta.value = str;
      ta.setAttribute("autocapitalize", "off");
      ta.setAttribute("autocorrect", "off");
      ta.setAttribute("spellcheck", "false");
      // 关键: 必须留在视口内且「可见」(1px + opacity 0.01), 且不能 readonly,
      // 否则 iOS Safari 会返回 true 却什么都不写入
      ta.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;margin:0;" +
        "border:0;outline:0;box-shadow:none;background:transparent;opacity:0.01;" +
        "font-size:16px;line-height:1;z-index:2147483647;" +
        "-webkit-user-select:text !important;user-select:text !important;";
      (document.body || document.documentElement).appendChild(ta);
      ta.focus();
      ta.select();
      try {
        ta.setSelectionRange(0, str.length);
      } catch (eSel) {}

      document.addEventListener("copy", onCopy, true);
      syncOk = document.execCommand("copy") || syncOk;
      document.removeEventListener("copy", onCopy, true);
    } catch (e2) {
      console.warn("[Patch] execCommand copy failed:", e2);
      try {
        document.removeEventListener("copy", onCopy, true);
      } catch (e3) {}
    } finally {
      // 异步移除: 同步移除在部分浏览器上会让写入失效
      if (ta) {
        setTimeout(function () {
          try {
            if (ta.parentNode) ta.parentNode.removeChild(ta);
          } catch (e4) {}
        }, 100);
      }
      try {
        if (active && typeof active.focus === "function") {
          active.focus({ preventScroll: true });
        }
      } catch (e5) {}
      if (sel && ranges.length) {
        try {
          sel.removeAllRanges();
          for (var k = 0; k < ranges.length; k++) sel.addRange(ranges[k]);
        } catch (e6) {}
      }
    }

    if (!syncOk) {
      console.warn(
        "[Patch] 同步复制未确认生效, 文本长度=" +
          str.length +
          ", asyncAttempted=" +
          asyncAttempted
      );
    }
    return syncOk || asyncAttempted;
  }

  function sdkSetClipboard(opts) {
    try {
      browserCopyText(opts && opts.text);
    } catch (e) {
      console.warn("[Patch] setClipboard failed:", e);
    }
  }

  function sdkGetClipboard() {
    if (
      window.navigator &&
      navigator.clipboard &&
      typeof navigator.clipboard.readText === "function"
    ) {
      return navigator.clipboard.readText().catch(function () { return ""; });
    }
    return Promise.resolve("");
  }

  // 模拟 HSDK
  window.HSDK = {
    onLogin(data) {
      setTimeout(() => {
        data.listener({ userSdk: { isNewUser: false } });
      }, 1000);
    },
    reportLoginState() {},
    onAddictionQuit() {},
    getGsSetting() { return {}; },
    setClipboard: sdkSetClipboard,
    getClipboard: sdkGetClipboard
  };

  // 模拟 HORTOR SDK
  window.__HORTOR_SDK__ = {
    tga: { track() {} },
    // PlatformH5.setClipboardData 的实际调用目标(签名 {text:string})
    setClipboard: sdkSetClipboard,
    getClipboard: sdkGetClipboard
  };

  // ========== 模块加载器 ==========
  window.define = function(name, factory) {
    console.log("[Patch] define called for:", name);
    var module = { exports: {} };
    var require = window.require || function(path) {
      console.warn("[Patch] require called for:", path);
      return {};
    };
    try {
      factory(require, module, module.exports);
    } catch (e) {
      console.error("[Patch] Error executing module factory for:", name, e);
    }
  };

  // ========== 核心保护逻辑 ==========
  // 保护 cc.assetManager
  function protectAssetManager() {
    if (typeof cc === "undefined" || !cc.assetManager) {
      // cc 还未加载，延迟重试
      setTimeout(protectAssetManager, 100);
      return;
    }

    var methodsToProtect = ["loadAny", "loadBundle"];

    methodsToProtect.forEach(function(methodName) {
      var originalMethod = cc.assetManager[methodName];
      if (!originalMethod) return;

      Object.defineProperty(cc.assetManager, methodName, {
        get: function() { return originalMethod; },
        set: function(value) {
          // 检测是否是恶意空函数
          if (typeof value === "function" && 
              value.toString().replace(/\s/g, "") === "function(){}") {
            console.warn("[Patch] 检测到尝试禁用 " + methodName + ", 已拦截并保持原始功能");
            return;
          }
          originalMethod = value;
        },
        configurable: true,
        enumerable: true
      });
    });

    console.log("[Patch] cc.assetManager (loadAny, loadBundle) 已保护");
  }

  // 保护 cc.RenderFlow
  function protectRenderFlow() {
    if (typeof cc === "undefined" || !cc.RenderFlow) {
      setTimeout(protectRenderFlow, 100);
      return;
    }

    var origUpdateRenderData = cc.RenderFlow.prototype._updateRenderData;
    if (!origUpdateRenderData) return;

    Object.defineProperty(cc.RenderFlow.prototype, "_updateRenderData", {
      get: function() { return origUpdateRenderData; },
      set: function(v) {
        if (typeof v === "function" && 
            v.toString().replace(/\s/g, "") === "function(){}") {
          console.warn("[Patch] 阻止恶意代码覆盖 cc.RenderFlow.prototype._updateRenderData");
          return;
        }
        origUpdateRenderData = v;
      },
      configurable: false
    });

    console.log("[Patch] RenderFlow._updateRenderData 已保护");
  }

  // 启动保护
  setTimeout(protectAssetManager, 100);
  setTimeout(protectRenderFlow, 200);
})();
