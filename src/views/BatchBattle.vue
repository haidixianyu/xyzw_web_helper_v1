<template>
  <div class="batch-battle-page">
    <!-- 页面头部（参考游戏功能风格） -->
    <header class="page-header">
      <div class="container">
        <div class="header-content">
          <div class="header-left">
            <h1 class="page-title">批量战斗</h1>
            <p class="page-subtitle">配置并批量执行盐场战斗与蟠桃园任务</p>
          </div>

          <div class="header-actions">
            <div class="status-pill" :class="headerStatusClass">
              <span class="status-dot"></span>
              <span>{{ headerStatusText }}</span>
            </div>
            <button class="btn btn-ghost" :disabled="isRunning" @click="exportBattleConfig">
              导出配置
            </button>
            <button class="btn btn-ghost" :disabled="isRunning" @click="importFileInput?.click()">
              导入配置
            </button>
            <input
              ref="importFileInput"
              type="file"
              accept=".json"
              style="display: none"
              @change="onImportFileChange"
            />
            <button
              class="btn btn-error btn-ghost"
              :disabled="!isRunning"
              @click="stopBattle"
            >
              停止
            </button>
            <button
              class="btn btn-primary"
              :disabled="isRunning || selectedTokens.length === 0"
              @click="runMainAction"
            >
              <span v-if="isRunning" class="btn-spinner"></span>
              {{ mainActionText }}
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="container batch-body">
      <div class="main-layout">
        <!-- 左侧：配置 -->
        <div class="left-column">
          <!-- 账号列表 -->
          <section class="card card--primary">
            <div class="card-header">
              <h2 class="card-title">账号列表</h2>
              <span class="card-extra">
                已选择 {{ selectedTokens.length }} / {{ signedTokens.length }}
              </span>
            </div>
            <div class="card-body">
              <label class="ui-checkbox select-all">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  :indeterminate="isIndeterminate"
                  @change="handleSelectAll($event.target.checked)"
                />
                <span class="ui-checkbox-box"></span>
                <span class="ui-checkbox-label">全选</span>
              </label>
              <button
                class="btn btn-sm btn-default collapse-toggle"
                :title="isAccountListCollapsed ? `展开全部 (${signedTokens.length})` : '收起（仅显示已选）'"
                @click="isAccountListCollapsed = !isAccountListCollapsed"
              >
                <n-icon :size="16">
                  <ChevronUp v-if="!isAccountListCollapsed" />
                  <ChevronDown v-else />
                </n-icon>
                {{ isAccountListCollapsed ? `展开 (${signedTokens.length})` : "收起" }}
              </button>

              <div class="group-toolbar">
                <button
                  class="btn btn-sm btn-default group-toggle"
                  @click="isGroupListCollapsed = !isGroupListCollapsed"
                >
                  <n-icon :size="14">
                    <ChevronDown v-if="!isGroupListCollapsed" />
                    <ChevronForward v-else />
                  </n-icon>
                  <span>分组</span>
                  <span v-if="tokenGroups.length" class="group-count">
                    {{ selectedGroupIds.length }}/{{ tokenGroups.length }}
                  </span>
                </button>
                <div
                  v-if="!isGroupListCollapsed && tokenGroups.length"
                  class="group-list-inline"
                >
                  <button
                    v-for="group in tokenGroups"
                    :key="group.id"
                    class="group-chip"
                    :class="{ selected: selectedGroupIds.includes(group.id) }"
                    :style="groupChipStyle(group)"
                    @click="toggleGroup(group)"
                  >
                    {{ group.name }}
                  </button>
                </div>
              </div>

              <div class="roster">
                <div
                  v-for="token in displayedTokens"
                  :key="token.id"
                  class="roster-item"
                  :class="{ selected: selectedTokens.includes(token.id) }"
                  @click="toggleToken(token.id)"
                >
                  <label class="ui-checkbox" @click.stop>
                    <input
                      type="checkbox"
                      :checked="selectedTokens.includes(token.id)"
                      @change="toggleToken(token.id)"
                    />
                    <span class="ui-checkbox-box"></span>
                  </label>
                  <span class="roster-name">{{ getDisplayName(token) }}</span>
                  <span
                    class="roster-status"
                    :class="'roster-status--' + getStatusType(token.id)"
                    :title="getStatusText(token.id)"
                  ></span>
                </div>
              </div>

              <div v-if="signedTokens.length === 0" class="ui-empty">
                暂无导入的账号，请先到 Token 管理导入
              </div>
            </div>
          </section>
          <!-- 功能配置 -->
          <section class="card card--info config-card">
            <div class="card-header">
              <h2 class="card-title">功能配置</h2>
            </div>
            <div class="card-body">
              <div class="ui-tabs">
                <div class="ui-tab-bar" role="tablist">
                  <button
                    class="ui-tab"
                    :class="{ active: activeTab === 'salt' }"
                    role="tab"
                    :aria-selected="activeTab === 'salt'"
                    @click="activeTab = 'salt'"
                  >
                    盐场
                  </button>
                  <button
                    class="ui-tab"
                    :class="{ active: activeTab === 'peach' }"
                    role="tab"
                    :aria-selected="activeTab === 'peach'"
                    @click="activeTab = 'peach'"
                  >
                    蟠桃园
                  </button>
                </div>

                <!-- 盐场 -->
                <div v-show="activeTab === 'salt'" class="ui-tab-pane">
                  <div class="form-row">
                    <span class="form-label">复活设置</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input
                          type="checkbox"
                          :checked="saltOptions.autoResurrect"
                          @change="onAutoResurrectChange($event.target.checked)"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">自动复活</span>

                      <label
                        class="ui-switch"
                        :class="{ disabled: !saltOptions.autoResurrect }"
                      >
                        <input
                          type="checkbox"
                          v-model="saltOptions.useItem"
                          :disabled="!saltOptions.autoResurrect"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">自动用丹</span>

                      <label
                        class="ui-switch"
                        :class="{ disabled: !saltOptions.autoResurrect }"
                      >
                        <input
                          type="checkbox"
                          v-model="saltOptions.instantRevive"
                          :disabled="!saltOptions.autoResurrect"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">马上复活</span>
                    </div>
                  </div>

                  <div class="form-row">
                    <span class="form-label">自动行军</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input type="checkbox" v-model="saltOptions.autoMarch" />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">开启</span>

                      <div
                        class="ui-segmented"
                        :class="{ disabled: !saltOptions.autoMarch || isRunning }"
                      >
                        <label class="ui-segmented-item">
                          <input
                            type="radio"
                            value="nearToFar"
                            v-model="saltOptions.marchStrategy"
                            :disabled="!saltOptions.autoMarch || isRunning"
                          />
                          <span>由近到远大建筑优先</span>
                        </label>
                        <label class="ui-segmented-item">
                          <input
                            type="radio"
                            value="follow"
                            v-model="saltOptions.marchStrategy"
                            :disabled="!saltOptions.autoMarch || isRunning"
                          />
                          <span>跟随队员</span>
                        </label>
                      </div>

                      <label
                        class="ui-switch"
                        :class="{ disabled: !saltOptions.autoMarch || isRunning }"
                      >
                        <input
                          type="checkbox"
                          v-model="saltOptions.autoSpeedUp"
                          :disabled="!saltOptions.autoMarch || isRunning"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">自动加速(耗金砖)</span>
                    </div>
                  </div>

                  <div
                    v-if="saltOptions.autoMarch && saltOptions.marchStrategy === 'follow'"
                    class="form-row"
                  >
                    <span class="form-label">跟随队员</span>
                    <div
                      class="member-input"
                      :class="{ 'is-disabled': isRunning }"
                      @click="openFollowPicker"
                    >
                      <template v-if="followedMembers.length">
                        <span
                          v-for="m in followedMembers"
                          :key="m.roleId"
                          class="chip chip--closable"
                          @click.stop="removeFollowMember(m.roleId)"
                        >
                          {{ m.name }}
                          <span class="chip-close">×</span>
                        </span>
                      </template>
                      <span v-else class="member-input-placeholder">
                        点击选择要跟随的俱乐部成员（可多选）
                      </span>
                    </div>
                  </div>

                  <div class="form-row">
                    <span class="form-label">自动攻击</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input type="checkbox" v-model="saltOptions.autoAttack" />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">开启</span>

                      <label
                        class="ui-switch"
                        :class="{ disabled: !saltOptions.autoAttack }"
                      >
                        <input
                          type="checkbox"
                          v-model="saltOptions.autoAttackPlayers"
                          :disabled="!saltOptions.autoAttack"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">攻击敌人</span>

                      <label
                        class="ui-switch"
                        :class="{ disabled: !saltOptions.autoAttack }"
                      >
                        <input
                          type="checkbox"
                          v-model="saltOptions.autoAttackBuildings"
                          :disabled="!saltOptions.autoAttack"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">攻击建筑</span>
                    </div>
                  </div>

                  <div class="form-row">
                    <span class="form-label">优先攻击</span>
                    <div class="follow-col">
                      <label class="ui-switch">
                        <input type="checkbox" v-model="saltOptions.priorityAttack" />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">开启</span>

                      <details v-if="saltOptions.priorityAttack" class="ui-multiselect">
                        <summary class="ui-multiselect-summary">
                          <span v-if="saltOptions.priorityFormationNames.length === 0">
                            选择优先阵容（如 吴国/毒爆）
                          </span>
                          <span v-else>
                            {{ saltOptions.priorityFormationNames.length }} 个阵容已选
                          </span>
                          <span class="caret">▾</span>
                        </summary>
                        <div class="ui-multiselect-panel">
                          <label
                            v-for="opt in lineupOptions"
                            :key="opt.value"
                            class="ui-multiselect-option"
                          >
                            <input
                              type="checkbox"
                              :checked="saltOptions.priorityFormationNames.includes(opt.value)"
                              :disabled="isRunning"
                              @change="toggleLineup(opt.value, $event.target.checked)"
                            />
                            <span class="lineup-dot" :style="{ background: opt.color }"></span>
                            <span>{{ opt.label }}</span>
                          </label>
                        </div>
                      </details>

                      <div
                        v-if="saltOptions.priorityAttack && saltOptions.priorityFormationNames.length"
                        class="chip-list"
                      >
                        <span
                          v-for="name in saltOptions.priorityFormationNames"
                          :key="name"
                          class="chip chip--closable"
                          :style="lineupChipStyle(name)"
                          @click="removeLineup(name)"
                        >
                          {{ name }}
                          <span class="chip-close">×</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="form-row">
                    <span class="form-label">招募队员</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input type="checkbox" v-model="saltOptions.recruitTeam" />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">开启</span>

                      <div
                        class="ui-segmented"
                        :class="{ disabled: !saltOptions.recruitTeam || isRunning }"
                      >
                        <label class="ui-segmented-item">
                          <input
                            type="radio"
                            value="random"
                            v-model="saltOptions.teamMode"
                            :disabled="!saltOptions.recruitTeam || isRunning"
                          />
                          <span>随机</span>
                        </label>
                        <label class="ui-segmented-item">
                          <input
                            type="radio"
                            value="specified"
                            v-model="saltOptions.teamMode"
                            :disabled="!saltOptions.recruitTeam || isRunning"
                          />
                          <span>指定</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="saltOptions.recruitTeam && saltOptions.teamMode === 'specified'"
                    class="form-row"
                  >
                    <span class="form-label">指定队员</span>
                    <div
                      class="member-input"
                      :class="{ 'is-disabled': isRunning }"
                      @click="openMemberPicker"
                    >
                      <template v-if="selectedMembers.length">
                        <span
                          v-for="m in selectedMembers"
                          :key="m.roleId"
                          class="chip chip--closable"
                          @click.stop="removeMember(m.roleId)"
                        >
                          {{ m.name }}
                          <span class="chip-close">×</span>
                        </span>
                      </template>
                      <span v-else class="member-input-placeholder">
                        点击选择俱乐部成员（最多4名）
                      </span>
                    </div>
                  </div>

                  <div class="ui-alert ui-alert--info">
                    执行流程：进场 → 拉取地图 → 设置阵容 → 招募 → 自动行军(由近到远大建筑优先/跟随) → 自动攻击(优先阵容/敌人/建筑)；自动复活可自行开关。优先攻击开启后，敌人属于所选阵容类型(如 吴国/毒爆)时优先攻击。
                  </div>
                </div>

                <!-- 蟠桃园 -->
                <div v-show="activeTab === 'peach'" class="ui-tab-pane">
                  <div class="ui-alert ui-alert--info">
                    执行流程：进场(payload_enterbf) → 同步阵容含宠物(setbattleteam) → 心跳保活 →
                    按目标策略选定未送达船（含敌方控制的，打赢抢回控制权）→ 攻击船上体力最低的敌人。
                    阵亡按服务端 sleepTime 精确等待自动复活，无需复活丹、无次数限制。
                  </div>
                  <div class="form-row">
                    <span class="form-label">抢夺敌船</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input
                          type="checkbox"
                          v-model="peachOptions.contestEnemyShips"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">开启（关闭则仅护送己方船）</span>
                    </div>
                  </div>
                  <div class="form-row">
                    <span class="form-label">只上船不打人</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input
                          type="checkbox"
                          v-model="peachOptions.noAttackPlayers"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">小号打不过别人时开启：不攻击玩家，但可上船（含敌方船）</span>
                    </div>
                  </div>
                  <div class="form-row">
                    <span class="form-label">自动复活</span>
                    <div class="switch-row">
                      <label class="ui-switch">
                        <input
                          type="checkbox"
                          v-model="peachOptions.autoResurrect"
                        />
                        <span class="ui-switch-track"></span>
                      </label>
                      <span class="switch-text">阵亡按服务端时间自动复活（关闭则阵亡后结束该账号监控）</span>
                    </div>
                  </div>
                  <div class="form-row">
                    <span class="form-label">目标策略</span>
                    <div class="ui-segmented">
                      <label class="ui-segmented-item">
                        <input
                          type="radio"
                          value="progress"
                          v-model="peachOptions.targetStrategy"
                        />
                        <span>进度最高</span>
                      </label>
                      <label class="ui-segmented-item">
                        <input
                          type="radio"
                          value="nearest"
                          v-model="peachOptions.targetStrategy"
                        />
                        <span>距离最近</span>
                      </label>
                    </div>
                  </div>
                  <div class="form-row">
                    <span class="form-label">轮询间隔</span>
                    <input
                      type="number"
                      v-model.number="peachOptions.pollInterval"
                      min="1000"
                      step="500"
                      class="ui-number-input"
                    />
                    <span class="form-hint">毫秒，默认 3000，越大越省流量</span>
                  </div>
                  <div class="form-row">
                    <span class="form-label">命令延时</span>
                    <input
                      type="number"
                      v-model.number="peachOptions.commandDelay"
                      min="100"
                      step="100"
                      class="ui-number-input"
                    />
                    <span class="form-hint">毫秒，默认 500</span>
                  </div>
                  <div class="ui-alert ui-alert--info">
                    配置完成后，点击右上角「开始蟠桃园监控」启动自动战斗；领取任务奖励请到
                    「批量日常任务」页面操作。
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        <!-- 右侧：日志 -->
        <div class="right-column">
          <n-card class="log-card">
            <template #header>
              <div class="custom-card-header">
                <div class="card-title">
                  执行日志
                  <span style="margin-left: 12px; font-size: 12px; color: #86909c">
                    最近 {{ logs.length }} 条
                  </span>
                  <n-tag
                    v-if="successCount > 0"
                    type="success"
                    size="small"
                    style="margin-left: 8px"
                  >
                    {{ successCount }} 个成功
                  </n-tag>
                  <n-tag
                    v-if="errorCount > 0"
                    type="error"
                    size="small"
                    style="margin-left: 8px"
                  >
                    {{ errorCount }} 个错误
                  </n-tag>
                </div>
                <div class="log-header-controls">
                  <label class="form-check">
                    <input
                      type="checkbox"
                      class="form-check__input"
                      :checked="filterErrorsOnly"
                      @change="onToggleErrorFilter($event.target.checked)"
                    />
                    <span class="form-check__box"></span>
                    <span class="form-check__label">只看错误</span>
                  </label>
                  <label class="form-check">
                    <input
                      type="checkbox"
                      class="form-check__input"
                      :checked="filterSuccessOnly"
                      @change="onToggleSuccessFilter($event.target.checked)"
                    />
                    <span class="form-check__box"></span>
                    <span class="form-check__label">只看成功</span>
                  </label>
                  <n-dropdown
                    trigger="hover"
                    :options="moreMenuOptions"
                    @select="onMoreItem"
                  >
                    <button class="btn btn-sm btn-default">更多</button>
                  </n-dropdown>
                </div>
              </div>
            </template>
            <div class="log-container" ref="logContainer">
              <div
                v-for="(log, index) in filteredLogs"
                :key="log?.ts ?? index"
                class="log-item"
                :class="log?.type"
              >
                <span class="time">{{ log?.time }}</span>
                <span class="message">{{ log?.message }}</span>
              </div>
              <div v-if="logs.length === 0" class="ui-empty">暂无日志</div>
            </div>
          </n-card>
        </div>
      </div>
    </div>

    <!-- 盐场监控弹窗 -->
    <div
      v-if="showSaltInfo"
      class="ui-modal-overlay"
      @click.self="closeSaltInfo"
    >
      <div class="ui-modal salt-info-modal">
        <div class="ui-modal-header">
          <h3>盐场监控</h3>
          <button
            class="ui-modal-close"
            @click="closeSaltInfo"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div class="ui-modal-body">
          <div class="salt-info-toolbar">
            <span class="salt-info-hint">每 {{ SALT_INFO_REFRESH_MS / 1000 }}s 自动刷新</span>
            <button
              class="btn btn-sm btn-default"
              :disabled="saltInfo.loading"
              @click="loadSaltSummary"
            >
              刷新
            </button>
          </div>
          <div v-if="saltInfo.loading && !saltInfo.base" class="ui-empty">
            正在获取战场信息(临时战斗通道)...
          </div>
          <template v-else>
            <div v-if="saltInfo.error" class="ui-alert ui-alert--error">
              {{ saltInfo.error }}
            </div>
            <div v-if="saltInfo.base" class="salt-info-grid">
              <div class="salt-info-item">
                <span class="label">战场ID</span>
                <span>{{ saltInfo.base.battlefieldId ?? "-" }}</span>
              </div>
              <div class="salt-info-item">
                <span class="label">赛段</span>
                <span>{{ phaseText(saltInfo.base.phase) }}</span>
              </div>
              <div v-if="saltInfo.snapshotAt" class="salt-info-item">
                <span class="label">快照时间</span>
                <span>{{ saltInfo.snapshotAt }}</span>
              </div>
            </div>
            <table v-if="saltInfo.accounts.length" class="ui-table salt-accounts-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>状态</th>
                  <th>精力</th>
                  <th>复活</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in saltInfo.accounts" :key="a.tokenId">
                  <td>{{ a.name }}</td>
                  <td>{{ a.found ? selfStateText(a.state) : "不在战场" }}</td>
                  <td>{{ a.found ? a.energy : "-" }}</td>
                  <td>{{ a.found ? a.revive + "/5" : "-" }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>

    <!-- 选择战斗队伍成员 / 跟随行军成员弹窗 -->
    <div
      v-if="showMemberPicker"
      class="ui-modal-overlay"
      @click.self="showMemberPicker = false"
    >
      <div class="ui-modal">
        <div class="ui-modal-header">
          <h3>{{ pickerTitle }}</h3>
          <button
            class="ui-modal-close"
            @click="showMemberPicker = false"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div class="ui-modal-body">
          <div v-if="loadingMembers" class="picker-loading">
            <span class="ui-spinner"></span>
            <span class="picker-loading-text">加载俱乐部成员…</span>
          </div>
          <div v-else-if="clubLoadError" class="ui-alert ui-alert--error">
            {{ clubLoadError }}
          </div>
          <div v-else-if="clubMembers.length === 0" class="ui-empty">
            暂无俱乐部成员
          </div>
          <template v-else>
            <div class="picker-hint">点击行勾选成员，最多 {{ pickerLimit }} 名</div>
            <div class="member-table-wrap">
              <table class="ui-table">
                <thead>
                  <tr>
                    <th class="col-select">选择</th>
                    <th class="col-avatar">头像</th>
                    <th>成员</th>
                    <th class="col-num">战力</th>
                    <th class="col-num">红淬</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="m in clubMembers"
                    :key="m.roleId"
                    class="member-row"
                    :class="{ selected: draftMemberIds.includes(m.roleId) }"
                    @click="toggleDraftMemberRow(m.roleId)"
                  >
                    <td class="col-select">
                      <label class="ui-checkbox" @click.stop>
                        <input
                          type="checkbox"
                          :checked="draftMemberIds.includes(m.roleId)"
                          @change="toggleDraftMember(m.roleId, $event.target.checked)"
                        />
                        <span class="ui-checkbox-box"></span>
                      </label>
                    </td>
                    <td class="col-avatar">
                      <img
                        v-if="m.headImg"
                        :src="m.headImg"
                        class="member-avatar"
                        :alt="m.name"
                      />
                      <span
                        v-else
                        class="member-avatar member-avatar--placeholder"
                      >
                        {{ m.name ? m.name.charAt(0) : "?" }}
                      </span>
                    </td>
                    <td>
                      <div class="member-name">{{ m.name }}</div>
                      <div class="member-id">ID: {{ m.roleId }}</div>
                    </td>
                    <td class="col-num">{{ formatNumber(m.power) }}</td>
                    <td class="col-num">{{ m.redQuench }}红</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
        <div class="ui-modal-footer">
          <button
            class="btn btn-sm"
            :disabled="isRunning || !sourceTokenId"
            @click="reloadClubMembers"
          >
            <span v-if="loadingMembers" class="btn-spinner"></span>
            重新加载
          </button>
          <div class="modal-footer-actions">
            <button class="btn btn-sm" @click="showMemberPicker = false">取消</button>
            <button
              class="btn btn-sm btn-primary"
              :disabled="loadingMembers"
              @click="confirmMemberPicker"
            >
              确认（{{ draftMemberIds.length }}/{{ pickerLimit }}）
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 原生 Toast（替代 naive-ui useMessage） -->
    <div class="toast-container">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="'toast--' + t.type"
      >
        {{ t.msg }}
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from "vue";
import { ChevronDown, ChevronForward, ChevronUp } from "@vicons/ionicons5";
import { useLocalStorage } from "@vueuse/core";
import { getKV, setKV, getKVByPrefix, deleteKVByPrefix } from "@/utils/tokenDb";
import { useTokenStore, gameTokens, tokenGroups } from "@/stores/tokenStore";
import { createConnectionManager } from "@/utils/batch/connectionManager";
import { workerSleep } from "@/utils/workerTimer";
import { runSaltFieldBattle, fetchSaltBattlefieldSnapshot } from "@/utils/batch/battleRunner";
import { runPeachBattle } from "@/utils/batch/tasksPeach";
import { LINEUP_RULES } from "@/utils/HeroList";
import { accountName } from "@/utils/accountName";

const tokenStore = useTokenStore();

// ===== 原生 Toast 替代 naive-ui useMessage =====
const toasts = ref([]);
let toastSeq = 0;
const toast = (type, msg, duration = 2600) => {
  const id = ++toastSeq;
  toasts.value.push({ id, type, msg });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, duration);
};

