<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  boot,
  clearAuthIntent,
  clearPendingJob,
  continueAfterAuth,
  ensureGuestSession,
  finishPendingLogout,
  getAuthIntent,
  goTab,
  hasLogoutPending,
  isAuthenticated,
  logoutBlocked,
  navigate,
  needsRegistration,
  peekPendingJob,
  refreshQuota,
  refreshSession,
  route,
  sessionTransition,
  signInWithLine,
  user,
} from './store';
import { ApiError } from './api';
import { initLiff, resetLiffLogin } from './liff';
import { getLocale, messageText } from './i18n';
import { useT } from './i18nVue';
import BrandLoading from './components/BrandLoading.vue';
import RegisterDialog from './components/RegisterDialog.vue';
import LoginPage from './views/LoginPage.vue';
import ScanHomePage from './views/ScanHomePage.vue';
import HistoryPage from './views/HistoryPage.vue';
import MyPage from './views/MyPage.vue';
import ConfirmPage from './views/ConfirmPage.vue';
import ProcessingPage from './views/ProcessingPage.vue';
import ResultPage from './views/ResultPage.vue';
import FinalResultPage from './views/FinalResultPage.vue';
import CompanyPage from './views/CompanyPage.vue';
import PlansPage from './views/PlansPage.vue';
import PlanPendingPage from './views/PlanPendingPage.vue';
import alibabaLogo from './assets/alibaba-logo.png';

const { t } = useT();

type Phase = 'splash' | 'login' | 'app';
const phase = ref<Phase>('splash');
const bootError = ref('');

function showBootError(error: unknown): void {
  bootError.value = error instanceof ApiError ? messageText(error.messageKey) : t('common.unknownError');
}

async function resumeAfterAuth(): Promise<void> {
  phase.value = 'app';
  bootError.value = '';
  if (needsRegistration.value) {
    navigate('auth', route.params);
    return;
  }
  const jobId = peekPendingJob();
  if (jobId && isAuthenticated.value) {
    try {
      await continueAfterAuth(jobId);
    } catch (error) {
      showBootError(error); // 保留待续任务，不把异常误判为订阅不足
      navigate('result', { jobId });
    }
    return;
  }
  const from = route.params?.from;
  goTab(from === 'my' || from === 'history' ? from : 'scan');
}

async function start(): Promise<void> {
  phase.value = 'splash';
  bootError.value = '';
  // LIFF 初始化仍处理 OAuth 回跳，但残留 token 不是自动登录许可。
  const liffState = initLiff();
  const intent = getAuthIntent();
  const recoveringLogout = hasLogoutPending();
  try {
    await finishPendingLogout();
    // FR-SYS-001：退出重试与刷新成功均恢复游客首页，不保留旧个人中心路由。
    if (recoveringLogout) goTab('scan');
    await boot();
    if (!user.value) await ensureGuestSession(getLocale());
    if (intent) {
      navigate('auth', {
        ...(intent.jobId ? { jobId: intent.jobId } : {}),
        ...(intent.from ? { from: intent.from } : {}),
      });
      const state = await liffState;
      if (state.idToken) {
        await signInWithLine(state.idToken, getLocale());
        await resumeAfterAuth();
        return;
      }
    }
    phase.value = 'app';
  } catch (error) {
    showBootError(error);
    if (intent && !hasLogoutPending()) {
      if (error instanceof ApiError && error.status === 401) resetLiffLogin();
      clearAuthIntent();
      phase.value = 'app';
      navigate('auth', {
        ...(intent.jobId ? { jobId: intent.jobId } : {}),
        ...(intent.from ? { from: intent.from } : {}),
      });
    } else {
      phase.value = 'login';
    }
  }
}

onMounted(start);

watch(logoutBlocked, (blocked) => {
  if (!blocked) return;
  bootError.value = t('my.logoutFailed');
  phase.value = 'login'; // 撤销失败时锁主壳，不能取消提示后继续旧身份操作
});

// 试用页面会话过期恢复游客；认证窗口中的 401 留在窗口供用户重试。
watch(user, async (u) => {
  if (u || phase.value !== 'app' || sessionTransition.value || logoutBlocked.value || hasLogoutPending() || route.name === 'auth') return;
  sessionTransition.value = true;
  phase.value = 'splash';
  clearAuthIntent();
  clearPendingJob();
  goTab('scan');
  try {
    await ensureGuestSession(getLocale());
    phase.value = 'app';
  } catch (error) {
    showBootError(error);
    phase.value = 'login';
  } finally {
    sessionTransition.value = false;
  }
});

async function onLoggedIn(): Promise<void> {
  await resumeAfterAuth();
}

async function onRegistered(): Promise<void> {
  if (!(await refreshSession())) {
    bootError.value = t('err.auth.session_expired');
    // 注册已提交，但会话刷新失败：保留 auth 与任务上下文，重新登录后再恢复。
    return;
  }
  await refreshQuota();
  await resumeAfterAuth();
}

