<template>
  <div class="sms-login-import">
    <!-- 短信登录流程说明 -->
    <div class="login-flow-info">
      <h3>短信登录流程（手机号 + 验证码）</h3>
      <ol class="flow-steps">
        <li>输入手机号，点击「获取验证码」</li>
        <li>输入短信中的验证码，点击「登录」</li>
        <li>系统将获取该手机号下所有角色的Token信息</li>
      </ol>
    </div>

    <!-- 登录表单 -->
    <n-form :model="smsForm" label-placement="top" :show-label="true">
      <n-form-item label="手机号" :show-label="true">
        <n-input
          v-model:value="smsForm.phone"
          placeholder="请输入手机号"
          :disabled="isLoggingIn"
          maxlength="11"
        >
          <template #prefix>
            <n-icon color="var(--text-tertiary)"><PhonePortrait /></n-icon>
          </template>
        </n-input>
      </n-form-item>

      <n-form-item label="验证码" :show-label="true">
        <div class="sms-code-row">
          <n-input
            v-model:value="smsForm.code"
            placeholder="请输入6位验证码"
            :disabled="isLoggingIn"
            maxlength="6"
          >
            <template #prefix>
              <n-icon color="var(--text-tertiary)"><Key /></n-icon>
            </template>
          </n-input>
          <n-button
            :disabled="!canSendCode || isLoggingIn"
            :loading="isSendingCode"
            @click="handleSendCode"
          >
            {{ countdown > 0 ? `${countdown}秒后重发` : "获取验证码" }}
          </n-button>
        </div>
      </n-form-item>
    </n-form>

    <!-- 状态信息 -->
    <div id="sms-status" class="qr-status" :class="statusType">
      {{ statusMessage }}
    </div>

    <!-- 发送验证码 + 登录按钮 -->
    <div class="form-actions">
      <n-button
        type="primary"
        block
        :loading="isLoggingIn"
        :disabled="!smsForm.phone || smsForm.code.length < 4"
        @click="handleLogin"
      >
        <template #icon>
          <n-icon>
            <LogIn />
          </n-icon>
        </template>
        登录
      </n-button>
    </div>

    <!-- 角色命名格式配置 -->
    <n-form
      v-if="serverListData.length > 0"
      :model="importForm"
      label-placement="top"
      :show-label="true"
      style="margin-top: 16px"
    >
      <n-form-item label="角色命名格式" :show-label="true">
        <n-input v-model:value="importForm.nameTemplate" placeholder="{name}-{index}-{id}" />
        <template #feedback>
          支持变量: {name}角色名, {id}角色ID, {index}角色序号, {server}区服
        </template>
      </n-form-item>
    </n-form>

    <!-- 服务器角色列表 -->
    <ServerRoleList
      v-if="serverListData.length > 0"
      :data="serverListData"
      server-column-title="区服ID"
      max-height="50vh"
      @add="addSelectedRole"
      @download="handleDownload"
    />

    <a-list v-if="roleList.length > 0">
      <a-list-item v-for="(role, index) in roleList" :key="index">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%">
          <div>
            <strong>角色名称:</strong> {{ role.name || "未命名角色" }}<br />
            <strong>Token:</strong>
            <span style="word-break: break-all">{{ role.token }}</span><br />
            <strong>服务器:</strong> {{ role.server || "未指定" }}<br />
            <strong>角色序号:</strong> {{ role.roleIndex }}
          </div>
          <n-button type="error" size="small" @click="removeRole(index)">
            删除
          </n-button>
        </div>
      </a-list-item>
    </a-list>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <n-button type="primary" size="large" block :loading="isImporting" @click="handleImport">
        <template #icon>
          <n-icon>
            <CloudUpload />
          </n-icon>
        </template>
        添加Token
      </n-button>

      <n-button block @click="$emit('cancel')" :disabled="isLoggingIn">
        <template #icon>
          <n-icon>
            <Close />
          </n-icon>
        </template>
        取消
      </n-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, onUnmounted } from "vue";