// ===== 日志 =====
// 界面渲染最近 MAX_LOG_ENTRIES 条; 内存保留 MEM_WINDOW 条;
// 全量历史按小时分块存 IndexedDB: 不设条数上限, 超 LOG_RETENTION_DAYS 天过期, 导出后清空。
const MAX_LOG_ENTRIES = 1000;
const MEM_WINDOW = 2000;
const LOG_CHUNK_PREFIX = "batchBattle:runLogs:";
const LOG_RETENTION_DAYS = 7;

const pad2 = (n) => String(n).padStart(2, "0");
const chunkIdOf = (ts) => {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    pad2(d.getHours())
  );
};
const chunkCutoffId = (ts) =>
  chunkIdOf(ts - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

const logs = ref([]);
let unsentLogs = [];
let logsHydrated = false;

const fixLegacyTimeLabel = (arr) => {
  const today = new Date().toLocaleDateString();
  for (const l of arr) {
    if (
      l?.ts &&
      new Date(l.ts).toLocaleDateString() !== today &&
      String(l.time || "").length <= 8
    ) {
      l.time = new Date(l.ts).toLocaleString();
    }
  }
};

// 启动: 迁移旧 localStorage 数据 → 清理过期分块 → 恢复最近 MEM_WINDOW 条到内存
(async () => {
  try {
    const legacyRaw = localStorage.getItem(LOG_CHUNK_PREFIX);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw || "null");
      if (Array.isArray(legacy) && legacy.length > 0) {
        const groups = new Map();
        for (const e of legacy) {
          const cid = chunkIdOf(e?.ts || Date.now());
          if (!groups.has(cid)) groups.set(cid, []);
          groups.get(cid).push(e);
        }
        for (const [cid, entries] of groups) {
          await setKV(LOG_CHUNK_PREFIX + cid, entries);
        }
      }
      localStorage.removeItem(LOG_CHUNK_PREFIX);
    }
  } catch (_) {}

  try {
    const cutoff = chunkCutoffId(Date.now());
    await deleteKVByPrefix(
      LOG_CHUNK_PREFIX,
      (key) => key.slice(LOG_CHUNK_PREFIX.length) < cutoff,
    );
    const rows = await getKVByPrefix(LOG_CHUNK_PREFIX);
    rows.sort((a, b) => (a.key < b.key ? 1 : -1));
    const restored = [];
    for (const { value } of rows) {
      if (Array.isArray(value)) restored.unshift(...value);
      if (restored.length >= MEM_WINDOW) break;
    }
    // 过滤损坏条目(历史写入可能含 null/undefined), 防止渲染崩溃
    const clean = restored.filter(
      (l) => l && typeof l === "object" && !Array.isArray(l),
    );
    const trimmed = clean.slice(-MEM_WINDOW);
    fixLegacyTimeLabel(trimmed);
    const seen = new Set(trimmed.map((l) => l.ts));
    const pending = logs.value.filter((l) => !seen.has(l.ts));
    logs.value = [...trimmed, ...pending];
  } catch (_) {}
  logsHydrated = true;
})();

