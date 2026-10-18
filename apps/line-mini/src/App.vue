<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  boot,
  clearPendingJob,
  continueAfterAuth,
  ensureGuestSession,
  goTab,
  isAuthenticated,
  navigate,
  needsRegistration,
  route,
  signInWithLine,
  signOutLocally,
  takePendingJob,
  user,
} from './store';
import { logout } from './api';
import { initLiff } from './liff';
import { getLocale } from './i18n';
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

async function resumeAfterAuth(): Promise<void> {
  // 新 LINE 账号须先完成注册信息录入（RegisterDialog 完成后再次进入此处）
  if (needsRegistration.value) return;
  phase.value = 'app';
  bootError.value = '';
  const jobId = takePendingJob();
  if (jobId && isAuthenticated.value) {
    try {
      await continueAfterAuth(jobId);
    } catch {
      navigate('plans', { jobId });
    }
    return;
  }
  goTab('scan');
}

onMounted(async () => {
  // 1) LINE 内：用 ID token 建/恢复会话；游客数据会在服务端归并
  try {
    const liffState = await initLiff();
    if (liffState.idToken) {
      await signInWithLine(liffState.idToken, getLocale());
      resumeAfterAuth();
      return;
    }
  } catch {
    /* LIFF 不可用则走 Cookie 恢复/游客会话 */
  }
  // 2) 桌面/外部浏览器：先尝试既有 Cookie 会话
  try {
    await boot();
  } catch (e) {
    bootError.value = e instanceof Error ? e.message : String(e);
  }
  if (user.value) {
    resumeAfterAuth();
    return;
  }
  // 3) 无会话时建立游客会话：可上传/OCR/核验，确认前要求登录
  try {
    await ensureGuestSession(getLocale());
    phase.value = 'app';
    return;
  } catch (e) {
    bootError.value = e instanceof Error ? e.message : String(e);
  }
  phase.value = 'login';
});

// 401 / 登出 → 回登录页
watch(user, (u) => {
  if (!u && phase.value === 'app') {
    phase.value = 'login';
  }
});

function onLoggedIn(): void {
  resumeAfterAuth();
}

/** 放弃注册：撤销刚建立的会话，回到登录页 */
async function cancelRegistration(): Promise<void> {
  try {
    await logout();
  } catch {
    /* 会话已失效也照常回登录页 */
  }
  signOutLocally();
  phase.value = 'login';
}

function leaveAuth(): void {
  clearPendingJob();
  const jobId = route.params?.jobId;
  if (jobId) {
    navigate('result', { jobId });
    return;
  }
  const from = route.params?.from;
  if (from === 'my' || from === 'history' || from === 'scan') {
    goTab(from);
    return;
  }
  goTab('scan');
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

  <LoginPage v-else-if="phase === 'login'" :notice="bootError" @logged-in="onLoggedIn" />

  <!-- 主壳：430px 手机框 + 底部导航 -->
  <div v-else class="phone">
    <main class="screen">
      <ScanHomePage v-if="route.name === 'scan'" />
      <HistoryPage v-else-if="route.name === 'history'" />
      <MyPage v-else-if="route.name === 'my'" />
      <ConfirmPage v-else-if="route.name === 'confirm'" :file-id="route.params?.fileId ?? ''" />
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

  <RegisterDialog v-if="needsRegistration" @done="resumeAfterAuth" @cancel="cancelRegistration" />
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
