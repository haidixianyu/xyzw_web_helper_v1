<template>
  <div class="game-player">
    <button class="back-btn" @click="goBack">← 返回</button>

    <div class="iframe-wrapper">
      <iframe
        :src="gameSrc"
        class="game-iframe"
        allow="fullscreen; autoplay; clipboard-write"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const gameSrc = import.meta.env.BASE_URL + 'game/index.html'

function goBack() {
  router.push('/tokens')
}

// 游戏路由期间把宿主页面刷黑并锁死滚动, 避免 iOS 上 iframe 重绘白闪时露出浅色
// 背景, 或 iframe 内容把宿主页面带出滚动区域
onMounted(() => {
  document.documentElement.classList.add('xyzw-game-route')
})
onUnmounted(() => {
  document.documentElement.classList.remove('xyzw-game-route')
})
</script>

<style>
/* 非 scoped: 作用到路由根节点以外的 html/body */
html.xyzw-game-route,
html.xyzw-game-route body {
  background: #000 !important;
}
html.xyzw-game-route body {
  overflow: hidden;
  overscroll-behavior: none;
}
</style>

<style scoped>
.game-player {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: #000;
  overflow: hidden;
}

.iframe-wrapper {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #000;
}

.game-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  /* 游戏首屏样式生效前 iframe 视口默认是白底, 黑底可消除 iOS 上的白闪 */
  background: #000;
}

.back-btn {
  position: fixed;
  top: calc(8px + env(safe-area-inset-top, 0px));
  left: calc(8px + env(safe-area-inset-left, 0px));
  z-index: 1000;
  /* iOS Safari 会把重型 WebGL 的 iframe 提升为独立合成层并盖住同层兄弟节点,
     即使 z-index 更高也可能被遮; translate3d 强制返回键拥有自己的合成层 */
  transform: translate3d(0, 0, 0);
  -webkit-transform: translate3d(0, 0, 0);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.back-btn:hover {
  background: rgba(0, 0, 0, 0.7);
}

.back-btn:active {
  background: rgba(0, 0, 0, 0.8);
}
</style>
