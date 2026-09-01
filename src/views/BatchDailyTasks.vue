<template>
  <div class="batch-daily-tasks">
    <div class="main-layout">
      <!-- Left Column -->
      <div class="left-column">
        <!-- Header -->
        <div
          class="page-header"
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
          "
        >
          <div style="display: flex; align-items: center; gap: 16px">
            <h2>批量日常任务</h2>
            <div
              style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 12px;
                background-color: #f8f9fa;
                border-radius: 8px;
                border: 1px solid #e9ecef;
              "
            >
              <div style="font-size: 14px; color: #495057">
                共 {{ scheduledTasks.length }} 个定时任务
              </div>
              <div
                v-if="shortestCountdownTask"
                style="font-size: 14px; font-weight: 500; color: #1677ff"
              >
                即将执行：{{ shortestCountdownTask.task.name }} ({{
                  shortestCountdownTask.countdown.formatted
                }})
              </div>
              <div v-else style="font-size: 14px; color: #6c757d">
                暂无定时任务
              </div>
              <div style="display: flex; gap: 8px">
                <n-button type="primary" size="small" @click="openTaskModal">
                  新增定时任务
                </n-button>
                <n-button size="small" @click="showTasksModal = true">
                  查看定时任务
                </n-button>
                <n-button size="small" @click="exportConfig">
                  导出配置
                </n-button>
                <n-upload
                  :show-file-list="false"
                  accept=".json"
                  :custom-request="importConfig"
                >
                  <n-button size="small">导入配置</n-button>
                </n-upload>
              </div>
            </div>
          </div>
          <div
            style="
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 8px 12px;
              background-color: #f8f9fa;
              border-radius: 8px;
              border: 1px solid #e9ecef;
            "
          >
            <n-button
              type="primary"
              @click="startBatch"
              :disabled="isRunning || selectedTokens.length === 0"
              size="medium"
            >
              {{ isRunning ? "执行中..." : "开始执行" }}
            </n-button>
            <n-button
              @click="stopBatch"
              :disabled="!isRunning"
              type="error"
              size="medium"
            >
              停止
            </n-button>
            <n-button
              @click="openTemplateManagerModal"
              type="info"
              size="medium"
            >
              任务模板
            </n-button>
            <n-button @click="openBatchSettings" type="default" size="medium">
              <template #icon>
                <n-icon>
                  <Settings />
                </n-icon>
              </template>
              设置
            </n-button>
          </div>
        </div>

        <!-- Token Selection -->
        <n-card class="token-list-card" style="padding: 8px 12px;">
          <template #header>
            <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
              <div style="display: flex; align-items: center; gap: 2px;">
                <span>账号列表</span>
                <n-tooltip placement="bottom">
                  <template #trigger>
                    <n-button
                      size="small"
                      quaternary
                      circle
                      @click="isAccountListCollapsed = !isAccountListCollapsed"
                    >
                      <n-icon :size="20">
                        <ChevronUp v-if="!isAccountListCollapsed" />
                        <ChevronDown v-else />
                      </n-icon>
                    </n-button>
                  </template>
                  {{ isAccountListCollapsed ? `展开全部 (${sortedTokens.length})` : '收起（仅显示已选）' }}
                </n-tooltip>
                <n-tag
                  size="medium"
                  :type="currentWeekType === '黑市周' ? 'warning' : 'info'"
                  round
                  style="margin-left: 6px; font-size: 16px; font-weight: bold;"
                >
                  {{ currentWeekType }}
                </n-tag>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <n-tooltip placement="bottom" style="display: inline-flex;">
                  <template #trigger>
                    <n-button
                      size="small"
                      type="success"
                      ghost
                      :loading="towerOverviewLoading"
                      :disabled="towerOverviewLoading || isRunning || selectedTokens.length === 0"
                      @click="fetchTowerOverview"
                    >
                      闯关信息
                      <template #icon v-if="towerOverviewLoading">
                        <n-icon style="margin-left: 4px;">
                          <Refresh />
                        </n-icon>
                      </template>
                    </n-button>
                  </template>
                  查询换皮闯关进度，标签格式：已通关数/8
                </n-tooltip>
                <n-button
                  size="small"
                  type="primary"
                  ghost
                  :loading="isRefreshingPower"
                  :disabled="isRefreshingPower || isRunning || selectedTokens.length === 0"
                  @click="refreshTokenPower"
                >
                  战力信息
                  <template #icon v-if="isRefreshingPower">
                    <n-icon style="margin-left: 4px;">
                      <Refresh />
                    </n-icon>
                  </template>
                </n-button>
                <n-button
                  size="small"
                  type="info"
                  ghost
                  :loading="shidianInfoLoading"
                  :disabled="shidianInfoLoading || isRunning || selectedTokens.length === 0"
                  @click="fetchShidianOverview"
                >
                  十殿信息
                  <template #icon v-if="shidianInfoLoading">
                    <n-icon style="margin-left: 4px;">
                      <Refresh />
                    </n-icon>
                  </template>
                </n-button>
                <n-button
                  size="small"
                  type="default"
                  ghost
                  :loading="consumptionInfoLoading"
                  :disabled="consumptionInfoLoading || isRunning || selectedTokens.length === 0"
                  @click="fetchConsumptionInfo"
                >
                  消耗信息
                  <template #icon v-if="consumptionInfoLoading">
                    <n-icon style="margin-left: 4px;">
                      <Refresh />
                    </n-icon>
                  </template>
                </n-button>
                <n-button
                  size="small"
                  type="info"
                  ghost
                  :loading="apexScheduleInfoLoading"
                  :disabled="apexScheduleInfoLoading || isRunning || selectedTokens.length === 0"
                  @click="fetchApexScheduleInfo"
                >
                  场次信息
                  <template #icon v-if="apexScheduleInfoLoading">
                    <n-icon style="margin-left: 4px;">
                      <Refresh />
                    </n-icon>
                  </template>
                </n-button>
                <n-button
                  size="small"
                  type="warning"
                  ghost
                  :loading="fullInfoLoading"
                  :disabled="fullInfoLoading || isRunning || selectedTokens.length === 0"
                  @click="fetchFullInfo"
                >
                  原始数据
                  <template #icon v-if="fullInfoLoading">
                    <n-icon style="margin-left: 4px;">
                      <Refresh />
                    </n-icon>
                  </template>
                </n-button>
              </div>
            </div>
          </template>
          <div v-if="!isAccountListCollapsed" style="margin-bottom: 16px">
            <!-- 分组管理和选择 -->
            <n-space vertical style="width: 100%">
              <!-- 分组选择部分 -->
              <div
                v-if="tokenGroups.length > 0"
                class="group-selection-section"
              >
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                  "
                >
                  <label style="font-weight: 500; color: #333">分组选择</label>
                  <n-button
                    size="small"
                    type="error"
                    text
                    @click="clearAllGroupSelection"
                  >
                    一键清除所有分组选择
                  </n-button>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap">
                  <div
                    v-for="group in tokenGroups"
                    :key="group.id"
                    draggable="true"
                    @click="toggleGroupSelection(group.id)"
                    @dragstart="onGroupDragStart(group, $event)"
                    @dragover="onGroupDragOver(group, $event)"
                    @drop.prevent="onGroupDrop(group)"
                    @dragend="onGroupDragEnd"
                    :style="{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      cursor: 'grab',
                      backgroundColor: isGroupSelected(group.id)
                        ? group.color
                        : 'transparent',
                      border: `2px solid ${group.color}`,
                      color: isGroupSelected(group.id) ? 'white' : group.color,
                      fontWeight: isGroupSelected(group.id) ? '600' : '400',
                      transition: 'all 0.3s ease',
                      userSelect: 'none',
                      opacity: draggingGroupId === group.id ? 0.4 : 1,
                      boxShadow:
                        dragOverGroupId === group.id
                          ? '0 0 0 2px rgba(64, 128, 255, 0.6)'
                          : 'none',
                    }"
                  >
                    {{ group.name }} ({{
                      getValidGroupTokenIds(group.id).length
                    }})
                  </div>
                </div>
              </div>

              <!-- 分组管理按钮 -->
              <div
                style="
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <n-space align="center" :size="8">
                  <n-button
                    type="info"
                    size="small"
                    @click="showGroupManageModal = true"
                  >
                    管理分组
                  </n-button>
                  <n-button size="small" @click="exportGroups">
                    导出分组
                  </n-button>
                  <n-button size="small" @click="importGroups">
                    导入分组
                  </n-button>
                </n-space>
                <span
                  v-if="selectedGroups.length > 0"
                  style="font-size: 12px; color: #86909c"
                >
                  已选择 {{ selectedGroups.length }} 个分组，包含
                  {{ selectedTokens.length }} 个账号
                </span>
              </div>
            </n-space>
          </div>

          <!-- 排序按钮组 -->
          <div v-if="!isAccountListCollapsed" class="sort-buttons" style="margin-bottom: 12px">
            <n-space align="center">
              <n-button-group size="small">
                <n-button
                  @click="toggleSort('name')"
                  :type="sortConfig.field === 'name' ? 'primary' : 'default'"
                >
                  名称 {{ getSortIcon("name") }}
                </n-button>
                <n-button
                  @click="toggleSort('server')"
                  :type="sortConfig.field === 'server' ? 'primary' : 'default'"
                >
                  服务器 {{ getSortIcon("server") }}
                </n-button>
                <n-button
                  @click="toggleSort('createdAt')"
                  :type="
                    sortConfig.field === 'createdAt' ? 'primary' : 'default'
                  "
                >
                  创建时间 {{ getSortIcon("createdAt") }}
                </n-button>
                <n-button
                  @click="toggleSort('lastUsed')"
                  :type="
                    sortConfig.field === 'lastUsed' ? 'primary' : 'default'
                  "
                >
                  最后使用 {{ getSortIcon("lastUsed") }}
                </n-button>
                <n-button
                  @click="toggleSort('power')"
                  :type="sortConfig.field === 'power' ? 'primary' : 'default'"
                >
                  战力 {{ getSortIcon("power") }}
                </n-button>
                <n-button
                  @click="toggleSort('group')"
                  :type="sortConfig.field === 'group' ? 'primary' : 'default'"
                >
                  分组 {{ getSortIcon("group") }}
                </n-button>
              </n-button-group>
            </n-space>
          </div>

          <!-- 收起时：只显示账号名称和状态，每行最多3个 -->
          <div
            v-if="isAccountListCollapsed"
            style="padding: 8px 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 12px; color: var(--text-secondary, #555); font-size: 14px;"
          >
            <span v-if="displayedTokens.length === 0" style="color: #999; grid-column: 1 / -1;">未选择账号</span>
            <span
              v-else
              v-for="t in displayedTokens"
              :key="t.id"
              style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
            >{{ t.name }}({{ getStatusText(t.id) }})</span>
          </div>

          <n-space v-if="!isAccountListCollapsed" vertical>
            <n-checkbox
              :checked="isAllSelected"
              :indeterminate="isIndeterminate"
              @update:checked="handleSelectAll"
            >
              全选
            </n-checkbox>
            <n-checkbox-group v-model:value="selectedTokens">
              <n-grid
                :x-gap="12"
                :y-gap="8"
                :cols="effectiveTokenListColumns"
              >
                <n-grid-item v-for="token in displayedTokens" :key="token.id">
                  <div class="token-row">
                    <n-checkbox
                      :value="token.id"
                      :label="token.name"
                      class="token-checkbox"
                    />
                    <div v-if="!isAccountListCollapsed" class="token-tags">
                      <n-tag
                        v-if="token.power != null"
                        size="small"
                        type="info"
                        :title="`战力原始值: ${token.power}`"
                      >
                        {{ formatPower(token.power) }}
                      </n-tag>
                      <n-tag
                        size="small"
                        :type="getStatusType(token.id)"
                      >
                        {{ getStatusText(token.id) }}
                      </n-tag>
                      <!-- 换皮闯关：已通关层数/8 -->
                      <n-tag
                        v-if="towerOverview[token.id]"
                        size="small"
                        :type="towerOverview[token.id].level >= 8 ? 'success' : 'default'"
                        :bordered="towerOverview[token.id].level >= 8"
                        :title="`换皮闯关今日已通关 ${towerOverview[token.id].level}/8 层`"
                      >
                        {{ towerOverview[token.id].level }}/8
                      </n-tag>
                      <!-- 显示token所属的分组 -->
                      <n-tag
                        v-for="group in tokenStore.getTokenGroups(token.id)"
                        :key="group.id"
                        size="small"
                        :color="{ color: group.color, textColor: 'white' }"
                        style="font-size: 11px"
                      >
                        {{ group.name }}
                      </n-tag>
                    </div>
                    <n-button
                      v-if="!isAccountListCollapsed"
                      size="tiny"
                      circle
                      class="token-settings-btn"
                      @click.stop="openSettings(token)"
                    >
                      <template #icon>
                        <n-icon>
                          <Settings />
                        </n-icon>
                      </template>
                    </n-button>
                  </div>
                </n-grid-item>
              </n-grid>
            </n-checkbox-group>
          </n-space>
        </n-card>

        <!-- Batch Functions -->
        <n-card title="批量功能列表" style="margin-top: 16px">
          <n-alert
            v-if="dailyReminder"
            type="warning"
            title="今日重要提示"
            style="margin-bottom: 12px"
            :show-icon="true"
          >
            {{ dailyReminder }}
          </n-alert>
          <n-tabs type="line" animated>
            <n-tab-pane name="quickDaily" tab="每日">
              <n-space vertical>
                <!-- 挂机 -->
                <n-space size="small" align="center" wrap>
                  <span class="batch-group-label">挂机</span>
                  <n-button
                    size="small"
                    @click="claimHangUpRewards"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    领取挂机
                  </n-button>
                  <span class="batch-inline-label">加钟次数</span>
                  <n-input-number
                    v-model:value="hangUpAddTimes"
                    size="small"
                    :min="0"
                    :max="10"
                    :step="1"
                    class="batch-count-input"
                  />
                  <n-button
                    size="small"
                    @click="batchAddHangUpTime"
                    :disabled="isRunning || selectedTokens.length === 0 || hangUpAddTimes === 0"
                  >
                    一键加钟
                  </n-button>
                </n-space>

                <!-- 罐子与闯关 -->
                <n-space size="small" align="center" wrap>
                  <span class="batch-group-label">罐子·闯关</span>
                  <n-button
                    size="small"
                    @click="resetBottles"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    重置罐子
                  </n-button>
                  <n-button
                    size="small"
                    @click="skinChallenge"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    换皮闯关
                  </n-button>
                  <n-button
                    size="small"
                    @click="claimSkinChallengeRewards"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    领取闯关奖励
                  </n-button>
                  <n-button
                    size="small"
                    @click="batchLegacyClaim"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    功法券领取
                  </n-button>
                </n-space>

                <!-- 竞猜与十殿 -->
                <n-space size="small" align="center" wrap>
                  <span class="batch-group-label">竞猜·十殿</span>
                  <n-popselect
                    :value="footballPick"
                    :options="footballPickOptions"
                    trigger="click"
                    @update:value="onFootballPickChange"
                  >
                    <n-button
                      size="small"
                      :disabled="isRunning || selectedTokens.length === 0"
                    >
                      一键竞猜({{ footballPickLabel }})
                    </n-button>
                  </n-popselect>
                  <n-button
                    size="small"
                    :disabled="isRunning || selectedTokens.length === 0"
                    @click="batchApexGuess(apexScheduleId)"
                  >
                    逐鹿盐山竞猜
                  </n-button>
                  <n-input-number
                    v-model:value="apexScheduleId"
                    size="small"
                    :min="0"
                    :max="999"
                    :step="1"
                    class="batch-count-input"
                  />
                  <n-button
                    size="small"
                    :disabled="isRunning || selectedTokens.length === 0"
                    @click="batchShidianReward"
                  >
                    十殿转盘
                  </n-button>
                </n-space>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="quickMon" tab="周一">
              <n-space>
                <n-button
                  size="small"
                  @click="batchStudy"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键答题
                </n-button>
                <n-button
                  size="small"
                  @click="legion_storebuygoods"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  四圣碎片
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="quickTue" tab="周二">
              <n-space>
                <n-button
                  size="small"
                  @click="batchStudy"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键答题
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="quickWed" tab="周三">
              <n-space>
                <n-button
                  size="small"
                  @click="batchStudy"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键答题
                </n-button>
                <n-button
                  size="small"
                  @click="batchBuyDreamItems"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  梦境商品
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="quickSun" tab="周日">
              <n-space>
                <n-button
                  size="small"
                  @click="batchBuyDreamItems"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  梦境商品
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="weirdTower" tab="怪异塔">
              <n-space>
                <n-input-number
                  v-model:value="weirdTowerMaxClimb"
                  class="weird-tower-count-input"
                  size="small"
                  :min="1"
                  :precision="0"
                  :show-button="false"
                  placeholder="次数"
                  :disabled="isRunning"
                />
                <span class="weird-tower-count-unit">次</span>
                <n-button
                  size="small"
                  @click="climbWeirdTower"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键爬怪异塔
                </n-button>
                <n-button
                  size="small"
                  @click="batchUseItems"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键使用怪异塔道具
                </n-button>
                <n-button
                  size="small"
                  @click="batchMergeItems"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键怪异塔合成
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimFreeEnergy"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isWeirdTowerActivityOpen
                  "
                >
                  一键领取怪异塔免费道具
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="daily" tab="日常">
              <n-space>
                <!-- 领取挂机
                <n-button
                  size="small"
                  @click="claimHangUpRewards"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  领取挂机
                </n-button>
                一键加钟
                <n-button
                  size="small"
                  @click="batchAddHangUpTime"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键加钟
                </n-button>
                -->

                <n-button
                  size="small"
                  @click="batchFightBoss"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键打BOSS
                </n-button>
                <!-- 重置罐子
                <n-button
                  size="small"
                  @click="resetBottles"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  重置罐子
                </n-button>
                一键领取罐子
                <n-button
                  size="small"
                  @click="batchlingguanzi"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键领取罐子
                </n-button>
                -->
                <n-button
                  size="small"
                  @click="batchclubsign"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键俱乐部签到
                </n-button>
                <!-- 一键答题
                <n-button
                  size="small"
                  @click="batchStudy"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键答题
                </n-button>
                -->
                <n-button
                  size="small"
                  @click="batcharenafight"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isarenaActivityOpen
                  "
                >
                  一键竞技场战斗3次
                </n-button>
                <!-- 智能发车 一键收车
                <n-button
                  size="small"
                  @click="batchSmartSendCar"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isCarActivityOpen
                  "
                >
                  智能发车
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimCars"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键收车
                </n-button>
                -->
                <n-button
                  size="small"
                  @click="store_purchase"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键黑市采购
                </n-button>
                <n-button
                  size="small"
                  @click="collection_claimfreereward"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键领取珍宝阁
                </n-button>
                <n-button
                  size="small"
                  @click="batchGenieSweep"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键灯神扫荡
                </n-button>
                <n-popselect
                  :value="campChallengeMode"
                  :options="campChallengeModeOptions"
                  trigger="click"
                  @update:value="onCampChallengeModeChange"
                >
                  <n-button
                    size="small"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    营地挑战({{ campChallengeModeLabel }})
                  </n-button>
                </n-popselect>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="dungeon" tab="副本">
              <n-space>
                <n-button
                  size="small"
                  @click="climbTower"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键爬塔
                </n-button>
                <n-button
                  size="small"
                  @click="batchmengjing"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  一键梦境
                </n-button>
                <n-button
                  size="small"
                  @click="skinChallenge"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键换皮闯关
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimPeachTasks"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键领取蟠桃园任务
                </n-button>
                <n-button
                  size="small"
                  @click="batchSmartSendCar"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isCarActivityOpen
                  "
                >
                  智能发车
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimCars"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键收车
                </n-button>
                <n-button
                  size="small"
                  @click="batchBuyDreamItems"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !ismengjingActivityOpen
                  "
                >
                  一键购买梦境商品
                </n-button>
                <n-popselect
                  :value="footballPick"
                  :options="footballPickOptions"
                  trigger="click"
                  @update:value="onFootballPickChange"
                >
                  <n-button
                    size="small"
                    :disabled="isRunning || selectedTokens.length === 0"
                  >
                    一键竞猜({{ footballPickLabel }})
                  </n-button>
                </n-popselect>
              </n-space>
            </n-tab-pane>
            <!-- 宝库 tab
            <n-tab-pane name="baoku" tab="宝库">
              <n-space>
                <n-button
                  size="small"
                  @click="batchbaoku13"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isbaokuActivityOpen
                  "
                >
                  一键宝库前3层
                </n-button>
                <n-button
                  size="small"
                  @click="batchbaoku45"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isbaokuActivityOpen
                  "
                >
                  一键宝库4,5层
                </n-button>
              </n-space>
            </n-tab-pane>
            -->
            <n-tab-pane name="resource" tab="资源">
              <n-space>
                <n-button
                  size="small"
                  @click="openHelperModal('box')"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  批量开箱
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('pointsBox')"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  按积分开箱
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimBoxPointReward"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  领取宝箱积分
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('fish')"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  批量钓鱼
                </n-button>
                <n-button
                  size="small"
                  @click="openHelperModal('recruit')"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  批量招募
                </n-button>
                <n-button
                  size="small"
                  @click="batchHeroUpgrade"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键英雄升星
                </n-button>
                <n-button
                  size="small"
                  @click="batchBookUpgrade"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键图鉴升星
                </n-button>
                <n-button
                  size="small"
                  @click="batchClaimStarRewards"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键领取图鉴奖励
                </n-button>
                <n-button
                  size="small"
                  @click="legion_storebuygoods"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键购买四圣碎片
                </n-button>
                <n-button
                  size="small"
                  @click="legionStoreBuySkinCoins"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键购买俱乐部5皮肤币
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="legacy" tab="功法">
              <n-space>
                <n-button
                  size="small"
                  @click="batchLegacyClaim"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  批量功法残卷领取
                </n-button>
                <n-button
                  size="small"
                  @click="showLegacyGiftModal = true"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  批量功法残卷赠送
                </n-button>
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="monthly" tab="月度">
              <n-space>
                <n-button
                  size="small"
                  @click="batchTopUpFish"
                  :disabled="isRunning || selectedTokens.length === 0"
                >
                  一键钓鱼补齐
                </n-button>
                <n-button
                  size="small"
                  @click="batchTopUpArena"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isarenaActivityOpen
                  "
                >
                  一键竞技场补齐
                </n-button>
                <n-button
                  size="small"
                  @click="openWarGuessModal"
                  :disabled="
                    isRunning ||
                    selectedTokens.length === 0 ||
                    !isWarGuessActivityOpen
                  "
                  :title="isWarGuessActivityOpen ? '' : warGuessActivityTip"
                >
                  月赛助威
                </n-button>
              </n-space>
            </n-tab-pane>
          </n-tabs>
        </n-card>
      </div>

      <!-- Right Column - Execution Log -->
      <div class="right-column">
        <n-card class="log-card">
          <template #header>
            <div class="custom-card-header">
              <div class="card-title">
                {{
                  currentRunningTokenName
                    ? `正在执行: ${currentRunningTokenName}`
                    : "执行日志"
                }}
                <span
                  style="margin-left: 12px; font-size: 12px; color: #86909c"
                >
                  {{ logs.length }}/{{ batchSettings.maxLogEntries || 1000 }}
                </span>
              </div>
              <div class="log-header-controls">
                <n-checkbox v-model:checked="autoScrollLog" size="small">
                  自动滚动
                </n-checkbox>
                <n-checkbox v-model:checked="filterErrorsOnly" size="small">
                  只看错误
                </n-checkbox>
                <n-tag v-if="errorCount > 0" type="error" size="small">
                  {{ errorCount }} 个错误
                </n-tag>
                <n-button size="small" @click="clearLogs"> 清空日志 </n-button>
                <n-button size="small" @click="copyLogs"> 复制日志 </n-button>
              </div>
            </div>
          </template>
          <div class="progress-wrapper">
            <n-tooltip placement="top" :disabled="completedTokenNames.length === 0">
              <template #trigger>
                <n-progress
                  type="line"
                  :percentage="batchProgressPercentage"
                  :indicator-placement="'inside'"
                  :status="isRunning ? 'default' : (batchProgressPercentage === 100 ? 'success' : 'default')"
                />
              </template>
              <div style="max-height: 300px; overflow-y: auto; white-space: nowrap;">
                <div style="margin-bottom: 4px; font-weight: 600;">
                  已完成 {{ completedTokenCount }}/{{ selectedTokens.length }}：
                </div>
                <div v-for="name in completedTokenNames" :key="name" style="line-height: 1.6;">
                  {{ name }}
                </div>
              </div>
            </n-tooltip>
            <span class="progress-text">
              {{ completedTokenCount }}/{{ selectedTokens.length }} 账号
            </span>
          </div>
          <div class="log-container" ref="logContainer">
            <div
              v-for="(log, index) in filteredLogs"
              :key="index"
              class="log-item"
              :class="log.type"
            >
              <span class="time">{{ log.time }}</span>
              <span class="message">{{ log.message }}</span>
            </div>
          </div>
        </n-card>
      </div>
    </div>

    <!-- Settings Modal -->
    <n-modal
      v-model:show="showSettingsModal"
      preset="card"
      :title="`任务设置 - ${currentSettingsTokenName}`"
      style="width: 90%; max-width: 400px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <div class="setting-item">
            <label class="setting-label">竞技场阵容</label>
            <n-select
              v-model:value="currentSettings.arenaFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">爬塔阵容</label>
            <n-select
              v-model:value="currentSettings.towerFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">BOSS阵容</label>
            <n-select
              v-model:value="currentSettings.bossFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">BOSS次数</label>
            <n-select
              v-model:value="currentSettings.bossTimes"
              :options="bossTimesOptions"
              size="small"
            />
          </div>
          <div class="setting-switches">
            <div class="switch-row">
              <span class="switch-label">领罐子</span
              ><n-switch v-model:value="currentSettings.claimBottle" />
            </div>
            <div class="switch-row">
              <span class="switch-label">领挂机</span
              ><n-switch v-model:value="currentSettings.claimHangUp" />
            </div>
            <div class="switch-row">
              <span class="switch-label">竞技场</span
              ><n-switch v-model:value="currentSettings.arenaEnable" />
            </div>
            <div class="switch-row">
              <span class="switch-label">开宝箱</span
              ><n-switch v-model:value="currentSettings.openBox" />
            </div>
            <div class="switch-row">
              <span class="switch-label">领取邮件奖励</span
              ><n-switch v-model:value="currentSettings.claimEmail" />
            </div>
            <div class="switch-row">
              <span class="switch-label">黑市购买物品</span
              ><n-switch v-model:value="currentSettings.blackMarketPurchase" />
            </div>
            <div class="switch-row">
              <span class="switch-label">付费招募</span
              ><n-switch v-model:value="currentSettings.payRecruit" />
            </div>
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button type="primary" @click="saveSettings">保存设置</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Task Template Modal -->
    <n-modal
      v-model:show="showTaskTemplateModal"
      preset="card"
      :title="currentTemplateId ? '编辑任务模板' : '任务模板设置'"
      style="width: 90%; max-width: 400px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <div class="setting-item">
            <label class="setting-label">模板名称</label>
            <n-input
              v-model:value="currentTemplateName"
              placeholder="请输入模板名称"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">竞技场阵容</label>
            <n-select
              v-model:value="currentTemplate.arenaFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">爬塔阵容</label>
            <n-select
              v-model:value="currentTemplate.towerFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">BOSS阵容</label>
            <n-select
              v-model:value="currentTemplate.bossFormation"
              :options="formationOptions"
              size="small"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">BOSS次数</label>
            <n-select
              v-model:value="currentTemplate.bossTimes"
              :options="bossTimesOptions"
              size="small"
            />
          </div>
          <div class="setting-switches">
            <div class="switch-row">
              <span class="switch-label">领罐子</span
              ><n-switch v-model:value="currentTemplate.claimBottle" />
            </div>
            <div class="switch-row">
              <span class="switch-label">领挂机</span
              ><n-switch v-model:value="currentTemplate.claimHangUp" />
            </div>
            <div class="switch-row">
              <span class="switch-label">竞技场</span
              ><n-switch v-model:value="currentTemplate.arenaEnable" />
            </div>
            <div class="switch-row">
              <span class="switch-label">开宝箱</span
              ><n-switch v-model:value="currentTemplate.openBox" />
            </div>
            <div class="switch-row">
              <span class="switch-label">领取邮件奖励</span
              ><n-switch v-model:value="currentTemplate.claimEmail" />
            </div>
            <div class="switch-row">
              <span class="switch-label">黑市购买物品</span
              ><n-switch v-model:value="currentTemplate.blackMarketPurchase" />
            </div>
            <div class="switch-row">
              <span class="switch-label">付费招募</span
              ><n-switch v-model:value="currentTemplate.payRecruit" />
            </div>
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button
            @click="showTaskTemplateModal = false"
            style="margin-right: 12px"
            >取消</n-button
          >
          <n-button @click="saveTaskTemplate" type="primary">保存模板</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Apply Template Modal -->
    <n-modal
      v-model:show="showApplyTemplateModal"
      preset="card"
      title="应用任务模板"
      style="width: 90%; max-width: 600px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <div class="setting-item">
            <label class="setting-label">选择模板</label>
            <n-select
              v-model:value="selectedTemplateId"
              :options="taskTemplates"
              label-field="name"
              value-field="id"
              placeholder="请选择要应用的模板"
              size="small"
              style="width: 100%"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">选择账号</label>

            <!-- 分组快速选择 -->
            <div
              style="
                margin-bottom: 12px;
                border-bottom: 1px solid #eee;
                padding-bottom: 8px;
              "
            >
              <div style="font-size: 12px; color: #86909c; margin-bottom: 8px">
                快速选择分组：
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap">
                <n-button
                  v-for="group in tokenGroups"
                  :key="group.id"
                  size="small"
                  @click="
                    () => {
                      const groupTokenIds = getValidGroupTokenIds(group.id);
                      groupTokenIds.forEach((id) => {
                        if (!selectedTokensForApply.includes(id)) {
                          selectedTokensForApply.push(id);
                        }
                      });
                    }
                  "
                  :style="{
                    borderColor: group.color,
                    color: group.color,
                  }"
                  ghost
                >
                  {{ group.name }}
                </n-button>
                <div
                  v-if="tokenGroups.length === 0"
                  style="font-size: 12px; color: #ccc"
                >
                  暂无分组
                </div>
              </div>
            </div>

            <n-checkbox
              :checked="isAllSelectedForApply"
              :indeterminate="isIndeterminateForApply"
              @update:checked="handleSelectAllForApply"
            >
              全选
            </n-checkbox>
            <n-checkbox-group
              v-model:value="selectedTokensForApply"
              style="margin-top: 8px"
            >
              <n-grid :cols="2" :x-gap="12" :y-gap="8">
                <n-grid-item v-for="token in sortedTokens" :key="token.id">
                  <n-checkbox :value="token.id">{{ token.name }}</n-checkbox>
                </n-grid-item>
              </n-grid>
            </n-checkbox-group>
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showApplyTemplateModal = false">取消</n-button>
          <n-button
            @click="applyTemplate"
            type="success"
            :disabled="
              !selectedTemplateId || selectedTokensForApply.length === 0
            "
            >应用模板</n-button
          >
        </div>
      </div>
    </n-modal>

    <!-- Template Manager Modal -->
    <n-modal
      v-model:show="showTemplateManagerModal"
      preset="card"
      title="任务模板管理"
      style="width: 90%; max-width: 800px"
    >
      <div class="settings-content">
        <div
          class="modal-header-actions"
          style="
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div>
            <n-button type="primary" @click="openNewTemplateModal"
              >新增模板</n-button
            >
            <n-button
              @click="openApplyTemplateModal"
              type="success"
              style="margin-left: 8px"
              >应用模板</n-button
            >
            <n-button
              @click="openAccountTemplateModal"
              type="info"
              style="margin-left: 8px"
              >查看账号模板引用</n-button
            >
          </div>
          <n-input placeholder="搜索模板" size="small" style="width: 200px" />
        </div>

        <!-- Template List -->
        <div
          class="template-list"
          style="max-height: 400px; overflow-y: auto; margin-bottom: 16px"
        >
          <n-card
            v-for="template in filteredTaskTemplates"
            :key="template.id"
            size="small"
            style="margin-bottom: 12px"
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
              "
            >
              <div>
                <h4 style="margin: 0; margin-bottom: 8px">
                  {{ template.name }}
                </h4>
                <div style="font-size: 12px; color: #86909c">
                  创建时间: {{ new Date(template.createdAt).toLocaleString() }}
                  <span v-if="template.updatedAt"
                    >, 更新时间:
                    {{ new Date(template.updatedAt).toLocaleString() }}</span
                  >
                </div>
              </div>
              <div style="display: flex; gap: 8px">
                <n-button size="small" @click="openEditTemplateModal(template)"
                  >编辑</n-button
                >
                <n-button
                  size="small"
                  type="error"
                  @click="deleteTaskTemplate(template.id)"
                  >删除</n-button
                >
              </div>
            </div>
          </n-card>
          <div
            v-if="filteredTaskTemplates.length === 0"
            style="text-align: center; padding: 24px; color: #86909c"
          >
            暂无模板
          </div>
        </div>

        <!-- Actions -->
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showTemplateManagerModal = false">关闭</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Account Template References Modal -->
    <n-modal
      v-model:show="showAccountTemplateModal"
      preset="card"
      title="账号模板引用查看"
      style="width: 90%; max-width: 800px"
    >
      <div class="settings-content">
        <div
          class="modal-header-actions"
          style="
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div>
            <span>共 {{ filteredAccountTemplates.length }} 个账号</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <label style="font-size: 12px; color: #86909c">按模板筛选:</label>
            <n-select
              v-model:value="selectedTemplateForFilter"
              :options="taskTemplates"
              label-field="name"
              value-field="id"
              placeholder="全部模板"
              size="small"
              @update:value="filterAccountTemplates"
              style="width: 180px"
            />
          </div>
        </div>

        <!-- Account Template List -->
        <div
          class="account-template-list"
          style="max-height: 400px; overflow-y: auto; margin-bottom: 16px"
        >
          <n-card
            v-for="item in filteredAccountTemplates"
            :key="item.tokenId"
            size="small"
            style="margin-bottom: 12px"
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
              "
            >
              <div>
                <h4 style="margin: 0; margin-bottom: 4px">
                  {{ item.tokenName }}
                </h4>
              </div>
              <div>
                <n-tag
                  :type="item.templateId ? 'success' : 'default'"
                  size="small"
                >
                  {{ item.templateName }}
                </n-tag>
              </div>
            </div>
          </n-card>
          <div
            v-if="filteredAccountTemplates.length === 0"
            style="text-align: center; padding: 24px; color: #86909c"
          >
            暂无账号数据
          </div>
        </div>

        <!-- Actions -->
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showAccountTemplateModal = false">关闭</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Legacy Gift Modal -->
    <n-modal
      v-model:show="showLegacyGiftModal"
      preset="card"
      title="批量功法残卷赠送"
      style="width: 90%; max-width: 600px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <!-- 接收者ID输入 -->
          <div class="setting-item">
            <label class="setting-label">接收者ID</label>
            <n-space>
              <n-input-number
                v-model:value="recipientIdInput"
                placeholder="ID"
                :show-button="false"
                @update:value="clearRecipientError"
                style="width: 180px"
              />
              <n-input
                v-model:value="securityPassword"
                placeholder="请输入安全密码"
                type="password"
                @input="clearRecipientError"
                style="width: 180px"
              />
              <n-button
                type="primary"
                @click="queryRecipientInfo"
                :disabled="
                  !recipientIdInput || isQueryingRecipient || !securityPassword
                "
              >
                查询
              </n-button>
            </n-space>
            <n-text
              v-if="recipientIdError"
              type="error"
              style="margin-top: 5px; display: block"
            >
              {{ recipientIdError }}
            </n-text>
          </div>

          <!-- 接收者信息展示 -->
          <div class="setting-item" v-if="recipientInfo">
            <label class="setting-label">接收者信息</label>
            <div
              class="recipient-info"
              style="
                background: #f7f8fa;
                padding: 16px;
                border-radius: 8px;
                border: 1px solid #e5e7eb;
                display: flex;
                align-items: flex-start;
                gap: 16px;
                transition: all 0.3s ease;
              "
            >
              <!-- 头像部分 -->
              <div
                class="avatar-container"
                style="
                  position: relative;
                  width: 80px;
                  height: 80px;
                  border-radius: 50%;
                  overflow: hidden;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  transition: all 0.3s ease;
                "
              >
                <img
                  v-if="recipientInfo.avatarUrl && !avatarLoadError"
                  :src="recipientInfo.avatarUrl"
                  alt="角色头像"
                  style="
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: all 0.3s ease;
                  "
                  @error="handleAvatarError"
                  @load="handleAvatarLoad"
                />
                <!-- 头像加载失败或未设置时的 fallback -->
                <div
                  v-else
                  class="avatar-fallback"
                  style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    color: white;
                    font-size: 24px;
                    font-weight: bold;
                    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                  "
                >
                  {{ (recipientInfo.name || "未知角色")[0] || "?" }}
                </div>
                <!-- 加载指示器 -->
                <div
                  v-if="isAvatarLoading"
                  class="avatar-loading"
                  style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                  "
                >
                  <div
                    class="loading-spinner"
                    style="
                      width: 30px;
                      height: 30px;
                      border: 3px solid rgba(255, 255, 255, 0.3);
                      border-top: 3px solid white;
                      border-radius: 50%;
                      animation: spin 1s linear infinite;
                    "
                  ></div>
                </div>
              </div>

              <!-- 角色信息部分 -->
              <div class="role-info" style="flex: 1; min-width: 0">
                <div
                  style="
                    margin-bottom: 12px;
                    font-size: 18px;
                    font-weight: bold;
                    color: #1d2129;
                    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                  "
                >
                  {{ recipientInfo.name || "未知角色" }}
                </div>
                <div
                  class="role-info-grid"
                  style="
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                  "
                >
                  <div class="info-item">
                    <div
                      class="info-label"
                      style="
                        font-size: 12px;
                        color: #86909c;
                        margin-bottom: 2px;
                      "
                    >
                      角色ID
                    </div>
                    <div
                      class="info-value"
                      style="font-size: 14px; font-weight: 500; color: #1d2129"
                    >
                      {{ recipientInfo.roleId }}
                    </div>
                  </div>
                  <div class="info-item">
                    <div
                      class="info-label"
                      style="
                        font-size: 12px;
                        color: #86909c;
                        margin-bottom: 2px;
                      "
                    >
                      服务器
                    </div>
                    <div
                      class="info-value"
                      style="font-size: 14px; font-weight: 500; color: #1d2129"
                    >
                      {{ recipientInfo.serverName }}
                    </div>
                  </div>
                  <div class="info-item">
                    <div
                      class="info-label"
                      style="
                        font-size: 12px;
                        color: #86909c;
                        margin-bottom: 2px;
                      "
                    >
                      战力
                    </div>
                    <div
                      class="info-value"
                      style="font-size: 16px; font-weight: 600; color: #667eea"
                    >
                      {{ recipientInfo.power }} {{ recipientInfo.powerUnit }}
                    </div>
                  </div>
                  <div class="info-item">
                    <div
                      class="info-label"
                      style="
                        font-size: 12px;
                        color: #86909c;
                        margin-bottom: 2px;
                      "
                    >
                      军团
                    </div>
                    <div
                      class="info-value"
                      style="font-size: 14px; font-weight: 500; color: #1d2129"
                    >
                      {{ recipientInfo.legionName || "无" }}
                    </div>
                  </div>
                  <div class="info-item" style="grid-column: 1 / -1">
                    <div
                      class="info-label"
                      style="
                        font-size: 12px;
                        color: #86909c;
                        margin-bottom: 2px;
                      "
                    >
                      军团ID
                    </div>
                    <div
                      class="info-value"
                      style="font-size: 14px; font-weight: 500; color: #1d2129"
                    >
                      {{ recipientInfo.legionId || "无" }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 赠送数量 -->
          <div class="setting-item">
            <label class="setting-label">赠送数量</label>
            <n-input-number
              v-model:value="giftQuantity"
              :min="1"
              :max="1000"
              :step="1"
              placeholder="请输入赠送数量"
            />
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button
            @click="showLegacyGiftModal = false"
            style="margin-right: 12px"
            >取消</n-button
          >
          <n-button
            type="primary"
            @click="confirmLegacyGift"
            :disabled="!recipientIdInput || !recipientInfo"
          >
            开始赠送
          </n-button>
        </div>
      </div>
    </n-modal>

    <!-- Helper Modal (开箱/钓鱼/招募/按积分开箱) -->
    <n-modal
      v-model:show="showHelperModal"
      preset="card"
      :title="helperModalTitle"
      style="width: 90%; max-width: 400px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <div class="setting-item" v-if="helperType === 'box'">
            <label class="setting-label">宝箱类型</label>
            <n-select
              v-model:value="helperSettings.boxType"
              :options="boxTypeOptions"
              size="small"
            />
          </div>
          <div class="setting-item" v-if="helperType === 'fish'">
            <label class="setting-label">鱼竿类型</label>
            <n-select
              v-model:value="helperSettings.fishType"
              :options="fishTypeOptions"
              size="small"
            />
          </div>
          <div class="setting-item" v-if="helperType === 'pointsBox'">
            <label class="setting-label">目标积分</label>
            <n-input-number
              v-model:value="helperSettings.targetPoints"
              :min="1"
              :max="1000000"
              :step="100"
              size="small"
              style="width: 100%"
            />
          </div>
          <n-alert
            v-if="helperType === 'pointsBox'"
            type="info"
            style="margin-bottom: 12px"
          >
            开箱优先级: 木质宝箱(保留200个) → 青铜宝箱 → 黄金宝箱 → 铂金宝箱<br />
            积分: 木质=1分, 青铜=10分, 黄金=20分, 铂金=50分
          </n-alert>
          <div class="setting-item" v-if="helperType !== 'pointsBox'">
            <label class="setting-label">消耗数量（10的倍数）</label>
            <n-input-number
              v-model:value="helperSettings.count"
              :min="10"
              :max="10000"
              :step="10"
              size="small"
            />
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showHelperModal = false" style="margin-right: 12px"
            >取消</n-button
          >
          <n-button type="primary" @click="executeHelper">开始执行</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Dream Buy Modal -->
    <n-modal
      v-model:show="showDreamBuyModal"
      preset="card"
      title="梦境商品购买配置"
      style="width: 90%; max-width: 600px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <n-alert type="info" show-icon style="margin-bottom: 12px">
            请勾选需要购买的商品。只会购买列表中存在的商品。
          </n-alert>

          <div style="display: flex; gap: 12px; margin-bottom: 12px">
            <n-button size="small" type="warning" @click="selectGoldItems">
              一键勾选金币商品
            </n-button>
            <n-button size="small" @click="selectAllItems"> 全选所有 </n-button>
            <n-button size="small" @click="clearAllItems"> 清空选择 </n-button>
          </div>

          <div
            v-for="(merchant, id) in merchantConfig"
            :key="id"
            style="margin-bottom: 16px"
          >
            <div style="font-weight: bold; margin-bottom: 8px">
              {{ merchant.name }}
            </div>
            <n-grid :cols="3" :x-gap="12" :y-gap="8">
              <n-grid-item v-for="(item, index) in merchant.items" :key="index">
                <n-checkbox
                  :value="`${id}-${index}`"
                  :checked="dreamBuyList.includes(`${id}-${index}`)"
                  @update:checked="
                    (checked) => toggleDreamItem(`${id}-${index}`, checked)
                  "
                >
                  {{ item }}
                </n-checkbox>
              </n-grid-item>
            </n-grid>
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button
            @click="showDreamBuyModal = false"
            style="margin-right: 12px"
            >取消</n-button
          >
          <n-button type="primary" @click="saveDreamBuyConfig"
            >保存配置</n-button
          >
        </div>
      </div>
    </n-modal>

    <!-- Tasks List Modal -->
    <n-modal
      v-model:show="showTasksModal"
      preset="card"
      title="定时任务列表"
      style="width: 90%; max-width: 800px"
    >
      <div class="tasks-list" style="max-height: 600px; overflow-y: auto">
        <div
          v-for="task in scheduledTasks"
          :key="task.id"
          class="task-item"
          style="
            margin-bottom: 16px;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
          "
        >
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            "
          >
            <div style="font-weight: bold">{{ task.name }}</div>
            <n-switch
              v-model:value="task.enabled"
              @update:value="toggleTaskEnabled(task.id, $event)"
            >
            </n-switch>
          </div>
          <div style="margin-bottom: 4px">
            <span style="color: #6b7280">运行类型：</span>
            <span>{{
              task.runType === "daily" ? "每天固定时间" : "Cron表达式"
            }}</span>
          </div>
          <div style="margin-bottom: 4px">
            <span style="color: #6b7280">运行时间：</span>
            <span>{{
              task.runType === "daily" ? task.runTime : task.cronExpression
            }}</span>
          </div>
          <div style="margin-bottom: 4px">
            <span style="color: #6b7280">下次执行：</span>
            <span
              :style="{
                fontWeight: 'bold',
                color: taskCountdowns[task.id]?.isNearExecution
                  ? '#ff4d4f'
                  : '#1677ff',
              }"
            >
              {{
                task.enabled
                  ? taskCountdowns[task.id]?.formatted || "计算中..."
                  : "已禁用"
              }}
            </span>
          </div>
          <div style="margin-bottom: 4px">
            <span style="color: #6b7280">选中账号：</span>
            <span>{{ task.selectedTokens.length }} 个</span>
          </div>
          <div style="margin-bottom: 8px">
            <span style="color: #6b7280">选中任务：</span>
            <span>{{ task.selectedTasks.length }} 个</span>
          </div>
          <div style="display: flex; gap: 8px">
            <n-button size="tiny" @click="editTask(task)"> 编辑 </n-button>
            <n-button size="tiny" type="error" @click="deleteTask(task.id)">
              删除
            </n-button>
            <n-button
              size="tiny"
              type="info"
              secondary
              :loading="executingTaskIds.includes(task.id)"
              @click="manualExecuteTask(task)"
            >
              立即执行
            </n-button>
          </div>
        </div>
        <div
          v-if="scheduledTasks.length === 0"
          style="text-align: center; padding: 24px; color: #6b7280"
        >
          暂无定时任务
        </div>
      </div>
    </n-modal>

    <!-- Task Modal -->
    <n-modal
      v-model:show="showTaskModal"
      preset="card"
      :title="editingTask ? '编辑定时任务' : '新增定时任务'"
      style="width: 90%; max-width: 600px"
    >
      <div class="settings-content">
        <div class="settings-grid">
          <div class="setting-item">
            <label class="setting-label">任务名称</label>
            <n-input
              v-model:value="taskForm.name"
              placeholder="请输入任务名称"
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">运行类型</label>
            <n-radio-group
              v-model:value="taskForm.runType"
              @update:value="resetRunType"
            >
              <n-radio value="daily">每天固定时间</n-radio>
              <n-radio value="cron">Cron表达式</n-radio>
            </n-radio-group>
          </div>
          <div class="setting-item" v-if="taskForm.runType === 'daily'">
            <label class="setting-label">运行时间</label>
            <n-time-picker v-model:value="taskForm.runTime" format="HH:mm" />
          </div>
          <div class="setting-item" v-if="taskForm.runType === 'cron'">
            <label class="setting-label">Cron表达式</label>
            <n-input
              v-model:value="taskForm.cronExpression"
              placeholder="请输入Cron表达式"
              @input="parseCronExpression"
            />

            <!-- Cron表达式解析结果 -->
            <div class="cron-parser" v-if="taskForm.cronExpression">
              <div v-if="cronValidation.valid" class="cron-validation success">
                <n-text type="success">✓ {{ cronValidation.message }}</n-text>
              </div>
              <div v-else class="cron-validation error">
                <n-text type="error">✗ {{ cronValidation.message }}</n-text>
              </div>

              <!-- 未来执行时间 -->
              <div
                v-if="cronValidation.valid && cronNextRuns.length > 0"
                class="cron-next-runs"
              >
                <h4>未来5次执行时间：</h4>
                <ul>
                  <li v-for="(run, index) in cronNextRuns" :key="index">
                    {{ run }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div class="setting-item">
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
              "
            >
              <label class="setting-label">选择账号</label>
              <n-space size="small">
                <n-button size="small" @click="selectAllTokens">
                  全选
                </n-button>
                <n-button size="small" @click="deselectAllTokens">
                  全不选
                </n-button>
              </n-space>
            </div>

            <!-- 分组快速选择 (仅在定时任务中显示) -->
            <div style="margin-bottom: 12px">
              <div
                style="
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 8px;
                "
              >
                <div style="font-size: 12px; color: #86909c">
                  快速选择分组：
                </div>
                <n-button
                  type="primary"
                  size="tiny"
                  text
                  @click="showGroupManageModal = true"
                >
                  管理分组
                </n-button>
              </div>
              <div
                v-if="tokenGroups.length === 0"
                style="font-size: 12px; color: #ccc"
              >
                暂无分组
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap">
                <n-button
                  v-for="group in tokenGroups"
                  :key="group.id"
                  size="small"
                  :type="
                    taskScheduleSelectedGroupIds.includes(group.id)
                      ? 'primary'
                      : 'default'
                  "
                  @click="
                    () => {
                      const index = taskScheduleSelectedGroupIds.indexOf(
                        group.id,
                      );
                      const groupTokenIds = getValidGroupTokenIds(group.id);

                      if (index > -1) {
                        // 取消选择该分组
                        taskScheduleSelectedGroupIds.splice(index, 1);
                        taskForm.selectedTokens =
                          taskForm.selectedTokens.filter(
                            (id) => !groupTokenIds.includes(id),
                          );
                      } else {
                        // 选择该分组
                        taskScheduleSelectedGroupIds.push(group.id);
                        groupTokenIds.forEach((id) => {
                          if (!taskForm.selectedTokens.includes(id)) {
                            taskForm.selectedTokens.push(id);
                          }
                        });
                      }
                    }
                  "
                  :style="{
                    borderColor: group.color,
                  }"
                >
                  {{ group.name }}
                </n-button>
              </div>
            </div>

            <n-checkbox-group v-model:value="taskForm.selectedTokens">
              <n-grid :cols="2" :x-gap="12" :y-gap="8">
                <n-grid-item v-for="token in sortedTokens" :key="token.id">
                  <n-checkbox :value="token.id">{{ token.name }}</n-checkbox>
                </n-grid-item>
              </n-grid>
            </n-checkbox-group>
          </div>
          <div class="setting-item">
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
              "
            >
              <label class="setting-label">选择任务</label>
              <n-space size="small">
                <n-button size="small" @click="selectAllTasks"> 全选 </n-button>
                <n-button size="small" @click="deselectAllTasks">
                  全不选
                </n-button>
              </n-space>
            </div>

            <n-checkbox-group v-model:value="taskForm.selectedTasks">
              <n-tabs
                type="line"
                animated
                size="small"
                pane-style="padding-top: 12px;"
                default-value="daily"
              >
                <n-tab-pane
                  v-for="group in taskGroupDefinitions"
                  :key="group.name"
                  :name="group.name"
                  :tab="group.label"
                >
                  <n-grid :cols="2" :x-gap="12" :y-gap="8">
                    <n-grid-item
                      v-for="task in groupedAvailableTasks[group.name]"
                      :key="task.value"
                    >
                      <n-checkbox :value="task.value">{{
                        task.label
                      }}</n-checkbox>
                    </n-grid-item>
                  </n-grid>
                </n-tab-pane>

                <n-tab-pane
                  v-if="
                    groupedAvailableTasks['other'] &&
                    groupedAvailableTasks['other'].length > 0
                  "
                  name="other"
                  tab="其他"
                >
                  <n-grid :cols="2" :x-gap="12" :y-gap="8">
                    <n-grid-item
                      v-for="task in groupedAvailableTasks['other']"
                      :key="task.value"
                    >
                      <n-checkbox :value="task.value">{{
                        task.label
                      }}</n-checkbox>
                    </n-grid-item>
                  </n-grid>
                </n-tab-pane>
              </n-tabs>
            </n-checkbox-group>
          </div>
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showTaskModal = false" style="margin-right: 12px"
            >取消</n-button
          >
          <n-button type="primary" @click="saveTask">保存</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Batch Settings Modal -->
    <n-modal
      v-model:show="showBatchSettingsModal"
      preset="card"
      title="任务设置"
      style="width: 90%; max-width: 700px"
    >
      <div class="settings-content">
        <n-grid :cols="2" :x-gap="24">
          <!-- 左列：批量操作设置 -->
          <n-grid-item>
            <n-divider title-placement="left" style="margin: 1px 0 8px 0"
              >批量操作设置</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">开箱数量(10倍)</label>
                <n-input-number
                  v-model:value="batchSettings.boxCount"
                  :min="10"
                  :max="10000"
                  :step="10"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">钓鱼数量(10倍)</label>
                <n-input-number
                  v-model:value="batchSettings.fishCount"
                  :min="10"
                  :max="10000"
                  :step="10"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">招募数量(10倍)</label>
                <n-input-number
                  v-model:value="batchSettings.recruitCount"
                  :min="10"
                  :max="10000"
                  :step="10"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">默认宝箱类型</label>
                <n-select
                  v-model:value="batchSettings.defaultBoxType"
                  :options="boxTypeOptions"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">默认鱼竿类型</label>
                <n-select
                  v-model:value="batchSettings.defaultFishType"
                  :options="fishTypeOptions"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">按积分开箱目标</label>
                <n-input-number
                  v-model:value="batchSettings.targetBoxPoints"
                  :min="1"
                  :max="1000000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">梦境商品购买配置</label>
                <n-button size="small" @click="openDreamBuyModal"
                  >点击配置</n-button
                >
              </div>
            </div>
            <n-divider title-placement="left" style="margin: 12px 0 8px 0"
              >智能发车条件设置(0为不限制)</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">保底车辆颜色</label>
                <n-select
                  v-model:value="batchSettings.carMinColor"
                  :options="[
                    { label: '绿·普通', value: 1 },
                    { label: '蓝·稀有', value: 2 },
                    { label: '紫·史诗', value: 3 },
                    { label: '橙·传说', value: 4 },
                    { label: '红·神话', value: 5 },
                    { label: '金·传奇', value: 6 },
                  ]"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">车辆强制刷新保底</label>
                <n-switch
                  v-model:value="batchSettings.useGoldRefreshFallback"
                />
              </div>
            </div>
            <div
              class="settings-grid"
              v-if="batchSettings.useGoldRefreshFallback"
              style="margin-top: 12px"
            >
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">需同时满足所有条件</label>
                <n-switch
                  v-model:value="batchSettings.smartDepartureMatchAll"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">金砖 >=</label>
                <n-input-number
                  v-model:value="batchSettings.smartDepartureGoldThreshold"
                  :min="0"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">招募令 >=</label>
                <n-input-number
                  v-model:value="batchSettings.smartDepartureRecruitThreshold"
                  :min="0"
                  :step="10"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">白玉 >=</label>
                <n-input-number
                  v-model:value="batchSettings.smartDepartureJadeThreshold"
                  :min="0"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">刷新卷 >=</label>
                <n-input-number
                  v-model:value="batchSettings.smartDepartureTicketThreshold"
                  :min="0"
                  :step="1"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>
            <n-divider title-placement="left" style="margin: 12px 0 8px 0"
              >指定护卫设置</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: column;
                  align-items: stretch;
                  gap: 8px;
                "
              >
                <label class="setting-label"
                  >指定护卫（从账号列表多选）</label
                >
                <n-select
                  v-model:value="batchSettings.designatedGuards"
                  :options="designatedGuardOptions"
                  multiple
                  filterable
                  clearable
                  placeholder="选择一个或多个账号作为指定护卫"
                  size="small"
                />
                <span class="setting-hint"
                  >已设置逻辑：发车账号所在俱乐部含有指定护卫时，仅用指定护卫（按红数排序优先），全部满4辆即停止发车。未设置逻辑（俱乐部无指定护卫）：用全部成员（按红数最多优先），护卫满4辆时也停止发车。留空则全部按未设置逻辑。</span
                >
              </div>
            </div>
            <n-divider title-placement="left" style="margin: 12px 0 8px 0"
              >功法赠送设置</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">接收者ID</label>
                <n-input-number
                  v-model:value="batchSettings.receiverId"
                  placeholder="ID"
                  size="small"
                  style="width: 100px"
                  :show-button="false"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">密码</label>
                <n-input
                  v-model:value="batchSettings.password"
                  type="password"
                  placeholder="密码"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>
          </n-grid-item>
          <!-- 右列：延迟与连接设置 -->
          <n-grid-item>
            <n-divider title-placement="left" style="margin: 1px 0 8px 0"
              >延迟设置(ms)</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">命令延迟</label>
                <n-input-number
                  v-model:value="batchSettings.commandDelay"
                  :min="100"
                  :max="2000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">任务间延迟</label>
                <n-input-number
                  v-model:value="batchSettings.taskDelay"
                  :min="100"
                  :max="2000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">操作延迟</label>
                <n-input-number
                  v-model:value="batchSettings.actionDelay"
                  :min="100"
                  :max="2000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">战斗延迟</label>
                <n-input-number
                  v-model:value="batchSettings.battleDelay"
                  :min="100"
                  :max="2000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">刷新延迟</label>
                <n-input-number
                  v-model:value="batchSettings.refreshDelay"
                  :min="500"
                  :max="3000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">长延迟</label>
                <n-input-number
                  v-model:value="batchSettings.longDelay"
                  :min="1000"
                  :max="10000"
                  :step="500"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>
            <n-divider title-placement="left" style="margin: 12px 0 8px 0"
              >连接设置</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">最大并发数</label>
                <n-input-number
                  v-model:value="batchSettings.maxActive"
                  :min="1"
                  :max="20"
                  :step="1"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">连接超时(ms)</label>
                <n-input-number
                  v-model:value="batchSettings.connectionTimeout"
                  :min="1000"
                  :max="30000"
                  :step="1000"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">重连等待(ms)</label>
                <n-input-number
                  v-model:value="batchSettings.reconnectDelay"
                  :min="100"
                  :max="5000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>
            <n-divider title-placement="left" style="margin: 12px 0 8px 0"
              >系统设置</n-divider
            >
            <div class="settings-grid">
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">列表每行数量</label>
                <n-input-number
                  v-model:value="batchSettings.tokenListColumns"
                  :min="1"
                  :max="10"
                  :step="1"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">最大日志条目</label>
                <n-input-number
                  v-model:value="batchSettings.maxLogEntries"
                  :min="100"
                  :max="5000"
                  :step="100"
                  size="small"
                  style="width: 100px"
                />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
              >
                <label class="setting-label">定时刷新页面</label>
                <n-switch v-model:value="batchSettings.enableRefresh" />
              </div>
              <div
                class="setting-item"
                style="
                  flex-direction: row;
                  justify-content: space-between;
                  align-items: center;
                "
                v-if="batchSettings.enableRefresh"
              >
                <label class="setting-label">刷新间隔(分钟)</label>
                <n-input-number
                  v-model:value="batchSettings.refreshInterval"
                  :min="10"
                  :max="1440"
                  :step="30"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>
          </n-grid-item>
        </n-grid>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button
            @click="showBatchSettingsModal = false"
            style="margin-right: 12px"
            >取消</n-button
          >
          <n-button type="primary" @click="saveBatchSettings"
            >保存设置</n-button
          >
        </div>
      </div>
    </n-modal>

    <!-- War Guess Modal -->
    <n-modal
      v-model:show="showWarGuessModal"
      preset="card"
      title="月赛助威"
      style="width: 90%; max-width: 800px"
    >
      <div class="settings-content">
        <div class="settings-grid" style="display: block">
          <div
            style="
              margin-bottom: 16px;
              display: flex;
              align-items: center;
              gap: 12px;
            "
          >
            <span style="font-size: 16px">拍手器:</span>
            <n-input-number
              v-model:value="warGuessCoin"
              placeholder="拍手器"
              :min="1"
              :max="20"
              style="width: 120px"
            >
            </n-input-number>
            <n-button
              type="primary"
              @click="handleWarGuessCheer"
              :disabled="!selectedWarGuessLegionId || isRunning"
            >
              助威
            </n-button>
            <n-button @click="fetchWarGuessRank" :loading="warGuessLoading">
              刷新数据
            </n-button>
          </div>

          <n-data-table
            :columns="warGuessColumns"
            :data="warGuessList"
            :loading="warGuessLoading"
            :row-key="(row) => row.id"
            :checked-row-keys="
              selectedWarGuessLegionId ? [selectedWarGuessLegionId] : []
            "
            @update:checked-row-keys="
              (keys) => (selectedWarGuessLegionId = keys[0])
            "
            :row-props="warGuessRowProps"
            style="height: 400px; flex: 1"
            flex-height
          />
        </div>
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showWarGuessModal = false">关闭</n-button>
        </div>
      </div>
    </n-modal>

    <!-- Token Group Management Modal -->
    <n-modal
      v-model:show="showGroupManageModal"
      preset="card"
      title="分组管理"
      style="width: 90%; max-width: 800px"
    >
      <div class="settings-content">
        <!-- 创建新分组 -->
        <n-divider title-placement="left" style="margin: 0 0 16px 0">
          创建新分组
        </n-divider>
        <div style="margin-bottom: 24px">
          <div
            style="
              display: flex;
              gap: 12px;
              align-items: center;
              margin-bottom: 12px;
              flex-wrap: wrap;
            "
          >
            <n-input
              v-model:value="newGroupName"
              placeholder="输入分组名称"
              style="width: 200px"
              size="small"
            />
            <div style="display: flex; gap: 8px; align-items: center">
              <span style="font-size: 12px">选择颜色:</span>
              <div style="display: flex; gap: 6px">
                <div
                  v-for="color in groupColors"
                  :key="color"
                  :style="{
                    width: '24px',
                    height: '24px',
                    backgroundColor: color,
                    borderRadius: '4px',
                    border:
                      newGroupColor === color
                        ? '3px solid #000'
                        : '2px solid #ddd',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                  }"
                  @click="newGroupColor = color"
                  @mouseover="$event.target.style.transform = 'scale(1.1)'"
                  @mouseleave="$event.target.style.transform = 'scale(1)'"
                />
              </div>
            </div>
            <n-button type="primary" size="small" @click="createNewGroup">
              创建分组
            </n-button>
          </div>

          <!-- 选择包含的账号 -->
          <div
            style="
              background: #f9f9f9;
              padding: 12px;
              border-radius: 8px;
              border: 1px solid #eee;
            "
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
              "
            >
              <span style="font-size: 13px; font-weight: bold"
                >包含账号 ({{ newGroupSelectedTokens.length }})</span
              >
              <n-space size="small">
                <n-button size="tiny" @click="selectAllNewGroup">全选</n-button>
                <n-button size="tiny" @click="deselectAllNewGroup"
                  >全不选</n-button
                >
              </n-space>
            </div>
            <div style="max-height: 150px; overflow-y: auto">
              <n-checkbox-group v-model:value="newGroupSelectedTokens">
                <n-grid :cols="3" :x-gap="12" :y-gap="8">
                  <n-grid-item v-for="token in sortedTokens" :key="token.id">
                    <n-checkbox :value="token.id">{{ token.name }}</n-checkbox>
                  </n-grid-item>
                </n-grid>
              </n-checkbox-group>
            </div>
          </div>
        </div>

        <!-- 分组列表 -->
        <n-divider title-placement="left" style="margin: 0 0 16px 0">
          分组列表
        </n-divider>
        <div
          style="
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px;
          "
        >
          <div
            v-for="group in tokenGroups"
            :key="group.id"
            style="
              padding: 12px;
              border: 1px solid #e5e7eb;
              border-radius: 6px;
              margin-bottom: 12px;
              background: #fafafa;
            "
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
              "
            >
              <div style="flex: 1">
                <!-- 编辑模式 -->
                <div
                  v-if="editingGroupId === group.id"
                  style="display: flex; gap: 8px"
                >
                  <n-input
                    v-model:value="editingGroupName"
                    placeholder="分组名称"
                    size="small"
                    style="width: 150px"
                  />
                  <div style="display: flex; gap: 6px; align-items: center">
                    <div
                      v-for="color in groupColors"
                      :key="color"
                      :style="{
                        width: '20px',
                        height: '20px',
                        backgroundColor: color,
                        borderRadius: '4px',
                        border:
                          editingGroupColor === color
                            ? '3px solid #000'
                            : '2px solid #ddd',
                        cursor: 'pointer',
                      }"
                      @click="editingGroupColor = color"
                    />
                  </div>
                  <n-button
                    size="small"
                    type="primary"
                    @click="saveEditGroup"
                    style="width: 60px"
                  >
                    保存
                  </n-button>
                  <n-button
                    size="small"
                    @click="cancelEditGroup"
                    style="width: 60px"
                  >
                    取消
                  </n-button>
                </div>
                <!-- 显示模式 -->
                <div v-else>
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      margin-bottom: 8px;
                    "
                  >
                    <div
                      :style="{
                        width: '16px',
                        height: '16px',
                        backgroundColor: group.color,
                        borderRadius: '3px',
                      }"
                    />
                    <span style="font-weight: 500; font-size: 14px">
                      {{ group.name }}
                    </span>
                    <n-tag size="small" type="info">
                      {{ getValidGroupTokenIds(group.id).length }} 个账号
                    </n-tag>
                  </div>
                  <div
                    style="
                      display: flex;
                      gap: 4px;
                      flex-wrap: wrap;
                      margin-bottom: 8px;
                    "
                  >
                    <div
                      v-for="tokenId in getValidGroupTokenIds(group.id)"
                      :key="tokenId"
                      style="
                        padding: 2px 8px;
                        background: white;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-size: 12px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                      "
                    >
                      {{ tokens.find((t) => t.id === tokenId)?.name }}
                      <n-button
                        size="tiny"
                        type="error"
                        text
                        @click="removeTokenFromSelectedGroup(group.id, tokenId)"
                      >
                        ×
                      </n-button>
                    </div>
                  </div>
                  <!-- 添加token到分组 -->
                  <div style="margin-bottom: 8px">
                    <n-select
                      placeholder="添加账号到分组"
                      size="small"
                      filterable
                      :options="
                        tokens
                          .filter(
                            (t) =>
                              !getValidGroupTokenIds(group.id).includes(t.id),
                          )
                          .map((t) => ({ label: t.name, value: t.id }))
                      "
                      @update:value="
                        (tokenId) => {
                          if (tokenId) {
                            addTokenToSelectedGroup(group.id, tokenId);
                          }
                        }
                      "
                    />
                  </div>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div
                style="display: flex; gap: 8px"
                v-if="editingGroupId !== group.id"
              >
                <n-button size="small" @click="startEditGroup(group.id)">
                  编辑
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  @click="deleteGroup(group.id)"
                >
                  删除
                </n-button>
              </div>
            </div>
          </div>

          <div
            v-if="tokenGroups.length === 0"
            style="text-align: center; padding: 24px; color: #86909c"
          >
            暂无分组，请创建一个新分组
          </div>
        </div>

        <!-- 关闭按钮 -->
        <div class="modal-actions" style="margin-top: 20px; text-align: right">
          <n-button @click="showGroupManageModal = false">关闭</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup>