// 增量写入: 只把新条目按小时分块追加进 IndexedDB, 不重写历史分块
const flushLogsToDb = async () => {
  if (!logsHydrated || unsentLogs.length === 0) return;
  const groups = new Map();
  for (const e of unsentLogs) {
    const cid = chunkIdOf(e.ts);
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(e);
  }
  unsentLogs = [];
  for (const [cid, entries] of groups) {
    try {
      const prev = (await getKV(LOG_CHUNK_PREFIX + cid)) || [];
      await setKV(LOG_CHUNK_PREFIX + cid, prev.concat(entries));
    } catch (e) {
      console.warn("[批量战斗] 日志写入 IndexedDB 失败:", cid, e);
    }
  }
};

watch(
  () => logs.value.length,
  () => {
    if (logSaveTimer) clearTimeout(logSaveTimer);
    logSaveTimer = setTimeout(flushLogsToDb, 800);
  },
);

// 每小时清理一次过期分块(页面长开时)
setInterval(async () => {
  try {
    const cutoff = chunkCutoffId(Date.now());
    await deleteKVByPrefix(
      LOG_CHUNK_PREFIX,
      (key) => key.slice(LOG_CHUNK_PREFIX.length) < cutoff,
    );
  } catch (_) {}
}, 60 * 60 * 1000);