import { CloudUpload, Close, Key, LogIn, PhonePortrait } from "@vicons/ionicons5";
import { NIcon, useMessage, NButton, NForm, NFormItem, NInput } from "naive-ui";
import { getTokenId, transformToken, getServerList } from "@/utils/token";
import { encodePayload, decodePayload } from "@/utils/hortorLogin";
import useIndexedDB from "@/hooks/useIndexedDB";
import { g_utils } from "@/utils/bonProtocol";
import { useTokenStore } from "@/stores/tokenStore";
const tokenStore = useTokenStore();
const { storeArrayBuffer } = useIndexedDB();

const message = useMessage();

const emit = defineEmits(["cancel", "ok"]);

// ============================================================================
// 端点（已通过逆向 libxyzwyy_rust_lib.so + 服务端探测确认）
// 1) 发送验证码：ucenter-app-server，明文 JSON，字段 accountNum + verifyCodeTp
// 2) 短信登录：复用 comb-login-server 加密管道，tp=app-mobile，字段 mobile + smsCode
//    实测必填：gameId、tp、signPrint、mobile、smsCode（缺 tp/signPrint 报"参数错误"）
// ============================================================================
const SEND_SMS_URL = "/api/ucenter/ucenter-app-server/api/v1/login/verify/code";
const SMS_LOGIN_URL = "/api/hortor/comb-login-server/api/v1/login";

// 登录基础参数（与微信登录同构，仅 tp 为 app-mobile 并携带 mobile/smsCode）
const LOGIN_BASE_PARAMS = {
  gameId: "xyzwapp",
  gameTp: "app",
  sysInfo:
    '{"system":"Android","hortorSDKVersion":"4.0.6-cn","model":"22081212C","brand":"Redmi"}',
  channel: "android",
  noLogin: "2",
  distinctId: "DID-a38175b7-14ce-4b36-aa89-3e092ea03ea6",
  state: "hortor",
  packageName: "com.hortor.games.xyzw",
  tp: "app-mobile",
  signPrint: "E6:F7:FE:A9:EC:8E:24:D0:4F:2A:32:50:28:78:E1:C5:5E:70:81:13",
};

// 登录 URL 公共参数（timestamp 需每次请求实时生成）
const loginUrl = () =>
  SMS_LOGIN_URL +
  "?gameId=xyzwapp" +
  "&timestamp=" +
  Date.now() +
  "&version=android-4.2.1-cn-release" +
  "&cryptVersion=1.1.0" +
  "&gameTp=app&system=android" +
  "&deviceUniqueId=DID-0e782e88-2f3b-4f5b-9020-47f5e5a5a026" +
  "&packageName=com.hortorgames.xyzw";

// 响应式数据
const smsForm = reactive({ phone: "", code: "" });
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  nameTemplate: "{name}-{index}-{id}",
});

const isSendingCode = ref(false);
const isLoggingIn = ref(false);
const isImporting = ref(false);
const countdown = ref(0);
let countdownTimer: any = null;

const statusMessage = ref("请输入手机号并获取验证码");
const statusType = ref("info");

const serverListData = ref<any[]>([]);
const originalBinData = ref<any>(null);
const roleList = ref<
  Array<{
    id: string;
    name: string;
    roleId: string;
    token: string;
    server: string;
    roleIndex?: number;
    wsUrl: string;
    importMethod: string;
  }>
>([]);

const canSendCode = computed(
  () => /^1\d{10}$/.test(smsForm.phone) && countdown.value === 0,
);

const updateStatus = (msg, type = "info") => {
  statusMessage.value = msg;
  statusType.value = type;
};

const removeRole = (index: number) => {
  roleList.value.splice(index, 1);
};

const startCountdown = (seconds = 60) => {
  countdown.value = seconds;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 1000);
};

/**
 * 发送短信验证码
 */
const handleSendCode = async () => {
  if (!/^1\d{10}$/.test(smsForm.phone)) {
    message.warning("请输入正确的11位手机号");
    return;
  }
  isSendingCode.value = true;
  updateStatus("正在发送验证码...", "info");
  try {
    // ucenter 明文 JSON：字段来自 libxyzwyy_rust_lib.so 逆向 + 服务端实测
    const body = {
      gameId: "xyzwapp",
      accountNum: smsForm.phone,
      verifyCodeTp: "login",
      distinctId: "DID-6efacb55-dacb-4fe9-86bc-a9408df90f70",
      sysInfo:
        '{"SDKVersion":"3.3.5","brand":"microsoft","model":"microsoft","system":"Windows 11 x64"}',
    };
    const res = await postJson(SEND_SMS_URL, body);
    const json = JSON.parse(res.responseText);
    if (json.meta?.errCode !== 0) {
      throw new Error(json.meta?.errMsg || "发送失败");
    }
    updateStatus("验证码已发送，请注意查收短信", "success");
    message.success("验证码已发送");
    startCountdown(60);
  } catch (e: any) {
    updateStatus("发送验证码失败：" + e.message, "error");
    message.error("发送验证码失败：" + e.message);
  } finally {
    isSendingCode.value = false;
  }
};

