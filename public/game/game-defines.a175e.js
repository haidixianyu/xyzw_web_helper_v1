'use strict'
const gt =
  typeof globalThis === 'object' ? globalThis : typeof window === 'object' ? window : global
gt.PLATFORM = 'h5web'
gt.SUB_PLATFORM = ''
gt.ENV = 'Prod'
gt.APPID = 'wx0840558555a454ed'
gt.APPID = ''
gt.CDN = 'https://xxz-xyzw-res.hortorgames.com'
gt.SERVER = 'https://xxz-xyzw.hortorgames.com'
gt.GAME_NAME = '咸鱼之王'
gt.GAME_ID = 'xyzw_mix'
// GAME_VERSION 与 manifest 彻底解耦(2026-10-05): /login/manifest 请求已由 manifest-override.js
// (两个 html 均首个加载)统一强制为 0.32.0-android —— 那是服务端唯一返回 isLast+完整 bundleVers 的
// 通道, 与本值无关。本值现在唯一的作用是游戏内上报给游戏服务器的 clientVersion
// (role_getinfo/getRoleInfo 等), 而「检测到您使用的客户端数据异常, 请使用官方最新客户端」弹窗是
// 服务端下发的错误文案(客户端全量代码无此句, _onWSMessage 对偶数非0 code 弹 SHOW_TIP(e.error));
// 纯手动也弹 → 判定为服务端身份核验: platform=h5web 必须搭配官方 h5web 的版本号
// (官方 h5web 线上 game-defines_1653c: GAME_VERSION='1.90.3-h5web'), 旧值 0.32.0-android 是
// 官方客户端不可能产生的组合。若弹窗依旧: 回退本值 + 依赖 ws-capture 的 <<! 条目定位真实触发 cmd。
gt.GAME_VERSION = '1.90.3-h5web'
gt.CODE_VERSION = '2.44.2'
gt.COMMIT_ID = ''
gt.CONFIG_COMMIT_ID = ''
gt.RESOURCES_COMMIT_ID = ''
gt.DOWNLOAD_URL = ''
gt.CDNS = ['https://xxz-xyzw-res.hortorgames.com', 'https://xxz-xyzw-alires.hortorgames.com']
gt.VERSION_POSTFIX = ''
gt.BATTLE_OSS_URL = 'https://xxz-xyzw-service-battle.hortorgames.com'