// Import required dependencies
import {
  ref,
  computed,
  nextTick,
  reactive,
  watch,
  onMounted,
  onBeforeUnmount,
  h,
  triggerRef,
} from "vue";
import { useTokenStore, gameTokens, tokenGroups } from "@/stores/tokenStore";
import { $emit } from "@/stores/events/index.ts";
import { DailyTaskRunner } from "@/utils/dailyTaskRunner";
import { preloadQuestions } from "@/utils/studyQuestionsFromJSON.js";
import { useMessage } from "naive-ui";
import { Settings, ChevronDown, ChevronUp } from "@vicons/ionicons5";
import { workerSleep } from "@/utils/workerTimer.js";
import { DEFAULT_WEIRD_TOWER_MAX_CLIMB } from "@/utils/towerClimbLimit.js";
import { getTowerActId } from "@/utils/towerActId.js";

// Import batch task modules
import {
  // Constants
  boxTypeOptions,
  fishTypeOptions,
  formationOptions,
  bossTimesOptions,
  availableTasks,
  CarresearchItem,
  FISH_TARGET,
  ARENA_TARGET,
  taskColumns,
  defaultSettings,
  defaultBatchSettings,
  defaultTemplate,
  defaultTaskForm,
  defaultHelperSettings,
  // Cron utilities
  validateCronField,
  validateCronExpression,
  parseCronField,
  calculateNextRuns,
  calculateNextExecutionTime,
  formatTimeDifference,
  matchesCronExpression,
  // Connection manager
  createConnectionManager,
  getActivityStatus,
  getTodayStartSec,
  isTodayAvailable,
  calculateMonthProgress,
  pickArenaTargetId,
  // Log utilities
  createLogManager,
  addTaskSaveLog,
  // Car utilities
  normalizeCars,
  gradeLabel,
  isBigPrize,
  countRacingRefreshTickets,
  shouldSendCar,
  canClaim,
  // Task factories
  createTasksHangUp,
  createTasksBottle,
  createTasksTower,
  createTasksCar,
  createTasksItem,
  createTasksDungeon,
  createTasksArena,
  createTasksStore,
  createTasksLegacy,
  createTasksFootball,
  createTasksApex,
  createTasksShidian,
  createTasksCampChallenge,
} from "@/utils/batch";