/** 取消不撤销已归集任务的正式会话，否则会丢失草稿访问能力。 */
function leaveAuth(): void {
  clearAuthIntent();
  clearPendingJob();
  phase.value = 'app';
  const jobId = route.params?.jobId;
  if (jobId) {
    navigate('result', { jobId });
    return;
  }
  const from = route.params?.from;
  goTab(from === 'my' || from === 'history' ? from : 'scan');
}

const TABS = [
  { name: 'scan' as const, key: 'nav.scan', icon: 'scan' },
  { name: 'history' as const, key: 'nav.history', icon: 'history' },
  { name: 'my' as const, key: 'nav.my', icon: 'user' },
];
</script>

<template>
  <!-- P01 启动页 -->
  <div v-if="phase === 'splash'" class="splash">
    <BrandLoading variant="splash" :label="t('boot.connecting')" tagline="Scan. Verify. Export." />
    <div class="splash-powered">
      <span>Powered by</span>
      <img class="splash-powered-logo" :src="alibabaLogo" alt="Alibaba" />
    </div>
  </div>

  <LoginPage v-else-if="phase === 'login'" :notice="bootError" can-back @back="start" @logged-in="onLoggedIn" />

  <!-- 主壳：430px 手机框 + 底部导航 -->
  <div v-else class="phone">
    <main class="screen">
      <ScanHomePage v-if="route.name === 'scan'" />
      <HistoryPage v-else-if="route.name === 'history'" />
      <MyPage v-else-if="route.name === 'my'" />
      <ConfirmPage
        v-else-if="route.name === 'confirm'"
        :key="route.params?.fileIds || route.params?.fileId || ''"
        :file-id="route.params?.fileId ?? ''"
        :file-ids="route.params?.fileIds ?? ''"
      />
      <ProcessingPage v-else-if="route.name === 'processing'" :job-id="route.params?.jobId ?? ''" />
      <ResultPage v-else-if="route.name === 'result'" :job-id="route.params?.jobId ?? ''" />
      <FinalResultPage v-else-if="route.name === 'final'" :job-id="route.params?.jobId ?? ''" />
      <CompanyPage v-else-if="route.name === 'company'" />
      <PlansPage v-else-if="route.name === 'plans'" :job-id="route.params?.jobId ?? ''" />
      <PlanPendingPage
        v-else-if="route.name === 'plan-pending'"
        :plan-name="route.params?.plan ?? ''"
        :submitted-at="route.params?.submittedAt ?? ''"
      />
      <LoginPage
        v-else-if="route.name === 'auth'"
        embedded
        can-back
        :notice="bootError"
        @back="leaveAuth"
        @logged-in="onLoggedIn"
      />
    </main>

    <nav v-if="route.name === 'scan' || route.name === 'history' || route.name === 'my'" class="bottom-nav">
      <button
        v-for="tab in TABS"
        :key="tab.name"
        class="nav-item"
        :class="{ active: route.name === tab.name }"
        @click="route.name = tab.name"
      >
        <svg
          v-if="tab.icon === 'scan'"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
        <svg
          v-else-if="tab.icon === 'history'"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3.5 2" />
        </svg>
        <svg
          v-else
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
        </svg>
        <span>{{ t(tab.key) }}</span>
      </button>
    </nav>
  </div>

  <RegisterDialog v-if="phase === 'app' && route.name === 'auth' && needsRegistration" @done="onRegistered" @cancel="leaveAuth" />
</template>

<style>
:root {
  --primary: #4a66f7;
  --primary-light: #e8edff;
  --bg: #f5f7fa;
  --card: #ffffff;
  --border: #e3e8f0;
  --text: #171a1c;
  --text-secondary: #99a1b0;
  --icon: #596170;
  --success-bg: #e3f5ed;
  --success: #1f9e6b;
  --processing-bg: #fcf2e3;
  --processing: #d98f1f;
  --danger: #e6474d;
  --track: #edf2f7;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', 'Sarabun', sans-serif;
  background: #e9edf3;
  color: var(--text);
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: none;
  padding: 0;
}

#app {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- P01 启动页 ---- */
.splash {
  width: 100%;
  min-height: 100dvh;
  max-width: 430px;
  background: linear-gradient(160deg, #5a76ff 0%, #4a66f7 55%, #3a55e0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  gap: 10px;
}

.splash-powered {
  position: absolute;
  bottom: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #ffffff;
  font-size: 10px;
  color: var(--text-secondary);
}

.splash-powered-logo {
  height: 14px;
  display: block;
}

/* ---- 手机壳 ---- */
.phone {
  width: 430px;
  max-width: 100vw;
  height: 100dvh;
  max-height: 940px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

@media (min-width: 480px) {
  .phone {
    border-radius: 28px;
    box-shadow: 0 24px 64px rgba(23, 26, 28, 0.18);
    border: 1px solid var(--border);
    height: 92dvh;
  }
}

.screen {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ---- 底部导航 ---- */
.bottom-nav {
  height: 68px;
  background: var(--card);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 24px;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  color: var(--icon);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.6px;
  padding: 6px 14px;
  border-radius: 999px;
}

.nav-item.active {
  background: var(--primary);
  color: #fff;
}
</style>