/**
 * 短信登录：用手机号+验证码换取 combUser，生成 bin 后拉取角色列表
 */
const handleLogin = async () => {
  if (!/^1\d{10}$/.test(smsForm.phone)) {
    message.warning("请输入正确的11位手机号");
    return;
  }
  if (smsForm.code.length < 4) {
    message.warning("请输入验证码");
    return;
  }
  isLoggingIn.value = true;
  updateStatus("正在登录...", "info");
  try {
    // comb-login-server 加密管道：tp=app-mobile + mobile/smsCode（服务端实测确认）
    const payload = {
      ...LOGIN_BASE_PARAMS,
      mobile: smsForm.phone,
      smsCode: smsForm.code,
    };
    const rawJson = JSON.stringify(payload);
    console.log("原始登录 JSON:", rawJson);
    const encoded = encodePayload(rawJson);
    try {
      console.log("加密后的登录 JSON:", encoded);
      console.log("解密:", decodePayload(encoded));
    } catch (err) {}

    const res = await postPlain(loginUrl(), encoded);
    const json = JSON.parse(res.responseText);
    if (json.meta?.errCode !== 0) {
      throw new Error(json.meta?.errMsg || "登录失败");
    }

    const combUser = json.data?.combUser;
    if (!combUser) {
      throw new Error("登录响应结构异常");
    }
    console.log("combUser:", combUser);

    // 生成 bin
    const dm = (window as any).__require?.("13");
    if (!dm?.encMsg || !dm?.lz4XorEncode) {
      throw new Error("游戏加密模块未加载，不能生成 bin");
    }
    const encryptedBuffer = dm.encMsg(
      {
        platform: "hortor",
        platformExt: "mix",
        info: combUser,
        serverId: null,
        scene: 0,
        referrerInfo: "",
      },
      { decrypt: dm.lz4XorDecode, encrypt: dm.lz4XorEncode },
    );
    const bin = new Uint8Array(encryptedBuffer);
    updateStatus("登录成功，正在获取角色列表...", "success");
    await saveAccount(bin.buffer);
    updateStatus("登录成功，请选择角色添加", "success");
  } catch (e: any) {
    updateStatus("登录失败：" + e.message, "error");
    message.error("登录失败：" + e.message);
  } finally {
    isLoggingIn.value = false;
  }
};

/**
 * text/plain 的 POST 请求封装
 */
const postPlain = (url, body) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader("Accept", "*/*");
    xhr.setRequestHeader("Content-Type", "text/plain; charset=utf-8");
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("请求超时"));
    xhr.send(body);
  });

/**
 * application/json 的 POST 请求封装（ucenter 明文接口）
 */
const postJson = (url, obj) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader("Accept", "application/json, text/plain, */*");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("请求超时"));
    xhr.send(JSON.stringify(obj));
  });

/**
 * 保存账号（复用微信扫码的 bin 解析链路）
 */
const saveAccount = async (arrBuf: ArrayBuffer) => {
  currentBinData.value = arrBuf;

  try {
    const listStr = await getServerList(arrBuf);
    const parsedList = JSON.parse(listStr);
    if (parsedList && typeof parsedList === "object") {
      serverListData.value = Object.values(parsedList).sort(
        (a: any, b: any) => b.power - a.power,
      );
    } else {
      serverListData.value = [];
    }
    console.log("Server List:", parsedList);
    message.success("获取服务器角色列表成功，请选择角色添加");
  } catch (err) {
    console.error("Failed to get server list", err);
    message.warning("获取服务器角色列表失败");
    serverListData.value = [];
  }

  try {
    const binMsg = g_utils.parse(arrBuf);
    let binData = binMsg.getData();
    if (!binData && (binMsg as any)._raw) {
      binData = { ...(binMsg as any)._raw };
    }
    console.log("Bin文件解析:", binData);
    originalBinData.value = binData;
  } catch (err: any) {
    console.error("Bin文件解析失败", err);
  }
};