import { merchantConfig, goldItemsConfig } from "@/utils/dreamConstants";

// Initialize token store, message service, and task runner
const tokenStore = useTokenStore();
const message = useMessage();
const weirdTowerMaxClimb = ref(DEFAULT_WEIRD_TOWER_MAX_CLIMB);

// 排序配置（从localStorage读取，与TokenImport共享）
const savedSortConfig = localStorage.getItem("tokenSortConfig");
const sortConfig = ref(
  savedSortConfig
    ? JSON.parse(savedSortConfig)
    : {
        field: "createdAt", // 排序字段：name, server, createdAt, lastUsed, power
        direction: "asc", // 排序方向：asc, desc
      },
);

// 计算属性 - 从gameData中获取塔相关信息
const evoTowerInfo = computed(() => {
  const data = tokenStore.gameData?.evoTowerInfo || null;
  return data;
});

const weirdTowerData = computed(() => {
  return evoTowerInfo.value?.evoTower || null;
});

const currentTowerId = computed(() => {
  return weirdTowerData.value?.towerId || 0;
});

const towerEnergy = computed(() => {
  return weirdTowerData.value?.energy || 0;
});

// 获取 token 所属分组中成员最少的分组信息（用于分组排序）
const getTokenGroupSortInfo = (tokenId) => {
  const groups = tokenGroups.value.filter((g) => g.tokenIds?.includes(tokenId));
  if (groups.length === 0) return { memberCount: Infinity, groupId: "" };
  let minGroup = groups[0];
  for (const g of groups) {
    const cnt = g.tokenIds?.length || 0;
    if (cnt < (minGroup.tokenIds?.length || 0)) {
      minGroup = g;
    }
  }
  return { memberCount: minGroup.tokenIds?.length || 0, groupId: minGroup.id };
};

