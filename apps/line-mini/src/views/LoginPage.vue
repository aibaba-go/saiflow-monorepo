<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../api';
import { getLocale, messageText, t } from '../i18n';
import { useT } from '../i18nVue';
import { initLiff, redirectToLineLogin, reopenLineLogin, resetLiffLogin, signOutLiff } from '../liff';
import { clearAuthIntent, rememberAuthIntent, signInWithDevId, signInWithLine } from '../store';
import BrandLoading from '../components/BrandLoading.vue';

const { t: tt } = useT();

// 仅本地开发且显式开启时显示开发者登录，仍需用户手动点击；LINE 按钮不使用开发身份
const devLoginEnabled = import.meta.env.DEV && import.meta.env.VITE_AUTO_DEV_LOGIN === 'true';
const defaultDevId = (import.meta.env.VITE_DEV_LOGIN_ID || 'demo-user').trim();

const props = defineProps<{
  notice?: string;
  embedded?: boolean;
  canBack?: boolean;
}>();

const emit = defineEmits<{
  (e: 'logged-in'): void;
  (e: 'back'): void;
}>();

type AuthMode = 'login' | 'register';
const mode = ref<AuthMode>('login');

function switchMode(next: AuthMode): void {
  mode.value = next;
  errorMsg.value = '';
}

// 启动失败原因（如会话过期）以通用错误展示
const errorMsg = ref(props.notice ?? '');
watch(() => props.notice, (notice) => { if (notice) errorMsg.value = notice; });

const lineLoading = ref(false);
const devId = ref(defaultDevId);
const devLoading = ref(false);
let lineAttempt = 0;

// FR-SYS-011：返回/卸载使仍在等待 SDK 的登录失效，迟到结果不能兑换身份或跳转。
onBeforeUnmount(() => { lineAttempt++; });
function back(): void {
  lineAttempt++;
  lineLoading.value = false;
  clearAuthIntent();
  emit('back');
}

async function loginWithLine() {
  if (lineLoading.value) return;
  const attempt = ++lineAttempt;
  errorMsg.value = '';
  lineLoading.value = true;
  rememberAuthIntent();
  try {
    const state = await initLiff();
    if (attempt !== lineAttempt) return;
    if (state.idToken) {
      await signInWithLine(state.idToken, getLocale());
      if (attempt !== lineAttempt) return;
      emit('logged-in');
      return;
    }
    if (state.loginAvailable) {
      signOutLiff(); // 缺 openid 的旧 SDK 会话需重新授权；仅显式点击时执行
      redirectToLineLogin(); // 用户显式点击后才跳转 LINE OAuth
      return;
    }
    // 用户已明确要求登录：SDK/客户端握手失败时从官方入口恢复一次。
    // 重开前不清 auth intent/待续任务；启动流程仍须验真 token，不能自动确认。
    if (state.initFailed && reopenLineLogin()) return;
    clearAuthIntent();
    const errorKey = !state.initFailed ? 'err.auth.line_not_configured'
      : state.failureReason === 'timeout' ? 'err.auth.line_init_timeout'
      : 'err.auth.line_init_failed';
    errorMsg.value = t(errorKey);
  } catch (e) {
    if (attempt !== lineAttempt) return;
    clearAuthIntent();
    if (e instanceof ApiError && e.status === 401) resetLiffLogin();
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('login.failed');
  } finally {
    if (attempt === lineAttempt) lineLoading.value = false;
  }
}

async function loginWithDev() {
  if (!devLoginEnabled) return;
  const id = devId.value.trim() || defaultDevId;
  if (!id || devLoading.value) return;
  errorMsg.value = '';
  devLoading.value = true;
  try {
    await signInWithDevId(id, getLocale());
    emit('logged-in');
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('login.failed');
  } finally {
    devLoading.value = false;
  }
}
</script>

