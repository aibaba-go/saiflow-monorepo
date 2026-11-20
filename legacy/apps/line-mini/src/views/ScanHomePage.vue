<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  ApiError,
  fetchNotifications,
  importFromUrl,
  listJobs,
  type JobSummary,
  type Tenant,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import {
  currentTenant,
  currentTenantId,
  isAuthenticated,
  navigate,
  quotaForTenant,
  refreshQuota,
  setTenant,
  tenants,
} from '../store';
import { uploadFile } from '../upload';
import BrandLoading from '../components/BrandLoading.vue';
import JobListItem from '../components/JobListItem.vue';
import NotificationDialog from '../components/NotificationDialog.vue';

const { t: tt, d } = useT();

const recentJobs = ref<JobSummary[]>([]);
const loading = ref(true);
const errorMsg = ref('');
const uploading = ref(false);
const uploadPct = ref(0);
const urlMode = ref(false);
const urlValue = ref('');
const urlBusy = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);

async function loadRecent() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await listJobs({ page: 1, page_size: 10, tenantId: currentTenantId.value });
    recentJobs.value = data.items;
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
  } finally {
    loading.value = false;
  }
}

// 铃铛未读数（静默失败：红点缺省不显示，不阻塞主流程）
const unreadCount = ref(0);
const notifyOpen = ref(false);

async function loadUnread() {
  try {
    unreadCount.value = (await fetchNotifications()).unread_count ?? 0;
  } catch {
    unreadCount.value = 0;
  }
}

onMounted(() => {
  loadRecent();
  refreshQuota(); // 任务列表之外再刷新一次月页额度与有效期
  loadUnread();
});

// 个人/企业数据隔离：切换租户即重新拉取该租户的任务
watch(() => currentTenantId.value, loadRecent);

function tenantLabel(): string {
  const tenant = currentTenant.value;
  if (!tenant || tenant.tenant_type === 'PERSONAL') return tt('home.workspacePersonal');
  return tenant.name || tt('my.company');
}

// 租户切换（个人 + 已认证企业，同 My 页身份切换一致）
const wsMenuOpen = ref(false);

function isCurrentTenant(tenant: Tenant): boolean {
  return currentTenantId.value === tenant.tenant_id;
}

function toggleWsMenu() {
  wsMenuOpen.value = !wsMenuOpen.value;
}

function selectTenant(tenant: Tenant) {
  setTenant(tenant);
  wsMenuOpen.value = false;
}

// 配额横幅：只有一种计量（套餐名 · 本月剩余 / 月页总量）
const quotaView = computed(() => quotaForTenant());
const quotaPct = computed(() => {
  const pages = quotaView.value?.pages;
  if (!pages || pages.monthly_total <= 0) return 0;
  return Math.min(100, Math.round((pages.remaining / pages.monthly_total) * 100));
});

// 有效期：EXPIRED 硬停（横幅 + 线下续费指引）；剩余 ≤7 天提示即将到期
const sub = computed(() => quotaView.value?.subscription ?? null);
const expired = computed(() => sub.value?.status === 'EXPIRED');
const daysLeft = computed(() => sub.value?.days_remaining ?? null);
const expiringSoon = computed(
  () => sub.value?.status === 'ACTIVE' && daysLeft.value != null && daysLeft.value <= 7,
);

function validUntilText(): string {
  return sub.value?.expires_at ? tt('sub.validUntil', { date: d(sub.value.expires_at) }) : '';
}

function daysLeftText(): string {
  // 仅在有效期内提示剩余天数；已过期由横幅与红色有效期文案表达
  if (sub.value?.status !== 'ACTIVE') return '';
  const left = daysLeft.value;
  if (left == null) return '';
  return left <= 0 ? tt('sub.lastDay') : tt('sub.daysLeft', { n: left });
}

async function onPicked(target: HTMLInputElement | null) {
  const file = target?.files?.[0];
  if (!file || uploading.value) return;
  uploading.value = true;
  uploadPct.value = 0;
  errorMsg.value = '';
  try {
    // 任务租户跟随文件：以公司身份上传的文件，后续 job/结果都归该企业租户
    const ready = await uploadFile(file, currentTenantId.value, 'OCR_TASK', (percent) => {
      uploadPct.value = percent;
    });
    navigate('confirm', { fileId: ready.id });
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
  } finally {
    uploading.value = false;
    if (target) target.value = '';
    refreshQuota();
  }
}

async function submitUrl() {
  const url = urlValue.value.trim();
  if (!url || urlBusy.value) return;
  urlBusy.value = true;
  errorMsg.value = '';
  try {
    const { file } = await importFromUrl(url, currentTenantId.value);
    urlMode.value = false;
    urlValue.value = '';
    navigate('confirm', { fileId: file.id });
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
  } finally {
    urlBusy.value = false;
  }
}

function openJob(job: JobSummary) {
  const route =
    job.stage === 'OCR_PROCESSING' ? 'processing' : job.stage === 'COMPLETED' ? 'final' : 'result';
  navigate(route, { jobId: job.id });
}