// 排序后的游戏角色Token列表
const sortedTokens = computed(() => {
  const result = [...gameTokens.value].sort((tokenA, tokenB) => {
    // 分组排序：按组内成员数升序，同组内按战力降序
    if (sortConfig.value.field === "group") {
      const infoA = getTokenGroupSortInfo(tokenA.id);
      const infoB = getTokenGroupSortInfo(tokenB.id);
      if (infoA.memberCount !== infoB.memberCount) {
        return infoA.memberCount - infoB.memberCount;
      }
      if (infoA.groupId !== infoB.groupId) {
        return infoA.groupId < infoB.groupId ? -1 : 1;
      }
      const powerA = tokenA.power || 0;
      const powerB = tokenB.power || 0;
      return sortConfig.value.direction === "asc"
        ? powerA - powerB
        : powerB - powerA;
    }

    let valueA, valueB;
    switch (sortConfig.value.field) {
      case "name":
        valueA = tokenA.name?.toLowerCase() || "";
        valueB = tokenB.name?.toLowerCase() || "";
        break;
      case "server":
        valueA = tokenA.server?.toLowerCase() || "";
        valueB = tokenB.server?.toLowerCase() || "";
        break;
      case "createdAt":
        valueA = new Date(tokenA.createdAt || 0).getTime();
        valueB = new Date(tokenB.createdAt || 0).getTime();
        break;
      case "lastUsed":
        valueA = new Date(tokenA.lastUsed || 0).getTime();
        valueB = new Date(tokenB.lastUsed || 0).getTime();
        break;
      case "power":
        valueA = tokenA.power || 0;
        valueB = tokenB.power || 0;
        break;
      default:
        valueA = tokenA.name?.toLowerCase() || "";
        valueB = tokenB.name?.toLowerCase() || "";
    }

    if (valueA < valueB) {
      return sortConfig.value.direction === "asc" ? -1 : 1;
    }
    if (valueA > valueB) {
      return sortConfig.value.direction === "asc" ? 1 : -1;
    }
    return 0;
  });
  return result;
});

// 收起时只显示已选中的账号
const displayedTokens = computed(() => {
  if (!isAccountListCollapsed.value) return sortedTokens.value;
  const selectedSet = new Set(selectedTokens.value);
  return sortedTokens.value.filter((t) => selectedSet.has(t.id));
});

// 切换排序
const toggleSort = (field) => {
  if (sortConfig.value.field === field) {
    // 如果点击的是当前排序字段，则切换排序方向
    sortConfig.value.direction =
      sortConfig.value.direction === "asc" ? "desc" : "asc";
  } else {
    // 如果点击的是新的排序字段，则默认升序（分组排序默认降序：高战力优先）
    sortConfig.value.field = field;
    sortConfig.value.direction = field === "group" ? "desc" : "asc";
  }

  // 保存排序设置到localStorage
  localStorage.setItem("tokenSortConfig", JSON.stringify(sortConfig.value));
};

// 获取排序图标
const getSortIcon = (field) => {
  if (sortConfig.value.field !== field) return null;
  return sortConfig.value.direction === "asc" ? "↑" : "↓";
};

const tokens = computed(() => gameTokens.value);
const isCarActivityOpen = computed(() => {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  // 1=Mon, 2=Tue, 3=Wed; 6点之后
  return day >= 1 && day <= 3 && hour >= 6;
});
const ismengjingActivityOpen = computed(() => {
  const day = new Date().getDay();
  return day === 0 || day === 1 || day === 3 || day === 4;
});
const isbaokuActivityOpen = computed(() => {
  const day = new Date().getDay();
  return day != 1 && day != 2;
});
const isarenaActivityOpen = computed(() => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 22;
});
const getCurrentActivityWeek = computed(() => {
  const now = new Date();
  const start = new Date("2025-12-12T12:00:00"); // 起始时间：黑市周开始
  const weekDuration = 7 * 24 * 60 * 60 * 1000; // 一周毫秒数
  const cycleDuration = 3 * weekDuration; // 三周期毫秒数

  const elapsed = now - start;
  if (elapsed < 0) return null; // 活动开始前

  const cyclePosition = elapsed % cycleDuration;

  if (cyclePosition < weekDuration) {
    return "黑市周";
  } else if (cyclePosition < 2 * weekDuration) {
    return "招募周";
  } else {
    return "宝箱周";
  }
});

const isWeirdTowerActivityOpen = computed(() => {
  if (getCurrentActivityWeek.value !== "黑市周") return false;

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  // 如果是周五，必须在12点之后
  if (day === 5) {
    return hour >= 12;
  }
  return true;
});

// 获取本月第四个周日的日期
const getFourthSundayOfMonth = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // 当月第一天
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay(); // 0-6

  // 计算第一个周日的日期 (1号是周日则为1，否则为 1 + 7 - dayOfWeek)
  let firstSundayDate = 1 + ((7 - dayOfWeek) % 7);

  // 仅针对2026年3月进行特殊处理
  if (year === 2026 && month === 2 && dayOfWeek === 0) {
    firstSundayDate = 8;
  }

  // 第四个周日 = 第一个周日 + 21天
  return new Date(year, month, firstSundayDate + 21);
};

const isWarGuessActivityOpen = computed(() => {
  const now = new Date();

  // 手动修正：2026年3月1日开放
  if (
    now.getFullYear() === 2026 &&
    now.getMonth() === 2 &&
    now.getDate() === 1
  ) {
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (hour < 19 || (hour === 19 && minute <= 55)) return true;
  }

  const fourthSunday = getFourthSundayOfMonth();

  // 检查是否是今天
  if (now.getDate() !== fourthSunday.getDate()) return false;

  // 检查时间 00:00 - 19:55
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour > 19 || (hour === 19 && minute > 55)) return false;

  return true;
});

const warGuessActivityTip = computed(() => {
  if (isWarGuessActivityOpen.value) return "";

  const fourthSunday = getFourthSundayOfMonth();
  const month = fourthSunday.getMonth() + 1;
  const date = fourthSunday.getDate();
  return `月赛助威仅在每月第四个周日 (${month}月${date}日) 00:00-19:55 开放`;
});

const selectedTokens = ref([]);
const tokenStatus = ref({}); // { tokenId: 'waiting' | 'running' | 'completed' | 'failed' }
const isRunning = ref(false);
const shouldStop = ref(false);
const isAccountListCollapsed = ref(false);

// =====================
// 屏幕常亮（防止iOS熄屏）
// =====================
let wakeLockSentinel = null;
let silentAudioEl = null;
const wakeLockActive = ref(false);

// 创建静音音频元素（后备方案，兼容不支持 Wake Lock API 的浏览器）
const SILENT_AUDIO_SRC =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const requestWakeLock = async () => {
  // 方案1：Screen Wake Lock API（iOS 16.4+ / 现代浏览器）
  if ("wakeLock" in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        console.log("[WakeLock] 已释放");
        wakeLockActive.value = false;
      });
      wakeLockActive.value = true;
      console.log("[WakeLock] Screen wake lock 已获取");
    } catch (err) {
      console.warn("[WakeLock] Wake Lock API 失败:", err.message);
    }
  }

  // 方案2：静音音频循环播放（后备方案，兼容旧版iOS）
  // iOS 不会在播放音频时自动锁屏
  if (!wakeLockActive.value) {
    try {
      if (!silentAudioEl) {
        silentAudioEl = new Audio(SILENT_AUDIO_SRC);
        silentAudioEl.loop = true;
        silentAudioEl.volume = 0.001; // 极低音量
      }
      await silentAudioEl.play();
      wakeLockActive.value = true;
      console.log("[WakeLock] 静音音频已启动（后备方案）");
    } catch (err) {
      console.warn("[WakeLock] 静音音频失败:", err.message);
    }
  }
};

const releaseWakeLock = async () => {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    } catch (err) {
      console.warn("[WakeLock] 释放失败:", err);
    }
  }
  if (silentAudioEl) {
    try {
      silentAudioEl.pause();
      silentAudioEl.currentTime = 0;
    } catch (err) {
      console.warn("[WakeLock] 停止音频失败:", err);
    }
  }
  wakeLockActive.value = false;
};

// 页面恢复可见时重新获取 wake lock（任务运行中）
const handleWakeLockVisibility = async () => {
  if (document.visibilityState === "visible" && isRunning.value) {
    await requestWakeLock();
  }
};

// 任务运行状态变化时获取/释放 wake lock
watch(isRunning, async (running) => {
  if (running) {
    await requestWakeLock();
  } else {
    await releaseWakeLock();
  }
});

// 每日重要提示（按星期）
const dailyReminder = (() => {
  const reminders = {
    0: "梦境商品",           // 周日
    1: "四圣碎片、答题、刷车", // 周一
    3: "梦境商品、答题",      // 周三
  };
  return reminders[new Date().getDay()] || "";
})();

// 换皮闯关信息
const towerOverview = ref({}); // { [tokenId]: { cleared, total } }
const towerOverviewLoading = ref(false);

// 原始数据
const fullInfoLoading = ref(false);

// 场次信息（逐鹿盐山竞猜赛季）
const apexScheduleInfoLoading = ref(false);

// 十殿信息
const shidianInfoLoading = ref(false);

// 解析十殿周奖励日期键 (YYYYMMDD)
const parseDateString = (s) => {
  if (!s || s.length < 8) return null;
  return new Date(
    parseInt(s.substring(0, 4)),
    parseInt(s.substring(4, 6)) - 1,
    parseInt(s.substring(6, 8)),
  );
};

// 是否同一周（周一为一周开始）
const isSameWeek = (a, b) => {
  if (!a || !b) return false;
  const startOfWeek = (d) => {
    const c = new Date(d);
    const day = (c.getDay() + 6) % 7;
    c.setDate(c.getDate() - day);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
};

// 查询选中账号本周十殿层数并写入日志
const fetchShidianOverview = async () => {
  const targetIds =
    selectedTokens.value.length > 0
      ? [...selectedTokens.value]
      : tokens.value.map((t) => t.id);
  if (targetIds.length === 0) {
    message.warning("没有可查询的账号");
    return;
  }
  shidianInfoLoading.value = true;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始查询十殿信息(${targetIds.length}个账号) ===`,
    type: "info",
  });
  try {
    for (const tokenId of targetIds) {
      if (shouldStop.value) break;
      const token = tokens.value.find((t) => t.id === tokenId);
      const name = token ? token.name : tokenId;
      try {
        await ensureConnection(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const roleId = roleInfo?.role?.roleId
          ? String(roleInfo.role.roleId)
          : tokenId;
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "nightmare_getroleinfo",
          { roleId: parseInt(roleId) },
          8000,
        );
        const nm = res?.nightMareData || res?.nightmareData || {};
        const weekAward = nm.weekAward || res?.weekAward;
        // 仅统计属于本周的周奖励数据（与 ShiDianCard 一致），跨周数据清零
        let finalLevel = 0;
        if (weekAward && typeof weekAward === "object") {
          for (const key of Object.keys(weekAward).sort().reverse()) {
            const date = parseDateString(key);
            if (date && isSameWeek(new Date(), date)) {
              finalLevel = Number(weekAward[key]?.maxLevel) || 0;
              break;
            }
          }
        }
        const currentLevel = Number(res?.nightmare?.level) || 0;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 十殿信息：本周已打到 ${finalLevel} 层（当前殿级 ${currentLevel}）`,
          type: "success",
        });
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 查询十殿信息失败: ${e?.message || e}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }
  } finally {
    shidianInfoLoading.value = false;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 十殿信息查询完成 ===`,
      type: "info",
    });
  }
};

// 消耗信息
const consumptionInfoLoading = ref(false);

// 在对象中递归查找名为 key 的属性值（兼容该字段位于响应不同层级的情况）
const deepFindKey = (obj, key, depth = 0) => {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const r = deepFindKey(v, key, depth + 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
};

// 查询选中账号的消耗活动进度并写入日志（读取 activity_get 的 commonActivityInfo）
const fetchConsumptionInfo = async () => {
  const targetIds =
    selectedTokens.value.length > 0
      ? [...selectedTokens.value]
      : tokens.value.map((t) => t.id);
  if (targetIds.length === 0) {
    message.warning("没有可查询的账号");
    return;
  }
  consumptionInfoLoading.value = true;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始查询消耗信息(${targetIds.length}个账号) ===`,
    type: "info",
  });
  try {
    for (const tokenId of targetIds) {
      if (shouldStop.value) break;
      const token = tokens.value.find((t) => t.id === tokenId);
      const name = token ? token.name : tokenId;
      try {
        await ensureConnection(tokenId);
        // 拉取角色信息：金砖库存 + 本周活动消耗（黑市周看金砖 / 招募周看贝壳）
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const diamond = roleInfo?.role?.diamond ?? 0;
        // 招募周显示贝壳消耗(wa:pearl)，其余周维持金砖消耗(wa:diamond)
        // 递归查找，兼容字段位于响应不同层级
        const isRecruitWeek = currentWeekType.value === "招募周";
        const weekConsumption =
          Number(
            deepFindKey(roleInfo, isRecruitWeek ? "wa:pearl" : "wa:diamond"),
          ) || 0;
        // 档位信息：招募周贝壳仅 200 一档；金砖为多档
        const tiers = isRecruitWeek
          ? [200]
          : [1000, 5000, 10000, 15000, 20000, 35000, 50000, 75000, 100000];
        let reached = 0;
        for (const t of tiers) {
          if (weekConsumption >= t) reached = t;
          else break;
        }
        const currentTier = reached
          ? `${isRecruitWeek ? "" : "￥"}${reached}`
          : "未达到最低档";
        const nextTierObj = tiers.find((t) => t > weekConsumption);
        const nextInfo = nextTierObj
          ? `${nextTierObj}（差 ${Math.max(0, nextTierObj - weekConsumption)}）`
          : "已满档";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 消耗信息：本周${isRecruitWeek ? "贝壳" : "金砖"}消耗(${isRecruitWeek ? "招募达标" : "黑市达标"})${weekConsumption}，当前达到档位：${currentTier}，下一档：${nextInfo}，当前金砖(库存)${diamond}`,
          type: "success",
        });
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${name} 查询消耗信息失败: ${e?.message || e}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }
  } finally {
    consumptionInfoLoading.value = false;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 消耗信息查询完成 ===`,
      type: "info",
    });
  }
};

// =====================
// 领取挂机：加钟次数（默认2，0=仅领取不加钟）
// =====================
const hangUpAddTimes = ref(2);

// =====================
// 金砖周（黑市周）判断
// 以 2026-06-19（周五）为基准，3周循环：黑市周(金砖)→招募周→宝箱周
// =====================
const getWeekOffset = () => {
  const baseFriday = new Date("2026-06-19T00:00:00").getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri
  const diffToFriday = (day - 5 + 7) % 7;
  const cycleFriday = new Date(now);
  cycleFriday.setHours(0, 0, 0, 0);
  cycleFriday.setDate(cycleFriday.getDate() - diffToFriday);
  return Math.round((cycleFriday.getTime() - baseFriday) / weekMs);
};

const isGoldBrickWeek = () => getWeekOffset() % 3 === 0;

// 当前周类型文字
const currentWeekType = computed(() => {
  const mod = ((getWeekOffset() % 3) + 3) % 3;
  const types = ["黑市周", "招募周", "宝箱周"];
  return types[mod];
});

// =====================
// 战斗力缓存（按账号）
// =====================
const tokenPowerMap = ref({}); // { [tokenId]: { power, powerText, updatedAt } }
const isRefreshingPower = ref(false);

// 写入战斗力缓存（同时持久化到 tokenStore，确保页面刷新后仍可读取）
const updateTokenPower = (tokenId, power) => {
  if (!tokenId || power == null) return;
  tokenPowerMap.value[tokenId] = {
    power,
    powerText: formatPower(power),
    updatedAt: new Date().toLocaleString(),
  };
  // 同步写入 tokenStore（useLocalStorage 会自动持久化到 localStorage）
  tokenStore.updateToken(tokenId, {
    power,
    powerUpdatedAt: new Date().toISOString(),
  });
  // 显式触发 gameTokens ref 的依赖更新，确保 sortedTokens 等 computed 重新计算
  triggerRef(gameTokens);
};

// 刷新选中账号的战斗力（若无选中则刷新全部）
const refreshTokenPower = async () => {
  const targetIds =
    selectedTokens.value.length > 0
      ? [...selectedTokens.value]
      : tokens.value.map((t) => t.id);

  if (targetIds.length === 0) {
    message.warning("没有可刷新的账号");
    return;
  }

  isRefreshingPower.value = true;
  let successCount = 0;
  let failCount = 0;

  // 串行处理，受连接池限流（avoidConnectionSlot 内部已限制并发）
  for (const tokenId of targetIds) {
    if (shouldStop.value) break;
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      failCount++;
      continue;
    }
    try {
      await ensureConnection(tokenId);
      const roleInfoResp = await tokenStore.sendGetRoleInfo(tokenId);
      const roleData = roleInfoResp?.role || roleInfoResp?.roleInfo;
      const power = roleData?.power ?? roleData?.role?.power ?? 0;
      updateTokenPower(tokenId, power);
      successCount++;
    } catch (e) {
      failCount++;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `刷新战力失败 ${token?.name || tokenId}: ${e.message}`,
        type: "warning",
      });
    } finally {
      // 查询完即可关闭连接，释放槽位
      tokenStore.closeWebSocketConnection(tokenId);
      releaseConnectionSlot();
    }
  }

  isRefreshingPower.value = false;
  message.success(`刷新战力完成: 成功 ${successCount}，失败 ${failCount}`);
};

// =====================
// Token分组管理状态
// =====================
const showGroupManageModal = ref(false);
const showGroupSelectModal = ref(false);
const selectedGroups = ref([]); // 选中的分组ID列表
const newGroupName = ref("");
const newGroupColor = ref("#1677ff");
const newGroupSelectedTokens = ref([]); // 新建分组时选中的Token ID列表
const editingGroupId = ref(null);
const editingGroupName = ref("");
const editingGroupColor = ref("");
const taskScheduleSelectedGroupIds = ref([]); // 定时任务中通过分组按钮选中的分组ID列表
const groupColors = [
  "#1677ff", // 蓝色
  "#52c41a", // 绿色
  "#faad14", // 橙色
  "#f5222d", // 红色
  "#722ed1", // 紫色
  "#13c2c2", // 青色
  "#eb2f96", // 粉色
  "#fa8c16", // 赤红色
];

// ======================
// War Guess Feature
// ======================
const showWarGuessModal = ref(false);
const warGuessList = ref([]);
const warGuessLoading = ref(false);
const warGuessCoin = ref(20);
const selectedWarGuessLegionId = ref(null);
const currentGuessCount = ref(0);

const formatPower = (power) => {
  if (!power) return "0";
  if (power >= 100000000) {
    return (power / 100000000).toFixed(2) + "亿";
  }
  if (power >= 10000) {
    return (power / 10000).toFixed(2) + "万";
  }
  return power.toString();
};

const warGuessColumns = [
  {
    type: "selection",
    multiple: false,
  },
  { title: "ID", key: "id", width: 100 },
  {
    title: "头像",
    key: "logo",
    render(row) {
      return h("img", {
        src: row.logo,
        style: { width: "30px", height: "30px", borderRadius: "50%" },
      });
    },
    width: 60,
  },
  { title: "区服", key: "serverId", width: 80 },
  { title: "俱乐部", key: "name", width: 120 },
  {
    title: "战力",
    key: "power",
    render(row) {
      return formatPower(row.power);
    },
    width: 100,
  },
  { title: "红淬", key: "quenchNum" },
  { title: "已助威", key: "guessNum" },
  {
    title: "总热度",
    key: "totalNum",
    render(row) {
      return formatPower(row.totalNum || 0);
    },
    width: 100,
  },
];

const warGuessRowProps = (row) => {
  return {
    style: "cursor: pointer",
    onClick: () => {
      selectedWarGuessLegionId.value = row.id;
    },
  };
};

const openWarGuessModal = () => {
  showWarGuessModal.value = true;
  // Reset selection
  selectedWarGuessLegionId.value = null;
  warGuessList.value = [];

  // Auto fetch if tokens selected
  if (selectedTokens.value.length > 0) {
    fetchWarGuessRank();
  }
};