const clearStoredLogs = async () => {
  unsentLogs = [];
  try {
    await deleteKVByPrefix(LOG_CHUNK_PREFIX);
  } catch (_) {}
};

const flushOnHide = () => {
  if (document.hidden) flushLogsToDb();
};
document.addEventListener("visibilitychange", flushOnHide);
window.addEventListener("beforeunload", flushLogsToDb);
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", flushOnHide);
  window.removeEventListener("beforeunload", flushLogsToDb);
  flushLogsToDb();
});

const logContainer = ref(null);
const autoScrollLog = ref(true);
const filterErrorsOnly = ref(false);
const filterSuccessOnly = ref(false);

const errorCount = computed(() =>
  logs.value.filter((log) => log.type === "error").length,
);
const successCount = computed(() =>
  logs.value.filter((log) => log.type === "success").length,
);

const onToggleSuccessFilter = (checked) => {
  filterSuccessOnly.value = checked;
  if (checked) filterErrorsOnly.value = false;
};

const onToggleErrorFilter = (checked) => {
  filterErrorsOnly.value = checked;
  if (checked) filterSuccessOnly.value = false;
};

// 界面只渲染最近 MAX_LOG_ENTRIES 条, 全量仍在 logs 中(持久化/导出用)
const visibleLogs = computed(() =>
  logs.value.filter((l) => l && typeof l === "object").slice(-MAX_LOG_ENTRIES),
);

const filteredLogs = computed(() => {
  if (filterSuccessOnly.value) {
    return visibleLogs.value.filter((log) => log.type === "success");
  }
  if (filterErrorsOnly.value) {
    return visibleLogs.value.filter((log) => log.type === "error");
  }
  return visibleLogs;
});

const addLog = (entry) => {
  const e = { ts: Date.now(), ...entry };
  logs.value.push(e);
  unsentLogs.push(e);
  if (logs.value.length > MEM_WINDOW) {
    logs.value.splice(0, logs.value.length - MEM_WINDOW);
  }
  try {
    if (logContainer.value && autoScrollLog.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  } catch (error) {
    console.warn("Failed to scroll log container:", error);
  }
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
        console.warn("Failed to scroll log container:", error);
      }
    });
  }
});

const moreMenuOptions = [
  { label: "导出日志", key: "export-logs" },
  { label: "复制日志", key: "copy-logs" },
  { label: "清空日志", key: "clear-logs" },
];

const onMoreItem = (key) => {
  if (key === "clear-logs") clearLogs();
  else if (key === "copy-logs") copyLogs();
  else if (key === "export-logs") exportLogs();
};

const copyLogs = () => {
  if (logs.value.length === 0) {
    toast("warning", "没有可复制的日志");
    return;
  }
  const logText = logs.value
    .map((log) => log.time + " " + log.message)
    .join("\n");
  navigator.clipboard
    .writeText(logText)
    .then(() => {
      toast("success", "日志已复制到剪贴板");
    })
    .catch((err) => {
      toast("error", "复制日志失败: " + err.message);
    });
};