const currentBinData = ref<ArrayBuffer | null>(null);

const addSelectedRole = async (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新登录");
    return;
  }
  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId;
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    const tokenId = getTokenId(newBinBuffer);
    const roleToken = await transformToken(newBinBuffer);
    const roleName = roleInfo.name || `角色_${roleInfo.roleId}`;

    storeArrayBuffer(tokenId, newBinBuffer);

    let sid = Number(roleInfo.serverId);
    let roleIndex = 0;
    if (sid >= 2000000) {
      roleIndex = 2;
      sid -= 2000000;
    } else if (sid >= 1000000) {
      roleIndex = 1;
      sid -= 1000000;
    }
    const serverNum = sid - 27;

    const template = importForm.nameTemplate || "{name}-{index}-{id}";
    const finalName = template
      .replace(/{name}/g, () => roleName)
      .replace(/{index}/g, () => String(roleIndex))
      .replace(/{id}/g, () => String(roleInfo.roleId))
      .replace(/{server}/g, () => String(serverNum) + "服");

    const exists = roleList.value.some(
      (r) => r.roleId === roleInfo.roleId && r.name === finalName,
    );
    if (exists) {
      message.warning(`角色 ${finalName} 已在待添加列表中`);
      return;
    }

    roleList.value.push({
      id: tokenId,
      roleId: roleInfo.roleId,
      token: roleToken,
      name: finalName,
      server: String(serverNum) + "服",
      roleIndex,
      wsUrl: importForm.wsUrl || "",
      importMethod: "sms",
    });

    message.success(`已添加角色: ${finalName}`);
  } catch (e: any) {
    console.error("添加角色失败", e);
    message.error("添加角色失败: " + e.message);
  }
};

const handleDownload = (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新登录");
    return;
  }
  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId;
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;

    let sid = Number(roleInfo.serverId);
    let roleIndex = 0;
    if (sid >= 2000000) {
      roleIndex = 2;
      sid -= 2000000;
    } else if (sid >= 1000000) {
      roleIndex = 1;
      sid -= 1000000;
    }
    const serverNum = sid - 27;
    const fileName = `bin-${serverNum}服-${roleIndex}-${roleInfo.roleId}-${roleInfo.name}.bin`;

    downloadBinFile(fileName, newBinBuffer);
    message.success(`已开始下载: ${fileName}`);
  } catch (e: any) {
    console.error("下载失败", e);
    message.error("下载失败: " + e.message);
  }
};

const downloadBinFile = (fileName, bin) => {
  const blob = new Blob([new Uint8Array(bin)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const handleImport = async () => {
  if (roleList.value.length === 0) {
    message.error("请先登录并选择角色！");
    return;
  }
  isImporting.value = true;
  try {
    roleList.value.forEach((role) => {
      const gameToken = tokenStore.gameTokens.find((t) => t.id === role.id);
      if (gameToken) {
        tokenStore.updateToken(gameToken.id, { ...role });
      } else {
        tokenStore.addToken({ ...role });
      }
    });
    message.success("Token添加成功");
    roleList.value = [];
    emit("ok");
  } finally {
    isImporting.value = false;
  }
};

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});
</script>

<style scoped lang="scss">
.sms-login-import {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) 0;
}

.login-flow-info {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);

  h3 {
    margin: 0 0 var(--spacing-sm) 0;
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .flow-steps {
    margin: 0;
    padding-left: var(--spacing-lg);
    color: var(--text-secondary);

    li {
      margin-bottom: var(--spacing-xs);
      font-size: var(--font-size-sm);
    }
  }
}

.sms-code-row {
  display: flex;
  gap: var(--spacing-sm);
  width: 100%;

  > .n-input {
    flex: 1;
  }
}

.qr-status {
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  text-align: center;

  &.info {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }
  &.success {
    color: #18a058;
    background: rgba(24, 160, 88, 0.08);
  }
  &.error {
    color: #d03050;
    background: rgba(208, 48, 80, 0.08);
  }
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
</style>