const fetchWarGuessRank = async () => {
  if (selectedTokens.value.length === 0) {
    message.warning("请先选择一个账号用于获取月赛助威数据");
    return;
  }

  const tokenId = selectedTokens.value[0];
  const token = tokens.value.find((t) => t.id === tokenId);

  warGuessLoading.value = true;
  try {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在使用 ${token.name} 获取月赛助威数据...`,
      type: "info",
    });

    // Ensure connection
    const status = tokenStore.getWebSocketStatus(tokenId);
    if (status !== "connected") {
      tokenStore.createWebSocketConnection(tokenId, token.token, token.wsUrl);
      await workerSleep(2000); // Wait for connection
    }

    // Fetch rank
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "warguess_getrank",
      { bfId: "" },
      5000,
    );

    if (res && res.list) {
      let list = [];
      if (Array.isArray(res.list)) {
        list = res.list;
      } else {
        list = Object.values(res.list);
      }

      // Sort by totalNum desc
      warGuessList.value = list
        .sort((a, b) => (b.totalNum || 0) - (a.totalNum || 0))
        .slice(0, 20);
    } else {
      message.warning("获取月赛助威数据为空");
    }
  } catch (error) {
    console.error("Fetch rank error:", error);
    message.error("获取月赛助威数据失败: " + error.message);
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `获取月赛助威数据失败: ${error.message}`,
      type: "error",
    });
  } finally {
    warGuessLoading.value = false;
  }
};

const handleWarGuessCheer = async () => {
  if (!selectedWarGuessLegionId.value) {
    message.warning("请先选择一个俱乐部");
    return;
  }
  // Close modal
  showWarGuessModal.value = false;
  // Call the batch function
  await batchWarGuessCheer(selectedWarGuessLegionId.value, warGuessCoin.value);
};

// Settings Modal State
const showSettingsModal = ref(false);
const currentSettingsTokenId = ref(null);
const currentSettingsTokenName = ref("");
const currentSettings = reactive({
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
});

// Task Template State
const showTaskTemplateModal = ref(false);
const showApplyTemplateModal = ref(false);
const showTemplateManagerModal = ref(false);
const showAccountTemplateModal = ref(false);
const taskTemplates = ref([]);
const selectedTemplateId = ref(null);
const selectedTokensForApply = ref([]);
const currentTemplateName = ref("");
const currentTemplateId = ref(null); // 用于编辑现有模板
const currentTemplate = reactive({
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
});

// Account Template References
const accountTemplateReferences = ref([]);
const filteredAccountTemplates = ref([]);
const selectedTemplateForFilter = ref(null);

// Computed for Apply Template
const isAllSelectedForApply = computed(() => {
  return (
    selectedTokensForApply.value.length === sortedTokens.value.length &&
    sortedTokens.value.length > 0
  );
});

const isIndeterminateForApply = computed(() => {
  return (
    selectedTokensForApply.value.length > 0 &&
    selectedTokensForApply.value.length < sortedTokens.value.length
  );
});

// Computed for Template Manager
const filteredTaskTemplates = computed(() => {
  return taskTemplates.value;
});

// Helper Modal State
const showHelperModal = ref(false);
const helperType = ref("box"); // 'box' | 'fish' | 'recruit'
const helperSettings = reactive({
  boxType: 2001,
  fishType: 1,
  count: 100,
  targetPoints: 1000,
});

const helperModalTitle = computed(() => {
  const titles = {
    box: "批量开宝箱",
    fish: "批量钓鱼",
    recruit: "批量招募",
    pointsBox: "按积分开箱",
  };
  return titles[helperType.value] || "批量助手";
});

// Batch Settings State
const showBatchSettingsModal = ref(false);

const defaultDreamPurchaseList = [];
for (const merchantId in goldItemsConfig) {
  goldItemsConfig[merchantId].forEach((index) => {
    defaultDreamPurchaseList.push(`${merchantId}-${index}`);
  });
}

const batchSettings = reactive({
  dreamPurchaseList: defaultDreamPurchaseList,
  boxCount: 100,
  fishCount: 100,
  recruitCount: 100,
  defaultBoxType: 2001,
  defaultFishType: 1,
  targetBoxPoints: 1000,
  receiverId: "",
  password: "",
  tokenListColumns: 2,
  useGoldRefreshFallback: false,
  // 延迟配置（毫秒）
  commandDelay: 500, // 命令间延迟
  taskDelay: 500, // 任务间延迟
  actionDelay: 300, // 一般操作延迟（开箱、钓鱼、招募等）
  battleDelay: 500, // 战斗延迟（宝库、竞技场等）
  refreshDelay: 1000, // 刷新延迟（发车刷新等）
  longDelay: 3000, // 长延迟（功法赠送等）
  // 其他配置
  maxActive: 2,
  carMinColor: 4,
  connectionTimeout: 10000,
  reconnectDelay: 1000,
  maxLogEntries: 1000,
  // 页面刷新配置
  enableRefresh: false,
  refreshInterval: 360, // 分钟
  smartDepartureGoldThreshold: 0,
  smartDepartureRecruitThreshold: 0,
  smartDepartureJadeThreshold: 0,
  smartDepartureTicketThreshold: 0,
  smartDepartureMatchAll: false,
  // 指定护卫：成员ID或名称列表（批量智能发车优先从同俱乐部指定人员中选择护卫）
  designatedGuards: [],
});

// 指定护卫：从账号列表多选（存账号名称），批量智能发车优先从同俱乐部指定人员中选择护卫
const designatedGuardOptions = computed(() =>
  [...gameTokens.value]
    .map((t) => ({
      label: t.name ? `${t.name}${t.server ? ` (${t.server})` : ""}` : t.id,
      value: t.name || t.id,
    })),
);

// 移动端检测：iOS/Android 等小屏设备自动切换为单列布局
const isMobile = ref(false);
const checkMobile = () => {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase());
  isMobile.value = isMobileUA || window.innerWidth <= 768;
};
const effectiveTokenListColumns = computed(() => {
  return isMobile.value ? 1 : batchSettings.tokenListColumns;
});


// Load batch settings from localStorage
const loadBatchSettings = () => {
  try {
    const saved = localStorage.getItem("batchSettings");
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(batchSettings, parsed);
    }
  } catch (error) {
    console.error("Failed to load batch settings:", error);
  }
};

// Save batch settings to localStorage
const saveBatchSettings = () => {
  try {
    localStorage.setItem("batchSettings", JSON.stringify(batchSettings));
    message.success("定时批量任务设置已保存");
    showBatchSettingsModal.value = false;
  } catch (error) {
    console.error("Failed to save batch settings:", error);
    message.error("保存设置失败");
  }
};

// Open batch settings modal
const openBatchSettings = () => {
  loadBatchSettings();
  showBatchSettingsModal.value = true;
};

// Load settings on component mount
loadBatchSettings();

// ======================
// Legacy Gift Feature
// ======================

// Legacy Gift Modal State
const showLegacyGiftModal = ref(false);
const recipientIdInput = ref("");
const recipientIdError = ref("");
const recipientInfo = ref(null);
const isQueryingRecipient = ref(false);
const giftQuantity = ref(10);
const securityPassword = ref(""); // 安全密码
// 头像加载状态
const isAvatarLoading = ref(false);
const avatarLoadError = ref(false);

// ======================
// Scheduled Tasks Feature
// ======================

// Scheduled Tasks State Management
const scheduledTasks = ref([]); // List of all scheduled tasks
const showTaskModal = ref(false); // Control the visibility of the add/edit task modal
const showTasksModal = ref(false); // Control the visibility of the tasks list modal
const editingTask = ref(null); // Currently editing task
const taskForm = reactive({
  name: "", // Task name
  runType: "daily", // 'daily' or 'cron'
  runTime: null, // Daily run time (HH:mm format)
  cronExpression: "", // Cron expression for complex scheduling
  selectedTokens: [], // Selected token IDs
  selectedTasks: [], // Selected task function names
  enabled: true, // Whether the task is enabled
});

// 任务分组定义
const taskGroupDefinitions = [
  {
    name: "daily",
    label: "日常",
    tasks: [
      "startBatch",
      "claimHangUpRewards",
      "batchAddHangUpTime",
      "resetBottles",
      "batchlingguanzi",
      "batchclubsign",
      "batchStudy",
      "batcharenafight",
      "batchSmartSendCar",
      "batchClaimCars",
      "batchCampChallenge",
      "batchCampChallengePet",
      "batchCampClaimTasks",
      "store_purchase",
      "collection_claimfreereward",
      "batchGenieSweep",
    ],
  },
  {
    name: "dungeon",
    label: "副本",
    tasks: [
      "climbTower",
      "batchmengjing",
      "skinChallenge",
      "batchClaimPeachTasks",
      "batchBuyDreamItems",
    ],
  },
  { name: "baoku", label: "宝库", tasks: ["batchbaoku13", "batchbaoku45"] },
  {
    name: "weirdTower",
    label: "怪异塔",
    tasks: [
      "climbWeirdTower",
      "batchUseItems",
      "batchMergeItems",
      "batchClaimFreeEnergy",
    ],
  },
  {
    name: "resource",
    label: "资源",
    tasks: [
      "batchOpenBox",
      "batchOpenBoxByPoints",
      "batchClaimBoxPointReward",
      "batchFish",
      "batchRecruit",
      "legion_storebuygoods",
    ],
  },
  {
    name: "legacy",
    label: "功法",
    tasks: ["batchLegacyClaim", "batchLegacyGiftSendEnhanced"],
  },
  {
    name: "monthly",
    label: "月度",
    tasks: ["batchTopUpFish", "batchTopUpArena"],
  },
];

// 计算属性，根据 taskGroupDefinitions 将 availableTasks 分组
const groupedAvailableTasks = computed(() => {
  const groups = {};
  taskGroupDefinitions.forEach((group) => {
    groups[group.name] = availableTasks.filter((task) =>
      group.tasks.includes(task.value),
    );
  });

  // 处理未分组的任务
  const groupedTaskValues = taskGroupDefinitions.flatMap((g) => g.tasks);
  const otherTasks = availableTasks.filter(
    (task) => !groupedTaskValues.includes(task.value),
  );
  if (otherTasks.length > 0) {
    groups["other"] = otherTasks;
  }

  return groups;
});

// Cron表达式解析相关变量
const cronValidation = ref({ valid: true, message: "" });
const cronNextRuns = ref([]);

// 注: availableTasks, CarresearchItem, taskColumns 已从 @/utils/batch 导入

// ======================
// Scheduled Tasks Storage
// ======================

// Track executing tasks for UI loading state
const executingTaskIds = ref([]);

// Manual execute task
const manualExecuteTask = async (task) => {
  if (executingTaskIds.value.includes(task.id)) return;

  // Reset stop flag if not running, to allow manual execution
  if (!isRunning.value && shouldStop.value) {
    shouldStop.value = false;
  }

  executingTaskIds.value.push(task.id);
  try {
    message.info(`开始执行任务: ${task.name}`);
    await executeScheduledTask(task);
    message.success(`任务 ${task.name} 执行完成`);
  } catch (e) {
    console.error(`执行任务 ${task.name} 失败:`, e);
    message.error(`任务 ${task.name} 执行失败`);
  } finally {
    executingTaskIds.value = executingTaskIds.value.filter(
      (id) => id !== task.id,
    );
  }
};

// Load scheduled tasks from localStorage
const loadScheduledTasks = () => {
  try {
    const saved = localStorage.getItem("scheduledTasks");

    if (saved) {
      const parsed = JSON.parse(saved);

      // Ensure we have an array
      scheduledTasks.value = Array.isArray(parsed) ? parsed : [];
    } else {
      scheduledTasks.value = [];
    }
  } catch (error) {
    console.error("Failed to load scheduled tasks:", error);
    scheduledTasks.value = [];
  }
};

// Save scheduled tasks to localStorage
const saveScheduledTasks = () => {
  try {
    const dataToSave = JSON.stringify(scheduledTasks.value);

    localStorage.setItem("scheduledTasks", dataToSave);
    // Verify save was successful
    const saved = localStorage.getItem("scheduledTasks");
  } catch (error) {
    console.error("Failed to save scheduled tasks:", error);
  }
};

// Open task modal for adding new task
const openTaskModal = () => {
  editingTask.value = null;
  Object.assign(taskForm, {
    name: "",
    runType: "daily",
    runTime: undefined,
    cronExpression: "",
    selectedTokens: [],
    selectedTasks: [],
    enabled: true,
  });
  taskScheduleSelectedGroupIds.value = [];
  showTaskModal.value = true;
};

// Edit existing task
const editTask = (task) => {
  editingTask.value = task;
  const taskData = { ...task };
  if (
    task.runType === "daily" &&
    task.runTime &&
    typeof task.runTime === "string"
  ) {
    const [hours, minutes] = task.runTime.split(":").map(Number);
    const now = new Date();
    taskData.runTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
    );
  }
  Object.assign(taskForm, taskData);
  taskScheduleSelectedGroupIds.value = [];
  showTaskModal.value = true;
};

// 注: validateCronExpression 已从 @/utils/batch 导入

// Parse cron expression and calculate next execution times
const parseCronExpression = (expression) => {
  // Validate the expression first
  const validation = validateCronExpression(expression);
  cronValidation.value = validation;

  if (!validation.valid) {
    cronNextRuns.value = [];
    return;
  }

  // Parse the expression and calculate next runs
  const cronParts = expression.split(" ").filter(Boolean);
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] =
    cronParts;

  // Calculate next 5 execution times
  const nextRuns = calculateNextRuns(
    minuteField,
    hourField,
    dayOfMonthField,
    monthField,
    dayOfWeekField,
    5,
  );
  cronNextRuns.value = nextRuns;
};

// 注: calculateNextRuns 已从 @/utils/batch 导入

// Save task (create or update)
const saveTask = () => {
  if (!taskForm.name) {
    message.warning("请输入任务名称");
    return;
  }

  if (taskForm.runType === "daily" && !taskForm.runTime) {
    message.warning("请选择运行时间");
    return;
  }

  if (taskForm.runType === "cron") {
    if (!taskForm.cronExpression) {
      message.warning("请输入Cron表达式");
      return;
    }

    // Validate cron expression
    const validation = validateCronExpression(taskForm.cronExpression);
    if (!validation.valid) {
      message.warning(validation.message);
      return;
    }
  }

  if (taskForm.selectedTokens.length === 0) {
    message.warning("请选择至少一个账号");
    return;
  }

  if (taskForm.selectedTasks.length === 0) {
    message.warning("请选择至少一个任务");
    return;
  }

  // Format runTime as string for storage
  let formattedRunTime = null;
  if (taskForm.runType === "daily" && taskForm.runTime) {
    const time = new Date(taskForm.runTime);
    formattedRunTime = time.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const taskData = {
    id: editingTask.value?.id || "task_" + Date.now(),
    name: taskForm.name,
    runType: taskForm.runType,
    runTime: formattedRunTime,
    cronExpression: taskForm.runType === "cron" ? taskForm.cronExpression : "",
    selectedTokens: [...taskForm.selectedTokens],
    selectedTasks: [...taskForm.selectedTasks],
    enabled: taskForm.enabled,
  };

  let isNew = !editingTask.value;

  if (editingTask.value) {
    // Update existing task
    const index = scheduledTasks.value.findIndex(
      (t) => t.id === editingTask.value.id,
    );
    if (index !== -1) {
      scheduledTasks.value[index] = taskData;
    }
  } else {
    // Add new task
    scheduledTasks.value.push(taskData);
  }

  saveScheduledTasks();

  // Add log entry for task save
  addTaskSaveLog(taskData, isNew, addLog);

  showTaskModal.value = false;
  message.success("定时任务已保存");
};

// Delete task
const deleteTask = (taskId) => {
  const task = scheduledTasks.value.find((t) => t.id === taskId);
  if (task) {
    scheduledTasks.value = scheduledTasks.value.filter((t) => t.id !== taskId);
    saveScheduledTasks();
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name} 已删除 ===`,
      type: "info",
    });
    message.success("定时任务已删除");
  }
};