const exportLogs = async () => {
  let all = [];
  try {
    const rows = await getKVByPrefix(LOG_CHUNK_PREFIX);
    rows.sort((a, b) => (a.key > b.key ? 1 : -1));
    for (const { value } of rows) {
      if (Array.isArray(value)) all.push(...value);
    }
  } catch (_) {}
  if (all.length === 0 && logs.value.length === 0) {
    toast("warning", "没有可导出的日志");
    return;
  }
  const seen = new Set();
  all = all.concat(logs.value).filter((l) => {
    if (!l || seen.has(l.ts)) return false;
    seen.add(l.ts);
    return true;
  });
  const lines = all.map(
    (log) =>
      `[${log.ts ? new Date(log.ts).toLocaleString() : log.time}] [${log.type || "info"}] ${log.message}`,
  );
  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `batch_battle_logs_${new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[T:]/g, "-")}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  // 导出后即清空本地(内存 + IndexedDB)
  logs.value = [];
  await clearStoredLogs();
  toast("success", `已导出 ${all.length} 条日志并清空本地记录`);
};

const clearLogs = () => {
  logs.value = [];
  clearStoredLogs();
  toast("success", "日志已清空");
};

// ===== 账号选择 =====
const signedTokens = computed(() => gameTokens.value || []);
const selectedTokens = useLocalStorage("batchBattle:selectedTokens", []);

const getDisplayName = (token) => token.roleName || token.name || token.id;

const getStatusText = (tokenId) => {
  const status = tokenStore.getWebSocketStatus(tokenId);
  return status || "disconnected";
};
const getStatusType = (tokenId) => {
  const s = tokenStore.getWebSocketStatus(tokenId);
  return s === "connected" ? "success" : s === "connecting" ? "warning" : "default";
};

// 收起/展开账号列表，收起时仅显示已选中的账号
const isAccountListCollapsed = ref(false);
const displayedTokens = computed(() => {
  if (!isAccountListCollapsed.value) return signedTokens.value;
  const selectedSet = new Set(selectedTokens.value);
  return signedTokens.value.filter((token) => selectedSet.has(token.id));
});

// 分组快速选择（可收起/展开）
const isGroupListCollapsed = ref(false);
const selectedGroupIds = ref([]);
const getToken = (tokenId) => signedTokens.value.find((token) => token.id === tokenId);
function toggleGroup(group) {
  const index = selectedGroupIds.value.indexOf(group.id);
  const validIds = (group.tokenIds || []).filter((tokenId) => getToken(tokenId));
  if (index >= 0) {
    selectedGroupIds.value.splice(index, 1);
    const groupSet = new Set(validIds);
    selectedTokens.value = selectedTokens.value.filter((tokenId) => !groupSet.has(tokenId));
  } else {
    selectedGroupIds.value.push(group.id);
    selectedTokens.value = [...new Set([...selectedTokens.value, ...validIds])];
  }
}
function groupChipStyle(group) {
  const selected = selectedGroupIds.value.includes(group.id);
  return selected
    ? { backgroundColor: group.color, borderColor: group.color, color: "#fff" }
    : { borderColor: group.color, color: group.color };
}

const isAllSelected = computed(
  () =>
    signedTokens.value.length > 0 &&
    selectedTokens.value.length === signedTokens.value.length,
);
const isIndeterminate = computed(
  () =>
    selectedTokens.value.length > 0 &&
    selectedTokens.value.length < signedTokens.value.length,
);
const handleSelectAll = (val) => {
  selectedTokens.value = val ? signedTokens.value.map((t) => t.id) : [];
};
const toggleToken = (id) => {
  const i = selectedTokens.value.indexOf(id);
  if (i >= 0) selectedTokens.value.splice(i, 1);
  else selectedTokens.value.push(id);
};

// 头部状态药丸
const headerStatus = computed(() => {
  const total = signedTokens.value.length;
  const sel = selectedTokens.value.length;
  const connected = selectedTokens.value.filter(
    (id) => tokenStore.getWebSocketStatus(id) === "connected",
  ).length;
  return { total, sel, connected };
});
const headerStatusText = computed(() => {
  if (headerStatus.value.total === 0) return "未导入账号";
  return "已选 " + headerStatus.value.sel + " / " + headerStatus.value.total + " · 已连接 " + headerStatus.value.connected;
});
const headerStatusClass = computed(() => {
  if (headerStatus.value.sel === 0) return "is-off";
  if (headerStatus.value.connected === headerStatus.value.sel) return "is-on";
  return "is-partial";
});

const sourceToken = computed(() => tokenStore.selectedToken || null);
const sourceTokenId = computed(() => sourceToken.value ? sourceToken.value.id : "");

// ===== 执行状态 =====
const isRunning = ref(false);
const shouldStop = ref(false);
const activeTab = ref("salt");
const importFileInput = ref(null);

const connectionManager = createConnectionManager({
  tokenStore,
  batchSettings: {
    maxActive: 10,
    connectionTimeout: 30000,
    reconnectDelay: 3000,
  },
  addLog,
});

// ===== 盐场配置 =====
const defaultSaltOptions = () => ({
  autoResurrect: true,
  useItem: false,
  instantRevive: false,
  autoAttack: true,
  autoAttackPlayers: true,
  autoAttackBuildings: true,
  autoMarch: true,
  marchStrategy: "nearToFar",
  autoSpeedUp: false,
  followMemberIds: [],
  recruitTeam: true,
  teamMode: "random",
  priorityAttack: false,
  priorityFormationNames: [],
});
const saltOptions = useLocalStorage("batchBattle:saltOptions", defaultSaltOptions());

// 蟠桃园配置
const defaultPeachOptions = () => ({
  contestEnemyShips: true, // 抢夺敌方控制的船(打赢夺回控制权)
  noAttackPlayers: false, // 只上船不打人(小号打不过别人): 不攻击玩家, 可上船(含敌方船)
  autoResurrect: true, // 阵亡后按服务端 sleepTime 等待自动复活
  targetStrategy: "progress", // 目标船选择: progress=进度最高 | nearest=距离最近
  pollInterval: 3000, // 战场轮询间隔(ms)
  commandDelay: 500, // 命令间延时(ms)
});
const peachOptions = useLocalStorage(
  "batchBattle:peachOptions",
  defaultPeachOptions(),
  { mergeDefaults: true },
);

const onAutoResurrectChange = (value) => {
  saltOptions.value.autoResurrect = value;
  if (!value) {
    saltOptions.value.useItem = false;
    saltOptions.value.instantRevive = false;
  }
};

// ===== 战斗队伍(指定模式) / 跟随成员 =====
const MAX_TEAM_MEMBERS = 4;
const clubMembers = ref([]);
const selectedMemberIds = useLocalStorage("batchBattle:selectedMemberIds", []);
const loadingMembers = ref(false);
const clubLoadError = ref("");

const memberPickerMode = ref("team");
const showMemberPicker = ref(false);
const draftMemberIds = ref([]);
const followMemberIds = useLocalStorage("batchBattle:followMemberIds", []);

const pickerLimit = computed(() =>
  memberPickerMode.value === "team" ? MAX_TEAM_MEMBERS : 999,
);
const pickerTitle = computed(() =>
  memberPickerMode.value === "follow"
    ? "选择要跟随的俱乐部成员（可多选）"
    : "选择俱乐部成员（最多4名）",
);

const selectedMembers = computed(() => {
  const map = new Map(clubMembers.value.map((m) => [m.roleId, m]));
  return selectedMemberIds.value.map((id) => map.get(String(id))).filter(Boolean);
});

const followedMembers = computed(() => {
  const map = new Map(clubMembers.value.map((m) => [m.roleId, m]));
  return followMemberIds.value.map((id) => map.get(String(id))).filter(Boolean);
});

const loadClubMembers = async () => {
  if (!sourceTokenId.value) {
    clubLoadError.value = "请先在 Token 管理选择当前账号";
    return;
  }
  loadingMembers.value = true;
  clubLoadError.value = "";
  try {
    await connectionManager.ensureConnection(sourceTokenId.value, signedTokens.value);

    // 与「游戏功能」一致：以 fire-and-forget 发送，响应由 LegionPlugin 写入
    // tokenStore.gameData.legionInfo，轮询等待其刷新后读取成员
    const prevUpdatedAt = tokenStore.gameData?.lastUpdated || null;
    tokenStore.sendMessage(sourceTokenId.value, "legion_getinfo");

    const start = Date.now();
    let legionInfo = null;
    while (Date.now() - start < 8000) {
      const li = tokenStore.gameData?.legionInfo || null;
      const members = li && li.info ? li.info.members : null;
      const fresh = !prevUpdatedAt || li?.lastUpdated !== prevUpdatedAt;
      if (li && members && Object.keys(members).length > 0 && fresh) {
        legionInfo = li;
        break;
      }
      await workerSleep(300);
    }
    if (!legionInfo) legionInfo = tokenStore.gameData?.legionInfo || null;

    const info = (legionInfo ? legionInfo.info : null) || {};
    const raw = info.members || {};
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    clubMembers.value = list.map((m) => ({
      roleId: String(m.roleId),
      name: m.name || m.nickname || String(m.roleId),
      isOnline: !!m.isOnline,
      headImg: m.headImg,
      job: Number(m.job || 0),
      power: Number(m.power || (m.custom ? m.custom.s_power : 0) || 0),
      redQuench: Number(m.custom ? m.custom.red_quench_cnt || 0 : 0),
    }));
    const ids = new Set(clubMembers.value.map((m) => m.roleId));
    selectedMemberIds.value = selectedMemberIds.value.filter((id) => ids.has(String(id)));
    followMemberIds.value = followMemberIds.value.filter((id) => ids.has(String(id)));
    if (clubMembers.value.length === 0) clubLoadError.value = "该账号暂无俱乐部成员";
    addLog({
      time: new Date().toLocaleTimeString(),
      message: (sourceToken.value ? accountName(sourceToken.value) : sourceTokenId.value) + " 俱乐部成员 " + clubMembers.value.length + " 人",
      type: "info",
    });
  } catch (e) {
    clubLoadError.value = "加载俱乐部成员失败: " + e.message;
    toast("warning", clubLoadError.value);
  } finally {
    loadingMembers.value = false;
  }
};
const openMemberPicker = async () => {
  if (isRunning.value) return;
  memberPickerMode.value = "team";
  if (clubMembers.value.length === 0 || clubLoadError.value) {
    await loadClubMembers();
  }
  draftMemberIds.value = selectedMemberIds.value.slice();
  showMemberPicker.value = true;
};

const openFollowPicker = async () => {
  if (isRunning.value) return;
  memberPickerMode.value = "follow";
  if (clubMembers.value.length === 0 || clubLoadError.value) {
    await loadClubMembers();
  }
  draftMemberIds.value = followMemberIds.value.slice();
  showMemberPicker.value = true;
};

const reloadClubMembers = async () => {
  await loadClubMembers();
};

const toggleDraftMember = (roleId, checked) => {
  let next = draftMemberIds.value.slice();
  if (checked) {
    if (next.includes(roleId)) return;
    if (next.length >= pickerLimit.value) {
      toast("warning", "最多选择 " + pickerLimit.value + " 名成员");
    } else {
      next.push(roleId);
    }
  } else {
    next = next.filter((id) => id !== roleId);
  }
  // 始终重新赋值以触发更新并复位超限的勾选框
  draftMemberIds.value = next;
};

const toggleDraftMemberRow = (roleId) => {
  toggleDraftMember(roleId, !draftMemberIds.value.includes(roleId));
};

const confirmMemberPicker = () => {
  if (memberPickerMode.value === "follow") {
    followMemberIds.value = draftMemberIds.value.slice();
  } else {
    selectedMemberIds.value = draftMemberIds.value.slice();
  }
  showMemberPicker.value = false;
};

const removeMember = (roleId) => {
  selectedMemberIds.value = selectedMemberIds.value.filter(
    (id) => String(id) !== String(roleId),
  );
};

const removeFollowMember = (roleId) => {
  followMemberIds.value = followMemberIds.value.filter(
    (id) => String(id) !== String(roleId),
  );
};

const formatNumber = (num) => {
  const n = Number(num || 0);
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "兆";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(2) + "万";
  return String(n);
};

watch(
  () => saltOptions.value.teamMode,
  (mode) => {
    if (mode === "specified") loadClubMembers();
  },
);

// ===== 优先攻击阵容 =====
const lineupOptions = computed(() =>
  LINEUP_RULES.map((r) => ({
    value: r.name,
    label: r.name,
    color: r.colorProps ? r.colorProps.color : undefined,
  })),
);

const toggleLineup = (name, checked) => {
  const arr = saltOptions.value.priorityFormationNames;
  let next;
  if (checked) {
    next = arr.includes(name) ? arr : [...arr, name];
  } else {
    next = arr.filter((n) => n !== name);
  }
  saltOptions.value.priorityFormationNames = next;
};

const removeLineup = (name) => {
  saltOptions.value.priorityFormationNames =
    saltOptions.value.priorityFormationNames.filter((n) => n !== name);
};

const lineupChipStyle = (name) => {
  const rule = LINEUP_RULES.find((r) => r.name === name);
  if (!rule) return {};
  return {
    background: rule.colorProps ? rule.colorProps.color : undefined,
    color: rule.colorProps ? rule.colorProps.textColor || "#fff" : "#fff",
  };
};

// ===== 主按钮随标签联动 =====
const mainActionText = computed(() => {
  if (isRunning.value) return "执行中…";
  return activeTab.value === "peach" ? "开始蟠桃园监控" : "开始盐场战斗";
});
const runMainAction = () => {
  if (activeTab.value === "peach") startPeachBattle();
  else startBattle();
};

// ===== 盐场关键信息弹窗 =====
const PHASE_TEXT_MAP = {
  sign: "报名期",
  ready: "准备中",
  prepare: "准备中",
  fight: "战斗中",
  fighting: "战斗中",
  end: "已结束",
};
const phaseText = (phase) => {
  if (phase === null || phase === undefined || phase === "") return "未知";
  return PHASE_TEXT_MAP[String(phase).toLowerCase()] || String(phase);
};
const SELF_STATE_TEXT = {
  idle: "空闲",
  march: "行军中",
  combat: "战斗中",
  watching: "阵亡观战",
  over: "阵亡",
};
const selfStateText = (state) => SELF_STATE_TEXT[state] || state || "未知";

const showSaltInfo = ref(false);
const SALT_INFO_REFRESH_MS = 30000;
let saltInfoTimer = null;
let saltInfoToken = null;
const saltRoleIds = new Map(); // tokenId -> roleId(缓存, 不随刷新变化)
const saltInfo = ref({
  loading: false,
  error: "",
  base: null,
  accounts: [],
  snapshotAt: "",
});

const stopSaltInfoRefresh = () => {
  if (saltInfoTimer) {
    clearInterval(saltInfoTimer);
    saltInfoTimer = null;
  }
};

const closeSaltInfo = () => {
  showSaltInfo.value = false;
  stopSaltInfoRefresh();
};

const loadSaltSummary = async () => {
  if (!saltInfoToken || saltInfo.value.loading) return;
  saltInfo.value.loading = true;
  try {
    const tokens = selectedTokens.value
      .map((id) => signedTokens.value.find((t) => t.id === id))
      .filter(Boolean);

    // 补齐各账号 roleId(只查一次, 之后走缓存)
    for (const t of tokens) {
      if (saltRoleIds.has(t.id)) continue;
      let rid = t.roleId || null;
      if (!rid) {
        try {
          await connectionManager.ensureConnection(t.id, signedTokens.value);
          const rr = await tokenStore.sendMessageWithPromise(
            t.id,
            "role_getroleinfo",
            {},
            8000,
          );
          rid = rr?.role?.roleId || null;
        } catch (_) {}
      }
      saltRoleIds.set(t.id, rid);
    }

    const res = await tokenStore.sendMessageWithPromise(
      saltInfoToken.id,
      "legion_getbattlefield",
      {},
      10000,
    );
    const info = res?.info || {};
    saltInfo.value.base = {
      battlefieldId: info.battlefieldId,
      phase: info.phase,
    };

    const bf = await fetchSaltBattlefieldSnapshot({
      token: saltInfoToken.token,
      sid: info.sid,
      battlefieldId: info.battlefieldId,
    });
    if (!bf) throw new Error("战场快照为空");
    const roleList = bf.roles ? Object.values(bf.roles) : [];
    saltInfo.value.accounts = tokens.map((t) => {
      const rid = saltRoleIds.get(t.id);
      const r = rid
        ? roleList.find((x) => String(x?.id) === String(rid))
        : null;
      return {
        tokenId: t.id,
        name: accountName(t),
        found: !!r,
        state: r?.state || null,
        energy: Number(r?.energy || 0),
        revive: Number(r?.revive || 0),
      };
    });
    saltInfo.value.snapshotAt = new Date().toLocaleTimeString();
    saltInfo.value.error = "";
  } catch (e) {
    saltInfo.value.error = e.message;
  } finally {
    saltInfo.value.loading = false;
  }
};

const openSaltSummary = (firstToken) => {
  saltInfoToken = firstToken;
  saltInfo.value = {
    loading: false,
    error: "",
    base: null,
    accounts: [],
    snapshotAt: "",
  };
  showSaltInfo.value = true;
  stopSaltInfoRefresh();
  loadSaltSummary();
  saltInfoTimer = setInterval(loadSaltSummary, SALT_INFO_REFRESH_MS);
};

onBeforeUnmount(stopSaltInfoRefresh);

// ===== 执行 =====
const buildSaltOptions = () => ({
  autoResurrect: saltOptions.value.autoResurrect,
  useItem: saltOptions.value.useItem,
  instantRevive: saltOptions.value.instantRevive,
  autoAttack: saltOptions.value.autoAttack,
  autoAttackPlayers: saltOptions.value.autoAttackPlayers,
  autoAttackBuildings: saltOptions.value.autoAttackBuildings,
  autoMarch: saltOptions.value.autoMarch,
  marchStrategy: saltOptions.value.marchStrategy,
  autoSpeedUp: saltOptions.value.autoSpeedUp,
  followMemberIds: followMemberIds.value.map(Number),
  recruitTeam: saltOptions.value.recruitTeam,
  teamMode: saltOptions.value.teamMode,
  team:
    saltOptions.value.teamMode === "specified"
      ? selectedMemberIds.value.map(Number)
      : [],
  priorityAttack: saltOptions.value.priorityAttack,
  priorityFormationNames: saltOptions.value.priorityFormationNames,
});

const startBattle = async () => {
  if (isRunning.value) return;
  isRunning.value = true;
  shouldStop.value = false;
  // 不清空历史日志(已持久化), 仅插入新一轮分隔线
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "──────── 新一轮批量执行 ────────",
    type: "info",
  });

  const tokens = selectedTokens.value.map((id) =>
    signedTokens.value.find((t) => t.id === id),
  );

  addLog({
    time: new Date().toLocaleTimeString(),
    message: "=== 开始批量盐场战斗, 共 " + tokens.length + " 个账号 ===",
    type: "info",
  });

  // 弹出盐场关键信息(异步加载, 不阻塞战斗启动)
  openSaltSummary(tokens.find(Boolean));

  const options = buildSaltOptions();
  await Promise.all(
    tokens.map(async (token) => {
      if (!token || shouldStop.value) return;
      try {
        await runSaltFieldBattle(token.id, token, options, {
          tokenStore,
          ensureConnection: connectionManager.ensureConnection,
          addLog,
          workerSleep,
          shouldStop: () => shouldStop.value,
          commandDelay: 300,
        });
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: accountName(token) + " 盐场战斗异常: " + e.message,
          type: "error",
        });
      }
    }),
  );

  isRunning.value = false;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "=== 批量盐场战斗结束 ===",
    type: "success",
  });
  toast("success", "批量盐场战斗结束");
};

const stopBattle = () => {
  shouldStop.value = true;
};

// ===== 配置导出/导入(JSON 文件, 不依赖浏览器存储) =====
const BATTLE_CONFIG_TYPE = "xyzw-batch-battle-config";

const exportBattleConfig = () => {
  try {
    const exportData = {
      type: BATTLE_CONFIG_TYPE,
      version: "1.0",
      exportTime: new Date().toISOString(),
      saltOptions: saltOptions.value,
      selectedTokens: selectedTokens.value,
      selectedMemberIds: selectedMemberIds.value,
      followMemberIds: followMemberIds.value,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `batch_battle_config_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast("success", "批量战斗配置已导出");
  } catch (e) {
    toast("error", "导出失败: " + e.message);
  }
};

