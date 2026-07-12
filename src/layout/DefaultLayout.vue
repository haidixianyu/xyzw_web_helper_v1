<template>
  <div class="default-layout">
    <!-- 顶部导航 -->
    <nav class="dashboard-nav">
      <div class="nav-container">
        <div class="nav-brand">
          <img src="/icons/xiaoyugan.png" alt="XYZW" class="brand-logo" />
          <div class="brand-toggle" @click="isMobileMenuOpen = true">
            <n-icon>
              <Menu />
            </n-icon>
            <span class="brand-text">XYZW 控制台</span>
          </div>
        </div>

        <div class="nav-menu">
          <router-link
            to="/admin/dashboard"
            class="nav-item"
            active-class="active"
          >
            <n-icon>
              <Home />
            </n-icon>
            <span>首页</span>
          </router-link>
          <router-link
            to="/admin/game-features"
            class="nav-item"
            active-class="active"
          >
            <n-icon>
              <Cube />
            </n-icon>
            <span>游戏功能</span>
          </router-link>
          <router-link to="/tokens" class="nav-item" active-class="active">
            <n-icon>
              <PersonCircle />
            </n-icon>
            <span>Token管理</span>
          </router-link>
          <router-link
            to="/admin/batch-daily-tasks"
            class="nav-item"
            active-class="active"
          >
            <n-icon>
              <Layers />
            </n-icon>
            <span>批量日常</span>
          </router-link>
          <router-link
            to="/admin/message-test"
            class="nav-item"
            active-class="active"
          >
            <n-icon>
              <ChatbubbleEllipsesSharp />
            </n-icon>
            <span>消息测试</span>
          </router-link>
          <router-link to="/admin/legion-war" class="nav-item" active-class="active"  v-if="isNowInLegionWarTime()" >
            <n-icon>
              <LockOpen />
            </n-icon>
            <span>实时盐场</span>
          </router-link>
        </div>

        <div class="nav-user">
          <!-- 主题切换按钮 -->
          <ThemeToggle />

          <!-- 上一个账号 -->
          <n-tooltip placement="bottom">
            <template #trigger>
              <n-button
                quaternary
                circle
                size="small"
                :disabled="!canSwitchToken"
                @click="goPrevToken"
                class="token-switch-btn"
              >
                <n-icon>
                  <ChevronBack />
                </n-icon>
              </n-button>
            </template>
            {{ prevTokenName ? `上一个: ${prevTokenName}` : '上一个账号' }}
          </n-tooltip>

          <n-dropdown
            :options="userMenuOptions"
            scrollable
            @select="handleUserAction"
          >
            <div class="user-info">
              <n-avatar
                :src="selectedToken?.avatar || '/icons/xiaoyugan.png'"
                size="medium"
                fallback-src="/icons/xiaoyugan.png"
              />
              <div class="user-text">
                <span class="username">{{
                  selectedToken?.name || "未选择Token"
                }}</span>
                <span v-if="selectedToken?.power" class="user-power">
                  {{ formatPower(selectedToken.power) }}
                </span>
              </div>
              <n-icon>
                <ChevronDown />
              </n-icon>
            </div>
          </n-dropdown>

          <!-- 下一个账号 -->
          <n-tooltip placement="bottom">
            <template #trigger>
              <n-button
                quaternary
                circle
                size="small"
                :disabled="!canSwitchToken"
                @click="goNextToken"
                class="token-switch-btn"
              >
                <n-icon>
                  <ChevronForward />
                </n-icon>
              </n-button>
            </template>
            {{ nextTokenName ? `下一个: ${nextTokenName}` : '下一个账号' }}
          </n-tooltip>
        </div>
      </div>
    </nav>
    <n-drawer
      v-model:show="isMobileMenuOpen"
      placement="left"
      style="width: 260px"
    >
      <div class="drawer-menu">
        <router-link
          to="/admin/dashboard"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <Home />
          </n-icon>
          <span>首页</span>
        </router-link>
        <router-link
          to="/admin/game-features"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <Cube />
          </n-icon>
          <span>游戏功能</span>
        </router-link>
        <router-link
          to="/tokens"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <PersonCircle />
          </n-icon>
          <span>Token管理</span>
        </router-link>
        <router-link
          to="/admin/daily-tasks"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <Settings />
          </n-icon>
          <span>任务管理</span>
        </router-link>
        <router-link
          to="/admin/batch-daily-tasks"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <Layers />
          </n-icon>
          <span>批量日常</span>
        </router-link>
        <router-link
          to="/admin/message-test"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <ChatbubbleEllipsesSharp />
          </n-icon>
          <span>消息测试</span>
        </router-link>
          <router-link to="/admin/legion-war" class="nav-item" active-class="active"  v-if="isNowInLegionWarTime()" >
            <n-icon>
              <LockOpen />
            </n-icon>
            <span>实时盐场</span>
          </router-link>
        <router-link
          to="/admin/profile"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon>
            <Settings />
          </n-icon>
          <span>个人设置</span>
        </router-link>
      </div>
    </n-drawer>
    <div class="main">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import {
  useTokenStore,
  selectedToken,
  selectedTokenId,
  gameTokens,
} from "@/stores/tokenStore";
import ThemeToggle from "@/components/Common/ThemeToggle.vue";
import {
  Home,
  PersonCircle,
  Cube,
  Settings,
  ChevronDown,
  ChatbubbleEllipsesSharp,
  LockClosedSharp,LockOpen,
  Menu,
  Layers,
  ChevronBack,
  ChevronForward,
} from "@vicons/ionicons5";

