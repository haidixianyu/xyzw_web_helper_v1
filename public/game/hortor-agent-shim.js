/**
 * hortor-agent-shim.js — Hortor H5-SDK 的补齐/兜底
 *
 * 背景(2026-10-17):
 *   官方 h5web 入口页在 <head> 中先于游戏脚本加载 cdn.hortor.net/sdk/sdk_agent.min.js，
 *   启动器(launcher bundle)会调用 window.HORTOR_AGENT 的方法 —— 实测其错误恢复路径会调
 *   exitGame()。本地页面从未加载该 SDK 时 launcher 抛
 *   "TypeError: i.exitGame is not a function"，恢复流程中断，游戏卡死（黑屏/战斗界面挂起）。
 *
 *   sdk_agent.min.js 已随本目录本地化(同源文件, 无 CDN 依赖)。它在独立页面(无宿主窗口)
 *   时 Channel.build 抛错被其内部 try/catch 吞掉, 之后所有 mainCall 均为安全 no-op ——
 *   与官方独立 h5web 页行为完全一致; checkIsInHost 的登录跳转被 isInit + URL userId
 *   参数双重门控, 本环境不可能触发。
 *
 * 本脚本职责(排在 sdk_agent.min.js 之后):
 *   1. SDK 加载失败时的最小 no-op 兜底(本地文件正常不会走到);
 *   2. 补齐官方内联脚本注入的 HORTOR_AGENT.tga 与 window.__HORTOR_SDK__ 引用,
 *      避免游戏代码直接访问时报 undefined。
 *
 * 加载顺序: 必须排在所有游戏脚本之前(index.html 与 multi-game.html 均已接入)。
 */
(function () {
  "use strict";
  if (typeof window.HORTOR_AGENT !== "object" || !window.HORTOR_AGENT) {
    window.HORTOR_AGENT = {
      isInit: false,
      platForm: "web",
      _log: function () {},
      init: function (cb) {
        if (typeof cb === "function") cb(false);
      },
      mainCall: function () {},
      mainBind: function () {},
      exitGame: function () {},
      getNotchHeight: function (n) {
        if (n && typeof n === "function") n(0);
      }
    };
    console.log("[hortorAgentShim] sdk_agent.min.js 未加载, 已启用最小 no-op 兜底");
  }
  var agent = window.HORTOR_AGENT;
  if (!agent.tga) {
    agent.tga = {
      init: function () {},
      track: function () {},
      quick: function () {}
    };
  }
  if (!window.__HORTOR_SDK__) {
    window.__HORTOR_SDK__ = agent;
  }
  console.log(
    "[hortorAgentShim] HORTOR_AGENT ready, platForm =",
    agent.platForm || "web"
  );
})();