const onImportFileChange = (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data?.type !== BATTLE_CONFIG_TYPE || !data.saltOptions) {
        toast("error", "无效的批量战斗配置文件");
        return;
      }
      saltOptions.value = { ...defaultSaltOptions(), ...data.saltOptions };
      if (Array.isArray(data.selectedTokens)) {
        selectedTokens.value = data.selectedTokens;
      }
      if (Array.isArray(data.selectedMemberIds)) {
        selectedMemberIds.value = data.selectedMemberIds;
      }
      if (Array.isArray(data.followMemberIds)) {
        followMemberIds.value = data.followMemberIds;
      }
      toast("success", "配置已导入并应用");
    } catch (err) {
      toast("error", "导入失败: " + err.message);
    }
  };
  reader.onerror = () => toast("error", "读取文件失败");
  reader.readAsText(file);
};

const claimPeachTasks = async () => {
  if (isRunning.value) return;
  isRunning.value = true;
  shouldStop.value = false;
  logs.value = [];
  try {
    const tokens = selectedTokens.value.map((id) =>
      signedTokens.value.find((t) => t.id === id),
    );
    for (const token of tokens) {
      if (shouldStop.value || !token) break;
      try {
        await connectionManager.ensureConnection(token.id, signedTokens.value);
        const res = await tokenStore.sendMessageWithPromise(
          token.id,
          "legion_getpayloadtask",
          {},
          5000,
        );
        const payloadTask = res?.payloadTask || res?.data?.payloadTask;
        if (payloadTask && payloadTask.taskMap) {
          const tasks = [];
          Object.entries(payloadTask.taskMap).forEach(([, item]) => {
            if (item && item.progress != null && item.claimedProgress != null && item.progress > item.claimedProgress) {
              tasks.push(item);
            }
          });
          for (const task of tasks) {
            if (shouldStop.value) break;
            try {
              await tokenStore.sendMessageWithPromise(
                token.id,
                "legion_claimpayloadtask",
                { taskId: task.id },
                5000,
              );
              addLog({
                time: new Date().toLocaleTimeString(),
                message: accountName(token) + " 领取任务成功 (id=" + task.id + ")",
                type: "success",
              });
            } catch (e) {
              // 忽略单个任务失败
            }
            await workerSleep(200);
          }
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: accountName(token) + " 蟠桃园任务领取完成",
          type: "success",
        });
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: accountName(token) + " 领取失败: " + e.message,
          type: "error",
        });
      }
    }
  } finally {
    isRunning.value = false;
  }
};

onBeforeUnmount(() => {
  shouldStop.value = true;
});

const startPeachBattle = async () => {
  if (isRunning.value) return;
  isRunning.value = true;
  shouldStop.value = false;
  addLog({
    time: new Date().toLocaleTimeString(),
    message: "──────── 新一轮批量执行(蟠桃园) ────────",
    type: "info",
  });

  try {
    const tokens = selectedTokens.value.map((id) =>
      signedTokens.value.find((t) => t.id === id),
    );

    addLog({
      time: new Date().toLocaleTimeString(),
      message: "=== 开始批量蟠桃园监控, 共 " + tokens.length + " 个账号 ===",
      type: "info",
    });

    // 并发跑所有选中账号(连接并发由 connectionManager maxActive 排队控制)
    await Promise.all(
      tokens.map(async (token) => {
        if (!token || shouldStop.value) return;
        let acquired = false; // 本次是否占用了连接槽位(结束后需释放)
        try {
          const wasConnected =
            tokenStore.getWebSocketStatus(token.id) === "connected";
          await connectionManager.ensureConnection(token.id, signedTokens.value);
          acquired = !wasConnected;

          await runPeachBattle({
            tokenStore,
            tokenId: token.id,
            roleId: token.roleId || "",
            name: accountName(token),
            addLog,
            shouldStop: () => shouldStop.value,
            commandDelay: Math.max(Number(peachOptions.value.commandDelay) || 500, 100),
            pollInterval: Math.max(Number(peachOptions.value.pollInterval) || 3000, 500),
            contestEnemy: peachOptions.value.contestEnemyShips !== false,
            noAttackPlayers: peachOptions.value.noAttackPlayers === true,
            targetStrategy: peachOptions.value.targetStrategy || "progress",
            autoResurrect: peachOptions.value.autoResurrect !== false,
          });

          addLog({ time: new Date().toLocaleTimeString(), message: accountName(token) + " 蟠桃园战场监控结束", type: "success" });
        } catch (e) {
          addLog({ time: new Date().toLocaleTimeString(), message: accountName(token) + " 蟠桃战场异常: " + e.message, type: "error" });
        } finally {
          tokenStore.closeWebSocketConnection(token.id);
          if (acquired) connectionManager.releaseConnectionSlot();
        }
      }),
    );
  } finally {
    isRunning.value = false;
  }
};