import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { ref, computed, h } from 'vue'
import { isNowInLegionWarTime } from '@/utils/clubBattleUtils'

const tokenStore = useTokenStore();
const router = useRouter();
const message = useMessage();

const isMobileMenuOpen = ref(false);

// 格式化战斗力
const formatPower = (power) => {
  if (!power) return "0";
  const yi = 100000000;
  const wan = 10000;
  if (power >= yi) return (power / yi).toFixed(2) + "亿";
  if (power >= wan) return (power / wan).toFixed(2) + "万";
  return power.toString();
};

// 上一个/下一个账号切换
const canSwitchToken = computed(() => gameTokens.value.length > 1);

// 计算上一个/下一个账号名称（用于按钮 tooltip 显示）
const prevTokenName = computed(() => {
  const tokens = gameTokens.value;
  if (tokens.length <= 1) return null;
  const currentIndex = tokens.findIndex((t) => t.id === selectedTokenId.value);
  if (currentIndex === -1) return tokens[tokens.length - 1]?.name || null;
  const prevIndex = (currentIndex - 1 + tokens.length) % tokens.length;
  return tokens[prevIndex]?.name || null;
});

const nextTokenName = computed(() => {
  const tokens = gameTokens.value;
  if (tokens.length <= 1) return null;
  const currentIndex = tokens.findIndex((t) => t.id === selectedTokenId.value);
  if (currentIndex === -1) return tokens[0]?.name || null;
  const nextIndex = (currentIndex + 1) % tokens.length;
  return tokens[nextIndex]?.name || null;
});

const switchToken = (direction) => {
  const tokens = gameTokens.value;
  if (tokens.length <= 1) return;
  const currentIndex = tokens.findIndex(
    (t) => t.id === selectedTokenId.value,
  );
  // 未选中任何账号时，direction=-1 取最后一个，direction=1 取第一个
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : tokens.length - 1;
  } else {
    nextIndex =
      (currentIndex + direction + tokens.length) % tokens.length;
  }
  const nextToken = tokens[nextIndex];
  if (nextToken) {
    tokenStore.selectToken(nextToken.id);
  }
};

const goPrevToken = () => switchToken(-1);
const goNextToken = () => switchToken(1);

// 账号列表下拉菜单（含战力显示，支持直接跳转指定账号）
const userMenuOptions = computed(() => {
  const accountOptions = gameTokens.value.map((t) => ({
    label: () =>
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            minWidth: "200px",
            padding: "2px 0",
          },
        },
        [
          h(
            "span",
            {
              style: {
                fontWeight: selectedTokenId.value === t.id ? "600" : "400",
                color:
                  selectedTokenId.value === t.id
                    ? "var(--primary-color, #1677ff)"
                    : "inherit",
              },
            },
            t.name,
          ),
          h(
            "span",
            {
              style: {
                fontSize: "12px",
                color: "var(--text-tertiary, #999)",
                whiteSpace: "nowrap",
              },
            },
            t.power ? formatPower(t.power) : "",
          ),
        ],
      ),
    key: `select-${t.id}`,
  }));

  return [
    ...accountOptions,
    { type: "divider", key: "divider-logout" },
    { label: "清除所有Token并退出", key: "logout" },
  ];
});

// 方法
const handleUserAction = async (key) => {
  // 直接跳转到指定账号
  if (key.startsWith("select-")) {
    const tokenId = key.replace("select-", "");
    tokenStore.selectToken(tokenId);
    return;
  }
  switch (key) {
    case "logout":
      await tokenStore.clearAllTokens();
      message.success("已清除所有Token");
      router.push("/tokens");
      break;
  }
};
</script>

<style scoped lang="scss">
// 导航栏
.dashboard-nav {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  padding: 0 var(--spacing-lg);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}

.nav-container {
  display: flex;
  align-items: center;
  height: 64px;
  max-width: 1400px;
  margin: 0 auto;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-right: var(--spacing-xl);
}

.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-small);
}

.brand-text {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.brand-toggle {
  display: none;
  align-items: center;
  gap: var(--spacing-xs);
  cursor: pointer;
  font-size: var(--font-size-lg);
}

.brand-toggle .n-icon {
  font-size: inherit;
}

.nav-menu {
  display: flex;
  gap: var(--spacing-md);
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--primary-color-light);
    color: var(--primary-color);
  }
}

.nav-user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.user-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--bg-tertiary);
  }
}

.user-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
}

.username {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}

.user-power {
  font-size: 11px;
  color: var(--primary-color, #1677ff);
  font-weight: 600;
}

@media (max-width: 768px) {
  .nav-item span {
    display: none;
  }

  .nav-menu {
    display: none;
  }

  .nav-item {
    padding: var(--spacing-sm);
    flex: 0 0 auto;
  }

  .nav-container {
    height: 56px;
  }

  .brand-logo {
    display: none;
  }

  .brand-toggle {
    display: inline-flex;
  }
}

.drawer-menu {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  color: var(--text-secondary);
  text-decoration: none;
}

.drawer-item.router-link-active {
  background: var(--primary-color-light);
  color: var(--primary-color);
}

/* 禁用样式：灰化、鼠标禁止、无hover效果 */
.nav-item.disabled {
  background: #cccccc;
  color: #999999;
  cursor: not-allowed; /* 鼠标样式：禁止 */
  pointer-events: none; /* 可选：直接禁用所有鼠标事件（比阻止click更彻底） */
}
</style>

<style>
/* 账号下拉菜单：账号过多时支持滚动 */
.n-dropdown-menu {
  max-height: 400px;
}
</style>