// 隐藏 input 由卡片点击触发
function pick(kind: 'camera' | 'photos' | 'files') {
  const el = kind === 'camera' ? cameraInput.value : kind === 'photos' ? imageInput.value : fileInput.value;
  el?.click();
}
</script>

<template>
  <div class="home">
    <header class="home-header">
      <div class="logo-chip">
        <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
          <path d="M12 27V13h11" stroke="#4A66F7" stroke-width="3.4" stroke-linecap="round" />
          <path d="M12 20h8" stroke="#4A66F7" stroke-width="3.4" stroke-linecap="round" />
          <circle cx="27.5" cy="26.5" r="2.5" fill="#4A66F7" />
        </svg>
      </div>
      <div class="brand">saiflow</div>
      <button class="bell" :aria-label="tt('notify.title')" @click="notifyOpen = true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#596170" stroke-width="2" stroke-linecap="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <span v-if="unreadCount > 0" class="bell-dot" :aria-label="tt('notify.hasUnread')" />
      </button>
    </header>

    <NotificationDialog
      v-if="notifyOpen"
      @close="notifyOpen = false"
      @unread="unreadCount = $event"
    />

    <div class="content">
      <!-- 身份 chip：点击切换 个人/公司 租户 -->
      <div class="ws-row">
        <div class="ws-switch">
          <button class="ws-pill" :aria-expanded="wsMenuOpen" @click="toggleWsMenu">
            <span class="ws-dot" />
            <span>{{ tenantLabel() }}</span>
            <svg class="ws-chevron" :class="{ open: wsMenuOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div v-if="wsMenuOpen" class="ws-menu-backdrop" @click="wsMenuOpen = false" />
          <div v-if="wsMenuOpen" class="ws-menu">
            <button
              v-for="tenant in tenants"
              :key="tenant.tenant_id"
              class="ws-menu-item"
              :class="{ current: isCurrentTenant(tenant) }"
              @click="selectTenant(tenant)"
            >
              <span class="ws-menu-name">{{ tenant.tenant_type === 'PERSONAL' ? tt('home.workspacePersonal') : tenant.name }}</span>
              <em v-if="tenant.tenant_type === 'ENTERPRISE'">{{ tenant.role }}</em>
              <svg v-if="isCurrentTenant(tenant)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1F9E6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 到期硬停横幅：仅线下续费指引，不展示价格或支付链接 -->
      <div v-if="expired && isAuthenticated" class="expired-card">
        <div class="expired-head">
          <span class="expired-badge">{{ tt('sub.expired') }}</span>
          <span class="expired-title">{{ tt('sub.expiredTitle') }}</span>
        </div>
        <p class="expired-body">{{ tt('sub.expiredBody') }}</p>
        <button class="expired-cta" @click="navigate('plans')">{{ tt('sub.expiredCta') }}</button>
      </div>

      <!-- 配额横幅：套餐名 · 本月剩余 / 月页总量 + 进度条 + 有效期 + Plans 入口 -->
      <div v-if="quotaView && isAuthenticated" class="quota-card">
        <div class="quota-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M13 2v7h7" />
          </svg>
        </div>
        <div class="quota-body">
          <div class="quota-text">
            {{ tt('home.quotaPages', {
              plan: quotaView.plan.name || tt('sub.notActive'),
              left: quotaView.pages.remaining.toLocaleString('en-US'),
              total: quotaView.pages.monthly_total.toLocaleString('en-US'),
            }) }}
          </div>
          <div class="quota-track">
            <div class="quota-fill" :style="{ width: quotaPct + '%' }" />
          </div>
          <div v-if="sub && sub.status !== 'NONE'" class="quota-expiry" :class="{ warn: expiringSoon, danger: expired }">
            <span>{{ validUntilText() }}</span>
            <span v-if="daysLeftText()" class="quota-days">· {{ daysLeftText() }}</span>
            <span v-if="expiringSoon" class="quota-soon">{{ tt('sub.expiringSoon') }}</span>
          </div>
          <div v-else-if="sub" class="quota-expiry">{{ tt('sub.enterprisePending') }}</div>
        </div>
        <button class="quota-plans" @click="navigate('plans')">{{ tt('home.plansLink') }}</button>
      </div>

      <!-- 三个入口卡片 -->
      <div class="entry-grid">
        <button class="entry-card" :disabled="uploading" @click="pick('camera')">
          <div class="entry-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <span>{{ tt('home.camera') }}</span>
        </button>
        <button class="entry-card" :disabled="uploading" @click="pick('photos')">
          <div class="entry-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <span>{{ tt('home.photos') }}</span>
        </button>
        <button class="entry-card" :disabled="uploading" @click="pick('files')">
          <div class="entry-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M13 2v7h7" />
            </svg>
          </div>
          <span>{{ tt('home.files') }}</span>
        </button>
      </div>

      <!-- 隐藏的文件选择 -->
      <input ref="cameraInput" type="file" accept="image/jpeg,image/png" capture="environment" hidden @change="onPicked(cameraInput)" />
      <input ref="imageInput" type="file" accept="image/jpeg,image/png" hidden @change="onPicked(imageInput)" />
      <input ref="fileInput" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" hidden @change="onPicked(fileInput)" />

      <!-- URL 导入 -->
      <button v-if="!urlMode" class="url-row" @click="urlMode = true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
        <span>{{ tt('home.importUrl') }}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1B0" stroke-width="2.2" stroke-linecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      <div v-else class="url-editor">
        <input
          v-model="urlValue"
          class="url-input"
          :placeholder="tt('home.urlPlaceholder')"
          @keyup.enter="submitUrl"
        />
        <button class="url-submit" :class="{ busy: urlBusy }" :disabled="urlBusy || !urlValue.trim()" @click="submitUrl">
          <BrandLoading v-if="urlBusy" variant="button" :label="tt('common.loading')" />
          <template v-else>{{ tt('home.urlSubmit') }}</template>
        </button>
      </div>

      <div v-if="uploading" class="upload-status">
        <div class="status-line">
          <BrandLoading variant="inline" :label="tt('home.uploading', { pct: uploadPct })" :announce="false" />
        </div>
        <div class="upload-track" role="progressbar" :aria-label="tt('home.uploading', { pct: uploadPct })" :aria-valuenow="uploadPct" aria-valuemin="0" aria-valuemax="100">
          <div class="upload-fill" :style="{ width: uploadPct + '%' }" />
        </div>
      </div>
      <p v-else-if="errorMsg" class="status-line error">{{ errorMsg }}</p>

      <!-- 最近任务 -->
      <div class="section-title">{{ tt('home.recent') }}</div>
      <div v-if="loading" class="status-line">
        <BrandLoading variant="inline" :label="tt('common.loading')" />
      </div>
      <div v-else-if="recentJobs.length === 0" class="status-line">{{ tt('history.empty') }}</div>
      <div v-else class="task-list">
        <JobListItem v-for="job in recentJobs" :key="job.id" :job="job" @open="openJob" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 12px;
}