// Toggle task enabled state
const toggleTaskEnabled = (taskId, enabled) => {
  const task = scheduledTasks.value.find((t) => t.id === taskId);
  if (task) {
    task.enabled = enabled;
    saveScheduledTasks();
    message.success(`定时任务已${enabled ? "启用" : "禁用"}`);
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务 ${task.name} 已${enabled ? "启用" : "禁用"} ===`,
      type: "info",
    });
  }
};

// 注: addTaskSaveLog 已从 @/utils/batch 导入，调用时需传入 addLog

// Reset run type related fields
const resetRunType = () => {
  if (taskForm.runType === "daily") {
    taskForm.cronExpression = "";
  } else {
    taskForm.runTime = undefined;
  }
};

// Select all tokens
const selectAllTokens = () => {
  taskForm.selectedTokens = tokens.value.map((token) => token.id);
};

// Deselect all tokens
const deselectAllTokens = () => {
  taskForm.selectedTokens = [];
};

// Select all tasks
const selectAllTasks = () => {
  taskForm.selectedTasks = availableTasks.map((task) => task.value);
};

// Deselect all tasks
const deselectAllTasks = () => {
  taskForm.selectedTasks = [];
};

// ======================
// Import/Export Config
// ======================

// Export all tokens and scheduled tasks configuration
const exportConfig = () => {
  try {
    // Get all valid token IDs
    const validTokenIds = new Set(tokens.value.map((t) => t.id));

    // Filter scheduled tasks: remove invalid token IDs from selectedTokens
    const filteredScheduledTasks = scheduledTasks.value
      .map((task) => ({
        ...task,
        selectedTokens:
          task.selectedTokens?.filter((tokenId) =>
            validTokenIds.has(tokenId),
          ) || [],
      }))
      .filter((task) => task.selectedTokens.length > 0); // Remove tasks with no valid tokens

    // Gather token settings
    const tokenSettings = [];
    tokens.value.forEach((token) => {
      const settings = localStorage.getItem(`daily-settings:${token.id}`);
      if (settings) {
        try {
          tokenSettings.push({
            tokenId: token.id,
            settings: JSON.parse(settings),
          });
        } catch (e) {
          console.warn(`Failed to parse settings for token ${token.id}`, e);
        }
      }
    });

    const exportData = {
      version: "1.1",
      exportTime: new Date().toISOString(),
      tokens: tokens.value.map((t) => ({
        id: t.id,
        name: t.name,
        token: t.token,
        server: t.server,
        wsUrl: t.wsUrl,
        remark: t.remark,
        importMethod: t.importMethod,
        sourceUrl: t.sourceUrl,
        upgradedToPermanent: true,
        upgradedAt: t.upgradedAt,
        updatedAt: t.updatedAt,
      })),
      scheduledTasks: filteredScheduledTasks,
      batchSettings: {
        boxCount: batchSettings.boxCount,
        fishCount: batchSettings.fishCount,
        recruitCount: batchSettings.recruitCount,
        defaultBoxType: batchSettings.defaultBoxType,
        defaultFishType: batchSettings.defaultFishType,
        carMinColor: batchSettings.carMinColor,
        commandDelay: batchSettings.commandDelay,
        taskDelay: batchSettings.taskDelay,
        actionDelay: batchSettings.actionDelay,
        battleDelay: batchSettings.battleDelay,
        refreshDelay: batchSettings.refreshDelay,
        longDelay: batchSettings.longDelay,
        maxActive: batchSettings.maxActive,
        tokenListColumns: batchSettings.tokenListColumns,
        useGoldRefreshFallback: batchSettings.useGoldRefreshFallback,
        smartDepartureGoldThreshold: batchSettings.smartDepartureGoldThreshold,
        smartDepartureRecruitThreshold:
          batchSettings.smartDepartureRecruitThreshold,
        smartDepartureJadeThreshold: batchSettings.smartDepartureJadeThreshold,
        smartDepartureTicketThreshold:
          batchSettings.smartDepartureTicketThreshold,
        smartDepartureMatchAll: batchSettings.smartDepartureMatchAll,
        designatedGuards: batchSettings.designatedGuards || [],
      },
      tokenSettings: tokenSettings,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xyzw_config_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    message.success(
      `导出成功: ${exportData.tokens.length} 个账号, ${exportData.scheduledTasks.length} 个定时任务`,
    );
  } catch (error) {
    console.error("Export failed:", error);
    message.error("导出失败: " + error.message);
  }
};

// Import tokens and scheduled tasks configuration
const importConfig = async ({ file }) => {
  try {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);

        // Validate structure
        if (
          !importData.version ||
          !importData.tokens ||
          !importData.scheduledTasks
        ) {
          message.error("无效的配置文件格式");
          return;
        }

        let importedTokens = 0;
        let importedTasks = 0;

        // Import tokens
        if (Array.isArray(importData.tokens)) {
          importData.tokens.forEach((token) => {
            // Check if token already exists
            const exists = gameTokens.value.some(
              (t) => t.token === token.token || t.id === token.id,
            );
            if (!exists && token.token) {
              // Add new token directly to gameTokens (useLocalStorage)
              gameTokens.value.push({
                id:
                  token.id ||
                  "token_" + Date.now() + Math.random().toString(36).slice(2),
                name: token.name || "",
                token: token.token,
                server: token.server || "",
                wsUrl: token.wsUrl || null,
                remark: token.remark || "",
                importMethod: "import",
                sourceUrl: token.sourceUrl || null,
                upgradedToPermanent: true,
                upgradedAt: token.upgradedAt || null,
                updatedAt: token.updatedAt || new Date().toISOString(),
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
              });
              importedTokens++;
            }
          });
        }

        // Import scheduled tasks
        if (Array.isArray(importData.scheduledTasks)) {
          importData.scheduledTasks.forEach((task) => {
            // Check if task already exists
            const exists = scheduledTasks.value.some((t) => t.id === task.id);
            if (!exists && task.id) {
              scheduledTasks.value.push(task);
              importedTasks++;
            }
          });
          saveScheduledTasks();
        }

        // Import batch settings if provided
        if (importData.batchSettings) {
          Object.assign(batchSettings, importData.batchSettings);
          saveBatchSettings();
        }

        // Import token settings
        if (Array.isArray(importData.tokenSettings)) {
          importData.tokenSettings.forEach((item) => {
            if (item.tokenId && item.settings) {
              localStorage.setItem(
                `daily-settings:${item.tokenId}`,
                JSON.stringify(item.settings),
              );
            }
          });
        }

        message.success(
          `导入成功: ${importedTokens} 个新账号, ${importedTasks} 个新定时任务`,
        );
      } catch (parseError) {
        console.error("Parse error:", parseError);
        message.error("解析配置文件失败");
      }
    };
    reader.readAsText(file.file);
  } catch (error) {
    console.error("Import failed:", error);
    message.error("导入失败: " + error.message);
  }
};

// ======================
// Scheduled Tasks Countdown
// ======================

// 注: parseCronField, calculateNextExecutionTime, formatTimeDifference 已从 @/utils/batch 导入

// Task countdowns ref
const taskCountdowns = ref({});
const nextExecutionTimes = ref({});

// Update countdowns for all tasks
const updateCountdowns = () => {
  const now = Date.now();

  scheduledTasks.value.forEach((task) => {
    if (!task.enabled) {
      // Clear countdown for disabled tasks
      delete taskCountdowns.value[task.id];
      return;
    }

    if (
      !nextExecutionTimes.value[task.id] ||
      nextExecutionTimes.value[task.id] <= now
    ) {
      // Calculate next execution time if not set or passed
      nextExecutionTimes.value[task.id] = calculateNextExecutionTime(task);
    }

    if (nextExecutionTimes.value[task.id]) {
      const timeDiff = nextExecutionTimes.value[task.id] - now;
      taskCountdowns.value[task.id] = {
        remainingTime: Math.max(0, timeDiff),
        formatted: formatTimeDifference(Math.max(0, timeDiff)),
        isNearExecution: timeDiff < 5 * 60 * 1000, // Less than 5 minutes
      };
    }
  });
};

// 计算最短倒计时任务
const shortestCountdownTask = computed(() => {
  if (scheduledTasks.value.length === 0) return null;

  let shortestTask = null;
  let shortestTime = Infinity;

  // 遍历所有任务，找到倒计时最短的任务
  scheduledTasks.value.forEach((task) => {
    if (!task.enabled) return;

    const countdown = taskCountdowns.value[task.id];
    if (countdown && countdown.remainingTime < shortestTime) {
      shortestTime = countdown.remainingTime;
      shortestTask = {
        task,
        countdown,
      };
    }
  });

  return shortestTask;
});

// Start countdown interval
let countdownInterval = null;

const startCountdown = () => {
  // Clear any existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Update countdowns immediately
  updateCountdowns();

  // Update countdowns every second
  countdownInterval = setInterval(updateCountdowns, 1000);
};

// ======================
// Scheduled Tasks Scheduler
// ======================

// Initialize scheduled tasks from localStorage
loadScheduledTasks();

// Watch for changes to scheduledTasks for debugging
watch(
  scheduledTasks,
  (newVal) => {
    // Reset countdowns when tasks change
    nextExecutionTimes.value = {};
    taskCountdowns.value = {};
    updateCountdowns();
  },
  { deep: true },
);

// 修复TimePicker的"Invalid time value"错误：确保runTime的初始值不是null
watch(
  () => showTaskModal.value,
  (isVisible) => {
    if (isVisible && !taskForm.runTime) {
      // 当模态框显示且runTime为null时，将其设置为undefined
      taskForm.runTime = undefined;
    }
  },
);

// Task scheduler variables - moved to component level scope
const intervalId = ref(null);
let lastTaskExecution = null;
let healthCheckInterval = null;
const pageLoadTime = Date.now();

// Health check for the scheduler
const healthCheck = () => {
  // If interval is not running, restart it
  if (!intervalId.value) {
    console.error(
      `[${new Date().toISOString()}] Task scheduler interval is not running, restarting...`,
    );
    startScheduler();
  }

  // Add a safety mechanism to prevent isRunning from being stuck
  if (isRunning.value) {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000; // 10 minutes ago
    if (lastTaskExecution && lastTaskExecution < tenMinutesAgo) {
      console.error(
        `[${new Date().toISOString()}] isRunning has been true for more than 10 minutes, resetting to false`,
      );
      isRunning.value = false;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: "=== 检测到任务执行超时，已重置isRunning状态 ===",
        type: "warning",
      });
    }
  }

  // Check for page refresh
  if (batchSettings.enableRefresh && batchSettings.refreshInterval > 0) {
    const elapsedMinutes = (Date.now() - pageLoadTime) / 1000 / 60;
    if (elapsedMinutes >= batchSettings.refreshInterval) {
      if (!isRunning.value) {
        console.log(
          `[${new Date().toISOString()}] Refreshing page as scheduled (Interval: ${batchSettings.refreshInterval}m, Elapsed: ${elapsedMinutes.toFixed(1)}m)`,
        );
        window.location.reload();
      } else {
        console.log(
          `[${new Date().toISOString()}] Scheduled refresh postponed due to running task`,
        );
      }
    }
  }
};

// Start the scheduler
const startScheduler = () => {
  // Clear any existing interval first
  if (intervalId.value) {
    clearInterval(intervalId.value);
  }

  // Check every 10 seconds instead of 60 seconds for more timely task execution
  intervalId.value = setInterval(() => {
    try {
      const now = new Date();
      const currentTime = now.toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      // Don't skip all tasks if isRunning is true, just skip individual task execution if already running
      const tasksToRun = scheduledTasks.value.filter((task) => task.enabled);

      if (tasksToRun.length === 0) {
        return;
      }

      tasksToRun.forEach((task) => {
        let shouldRun = false;
        let reason = "";

        if (task.runType === "daily") {
          // Check if current time matches the scheduled time
          const taskTime = task.runTime;
          const nowTime = now.toLocaleTimeString("zh-CN", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
          });
          shouldRun = nowTime === taskTime;
          reason = `currentTime=${nowTime}, taskTime=${taskTime}, match=${shouldRun}`;
        } else if (task.runType === "cron") {
          // Improved cron expression parsing using shared utility
          try {
            shouldRun = matchesCronExpression(task.cronExpression, now);
          } catch (error) {
            console.error(
              `[${new Date().toISOString()}] Error parsing cron expression ${task.cronExpression}:`,
              error,
            );
            addLog({
              time: currentTime,
              message: `=== 解析定时任务 ${task.name} 的Cron表达式失败: ${error.message} ===`,
              type: "error",
            });
            return;
          }
        }

        if (shouldRun) {
          // Check if the task was already executed in the last minute to avoid duplicate execution
          const taskExecutionKey = `${task.id}_${now.getDate()}_${now.getHours()}_${now.getMinutes()}`;
          const lastExecutionKey = localStorage.getItem(
            `lastTaskExecution_${task.id}`,
          );

          if (lastExecutionKey !== taskExecutionKey) {
            // Update last execution time
            localStorage.setItem(
              `lastTaskExecution_${task.id}`,
              taskExecutionKey,
            );

            // Execute the task
            lastTaskExecution = Date.now();
            executeScheduledTask(task);
          } else {
            // Only log once per minute to avoid spamming logs
            // But since we check every 10s, this might log multiple times if we don't track logged state
            // For now, we can skip logging "already executed" to keep logs clean
          }
        }
      });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error in task scheduler:`,
        error,
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务调度服务发生错误: ${error.message} ===`,
        type: "error",
      });
    }
  }, 10000); // Check every 10 seconds
};

// Token刷新等待处理函数
const handleTokenRefreshWaiting = (data) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `Token刷新限流等待中，预计等待 ${data.waitSeconds} 秒（队列: ${data.queueSize}）`,
    type: "warning",
  });
};

// Debug: Log initial state when component mounts
onMounted(() => {
  // Start the task scheduler after all functions are initialized
  scheduleTaskExecution();
  // Start countdown timer
  startCountdown();
  loadTaskTemplates();
  // 监听Token刷新等待事件
  $emit.on("token:refresh:waiting", handleTokenRefreshWaiting);
  // 移动端检测
  checkMobile();
  window.addEventListener("resize", checkMobile);
  // 监听页面可见性变化，恢复 wake lock
  document.addEventListener("visibilitychange", handleWakeLockVisibility);
});

// Cleanup countdown interval on unmount
onBeforeUnmount(() => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // 移除Token刷新等待事件监听
  $emit.off("token:refresh:waiting", handleTokenRefreshWaiting);

  // 移除移动端检测监听
  window.removeEventListener("resize", checkMobile);

  // 移除 wake lock 可见性监听，并释放 wake lock
  document.removeEventListener("visibilitychange", handleWakeLockVisibility);
  releaseWakeLock();

  // Cleanup task scheduler intervals
  if (intervalId.value) {
    clearInterval(intervalId.value);
    intervalId.value = null;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "=== 定时任务调度服务已停止 ===",
      type: "info",
    });
  }

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
});

// Task scheduler - ensure it runs properly
const scheduleTaskExecution = () => {
  // Log the start of the scheduler
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "=== 定时任务调度服务已启动 ===",
    type: "info",
  });

  // Start the scheduler
  startScheduler();

  // Health check every 5 minutes instead of 1 hour for more frequent safety checks
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  healthCheckInterval = setInterval(healthCheck, 5 * 60 * 1000);

  // Initial health check
  healthCheck();
};

// Verify task dependencies - 只验证基础依赖，WebSocket连接由具体任务函数处理
const verifyTaskDependencies = async (task) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始验证定时任务 ${task.name} 的依赖 ===`,
    type: "info",
  });

  // Verify localStorage is available
  try {
    localStorage.setItem("test", "test");
    localStorage.removeItem("test");
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "✅ localStorage可用",
      type: "info",
    });
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `❌ localStorage不可用: ${error.message}`,
      type: "error",
    });
    return false;
  }

  // Verify token store is available
  if (!tokenStore || !tokenStore.gameTokens) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: "❌ Token存储不可用",
      type: "error",
    });
    return false;
  }

  // Verify task functions exist
  for (const taskName of task.selectedTasks) {
    const taskFunction = eval(taskName);
    if (typeof taskFunction !== "function") {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `❌ 任务函数不存在: ${taskName}`,
        type: "error",
      });
      return false;
    }
  }

  // 直接使用所有选中的token，WebSocket连接由具体任务函数内部管理
  // ensureConnection函数会自动处理并行连接和连接池管理
  const connectedTokens = task.selectedTokens.map((tokenId) => {
    const tokenName =
      tokenStore.gameTokens.find((t) => t.id === tokenId)?.name || tokenId;
    return { id: tokenId, name: tokenName };
  });

  // Log connection status
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `✅ 将使用 ${connectedTokens.length} 个账号执行任务`,
    type: "info",
  });

  // Store connected tokens for execution
  task.connectedTokens = connectedTokens.map((t) => t.id);

  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 定时任务 ${task.name} 的依赖验证通过，将执行 ${connectedTokens.length} 个账号 ===`,
    type: "success",
  });
  return true;
};

// Execute a scheduled task with dependency verification
const executeScheduledTask = async (task) => {
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始执行定时任务: ${task.name} ===`,
    type: "info",
  });

  try {
    // Verify dependencies before executing task
    const dependenciesValid = await verifyTaskDependencies(task);
    if (!dependenciesValid) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务 ${task.name} 依赖验证失败，取消执行 ===`,
        type: "error",
      });
      return;
    }

    // Filter out tokens that don't exist in current tokens.value
    const availableTokens = (
      task.connectedTokens || task.selectedTokens
    ).filter((tokenId) => {
      return tokens.value.some((t) => t.id === tokenId);
    });

    const missingTokens = (task.connectedTokens || task.selectedTokens).filter(
      (tokenId) => {
        return !tokens.value.some((t) => t.id === tokenId);
      },
    );

    if (missingTokens.length > 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `⚠️  跳过不存在的Token: ${missingTokens.join(", ")}`,
        type: "warning",
      });
    }

    if (availableTokens.length === 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 定时任务 ${task.name} 没有可用的Token，取消执行 ===`,
        type: "error",
      });
      return;
    }

    // Always use the latest selectedTokens from the task that exist in current tokens.value
    selectedTokens.value = [...availableTokens];

    // Execute selected tasks in parallel
    const taskPromises = task.selectedTasks.map(async (taskName) => {
      if (shouldStop.value) return;

      if (
        ["batchbaoku45", "batchbaoku13"].includes(taskName) &&
        !isbaokuActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在宝库开放时间)`,
          type: "warning",
        });
        return;
      }

      if (
        ["batchmengjing", "batchBuyDreamItems"].includes(taskName) &&
        !ismengjingActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在梦境开放时间)`,
          type: "warning",
        });
        return;
      }

      if (
        ["batchSmartSendCar"].includes(taskName) &&
        !isCarActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在发车开放时间)`,
          type: "warning",
        });
        return;
      }

      if (
        ["batchTopUpArena", "batcharenafight"].includes(taskName) &&
        !isarenaActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在竞技场开放时间)`,
          type: "warning",
        });
        return;
      }

      if (
        [
          "climbWeirdTower",
          "batchUseItems",
          "batchMergeItems",
          "batchClaimFreeEnergy",
        ].includes(taskName) &&
        !isWeirdTowerActivityOpen.value
      ) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `跳过任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName} (不在怪异塔开放时间)`,
          type: "warning",
        });
        return;
      }

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `执行任务: ${availableTasks.find((t) => t.value === taskName)?.label || taskName}`,
        type: "info",
      });

      // Call the task function dynamically
      const taskFunction = eval(taskName);
      if (typeof taskFunction === "function") {
        // For batch operations, pass isScheduledTask = true
        // 具体的batch任务函数内部会使用ensureConnection管理并行连接
        if (
          [
            "batchOpenBox",
            "batchOpenBoxByPoints",
            "batchFish",
            "batchRecruit",
            "batchLegacyGiftSendEnhanced",
          ].includes(taskName)
        ) {
          await taskFunction(true);
        } else {
          await taskFunction();
        }
      } else {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `任务函数不存在: ${taskName}`,
          type: "error",
        });
      }
    });

    // Wait for all tasks to complete
    await Promise.all(taskPromises);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务执行完成: ${task.name} ===`,
      type: "success",
    });
  } catch (error) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 定时任务执行失败: ${error.message} ===`,
      type: "error",
    });
    console.error(
      `[${new Date().toISOString()}] Error executing scheduled task ${task.name}:`,
      error,
    );
  }
};

// 注: boxTypeOptions, fishTypeOptions 已从 @/utils/batch 导入

const openHelperModal = (type) => {
  helperType.value = type;
  showHelperModal.value = true;
};

// 批量功法残卷赠送相关方法
const clearRecipientError = () => {
  recipientIdError.value = "";
};

const validateRecipientId = (value) => {
  if (!value || value === "") {
    return true; // 允许为空，由按钮禁用控制
  }
  if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
    recipientIdError.value = "请输入有效的数字ID";
    return false;
  }
  return true;
};

// 头像处理方法
const handleAvatarLoad = () => {
  isAvatarLoading.value = false;
  avatarLoadError.value = false;
};

const handleAvatarError = () => {
  isAvatarLoading.value = false;
  avatarLoadError.value = true;
};

const resetAvatarState = () => {
  isAvatarLoading.value = true;
  avatarLoadError.value = false;
};

