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
// 线上 manifest 实测(2026-10-04): 仅 version=0.32.0-android 返回 isLast=true 且带完整 bundleVers;
// '1.90.3-h5web'/'2.44.2-h5web' 返回的 body 既无 isLast 也无 bundleVers → 游戏侧
// IsLastVersion=false → 弹「版本异常，请下载最新版本」; '1.89.8-h5web' 有 bundleVers 但 isLast=false。
// 所以 clientVersion 必须与 manifest 请求同源(统一 0.32.0-android), platformExt 仍为 h5web(Web 端必需)。
gt.GAME_VERSION = '0.32.0-android'
gt.CODE_VERSION = '2.44.2'
gt.COMMIT_ID = ''
gt.CONFIG_COMMIT_ID = ''
gt.RESOURCES_COMMIT_ID = ''
gt.DOWNLOAD_URL = ''
gt.CDNS = ['https://xxz-xyzw-res.hortorgames.com', 'https://xxz-xyzw-alires.hortorgames.com']
gt.VERSION_POSTFIX = ''
gt.BATTLE_OSS_URL = 'https://xxz-xyzw-service-battle.hortorgames.com'