<template>
  <div class="login" :class="{ embedded }">
    <div v-if="canBack" class="auth-top">
      <button class="back-btn" @click="back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>{{ tt('common.back') }}</span>
      </button>
    </div>

    <div class="login-logo">
      <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="10" fill="#4A66F7" />
        <path d="M12 27V13h11" stroke="#fff" stroke-width="3.4" stroke-linecap="round" />
        <path d="M12 20h8" stroke="#fff" stroke-width="3.4" stroke-linecap="round" />
        <circle cx="27.5" cy="26.5" r="2.5" fill="#fff" />
      </svg>
    </div>
    <div class="login-name">saiflow</div>
    <div class="login-tagline">Scan. Verify. Export.</div>

    <div class="auth-tabs">
      <button :class="{ active: mode === 'login' }" @click="switchMode('login')">
        {{ tt('auth.tabLogin') }}
      </button>
      <button :class="{ active: mode === 'register' }" @click="switchMode('register')">
        {{ tt('auth.tabRegister') }}
      </button>
    </div>
    <p class="auth-subtitle">
      {{ mode === 'login' ? tt('auth.loginHint') : tt('auth.registerHint') }}
    </p>

    <button class="line-btn" :disabled="lineLoading" @click="loginWithLine">
      <BrandLoading v-if="lineLoading" variant="button" :label="tt('common.loading')" />
      <template v-else>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
          <path
            d="M12 3C6.48 3 2 6.64 2 11.13c0 4.03 3.55 7.4 8.35 8.04.33.07.77.22.88.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1.01.88.55 1.08-.46 5.84-3.44 7.97-5.89C20.44 14.4 22 12.9 22 11.13 22 6.64 17.52 3 12 3z"
          />
        </svg>
        <span>{{ mode === 'login' ? tt('login.withLine') : tt('auth.registerWithLine') }}</span>
      </template>
    </button>

    <p v-if="mode === 'register'" class="auth-note">{{ tt('auth.registerNote') }}</p>
    <p v-if="errorMsg" class="login-error">{{ errorMsg }}</p>

    <!-- 手动开发登录：仅本地开发且显式开启时显示，后端仍需 AUTH_DEV_MODE=1 -->
    <div v-if="devLoginEnabled" class="dev-box">
      <div class="dev-title">{{ tt('login.devTitle') }}</div>
      <div class="dev-hint">{{ tt('login.devHint') }}</div>
      <div class="dev-row">
        <input
          v-model="devId"
          class="dev-input"
          :placeholder="tt('login.devPlaceholder')"
          @keyup.enter="loginWithDev()"
        />
        <button class="dev-btn" :class="{ busy: devLoading }" :disabled="devLoading" @click="loginWithDev()">
          <BrandLoading v-if="devLoading" variant="button" :label="tt('common.loading')" />
          <template v-else>{{ tt('login.devSubmit') }}</template>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  width: 100%;
  max-width: 430px;
  min-height: 100dvh;
  background: linear-gradient(160deg, #5a76ff 0%, #4a66f7 55%, #3a55e0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 28px;
  color: #fff;
  gap: 10px;
}

/* 登录注册作为应用内页面：铺满手机壳，不重复整屏高度 */
.login.embedded {
  flex: 1;
  min-height: 100%;
  max-width: none;
  padding: 24px 28px;
}

.auth-top {
  position: absolute;
  top: 14px;
  left: 16px;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.auth-tabs {
  display: flex;
  width: 100%;
  max-width: 320px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.auth-tabs button {
  flex: 1;
  height: 34px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  font-weight: 700;
}

.auth-tabs button.active {
  background: #fff;
  color: var(--primary);
}

.auth-subtitle {
  margin: 2px 0 8px;
  max-width: 320px;
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.85;
}

.auth-note {
  margin: 0;
  max-width: 320px;
  text-align: center;
  font-size: 10px;
  line-height: 1.5;
  opacity: 0.75;
}

.login-name {
  font-size: 28px;
  font-weight: 700;
  margin-top: 6px;
}

.login-tagline {
  font-size: 12px;
  opacity: 0.85;
  margin-bottom: 18px;
}

.line-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 320px;
  height: 52px;
  border-radius: 999px;
  background: #06c755;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  transition: opacity 0.15s;
}

.line-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.login-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #ffe1e1;
  max-width: 320px;
  text-align: center;
}

.dev-box {
  margin-top: 24px;
  width: 100%;
  max-width: 320px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 14px;
  padding: 14px 16px;
}

.dev-title {
  font-size: 12px;
  font-weight: 700;
}

.dev-hint {
  font-size: 10px;
  opacity: 0.75;
  margin: 4px 0 10px;
}

.dev-row {
  display: flex;
  gap: 8px;
}

.dev-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.95);
  padding: 0 12px;
  font-size: 13px;
  color: var(--text);
  outline: none;
}

.dev-btn {
  flex-shrink: 0;
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  background: #fff;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.dev-btn.busy {
  width: 136px;
  height: auto;
  min-height: 38px;
  padding: 4px 8px;
}

.dev-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