onMounted(() => {
  if (
    (selectedMemberIds.value.length > 0 || followMemberIds.value.length > 0) &&
    sourceTokenId.value
  ) {
    loadClubMembers();
  }
});
</script>
<style scoped lang="scss">
.batch-battle-page {
  min-height: 100dvh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));
}

[data-theme="dark"] .batch-battle-page {
  background: linear-gradient(135deg, #0f172a 0%, #1f2937 100%);
}

// ===== 页面头部（参考游戏功能）=====
.page-header {
  position: sticky;
  /* 低于顶部导航栏(--z-sticky), 避免「更多」下拉菜单被本页头遮挡 */
  z-index: calc(var(--z-sticky) - 20);
  top: 0;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  padding: var(--spacing-lg) 0;
}

.container {
  /* 全宽布局: 两侧预留边距 */
  --page-gutter: clamp(24px, 3vw, 56px);
  max-width: none;
  margin: 0;
  padding-left: var(--page-gutter);
  padding-right: var(--page-gutter);
}

.batch-body {
  /* 复用 --page-gutter, 避免简写覆盖容器左右边距 */
  padding: var(--spacing-lg) var(--page-gutter) var(--spacing-xl);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.page-title {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.page-subtitle {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.status-pill.is-on {
  background: rgba(24, 160, 88, 0.12);
  color: var(--success-color);
  .status-dot { background: var(--success-color); }
}
.status-pill.is-partial {
  background: rgba(245, 166, 35, 0.14);
  color: var(--warning-color);
  .status-dot { background: var(--warning-color); }
}
.status-pill.is-off {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  .status-dot { background: var(--text-tertiary); }
}

// ===== 按钮 =====
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--border-radius-medium);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}
.btn-primary { background: var(--primary-color); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--primary-color-hover); }
.btn-default {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-color: var(--border-light);
}
.btn-default:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.btn-error { background: var(--error-color); color: #fff; }
.btn-warning { background: var(--warning-color); color: #fff; }
.btn-ghost {
  background: transparent;
  border-color: var(--error-color);
  color: var(--error-color);
}
.btn-ghost:hover:not(:disabled) { background: rgba(208, 48, 80, 0.08); }
.btn-sm { padding: 5px 12px; font-size: var(--font-size-xs); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

// ===== 卡片（参考游戏功能 feature-card 的左强调边框）=====
.card {
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-medium);
  padding: var(--spacing-lg);
  border-left: 4px solid var(--primary-color);
  animation: fade-up 0.25s ease both;
}
.card--primary { border-left-color: var(--primary-color); }
.card--info { border-left-color: var(--info-color); }
.card--success { border-left-color: var(--success-color); }

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}
.card-header--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}
.card-title-row { display: flex; align-items: center; }
.card-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}
.card-extra {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.main-layout {
  display: grid;
  /* 配置列占满剩余屏幕, 执行日志固定 480px */
  grid-template-columns: minmax(0, 1fr) 480px;
  gap: var(--spacing-lg);
  align-items: start;
}
.left-column {
  grid-column: 1; /* 配置: 占满剩余 */
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}
.right-column {
  grid-column: 2; /* 日志: 固定 480px */
  display: flex;
}

// ===== 复选框 =====
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.ui-checkbox input { position: absolute; opacity: 0; width: 0; height: 0; }
.ui-checkbox-box {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-medium);
  border-radius: 5px;
  background: var(--bg-primary);
  position: relative;
  transition: all var(--transition-fast);
  flex: none;
}
.ui-checkbox input:checked + .ui-checkbox-box {
  background: var(--primary-color);
  border-color: var(--primary-color);
}
.ui-checkbox input:checked + .ui-checkbox-box::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.ui-checkbox input:indeterminate + .ui-checkbox-box {
  background: var(--primary-color);
  border-color: var(--primary-color);
}
.ui-checkbox input:indeterminate + .ui-checkbox-box::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 7px;
  width: 8px;
  height: 2px;
  background: #fff;
}
.ui-checkbox--sm .ui-checkbox-box { width: 16px; height: 16px; }
.ui-checkbox--sm .ui-checkbox-label { font-size: var(--font-size-xs); }

// ===== 账号清单 =====
.select-all { margin-bottom: var(--spacing-sm); }
.collapse-toggle {
  margin-left: var(--spacing-sm);
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.group-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
}
.group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.group-count {
  font-size: var(--font-size-xs);
  color: var(--color-muted, #888);
}
.group-list-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.group-chip {
  border: 1px solid;
  border-radius: 999px;
  padding: 3px 10px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
  line-height: 1.4;
}
.roster {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 12px;
  margin-top: var(--spacing-sm);
}
@media (max-width: 880px) { .roster { grid-template-columns: 1fr; } }
.roster-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  background: var(--bg-primary);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.roster-item:hover { border-color: var(--border-medium); }
.roster-item.selected {
  border-color: var(--primary-color);
  background: rgba(102, 126, 234, 0.06);
}
.roster-name {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ===== 账号连接状态圆点 =====
.roster-status {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-tertiary, #c2c8d1);
}
.roster-status--success { background: var(--success-color); }
.roster-status--warning { background: var(--warning-color); }

// ===== 原生 Tab =====
.ui-tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: var(--spacing-md);
}
.ui-tab {
  padding: 8px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--transition-fast);
}
.ui-tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}
.ui-tab-pane { animation: fade 0.2s ease; }

// ===== 表单行 =====
.form-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-bottom: 1px dashed var(--border-light);
}
.form-row:last-of-type { border-bottom: none; }
.form-label {
  flex: 0 0 84px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  padding-top: 2px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.switch-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-right: 14px;
  white-space: nowrap;
}
.switch-text:last-child { margin-right: 0; }
.ui-number-input {
  width: 110px;
  padding: 4px 8px;
  border: 1px solid var(--border-medium);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}
.form-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary, #86909c);
  align-self: center;
}
.follow-col {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
}

// ===== 开关 =====
.ui-switch { position: relative; display: inline-flex; }
.ui-switch input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  z-index: 1;
}
.ui-switch-track {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--border-medium);
  position: relative;
  display: inline-block;
  transition: background var(--transition-fast);
}
.ui-switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform var(--transition-fast);
}
.ui-switch input:checked + .ui-switch-track { background: var(--primary-color); }
.ui-switch input:checked + .ui-switch-track::after { transform: translateX(18px); }
.ui-switch.disabled { opacity: 0.5; pointer-events: none; }

// ===== 分段单选 =====
.ui-segmented {
  display: inline-flex;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  overflow: hidden;
}
.ui-segmented.disabled { opacity: 0.5; pointer-events: none; }
.ui-segmented-item { position: relative; display: inline-flex; }
.ui-segmented-item + .ui-segmented-item { border-left: 1px solid var(--border-light); }
.ui-segmented-item input { position: absolute; opacity: 0; width: 0; height: 0; }
.ui-segmented-item span {
  display: inline-block;
  padding: 4px 12px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ui-segmented-item input:checked + span {
  background: var(--primary-color);
  color: #fff;
}

// ===== 成员选择输入 =====
.member-input {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  background: var(--bg-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  transition: border-color var(--transition-fast);
}
.member-input:hover:not(.is-disabled) { border-color: var(--primary-color); }
.member-input.is-disabled { opacity: 0.6; cursor: not-allowed; }
.member-input-placeholder {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

// ===== 芯片 =====
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: var(--font-size-xs);
}
.chip--closable { cursor: pointer; }
.chip-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.15);
  font-size: 12px;
  line-height: 1;
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  width: 100%;
}

// ===== 多选下拉 =====
.ui-multiselect { position: relative; display: inline-block; }
.ui-multiselect-summary {
  list-style: none;
  cursor: pointer;
  padding: 6px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  background: var(--bg-secondary);
  font-size: var(--font-size-sm);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}
.ui-multiselect-summary::-webkit-details-marker { display: none; }
.caret { margin-left: auto; }
.ui-multiselect-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: var(--z-dropdown);
  min-width: 240px;
  max-height: 240px;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  box-shadow: var(--shadow-heavy);
  padding: 6px;
}
.ui-multiselect-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.ui-multiselect-option:hover { background: var(--bg-secondary); }
.ui-multiselect-option input { width: 16px; height: 16px; }
.lineup-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}