.logo-chip {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--card);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand {
  font-size: 18px;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.3px;
}

.bell {
  position: relative;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
}

/* 未读红点：铃铛右上角 */
.bell-dot {
  position: absolute;
  top: 6px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid var(--card);
}

.ws-row {
  display: flex;
}

.ws-switch {
  position: relative;
}

.ws-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--icon);
  max-width: 180px;
}

.ws-pill span:not(.ws-dot) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}

.ws-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.ws-chevron.open {
  transform: rotate(180deg);
}

.ws-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.ws-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(23, 26, 28, 0.14);
  padding: 6px;
  z-index: 11;
  display: flex;
  flex-direction: column;
}

.ws-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--text);
  text-align: left;
}

.ws-menu-item:active {
  background: var(--bg);
}

.ws-menu-item.current {
  font-weight: 700;
}

.ws-menu-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-menu-item em {
  font-style: normal;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* ---- 配额横幅（PRD v1.4 §22.2） ---- */
.quota-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--primary-light);
  border-radius: 14px;
  padding: 12px 14px;
}

.quota-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--card);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.quota-body {
  flex: 1;
  min-width: 0;
}

.quota-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quota-track {
  margin-top: 7px;
  height: 6px;
  border-radius: 3px;
  background: #ffffff;
  overflow: hidden;
}

.quota-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--primary);
  transition: width 0.3s ease;
}

.quota-plans {
  font-size: 10px;
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap;
  flex-shrink: 0;
  padding: 4px 2px;
}

/* ---- 有效期与到期（FR-SYS-012/013，线下续费） ---- */
.quota-expiry {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-secondary);
}

.quota-expiry.warn,
.quota-expiry.danger {
  color: var(--danger);
  font-weight: 700;
}

.quota-days {
  white-space: nowrap;
}

.quota-soon {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--card);
  color: var(--danger);
  font-weight: 800;
}

.expired-card {
  background: var(--card);
  border: 1px solid var(--danger);
  border-radius: 14px;
  padding: 12px 14px;
}

.expired-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expired-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.expired-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--text);
}

.expired-body {
  margin: 7px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.expired-cta {
  margin-top: 9px;
  width: 100%;
  min-height: 38px;
  border-radius: 12px;
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.content {
  padding: 4px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.entry-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 8px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.entry-card:disabled {
  opacity: 0.6;
}

.entry-icon {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
}

.url-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  text-align: left;
}

.url-row span {
  flex: 1;
}

.url-editor {
  display: flex;
  gap: 8px;
}

.url-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card);
  padding: 0 14px;
  font-size: 12px;
  outline: none;
}

.url-input:focus {
  border-color: var(--primary);
}

.url-submit {
  flex-shrink: 0;
  height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.url-submit.busy {
  width: 140px;
  padding: 0 8px;
}

.url-submit:disabled {
  opacity: 0.6;
}

.status-line {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

.status-line.error {
  color: var(--danger);
}

.upload-track {
  margin-top: 8px;
  height: 6px;
  border-radius: 3px;
  background: var(--primary-light);
  overflow: hidden;
}

.upload-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 0.12s linear;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  margin-top: 6px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