const queryRecipientInfo = async () => {
  // 1. 输入验证
  if (!recipientIdInput.value || recipientIdInput.value === "") {
    recipientIdError.value = "请输入接收者ID";
    return;
  }

  const recipientId = Number(recipientIdInput.value);
  if (!Number.isInteger(recipientId) || recipientId <= 0) {
    recipientIdError.value = "请输入有效的数字ID";
    return;
  }

  // 2. 检查选中账号
  if (selectedTokens.value.length === 0) {
    recipientIdError.value = "请先选择要操作的角色";
    return;
  }

  // 3. 初始化状态
  isQueryingRecipient.value = true;
  recipientIdError.value = "";
  recipientInfo.value = null;
  // 重置头像状态
  resetAvatarState();

  const firstTokenId = selectedTokens.value[0];
  const token = tokens.value.find((t) => t.id === firstTokenId);

  // 记录开始查询
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始查询接收者信息: 使用账号 ${token.name} (ID: ${firstTokenId}) ===`,
    type: "info",
  });

  try {
    // 确保WebSocket连接
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在建立WebSocket连接...`,
      type: "info",
    });

    // 使用现有的ensureConnection函数，它已经包含了重连机制
    await ensureConnection(firstTokenId);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `WebSocket连接成功`,
      type: "success",
    });

    // 发送查询命令
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在发送查询命令，接收者ID: ${recipientId}`,
      type: "info",
    });

    // 延长超时时间到10秒，确保有足够时间处理
    const resp = await tokenStore.sendMessageWithPromise(
      firstTokenId,
      "rank_getroleinfo",
      {
        bottleType: 0,
        includeBottleTeam: false,
        isSearch: false,
        roleId: recipientId,
      },
      10000,
    );

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `查询命令发送成功，正在处理响应...`,
      type: "info",
    });

    // 处理查询结果
    console.log("rank_getroleinfo 响应结果:", resp);

    // 兼容不同的响应结构
    const roleData = resp?.role || resp?.roleInfo;

    if (roleData) {
      // 构建完整的角色信息，移除等级和VIP字段
      recipientInfo.value = {
        roleId: roleData.roleId || roleData.role?.roleId,
        name: roleData.name || roleData.role?.name,
        // 添加头像URL
        avatarUrl:
          resp?.roleInfo?.headImg ||
          roleData?.headImg ||
          roleData?.role?.headImg ||
          "",
        // 战力转换为亿为单位
        power: (function (p) {
          const billion = 100000000;
          return (p / billion).toFixed(2);
        })(roleData.power || roleData.role?.power || 0),
        powerUnit: "亿",
        // 扩展更多角色信息
        serverName: roleData.serverName || roleData.role?.serverName || "",
        legionName: resp?.legionInfo?.name || "",
        legionId: resp?.legionInfo?.id || 0,
      };

      // 格式化角色名，处理特殊字符
      const displayName = recipientInfo.value.name || "未知角色";

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 查询成功: 找到角色 ${displayName} (ID: ${recipientInfo.value.roleId})，战力: ${recipientInfo.value.power}${recipientInfo.value.powerUnit} ===`,
        type: "success",
      });

      message.success("查询成功");
    } else {
      const errorMsg = "未找到该角色信息";
      recipientIdError.value = errorMsg;

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 查询失败: ${errorMsg} ===`,
        type: "error",
      });

      message.error(errorMsg);
    }
  } catch (error) {
    // 详细的错误处理
    console.error("查询接收者信息失败:", error);

    let errorMsg = "查询失败";
    let logType = "error";

    // 根据错误类型提供更友好的错误信息
    if (error.message.includes("连接失败")) {
      errorMsg = "WebSocket连接失败，请检查网络或账号状态";
    } else if (
      error.message.includes("timeout") ||
      error.message.includes("超时")
    ) {
      errorMsg = "查询超时，请稍后重试";
      logType = "warning";
    } else if (error.message.includes("200160")) {
      errorMsg = "功法系统未开启";
    } else {
      errorMsg = `查询失败: ${error.message}`;
    }

    recipientIdError.value = errorMsg;

    // 记录错误日志
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== ${errorMsg} ===`,
      type: logType,
    });

    // 显示用户友好的错误提示
    message.error(errorMsg);
  } finally {
    isQueryingRecipient.value = false;

    // 记录查询完成
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 查询操作完成 ===`,
      type: "info",
    });
  }
};

const confirmLegacyGift = async () => {
  if (!recipientIdInput.value || !recipientInfo.value) {
    message.error("请先查询并确认接收者信息");
    return;
  }

  if (!securityPassword.value) {
    message.error("请输入安全密码");
    return;
  }

  // 调用增强版批量赠送功能
  await batchLegacyGiftSendEnhanced();

  // 关闭模态框
  showLegacyGiftModal.value = false;
  // 清空安全密码
  securityPassword.value = "";
};

const executeHelper = () => {
  if (helperType.value !== "pointsBox") {
    if (helperSettings.count % 10 !== 0 || helperSettings.count < 10) {
      message.warning("消耗数量必须是10的整数倍，最小为10");
      return;
    }
  }
  showHelperModal.value = false;
  if (helperType.value === "box") {
    batchOpenBox();
  } else if (helperType.value === "fish") {
    batchFish();
  } else if (helperType.value === "recruit") {
    batchRecruit();
  } else if (helperType.value === "pointsBox") {
    batchOpenBoxByPoints();
  }
};

// Dream Buy Modal Logic
const showDreamBuyModal = ref(false);
const dreamBuyList = ref([]);

const openDreamBuyModal = () => {
  // Load saved settings
  dreamBuyList.value = batchSettings.dreamPurchaseList || [];
  showDreamBuyModal.value = true;
};

const toggleDreamItem = (itemKey, checked) => {
  if (checked) {
    if (!dreamBuyList.value.includes(itemKey)) {
      dreamBuyList.value.push(itemKey);
    }
  } else {
    dreamBuyList.value = dreamBuyList.value.filter((k) => k !== itemKey);
  }
};

const saveDreamBuyConfig = () => {
  // Save settings
  batchSettings.dreamPurchaseList = [...dreamBuyList.value];
  saveBatchSettings();

  showDreamBuyModal.value = false;
  message.success("梦境购买配置已保存");
};

const selectGoldItems = () => {
  const newSelection = new Set(dreamBuyList.value);

  for (const merchantId in goldItemsConfig) {
    const items = goldItemsConfig[merchantId];
    items.forEach((index) => {
      newSelection.add(`${merchantId}-${index}`);
    });
  }

  dreamBuyList.value = Array.from(newSelection);
};

const selectAllItems = () => {
  const newSelection = new Set(dreamBuyList.value);

  for (const merchantId in merchantConfig) {
    const items = merchantConfig[merchantId].items;
    items.forEach((_, index) => {
      newSelection.add(`${merchantId}-${index}`);
    });
  }

  dreamBuyList.value = Array.from(newSelection);
};

const clearAllItems = () => {
  dreamBuyList.value = [];
};

// 注: formationOptions, bossTimesOptions 已从 @/utils/batch 导入

const loadSettings = (tokenId) => {
  try {
    const raw = localStorage.getItem(`daily-settings:${tokenId}`);
    const defaultSettings = {
      arenaFormation: 1,
      towerFormation: 1,
      bossFormation: 1,
      bossTimes: 2,
      claimBottle: true,
      payRecruit: true,
      openBox: true,
      arenaEnable: true,
      claimHangUp: true,
      claimEmail: true,
      blackMarketPurchase: true,
    };
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch (error) {
    console.error("Failed to load settings:", error);
    return null;
  }
};

const openSettings = (token) => {
  currentSettingsTokenId.value = token.id;
  currentSettingsTokenName.value = token.name;
  const saved = loadSettings(token.id);
  Object.assign(currentSettings, saved);
  showSettingsModal.value = true;
};

const saveSettings = () => {
  if (currentSettingsTokenId.value) {
    localStorage.setItem(
      `daily-settings:${currentSettingsTokenId.value}`,
      JSON.stringify(currentSettings),
    );
    message.success(`已保存 ${currentSettingsTokenName.value} 的设置`);
    showSettingsModal.value = false;
  }
};

// Task Template Functions
const openTaskTemplateModal = () => {
  // 加载模板列表
  loadTaskTemplates();
  // 重置当前模板
  Object.assign(currentTemplate, {
    arenaFormation: 1,
    towerFormation: 1,
    bossFormation: 1,
    bossTimes: 2,
    claimBottle: true,
    payRecruit: true,
    openBox: true,
    arenaEnable: true,
    claimHangUp: true,
    claimEmail: true,
    blackMarketPurchase: true,
  });
  currentTemplateName.value = "";
  showTaskTemplateModal.value = true;
};

const loadTaskTemplates = () => {
  const templates = localStorage.getItem("task-templates");
  const parsed = templates ? JSON.parse(templates) : [];
  taskTemplates.value = parsed;
  return parsed;
};

const openApplyTemplateModal = () => {
  // 加载模板列表
  loadTaskTemplates();
  // 重置选择
  selectedTemplateId.value = null;
  selectedTokensForApply.value = [];
  showApplyTemplateModal.value = true;
};

const handleSelectAllForApply = (checked) => {
  if (checked) {
    selectedTokensForApply.value = sortedTokens.value.map((token) => token.id);
  } else {
    selectedTokensForApply.value = [];
  }
};

const applyTemplate = () => {
  if (!selectedTemplateId.value || selectedTokensForApply.value.length === 0) {
    message.error("请选择模板和要应用的账号");
    return;
  }

  // 找到选中的模板
  const templates = loadTaskTemplates();
  const template = templates.find((t) => t.id === selectedTemplateId.value);
  if (!template) {
    message.error("模板不存在");
    return;
  }

  // 应用模板到选中的账号
  let successCount = 0;
  selectedTokensForApply.value.forEach((tokenId) => {
    // 保存账号设置时同时保存模板ID
    const accountSettings = {
      ...template.settings,
      templateId: template.id, // 记录模板ID
    };
    localStorage.setItem(
      `daily-settings:${tokenId}`,
      JSON.stringify(accountSettings),
    );
    successCount++;
  });

  message.success(`已成功应用模板到 ${successCount} 个账号`);
  showApplyTemplateModal.value = false;
};

// Template Manager Functions
const openTemplateManagerModal = () => {
  // 加载模板列表
  loadTaskTemplates();
  showTemplateManagerModal.value = true;
};

const openEditTemplateModal = (template) => {
  // 加载模板数据到当前编辑模板
  currentTemplateId.value = template.id;
  currentTemplateName.value = template.name;
  Object.assign(currentTemplate, template.settings);
  showTaskTemplateModal.value = true;
};

const updateTaskTemplate = () => {
  if (!currentTemplateName.value.trim()) {
    message.error("请输入模板名称");
    return;
  }

  // 找到并更新模板
  const templates = loadTaskTemplates();
  const templateIndex = templates.findIndex(
    (t) => t.id === currentTemplateId.value,
  );
  if (templateIndex === -1) {
    message.error("模板不存在");
    return;
  }

  // 更新模板
  templates[templateIndex] = {
    ...templates[templateIndex],
    name: currentTemplateName.value.trim(),
    settings: {
      ...currentTemplate,
    },
    updatedAt: new Date().toISOString(),
  };

  // 保存模板到localStorage
  localStorage.setItem("task-templates", JSON.stringify(templates));

  // 更新模板列表
  taskTemplates.value = templates;

  message.success(`已更新模板 "${templates[templateIndex].name}"`);
  showTaskTemplateModal.value = false;

  // 重置编辑状态
  resetTemplateForm();
};

const deleteTaskTemplate = (templateId) => {
  // 确认删除
  if (confirm("确定要删除这个模板吗？")) {
    // 找到并删除模板
    const templates = loadTaskTemplates();
    const filteredTemplates = templates.filter((t) => t.id !== templateId);

    // 保存模板到localStorage
    localStorage.setItem("task-templates", JSON.stringify(filteredTemplates));

    // 更新模板列表
    taskTemplates.value = filteredTemplates;

    message.success("模板已删除");
  }
};

const resetTemplateForm = () => {
  currentTemplateId.value = null;
  currentTemplateName.value = "";
  Object.assign(currentTemplate, {
    arenaFormation: 1,
    towerFormation: 1,
    bossFormation: 1,
    bossTimes: 2,
    claimBottle: true,
    payRecruit: true,
    openBox: true,
    arenaEnable: true,
    claimHangUp: true,
    claimEmail: true,
    blackMarketPurchase: true,
  });
};

const openAccountTemplateModal = () => {
  // 加载账号模板引用关系
  loadAccountTemplateReferences();
  showAccountTemplateModal.value = true;
};

const loadAccountTemplateReferences = () => {
  const templates = loadTaskTemplates();
  const references = [];

  // 遍历所有账号，获取其模板引用
  sortedTokens.value.forEach((token) => {
    const settingsStr = localStorage.getItem(`daily-settings:${token.id}`);
    if (settingsStr) {
      try {
        const settings = JSON.parse(settingsStr);
        const templateId = settings.templateId;
        const template = templates.find((t) => t.id === templateId);

        references.push({
          tokenId: token.id,
          tokenName: token.name,
          templateId: templateId,
          templateName: template ? template.name : "未引用模板",
        });
      } catch (e) {
        console.error(`解析账号 ${token.name} 的设置失败:`, e);
      }
    } else {
      // 没有设置的账号
      references.push({
        tokenId: token.id,
        tokenName: token.name,
        templateId: null,
        templateName: "未引用模板",
      });
    }
  });

  accountTemplateReferences.value = references;
  filteredAccountTemplates.value = references;
};

const filterAccountTemplates = () => {
  if (!selectedTemplateForFilter.value) {
    filteredAccountTemplates.value = accountTemplateReferences.value;
  } else {
    filteredAccountTemplates.value = accountTemplateReferences.value.filter(
      (item) => item.templateId === selectedTemplateForFilter.value,
    );
  }
};

const openNewTemplateModal = () => {
  // 重置表单，准备创建新模板
  resetTemplateForm();
  showTaskTemplateModal.value = true;
};

// 修改saveTaskTemplate函数，支持新增和编辑
const saveTaskTemplate = () => {
  if (!currentTemplateName.value.trim()) {
    message.error("请输入模板名称");
    return;
  }

  const templates = loadTaskTemplates();

  if (currentTemplateId.value) {
    // 更新现有模板
    updateTaskTemplate();
  } else {
    // 创建新模板
    const template = {
      id: Date.now().toString(),
      name: currentTemplateName.value.trim(),
      settings: {
        ...currentTemplate,
      },
      createdAt: new Date().toISOString(),
    };

    // 添加新模板
    templates.push(template);
    localStorage.setItem("task-templates", JSON.stringify(templates));

    // 更新模板列表
    taskTemplates.value = templates;

    message.success(`已保存模板 "${template.name}"`);
    showTaskTemplateModal.value = false;

    // 重置表单
    resetTemplateForm();
  }
};

const currentRunningTokenId = ref(null);
const logs = ref([]);
const logContainer = ref(null);
const autoScrollLog = ref(true);
const filterErrorsOnly = ref(false);
const errorCount = computed(() => {
  return logs.value.filter((log) => log.type === "error").length;
});

const filteredLogs = computed(() => {
  if (filterErrorsOnly.value) {
    return logs.value.filter((log) => log.type === "error");
  }
  return logs.value;
});

const currentRunningTokenName = computed(() => {
  const t = tokens.value.find((x) => x.id === currentRunningTokenId.value);
  return t ? t.name : "";
});

// 批量任务进度：已完成账号数 / 已选中账号数
const completedTokenCount = computed(() => {
  return selectedTokens.value.filter((id) => {
    const s = tokenStatus.value[id];
    return s === "completed" || s === "failed";
  }).length;
});

const batchProgressPercentage = computed(() => {
  const total = selectedTokens.value.length;
  if (total === 0) return 0;
  return Math.round((completedTokenCount.value / total) * 100);
});

// 已完成账号名称列表（用于进度条 tooltip 展示）
const completedTokenNames = computed(() => {
  return selectedTokens.value
    .filter((id) => {
      const s = tokenStatus.value[id];
      return s === "completed" || s === "failed";
    })
    .map((id) => {
      const t = tokens.value.find((x) => x.id === id);
      const status = tokenStatus.value[id];
      const suffix = status === "failed" ? " (失败)" : "";
      return `${t?.name || id}${suffix}`;
    });
});

// 选中账号变化时，清空进度状态（重置进度条）
watch(
  () => [...selectedTokens.value],
  () => {
    if (!isRunning.value) {
      tokenStatus.value = {};
    }
  },
);

// Selection logic
const isAllSelected = computed(
  () =>
    selectedTokens.value.length === tokens.value.length &&
    tokens.value.length > 0,
);
const isIndeterminate = computed(
  () =>
    selectedTokens.value.length > 0 &&
    selectedTokens.value.length < tokens.value.length,
);

const handleSelectAll = (checked) => {
  if (checked) {
    selectedTokens.value = tokens.value.map((t) => t.id);
  } else {
    selectedTokens.value = [];
  }
};

const getStatusType = (tokenId) => {
  const status = tokenStatus.value[tokenId];
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  return "default";
};

const getStatusText = (tokenId) => {
  const status = tokenStatus.value[tokenId];
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "执行中";
  return "等待中";
};

// =====================
// Token分组管理相关方法
// =====================

/**
 * 创建新分组
 */
const createNewGroup = () => {
  if (!newGroupName.value.trim()) {
    message.warning("请输入分组名称");
    return;
  }

  const newGroup = tokenStore.createTokenGroup(
    newGroupName.value.trim(),
    newGroupColor.value,
  );

  // 添加选中的Token到新分组
  if (newGroupSelectedTokens.value.length > 0) {
    newGroupSelectedTokens.value.forEach((tokenId) => {
      tokenStore.addTokenToGroup(newGroup.id, tokenId);
    });
  }

  message.success("分组创建成功");
  newGroupName.value = "";
  newGroupColor.value = "#1677ff";
  newGroupSelectedTokens.value = [];
};

const selectAllNewGroup = () => {
  newGroupSelectedTokens.value = sortedTokens.value.map((t) => t.id);
};

const deselectAllNewGroup = () => {
  newGroupSelectedTokens.value = [];
};

/**
 * 删除分组
 */
const deleteGroup = (groupId) => {
  if (confirm("确定要删除这个分组吗？分组中的token不会被删除。")) {
    tokenStore.deleteTokenGroup(groupId);
    message.success("分组已删除");
  }
};

/**
 * 保存编辑的分组
 */
const saveEditGroup = () => {
  if (!editingGroupId.value) return;

  if (!editingGroupName.value.trim()) {
    message.warning("请输入分组名称");
    return;
  }

  tokenStore.updateTokenGroup(editingGroupId.value, {
    name: editingGroupName.value.trim(),
    color: editingGroupColor.value,
  });

  message.success("分组已更新");
  editingGroupId.value = null;
  editingGroupName.value = "";
  editingGroupColor.value = "";
};

/**
 * 开始编辑分组
 */
const startEditGroup = (groupId) => {
  const group = tokenGroups.value.find((g) => g.id === groupId);
  if (group) {
    editingGroupId.value = groupId;
    editingGroupName.value = group.name;
    editingGroupColor.value = group.color;
  }
};

/**
 * 取消编辑分组
 */
const cancelEditGroup = () => {
  editingGroupId.value = null;
  editingGroupName.value = "";
  editingGroupColor.value = "";
};

/**
 * 切换分组选择状态
 */
const toggleGroupSelection = (groupId) => {
  const index = selectedGroups.value.indexOf(groupId);
  if (index > -1) {
    selectedGroups.value.splice(index, 1);
  } else {
    selectedGroups.value.push(groupId);
  }

  // 更新selectedTokens
  updateSelectedTokensFromGroups();
};

/**
 * 判断分组是否被选中
 */
const isGroupSelected = (groupId) => {
  return selectedGroups.value.includes(groupId);
};

/**
 * 根据选中的分组更新selectedTokens
 */
const updateSelectedTokensFromGroups = () => {
  const tokenIds = new Set();

  selectedGroups.value.forEach((groupId) => {
    const validTokenIds = tokenStore.getValidGroupTokenIds(groupId);
    validTokenIds.forEach((id) => tokenIds.add(id));
  });

  selectedTokens.value = Array.from(tokenIds);
};

/**
 * 一键清除所有分组选择
 */
const clearAllGroupSelection = () => {
  selectedGroups.value = [];
  selectedTokens.value = [];
};

/**
 * 分组拖动排序（拖拽分组标签改变顺序，顺序自动持久化到 localStorage）
 */
const draggingGroupId = ref(null);
const dragOverGroupId = ref(null);

const onGroupDragStart = (group, e) => {
  draggingGroupId.value = group.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(group.id));
  }
};

const onGroupDragOver = (group, e) => {
  if (e) e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  if (draggingGroupId.value && draggingGroupId.value !== group.id) {
    dragOverGroupId.value = group.id;
  }
};

const onGroupDrop = (group) => {
  const sourceId = draggingGroupId.value;
  const targetId = group.id;
  dragOverGroupId.value = null;
  draggingGroupId.value = null;
  if (!sourceId || sourceId === targetId) return;
  const list = tokenGroups.value;
  const from = list.findIndex((g) => g.id === sourceId);
  const to = list.findIndex((g) => g.id === targetId);
  if (from === -1 || to === -1) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
};

const onGroupDragEnd = () => {
  draggingGroupId.value = null;
  dragOverGroupId.value = null;
};

/**
 * 从token name中提取短ID（最后一段数字，如"哇哇笑-0-545630303"→"545630303"）
 */
const extractShortId = (tokenName) => {
  const match = String(tokenName).match(/(\d+)$/);
  return match ? match[1] : String(tokenName);
};

/**
 * 根据短ID查找当前gameTokens中的token
 */
const findTokenByShortId = (shortId) => {
  const sid = String(shortId);
  return gameTokens.value.find((t) => extractShortId(t.name) === sid);
};

/**
 * 导出分组为JSON文件
 * 格式: [{ groupName, tokenIds: [短ID, ...] }]
 */
const exportGroups = () => {
  if (tokenGroups.value.length === 0) {
    message.warning("没有分组可导出");
    return;
  }
  const data = tokenGroups.value.map((g) => ({
    groupName: g.name,
    tokenIds: g.tokenIds.map((tid) => {
      const token = gameTokens.value.find((t) => t.id === tid);
      return token ? extractShortId(token.name) : tid;
    }),
  }));
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `token_groups_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success(`已导出 ${data.length} 个分组`);
};

/**
 * 从JSON文件导入分组
 */
const importGroups = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        message.error("JSON格式错误：应为数组");
        return;
      }
      let groupCount = 0;
      let matchCount = 0;
      let missCount = 0;
      for (const item of data) {
        if (!item.groupName || !Array.isArray(item.tokenIds)) continue;
        // 查找或创建分组
        let group = tokenGroups.value.find((g) => g.name === item.groupName);
        if (!group) {
          group = tokenStore.createTokenGroup(item.groupName, "#2080f0");
        }
        // 根据短ID匹配token
        for (const shortId of item.tokenIds) {
          const token = findTokenByShortId(shortId);
          if (token) {
            tokenStore.addTokenToGroup(group.id, token.id);
            matchCount++;
          } else {
            missCount++;
          }
        }
        groupCount++;
      }
      message.success(
        `导入完成：${groupCount}个分组，匹配${matchCount}个账号` +
          (missCount > 0 ? `，未匹配${missCount}个` : ""),
      );
    } catch (err) {
      message.error("导入失败：" + err.message);
    }
  };
  input.click();
};

/**
 * 添加token到分组
 */
const addTokenToSelectedGroup = (groupId, tokenId) => {
  tokenStore.addTokenToGroup(groupId, tokenId);
  message.success("已将token添加到分组");
};

/**
 * 从分组移除token
 */
const removeTokenFromSelectedGroup = (groupId, tokenId) => {
  tokenStore.removeTokenFromGroup(groupId, tokenId);
  message.success("已将token从分组移除");
};

/**
 * 获取分组中有效的token ID列表（用于模板中展示）
 */
const getValidGroupTokenIds = (groupId) => {
  return tokenStore.getValidGroupTokenIds(groupId);
};

/**
 * 获取分组中的token列表
 */
const getGroupTokenList = (groupId) => {
  const tokenIds = tokenStore.getValidGroupTokenIds(groupId);
  return tokens.value.filter((t) => tokenIds.includes(t.id));
};

// 注: pickArenaTargetId, FISH_TARGET, ARENA_TARGET, getTodayStartSec, isTodayAvailable, calculateMonthProgress 已从 @/utils/batch 导入

const addLog = (log) => {
  // 添加日志数据到数组
  logs.value.push(log);

  // 限制logs数组大小，防止内存占用过大
  const maxLogEntries = batchSettings.maxLogEntries || 1000;
  if (logs.value.length > maxLogEntries) {
    logs.value = logs.value.slice(-maxLogEntries);
  }

  // 尝试DOM操作，但不依赖nextTick确保日志显示
  // 在后台运行时，浏览器可能会限制DOM操作
  try {
    if (logContainer.value && autoScrollLog.value) {
      // 直接尝试滚动，不使用nextTick
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  } catch (error) {
    // 忽略DOM操作错误，确保日志数据仍然被记录
    console.warn("Failed to scroll log container:", error);
  }

  // 同时使用nextTick作为后备，确保在页面回到前台时能正确滚动
  nextTick(() => {
    try {
      if (logContainer.value && autoScrollLog.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    } catch (error) {
      // 忽略错误
    }
  });
};

watch(autoScrollLog, (newValue) => {
  if (newValue && logContainer.value) {
    nextTick(() => {
      try {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      } catch (error) {
        // 忽略DOM操作错误
        console.warn("Failed to scroll log container:", error);
      }
    });
  }
});

const copyLogs = () => {
  if (logs.value.length === 0) {
    message.warning("没有可复制的日志");
    return;
  }
  const logText = logs.value
    .map((log) => `${log.time} ${log.message}`)
    .join("\n");
  navigator.clipboard
    .writeText(logText)
    .then(() => {
      message.success("日志已复制到剪贴板");
    })
    .catch((err) => {
      message.error("复制日志失败: " + err.message);
    });
};

const clearLogs = () => {
  logs.value = [];
  message.success("日志已清空");
};

const waitForConnection = async (
  tokenId,
  timeout = batchSettings.connectionTimeout,
) => {
  const start = Date.now();
  let sawConnecting = false;
  while (Date.now() - start < timeout) {
    const status = tokenStore.getWebSocketStatus(tokenId);
    if (status === "connected") return true;
    // 记录是否进入过连接中状态
    if (status === "connecting") sawConnecting = true;
    // 仅当"确认进入过 connecting 后又失败"才提前返回（缩短阻塞）。
    // 初始状态(connecting/disconnected都还没真正建连)不做提前返回，
    // 否则会误把初始 disconnected 当成失败导致瞬间超时。
    if (sawConnecting && (status === "error" || status === "disconnected")) {
      return false;
    }
    await workerSleep(500);
  }
  return false;
};

// 全局连接队列控制 - 限制并发连接数
const connectionQueue = { active: 0 };

const waitForConnectionSlot = async () => {
  while (connectionQueue.active >= batchSettings.maxActive) {
    await workerSleep(1000);
  }
  connectionQueue.active++;
};

const releaseConnectionSlot = () => {
  if (connectionQueue.active > 0) {
    connectionQueue.active--;
  }
};

const formatConnectionFailure = (tokenId, info) => {
  const parts = [`状态: ${info?.status || "未知"}`];
  if (info?.crossTab) {
    const time = info.crossTab.timestamp
      ? new Date(info.crossTab.timestamp).toLocaleTimeString()
      : "";
    parts.push(`其他标签页已连接${time ? ` (${time})` : ""}`);
  }
  if (info?.lock) parts.push("连接锁被占用");
  if (info?.lastError) {
    const err =
      typeof info.lastError === "string"
        ? info.lastError
        : info.lastError.error || JSON.stringify(info.lastError);
    parts.push(`最后错误: ${err}`);
  }
  return parts.join("，");
};

const ensureConnection = async (tokenId, maxRetries = 2) => {
  const latestToken = tokens.value.find((t) => t.id === tokenId);
  if (!latestToken) {
    throw new Error(`Token not found: ${tokenId}`);
  }

  let status = tokenStore.getWebSocketStatus(tokenId);
  let connected = status === "connected";

  if (!connected) {
    // 等待连接槽位，限制并发连接数
    await waitForConnectionSlot();

    // 优化：若已知该账号 token 已过期（上次连接记录的 lastError），
    // 先用新 token 建连，避免拿过期 token 干等 connectionTimeout(10s) 超时
    const connInfo = tokenStore.getConnectionInfo?.(tokenId);
    const knownExpired =
      connInfo?.lastError?.error &&
      String(connInfo.lastError.error).toLowerCase().includes("token expired");
    if (knownExpired) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${latestToken.name} token已过期，先刷新Token再连接`,
        type: "warning",
      });
      try {
        await tokenStore.attemptTokenRefresh(tokenId, false, true);
      } catch (refreshErr) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `预刷新Token异常: ${refreshErr?.message || refreshErr}`,
          type: "warning",
        });
      }
    }

    // 刷新成功后 tokens.value 已更新，重新读取最新 token
    const connectToken =
      tokens.value.find((t) => t.id === tokenId) || latestToken;

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在连接... (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
      type: "info",
    });

    tokenStore.createWebSocketConnection(
      tokenId,
      connectToken.token,
      connectToken.wsUrl,
    );
    connected = await waitForConnection(tokenId);

    if (!connected && maxRetries > 0) {
      const info = tokenStore.getConnectionInfo?.(tokenId);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `连接超时，尝试重连... (${formatConnectionFailure(tokenId, info)})`,
        type: "warning",
      });

      tokenStore.closeWebSocketConnection(tokenId);
      await workerSleep(batchSettings.reconnectDelay);

      // 清除残留的连接锁：若上次连接卡在 connecting 超时，其 connect 锁可能一直未释放，
      // 否则下面的 createWebSocketConnection 会再被锁阻塞10秒导致“连接锁被占用”
      tokenStore.releaseConnectionLock(tokenId, "connect");

      // 主动触发一次Token刷新（在批量页 attemptTokenRefresh 仅刷新token值、不会自动重连，
      // bin/wxQrcode 重读IndexedDB里的BIN重新变换，url 重新fetch，manual无来源则刷新失败）
      let activeRefreshOk = false;
      try {
        activeRefreshOk =
          (await tokenStore.attemptTokenRefresh(tokenId, false, true)) === true;
      } catch (refreshErr) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `主动刷新Token异常: ${refreshErr?.message || refreshErr}`,
          type: "warning",
        });
      }

      // 等待自动刷新完成（最多等 3 秒），避免竞态
      const oldToken = tokens.value.find((t) => t.id === tokenId)?.token;
      // 主动刷新已成功则视为 Token 已刷新
      let tokenChanged = activeRefreshOk;
      const refreshWaitStart = Date.now();
      while (Date.now() - refreshWaitStart < 3000) {
        await workerSleep(200);
        const current = tokens.value.find((t) => t.id === tokenId);
        if (current && current.token !== oldToken) {
          tokenChanged = true;
          break;
        }
      }

      const currentToken = tokens.value.find((t) => t.id === tokenId);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `正在重连...${tokenChanged ? " (Token已刷新)" : ` (Token未变化, 最后刷新: ${currentToken?.lastRefreshed ? new Date(currentToken.lastRefreshed).toLocaleTimeString() : '无'})`}`,
        type: "info",
      });

      const refreshedToken = currentToken || tokens.value.find((t) => t.id === tokenId);
      tokenStore.createWebSocketConnection(
        tokenId,
        refreshedToken.token,
        refreshedToken.wsUrl,
      );

      connected = await waitForConnection(tokenId);
    }

    if (!connected) {
      // 连接失败，释放槽位
      releaseConnectionSlot();
      const info = tokenStore.getConnectionInfo?.(tokenId);
      const reason = formatConnectionFailure(tokenId, info);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `连接失败: ${reason}`,
        type: "error",
      });
      throw new Error(`连接失败 (${reason})`);
    }
  }

  // 连接成功，槽位保持占用，直到任务完成后手动释放

  // Initialize Game Data (Critical for Battle Version and Session)
  try {
    // Fetch Role Info first (Standard flow)
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
      5000,
    );

    // Fetch Battle Version
    const res = await tokenStore.sendMessageWithPromise(
      tokenId,
      "fight_startlevel",
      {},
      5000,
    );
    if (res?.battleData?.version) {
      tokenStore.setBattleVersion(res.battleData.version);
    }
  } catch (e) {
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `初始化数据失败: ${e.message}`,
      type: "warning",
    });
  }

  return true;
};

// ===== 临时: 模拟 token 过期，用于本地验证重连/刷新修复 =====
// 用法: window.__simulateTokenExpired('账号id')
// 会断开并篡改该账号的token为无效值, 模拟服务器判定过期。
// 之后运行任一批量任务(如重置罐子), 应看到:
//   连接超时 -> 正在重连...(Token已刷新) -> 成功
// 验证完可删除本函数。
window.__simulateTokenExpired = function (tokenId) {
  const t = tokens.value.find((x) => x.id === tokenId);
  if (!t) {
    message.error(`未找到账号: ${tokenId}`);
    return;
  }
  // 断开当前连接(模拟服务端因过期掉线)
  if (tokenStore.getWebSocketStatus(tokenId) === "connected") {
    tokenStore.closeWebSocketConnection(tokenId);
  }
  // 篡改token为无效值, 使下次连接握手必被判定 token expired
  tokenStore.updateToken(tokenId, {
    token: `EXPIRED_SIM_${Date.now()}`,
    lastRefreshed: Date.now(),
  });
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `[模拟] 已将 ${t.name} 的token篡改为无效值, 下一次批量任务将触发过期+重连自愈`,
    type: "warning",
  });
  message.warning(`已模拟 ${t.name} 的 token 过期`);
};

// 查询换皮闯关关数
// 今日开放 BOSS 类型映射（周五=1, 周六=2, 周日=3, 周一=4, 周二=5, 周三=6, 周四=全部）
const todayTowerTypes = (() => {
  const dayMap = { 5: [1], 6: [2], 0: [3], 1: [4], 2: [5], 3: [6], 4: [1, 2, 3, 4, 5, 6] };
  return dayMap[new Date().getDay()] || [];
})();

// 从 levelRewardMap 计算今日 BOSS 的已通关层数（0-8，8=全部通关）
const getTowerClearedLevel = (levelRewardMap, towerType) => {
  for (let i = 8; i >= 1; i--) {
    const key1 = `${towerType}00${i}`;
    const key2 = Number(key1);
    if (levelRewardMap[key1] || levelRewardMap[key2]) {
      return i; // 最高已通关层
    }
  }
  return 0; // 一层都没通关
};

const fetchTowerOverview = async () => {
  const targetIds =
    selectedTokens.value.length > 0
      ? [...selectedTokens.value]
      : tokens.value.map((t) => t.id);

  if (targetIds.length === 0) {
    message.warning("没有可查询的账号");
    return;
  }

  towerOverviewLoading.value = true;
  let successCount = 0;
  let failCount = 0;
  const computedActId = getTowerActId();

  for (const tokenId of targetIds) {
    if (shouldStop.value) break;
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      failCount++;
      continue;
    }
    try {
      await ensureConnection(tokenId);
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "towers_getinfo",
        { actId: computedActId },
        10000,
      );
      const data = res?.actId ? res : (res?.towerData?.actId ? res.towerData : res);
      const levelRewardMap = data?.levelRewardMap || {};
      // 取今日开放 BOSS 中的最高已通关层数
      let todayLevel = 0;
      for (const type of todayTowerTypes) {
        const level = getTowerClearedLevel(levelRewardMap, type);
        if (level > todayLevel) todayLevel = level;
      }
      towerOverview.value[tokenId] = {
        level: todayLevel,
        total: 8,
        updatedAt: new Date().toLocaleTimeString(),
      };
      successCount++;
    } catch (e) {
      failCount++;
      towerOverview.value[tokenId] = {
        level: 0,
        total: 8,
        error: e.message,
        updatedAt: new Date().toLocaleTimeString(),
      };
    } finally {
      tokenStore.closeWebSocketConnection(tokenId);
      releaseConnectionSlot();
    }
  }

  towerOverviewLoading.value = false;
  message.success(`闯关信息查询完成: 成功 ${successCount}，失败 ${failCount}`);
};

// 查询逐鹿盐山竞猜场次信息
const fetchApexScheduleInfo = async () => {
  if (selectedTokens.value.length === 0) {
    message.warning("请先选择要查询的账号");
    return;
  }

  const targetIds = [...selectedTokens.value];
  apexScheduleInfoLoading.value = true;
  let successCount = 0;
  let failCount = 0;
  const scheduleCounter = {};

  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 开始查询场次信息(${targetIds.length}个账号) ===`,
    type: "info",
  });

  for (const tokenId of targetIds) {
    if (shouldStop.value) break;
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      failCount++;
      continue;
    }
    try {
      await ensureConnection(tokenId);
      const roleResp = await tokenStore.sendMessageWithPromise(
        tokenId,
        "apex_getroleinfo",
        {},
        8000,
      );
      const apexInfo = roleResp?.apexRoleInfo || {};
      const guessMap = apexInfo.guessMap || {};
      const guessClaimMap = apexInfo.guessClaimMap || {};

      // 探测活跃场次：向服务端请求对阵数据，能返回的即为当前场次
      const resolved = await tasksApex.resolveActiveScheduleId(
        tokenId,
        guessClaimMap,
        apexScheduleId.value,
      );
      const activeId = resolved.scheduleId;
      // 拉取该场次全部对阵（探测仅取第一页5组）
      const allGroups = activeId
        ? await tasksApex.fetchAllGuessGroups(tokenId, activeId, resolved.groups)
        : [];
      const guessedCount = activeId ? (guessMap[activeId] || []).length : 0;
      if (activeId) {
        scheduleCounter[activeId] = (scheduleCounter[activeId] || 0) + 1;
      }

      // 验证假设：apex_getguesslist 是否只返回"未竞猜"的对阵
      // （返回的 teamId 应全部不在 guessMap[activeId] 中）
      const guessedSet = new Set(guessMap[activeId] || []);
      let overlap = 0;
      for (const g of allGroups) {
        for (const t of g || []) {
          if (guessedSet.has(t?.teamId)) overlap++;
        }
      }
      const totalGroups = activeId
        ? overlap === 0
          ? allGroups.length + guessedCount
          : allGroups.length
        : 0;

      addLog({
        time: new Date().toLocaleTimeString(),
        message: activeId
          ? `${token.name} 场次信息：当前场次 ${activeId}，未竞猜 ${allGroups.length} 组 + 已竞猜 ${guessedCount} 队 = 总 ${totalGroups} 组${overlap === 0 ? "（接口仅返回未竞猜对阵）" : `（含 ${overlap} 队已竞猜数据）`}，历史场次 [${Object.keys(guessClaimMap).join(", ")}]`
          : `${token.name} 场次信息：未找到有效场次（${resolved.reason || "无对阵信息"}，历史场次 [${Object.keys(guessClaimMap).join(", ") || "无"}]），请在输入框手动指定场次`,
        type: activeId ? "success" : "warning",
      });
      successCount++;
    } catch (e) {
      failCount++;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 查询场次信息失败: ${e?.message || e}`,
        type: "warning",
      });
    } finally {
      tokenStore.closeWebSocketConnection(tokenId);
      releaseConnectionSlot();
    }
  }

  const summary = Object.keys(scheduleCounter)
    .map((id) => `${id}: ${scheduleCounter[id]}个账号`)
    .join("，");
  apexScheduleInfoLoading.value = false;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: `=== 场次信息查询完成: 成功 ${successCount}，失败 ${failCount}${summary ? `。场次分布 ${summary}` : ""} ===`,
    type: "info",
  });
  message.success(`场次信息查询完成: 成功 ${successCount}，失败 ${failCount}`);
};

// 查询完整角色信息
const fetchFullInfo = async () => {
  if (selectedTokens.value.length === 0) {
    message.warning("请先选择要查询的账号");
    return;
  }

  const targetIds = [...selectedTokens.value];
  fullInfoLoading.value = true;
  let successCount = 0;
  let failCount = 0;

  for (const tokenId of targetIds) {
    if (shouldStop.value) break;
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      failCount++;
      continue;
    }
    try {
      await ensureConnection(tokenId);
      const roleInfoResp = await tokenStore.sendGetRoleInfo(tokenId);
      // 自动缓存战斗力
      const roleData = roleInfoResp?.role || {};
      if (roleData.power) updateTokenPower(tokenId, roleData.power);

      // 将完整响应体转为 JSON 输出
      const fullJson = JSON.stringify(roleInfoResp, null, 2);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `【原始数据】${token.name}\n${fullJson}`,
        type: "info",
      });
      successCount++;
    } catch (e) {
      failCount++;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 查询原始数据失败: ${e.message}`,
        type: "warning",
      });
    } finally {
      tokenStore.closeWebSocketConnection(tokenId);
      releaseConnectionSlot();
    }
  }

  fullInfoLoading.value = false;
  message.success(`原始数据查询完成: 成功 ${successCount}，失败 ${failCount}`);
};