// ===== 提示框 / 空状态 =====
.ui-alert {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  margin-top: var(--spacing-md);
}
.ui-alert--info {
  background: rgba(32, 128, 240, 0.08);
  color: var(--text-secondary);
  border: 1px solid rgba(32, 128, 240, 0.2);
}
.ui-alert--error {
  background: rgba(208, 48, 80, 0.08);
  color: var(--error-color);
  border: 1px solid rgba(208, 48, 80, 0.2);
}
.ui-empty {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.peach-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

// ===== 日志控制 =====
.log-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.log-count {
  margin-left: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: var(--font-weight-normal);
}

.ui-dropdown { position: relative; display: inline-block; }
.ui-dropdown-trigger {
  cursor: pointer;
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--bg-primary);
  transition: all var(--transition-fast);
}
.ui-dropdown:hover .ui-dropdown-trigger,
.ui-dropdown:focus-within .ui-dropdown-trigger {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.ui-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--z-dropdown);
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  box-shadow: var(--shadow-heavy);
  overflow: hidden;
  min-width: 120px;
  display: none;
}
.ui-dropdown:hover .ui-dropdown-menu,
.ui-dropdown:focus-within .ui-dropdown-menu {
  display: block;
}
.ui-dropdown-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 14px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}
.ui-dropdown-menu button:hover { background: var(--bg-secondary); }

// ===== 进度条 =====
.ui-progress {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: var(--spacing-sm);
}
.ui-progress-bar {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
  border-radius: 999px;
  transition: width var(--transition-normal);
}
.ui-progress-bar.processing {
  background-image: linear-gradient(
    90deg,
    var(--primary-color) 25%,
    var(--secondary-color) 50%,
    var(--primary-color) 75%
  );
  background-size: 200% 100%;
  animation: progress-stripes 1s linear infinite;
}

.log-card {
  /* 填满右列剩余宽度(right-column 为 flex), 防内容收缩 */
  flex: 1;
  min-width: 0;
  position: sticky;
  top: 88px;
}
.log-container {
  height: min(60vh, 520px);
  overflow-y: auto;
  background: var(--bg-secondary);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-medium);
  margin-top: var(--spacing-sm);
  font-family: "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace;
  font-size: var(--font-size-xs);
}
.log-item {
  margin-bottom: 4px;
  font-size: 12px;
  word-break: break-all;
}
.log-item .time { color: var(--text-tertiary); margin-right: 8px; }
.log-item.error { color: var(--error-color); }
.log-item.success { color: var(--success-color); }
.log-item.warning { color: var(--warning-color); }
.log-item.info { color: var(--text-primary); }

// ===== 弹窗 =====
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  padding: var(--spacing-md);
  animation: fade 0.15s ease;
}
.ui-modal {
  width: 520px;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: var(--border-radius-large);
  box-shadow: var(--shadow-heavy);
  overflow: hidden;
}
.ui-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-light);
}
.ui-modal-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}
.ui-modal-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}
.ui-modal-close:hover { background: var(--border-light); }
.ui-modal-body {
  padding: var(--spacing-lg);
  overflow-y: auto;
}
.ui-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--border-light);
}
.modal-footer-actions { display: flex; gap: 8px; }

// ===== 盐场关键信息弹窗 =====
.salt-info-modal {
  width: min(680px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.salt-info-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}
.salt-info-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.salt-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-md);
}
.salt-info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-secondary, rgba(0, 0, 0, 0.03));
  font-size: var(--font-size-sm);
  .label {
    font-size: 12px;
    color: var(--text-tertiary);
  }
}

// ===== 成员表格 =====
.picker-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--text-secondary);
}
.picker-loading-text { font-size: var(--font-size-sm); }
.picker-hint {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.ui-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-medium);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
.member-table-wrap {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
}
.ui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}
.ui-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  text-align: left;
  padding: 8px 10px;
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
}
.ui-table tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-light);
}
.member-row { cursor: pointer; transition: background var(--transition-fast); }
.member-row:hover { background: var(--bg-secondary); }
.member-row.selected { background: rgba(102, 126, 234, 0.08); }
.col-select { width: 56px; text-align: center; }
.col-avatar { width: 56px; text-align: center; }
.col-num { text-align: center; }
.member-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}
.member-avatar--placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  font-size: 14px;
}
.member-name { font-weight: var(--font-weight-medium); }
.member-id { font-size: 12px; color: var(--text-tertiary); }

// ===== Toast =====
.toast-container {
  position: fixed;
  top: var(--spacing-md);
  right: var(--spacing-md);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  min-width: 200px;
  max-width: 320px;
  padding: 10px 14px;
  border-radius: var(--border-radius-medium);
  color: #fff;
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-heavy);
  animation: toast-in 0.2s ease;
  pointer-events: auto;
}
.toast--success { background: var(--success-color); }
.toast--error { background: var(--error-color); }
.toast--warning { background: var(--warning-color); }
.toast--info { background: var(--info-color); }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: none; }
}
@keyframes progress-stripes {
  from { background-position: 200% 0; }
  to { background-position: 0 0; }
}

@media (max-width: 1024px) {
  .main-layout { grid-template-columns: 1fr; }
  .log-card { position: static; }
  .log-card :deep(.n-card__content) { max-height: none; }
  .log-card .log-container { max-height: 50vh; }
}
@media (max-width: 768px) {
  .container { padding: 0 var(--spacing-md); }

  /* 头部: 标题整行, 状态条占满, 次要按钮三列, 主按钮整行 */
  .header-content {
    flex-direction: column;
    align-items: stretch;
    gap: var(--spacing-sm);
  }
  .header-left { flex: none; }
  .header-actions {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-sm);
  }
  .header-actions .status-pill {
    grid-column: 1 / -1;
    justify-content: center;
  }
  .header-actions .btn {
    width: 100%;
    min-width: 0;
    justify-content: center;
    padding-left: 6px;
    padding-right: 6px;
    font-size: var(--font-size-sm);
  }
  .header-actions .btn-primary { grid-column: 1 / -1; }

  /* Tab 平分整行 */
  .ui-tab-bar { width: 100%; }
  .ui-tab { flex: 1; text-align: center; }

  /* 表单行改为上下堆叠: 标签在上, 控件在下占满整行 */
  .form-row { flex-direction: column; align-items: stretch; gap: 6px; }
  .form-label { flex: none; width: 100%; padding-top: 0; }
  .switch-row { width: 100%; }
  .switch-text { white-space: normal; }
  .follow-col { width: 100%; }
  .ui-number-input { width: 100%; }
  .form-hint { align-self: flex-start; }

  /* 账号清单操作区: 允许换行 */
  .card-header { flex-wrap: wrap; }
  .collapse-toggle { margin-left: 0; }

  /* 日志区压缩高度 */
  .log-card :deep(.n-card__content) { max-height: 45vh; }
  .log-card .log-container { min-height: 120px; }
}
@media (max-width: 480px) {
  .page-title { font-size: var(--font-size-xl); }
  .page-subtitle { font-size: var(--font-size-xs); }
  .group-chip { font-size: 13px; padding: 2px 8px; }
  .log-card .log-item { font-size: 11px; }
  .roster-item { padding: 5px 6px; gap: 6px; }
  .roster-name { font-size: var(--font-size-xs); }
  .roster-status { width: 8px; height: 8px; }
}

/* ===== 执行日志（与 BatchDailyTasks 一致的样式） ===== */
.log-card {
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-light);
  transition: box-shadow var(--transition-normal, 0.3s ease);
  overflow: hidden;
}

.log-card:hover {
  box-shadow: var(--shadow-medium);
}

.log-card :deep(.n-card-header) {
  border-radius: var(--border-radius-xl) var(--border-radius-xl) 0 0;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.08) 0%,
    rgba(118, 75, 162, 0.08) 100%
  );
}

.log-card .custom-card-header {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-card .card-title {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-card .log-header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.log-card :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: calc(100dvh - 260px);
}

.log-card .log-container {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-secondary, #f7f8fa);
  padding: 10px;
  border-radius: var(--border-radius-medium, 8px);
  margin-top: 10px;
  font-family: monospace;
  min-height: 200px;
}

.log-card .log-item {
  margin-bottom: 4px;
  font-size: 12px;
}
.log-card .log-item.error { color: #d03050; }
.log-card .log-item.success { color: #18a058; }
.log-card .log-item.warning { color: #f0a020; }
.log-card .log-item.info { color: #333; }

.log-card .time {
  color: #999;
  margin-right: 8px;
}

/* form-check（与 BatchDailyTasks 相同外观） */
.log-card .form-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.log-card .form-check__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.log-card .form-check__box {
  position: relative;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: 2px solid #dcdee2;
  border-radius: 4px;
  background: #fff;
  transition: border-color 0.18s ease, background-color 0.18s ease,
    box-shadow 0.18s ease;
}
.log-card .form-check__input:focus-visible + .form-check__box {
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.18);
}
.log-card .form-check__input:checked + .form-check__box {
  border-color: var(--primary-color);
  background: var(--primary-color);
}
.log-card .form-check__input:checked + .form-check__box::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: translate(-50%, -60%) rotate(45deg);
}
.log-card .form-check__label {
  font-size: 13px;
  color: var(--text-primary);
}
</style>