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

  // 模拟 HSDK
  window.HSDK = {
    onLogin(data) {
      setTimeout(() => {
        data.listener({ userSdk: { isNewUser: false } });
      }, 1000);
    },
    reportLoginState() {},
    onAddictionQuit() {},
    getGsSetting() { return {}; }
  };

  // 模拟 HORTOR SDK
  window.__HORTOR_SDK__ = {
    tga: { track() {} }
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
