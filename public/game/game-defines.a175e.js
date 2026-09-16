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
// manifest 拉取已与 GAME_VERSION 解耦(main.2a00e.js 固定用 android 通道值),
// 这里伪装为官方 h5web 身份, 使 clientVersion 与 platformExt=h5web 一致
// (此前 0.32.0-android + h5web 的矛盾组合疑似「客户端数据异常」弹窗来源)。
// 若登录后出现新版本/资源类报错, 改回 '0.32.0-android' 即可还原。
gt.GAME_VERSION = '1.90.3-h5web'
gt.CODE_VERSION = '2.44.2'
gt.COMMIT_ID = ''
gt.CONFIG_COMMIT_ID = ''
gt.RESOURCES_COMMIT_ID = ''
gt.DOWNLOAD_URL = ''
gt.CDNS = ['https://xxz-xyzw-res.hortorgames.com', 'https://xxz-xyzw-alires.hortorgames.com']
gt.VERSION_POSTFIX = ''
gt.BATTLE_OSS_URL = 'https://xxz-xyzw-service-battle.hortorgames.com'