const createTaskDeps = () => ({
  selectedTokens,
  tokens,
  tokenStatus,
  isRunning,
  shouldStop,
  ensureConnection,
  releaseConnectionSlot,
  connectionQueue,
  batchSettings,
  tokenStore,
  addLog,
  message,
  currentRunningTokenId,
  // 延迟配置
  delayConfig: {
    command: batchSettings.commandDelay,
    task: batchSettings.taskDelay,
    action: batchSettings.actionDelay,
    battle: batchSettings.battleDelay,
    refresh: batchSettings.refreshDelay,
    long: batchSettings.longDelay,
  },
  // 其他特定依赖
  logs,
  logContainer,
  autoScrollLog,
  nextTick,
  shouldSendCar,
  canClaim,
  normalizeCars,
  gradeLabel,
  // 设置相关
  currentSettings,
  helperSettings,
  weirdTowerMaxClimb,
  // 功法赠送相关
  recipientIdInput,
  recipientInfo,
  securityPassword,
  giftQuantity,
  // 领取挂机：加钟次数
  hangUpAddTimes,
  // 竞技场相关辅助函数
  pickArenaTargetId,
  getTodayStartSec,
  isTodayAvailable,
  calculateMonthProgress,
  // 配置加载函数
  loadSettings,
});

// 初始化任务模块
const tasksHangUp = createTasksHangUp(createTaskDeps());
const {
  claimHangUpRewards,
  batchAddHangUpTime,
  batchStudy,
  batchclubsign,
  batchWarGuessCheer,
} = tasksHangUp;

const tasksBottle = createTasksBottle(createTaskDeps());
const { resetBottles, batchlingguanzi } = tasksBottle;

const tasksTower = createTasksTower(createTaskDeps());
const {
  climbTower,
  climbWeirdTower,
  batchClaimFreeEnergy,
  skinChallenge,
  claimSkinChallengeRewards,
  batchUseItems,
  batchMergeItems,
} = tasksTower;

const tasksCar = createTasksCar(createTaskDeps());
const { batchSmartSendCar, batchClaimCars } = tasksCar;

const tasksItem = createTasksItem(createTaskDeps());
const {
  batchOpenBox,
  batchOpenBoxByPoints,
  batchClaimBoxPointReward,
  batchFish,
  batchRecruit,
  batchHeroUpgrade,
  batchBookUpgrade,
  batchClaimStarRewards,
  batchClaimPeachTasks,
  batchGenieSweep,
} = tasksItem;

const tasksDungeon = createTasksDungeon(createTaskDeps());
const { batchbaoku13, batchbaoku45, batchmengjing, batchBuyDreamItems } =
  tasksDungeon;

const tasksArena = createTasksArena(createTaskDeps());
const { batcharenafight, batchTopUpFish, batchTopUpArena } = tasksArena;

const tasksStore = createTasksStore(createTaskDeps());
const {
  legion_storebuygoods,
  legionStoreBuySkinCoins,
  store_purchase,
  collection_claimfreereward,
} = tasksStore;

const tasksLegacy = createTasksLegacy(createTaskDeps());
const { batchLegacyClaim, batchLegacyGiftSendEnhanced } = tasksLegacy;

const tasksFootball = createTasksFootball(createTaskDeps());
const { batchFootballBet } = tasksFootball;

const tasksApex = createTasksApex(createTaskDeps());
const { batchApexGuess } = tasksApex;

const tasksShidian = createTasksShidian(createTaskDeps());
const { batchShidianReward } = tasksShidian;

const tasksCampChallenge = createTasksCampChallenge(createTaskDeps());
const { batchCampChallenge, batchCampChallengePet, batchCampClaimTasks } = tasksCampChallenge;

// 营地挑战模式选择
const campChallengeMode = ref("pet");
const campChallengeModeOptions = [
  { label: "挑战宠物", value: "pet" },
  { label: "随机挑战人员", value: "random" },
  { label: "领取任务奖励", value: "claim" },
];
const campChallengeModeLabel = computed(() => {
  return campChallengeModeOptions.find((o) => o.value === campChallengeMode.value)?.label || "";
});
const onCampChallengeModeChange = async (val) => {
  campChallengeMode.value = val;
  if (val === "pet") {
    await batchCampChallengePet();
  } else if (val === "claim") {
    await batchCampClaimTasks();
  } else {
    await batchCampChallenge();
  }
};

// 盐杯竞猜 pick 选择
const footballPick = ref(3);
const apexScheduleId = ref(0);
const footballPickOptions = [
  { label: "主胜", value: 1 },
  { label: "平局", value: 2 },
  { label: "客胜", value: 3 },
];
const footballPickLabel = computed(() => {
  return footballPickOptions.find((o) => o.value === footballPick.value)?.label || "";
});
const onFootballPickChange = async (val) => {
  footballPick.value = val;
  await batchFootballBet(val);
};

const refreshBattleVersion = async (tokenId) => {
  const res = await tokenStore.sendMessageWithPromise(
    tokenId,
    "fight_startlevel",
    {},
    8000,
  );
  const battleVersion = res?.battleData?.version;
  if (battleVersion) {
    tokenStore.setBattleVersion(battleVersion);
  }
  return battleVersion || tokenStore.getBattleVersion?.();
};

const formatBossResponse = (response) => {
  try {
    return JSON.stringify(
      response,
      (key, value) => (typeof value === "bigint" ? value.toString() : value),
    ).slice(0, 500);
  } catch (error) {
    return String(response);
  }
};

const getRemainingLegionBossTimes = (roleData, settings) => {
  const statistics = roleData?.statistics ?? {};
  const statisticsTime = roleData?.statisticsTime ?? {};
  const configuredBossTimes = 4;
  const maxBossTimes = Math.min(
    Number.isFinite(configuredBossTimes) ? configuredBossTimes : 4,
    4,
  );

  let alreadyLegionBoss = statistics["legion:boss"] ?? 0;
  if (isTodayAvailable(statisticsTime["legion:boss"])) {
    alreadyLegionBoss = 0;
  }

  return {
    alreadyLegionBoss,
    maxBossTimes,
    remainingLegionBoss: Math.max(maxBossTimes - alreadyLegionBoss, 0),
  };
};

const batchFightBoss = async () => {
  if (selectedTokens.value.length === 0) return;

  isRunning.value = true;
  shouldStop.value = false;

  selectedTokens.value.forEach((id) => {
    tokenStatus.value[id] = "waiting";
  });

  const taskPromises = selectedTokens.value.map(async (tokenId) => {
    if (shouldStop.value) return;

    const token = tokens.value.find((t) => t.id === tokenId);
    tokenStatus.value[tokenId] = "running";
    currentRunningTokenId.value = tokenId;

    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `=== 开始一键打BOSS ${token?.name || tokenId} ===`,
        type: "info",
      });

      await ensureConnection(tokenId);
      if (shouldStop.value) return;

      const battleVersion = await refreshBattleVersion(tokenId);
      if (!battleVersion) {
        throw new Error("未获取到战斗版本号，无法发起BOSS战斗");
      }

      const tokenSettings = loadSettings
        ? loadSettings(tokenId) || currentSettings
        : currentSettings;

      const roleInfoResp = await tokenStore.sendGetRoleInfo(tokenId);
      const roleData = roleInfoResp?.role;
      if (!roleData) {
        throw new Error("角色数据不存在，无法判断军团BOSS剩余次数");
      }
      // 自动缓存战斗力
      updateTokenPower(tokenId, roleData?.power);
      const {
        alreadyLegionBoss,
        maxBossTimes,
        remainingLegionBoss,
      } = getRemainingLegionBossTimes(roleData, tokenSettings);

      if (remainingLegionBoss <= 0) {
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token?.name || tokenId} 今日军团BOSS已达上限 ${alreadyLegionBoss}/${maxBossTimes}，跳过`,
          type: "warning",
        });
        return;
      }

      const teamInfo = await tokenStore.sendMessageWithPromise(
        tokenId,
        "presetteam_getinfo",
        {},
        5000,
      );

      if (teamInfo?.presetTeamInfo?.useTeamId !== tokenSettings.bossFormation) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "presetteam_saveteam",
          { teamId: tokenSettings.bossFormation },
          5000,
        );
        await workerSleep(batchSettings.commandDelay || 500);
      }

      if (shouldStop.value) return;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token?.name || tokenId} 发送军团BOSS战斗请求，今日已打 ${alreadyLegionBoss}/${maxBossTimes}，battleVersion: ${battleVersion}`,
        type: "info",
      });
      const bossResponse = await tokenStore.sendMessageWithPromise(
        tokenId,
        "fight_startlegionboss",
        { battleVersion },
        12000,
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token?.name || tokenId} 军团BOSS执行成功，响应: ${formatBossResponse(bossResponse)}`,
        type: "success",
      });

      await tokenStore.sendGetRoleInfo(tokenId).then((resp) => {
        const r = resp?.role || resp?.roleInfo;
        if (r) updateTokenPower(tokenId, r?.power);
      });
      tokenStatus.value[tokenId] = "completed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token?.name || tokenId} 一键打BOSS完成`,
        type: "success",
      });
    } catch (error) {
      console.error(error);
      tokenStatus.value[tokenId] = "failed";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token?.name || tokenId} 一键打BOSS失败: ${error.message}`,
        type: "error",
      });
    } finally {
      tokenStore.closeWebSocketConnection(tokenId);
      releaseConnectionSlot();
      currentRunningTokenId.value = null;
    }
  });

  await Promise.all(taskPromises);
  isRunning.value = false;
  currentRunningTokenId.value = null;
  message.success("一键打BOSS执行结束");
};

const startBatch = async () => {
  if (selectedTokens.value.length === 0) return;

  isRunning.value = true;
  shouldStop.value = false;
  // 不再重置logs数组，保留之前的日志
  // logs.value = [];

  // Reset status
  selectedTokens.value.forEach((id) => {
    tokenStatus.value[id] = "waiting";
  });

  // 并行执行任务，但通过connectionQueue限制并发连接数
  const taskPromises = selectedTokens.value.map(async (tokenId) => {
    if (shouldStop.value) return;

    tokenStatus.value[tokenId] = "running";

    let retryCount = 0;
    const MAX_RETRIES = 1;
    let success = false;

    while (retryCount <= MAX_RETRIES && !success) {
      if (shouldStop.value) break;

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        if (retryCount === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始执行: ${token.name} ===`,
            type: "info",
          });
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 尝试重试: ${token.name} (第${retryCount}次) ===`,
            type: "info",
          });
        }

        await ensureConnection(tokenId);

        // Create runner with delay settings
        const runner = new DailyTaskRunner(tokenStore, {
          commandDelay: batchSettings.commandDelay,
          taskDelay: batchSettings.taskDelay,
        });

        // Run tasks
        await runner.run(tokenId, {
          onLog: (log) => addLog(log),
          onProgress: (p) => {
            // 每个token维护自己的进度
          },
        });

        success = true;
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 执行完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        if (retryCount < MAX_RETRIES && !shouldStop.value) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 执行出错: ${error.message}，等待3秒后重试...`,
            type: "warning",
          });
          // Wait for potential token refresh in store
          await workerSleep(3000);
          retryCount++;
        } else {
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 执行失败: ${error.message}`,
            type: "error",
          });
        }
      } finally {
        // 完成后关闭连接并释放槽位
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    }
  });

  // 等待所有任务完成
  await Promise.all(taskPromises);

  // 等待所有任务完成后再继续
  await workerSleep(1000);

  isRunning.value = false;
  currentRunningTokenId.value = null;
  message.success("批量任务执行结束");
};

const stopBatch = () => {
  shouldStop.value = true;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "正在停止...",
    type: "warning",
  });
};
</script>

<style scoped>
.batch-daily-tasks {
  padding: 20px;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
}

.main-layout {
  display: flex;
  gap: 20px;
  height: 100%;
  overflow: hidden;
}

.left-column {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding-right: 8px;
}

.right-column {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 700px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.token-item {
  display: flex;
  align-items: center;
}

.token-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  flex: 1;
  margin-left: 8px;
}

.token-checkbox {
  flex: 0 0 auto;
}

.token-settings-btn {
  flex: 0 0 auto;
}

.log-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.progress-wrapper .n-progress {
  flex: 1;
}

.progress-text {
  font-size: 13px;
  color: var(--text-secondary, #86909c);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.custom-card-header {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
  flex-wrap: nowrap;
}

/* Cron Parser Styles */
.cron-parser {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 8px;
}

.cron-validation {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 4px;
}

.cron-validation.success {
  background-color: rgba(24, 160, 88, 0.12);
}

.cron-validation.error {
  background-color: rgba(235, 87, 87, 0.12);
}

.cron-next-runs h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cron-next-runs ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.cron-next-runs li {
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.cron-next-runs li:last-child {
  border-bottom: none;
}

.log-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;
  padding: 10px;
  border-radius: 4px;
  margin-top: 10px;
  font-family: monospace;
  min-height: 200px;
}

.log-item {
  margin-bottom: 4px;
  font-size: 12px;
}

.log-item.error {
  color: #d03050;
}

.log-item.success {
  color: #18a058;
}

.log-item.warning {
  color: #f0a020;
}

.log-item.info {
  color: #333;
}

.time {
  color: #999;
  margin-right: 8px;
}

.token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-right: 8px;
}

/* 移动端：账号显示为两行，第一行为名称+设置按钮，第二行战斗力/状态/分组等标签 */
@media (max-width: 768px) {
  .token-row {
    flex-wrap: wrap;
    align-items: center;
  }
  .token-checkbox {
    order: 1;
    flex: 1 1 auto;
  }
  .token-settings-btn {
    order: 2;
  }
  .token-tags {
    order: 3;
    flex-basis: 100%;
    margin-left: 0;
    margin-top: 4px;
  }
}

/* Settings Modal Styles */
.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  font-size: 14px;
  color: #666;
}

.setting-hint {
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}

.setting-switches {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.switch-row:last-child {
  border-bottom: none;
}

.switch-label {
  font-size: 14px;
  color: #666;
}

.weird-tower-count-input {
  width: 86px;
  flex-shrink: 0;
}

/* 每日分组排版 */
.batch-group-label {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--n-color-info, #2080f0);
  background: var(--n-color, rgba(32, 128, 240, 0.1));
  border-radius: 4px;
  white-space: nowrap;
}

.batch-inline-label {
  font-size: 12px;
  color: #666;
}

.batch-count-input {
  width: 90px !important;
}

.weird-tower-count-unit {
  display: inline-flex;
  align-items: center;
  height: 28px;
  color: #666;
  font-size: 14px;
}

/* Responsive Design */
@media (max-width: 1200px) {
  .right-column {
    width: 380px;
  }
}

@media (max-width: 992px) {
  .batch-daily-tasks {
    height: auto;
    overflow: visible;
  }

  .main-layout {
    flex-direction: column;
    height: auto;
    overflow: visible;
  }

  .left-column {
    overflow-y: visible;
    padding-right: 0;
  }

  .right-column {
    width: 100%;
    height: auto;
    flex-shrink: 0;
  }

  .log-container {
    height: 300px;
    min-height: 300px;
  }
}

@media (max-width: 768px) {
  .batch-daily-tasks {
    padding: 12px;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .main-layout {
    height: auto;
    overflow: visible;
    flex-direction: column;
  }

  .left-column {
    overflow: visible;
    padding-right: 0;
    flex: none;
    height: auto;
  }

  .right-column {
    height: auto;
    width: 100%;
    flex: none;
  }

  .page-header {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .page-header .actions {
    display: flex;
    gap: 8px;
  }

  .log-card {
    height: auto !important;
  }

  .log-card :deep(.n-card__content) {
    flex: none !important;
    overflow: visible !important;
    display: block !important;
  }

  .log-container {
    height: 300px;
    min-height: 300px;
    flex: none !important;
  }

  .log-header-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  /* 批量功法残卷赠送样式 */
  .recipient-info:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  }

  /* 头像悬停效果 */
  .avatar-container:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.3);
  }

  /* 加载动画 */
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }

    100% {
      transform: rotate(360deg);
    }
  }

  /* Token分组管理样式 */
  .group-selection-section {
    padding: 12px;
    background-color: #f5f7fa;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
  }

  .group-tag {
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.3s ease;
    user-select: none;
    text-align: center;
    font-weight: 500;
  }

  .group-tag:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .group-tag-selected {
    color: white;
    font-weight: 600;
  }

  /* 响应式设计 */
  @media (max-width: 600px) {
    .recipient-info {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .avatar-container {
      margin-bottom: 12px;
    }
  }
}
</style>
