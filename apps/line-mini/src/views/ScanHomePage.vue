<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ApiError,
  dataEpochs,
  deleteFile,
  fetchNotifications,
  importFromUrl,
  listJobs,
  listPendingFiles,
  type FileInfo,
  type JobSummary,
  type Tenant,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import {
  currentTenant,
  currentTenantId,
  isAuthenticated,
  jobRoute,
  navigate,
  quotaForTenant,
  refreshQuota,
  setTenant,
  tenants,
  user,
} from '../store';
import { uploadFile } from '../upload';
import BrandLoading from '../components/BrandLoading.vue';
import JobListItem from '../components/JobListItem.vue';
import NotificationDialog from '../components/NotificationDialog.vue';

const { t: tt, d, locale } = useT();

const recentJobs = ref<JobSummary[]>([]);
const loading = ref(true);
const errorMsg = ref('');
const uploading = ref(false);

function errorText(e: unknown): string {
  return e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
}

// FR-UPLOAD-003/005/010/013: one upload batch per selection; successful files land in Pending, never auto-confirmed.
type UploadStatus = 'waiting' | 'uploading' | 'uploaded' | 'failed';
type UploadItem = {
  key: number;
  name: string;
  size: number;
  format: string;
  image: boolean;
  status: UploadStatus;
  percent: number;
  error: string;
  /** Local file-type rejection would fail again, so it is not retried. */
  retryable: boolean;
  fileId?: string;
  /** Upload session (= file id) created by stage 1; deleted when the user cancels. */
  sessionId?: string;
  cancelled?: boolean;
};
const uploadItems = ref<UploadItem[]>([]);
// File objects stay outside reactive state.
const uploadSources = new Map<number, File>();
let nextUploadKey = 0;
const cancelledCount = ref(0);
const cancelAllUsed = ref(false);
const confirmAll = ref(false);
const confirmRowKey = ref<number | null>(null);
let current: { key: number; controller: AbortController } | null = null;
let active = true;
onBeforeUnmount(() => { active = false; });
const urlMode = ref(false);
const urlValue = ref('');
const urlBusy = ref(false);
const inputBusy = computed(() => uploading.value || urlBusy.value);

const uploadedCount = computed(() => uploadItems.value.filter((item) => item.status === 'uploaded').length);
const failedItems = computed(() => uploadItems.value.filter((item) => item.status === 'failed'));
const unfinishedCount = computed(() => uploadItems.value.filter((item) => item.status === 'uploading' || item.status === 'waiting').length);
const currentPosition = computed(() => uploadItems.value.findIndex((item) => item.status === 'uploading') + 1);
const showUploadBox = computed(() => uploadItems.value.length > 0 || cancelledCount.value > 0);
const visibleUploadItems = computed(() => (uploading.value ? uploadItems.value : failedItems.value));
const canRetry = computed(() => !inputBusy.value && failedItems.value.some((item) => item.retryable && uploadSources.has(item.key)));
const batchSummary = computed(() => {
  const parts = [tt('home.batch.uploadedCount', { n: uploadedCount.value })];
  if (unfinishedCount.value) parts.push(tt('home.batch.remainingCount', { n: unfinishedCount.value }));
  if (failedItems.value.length) parts.push(tt('home.batch.failedCount', { n: failedItems.value.length }));
  return parts.join(' · ');
});

// Pending (FR-UPLOAD-013): READY uploads without a task in the current tenant.
const pendingFiles = ref<FileInfo[]>([]);
const pendingLoading = ref(false);
const pendingError = ref('');
const selectedIds = ref<string[]>([]);
const deleteIds = ref<string[]>([]);
const deleting = ref(false);
const deleteError = ref('');
let pendingSeq = 0;
const selectedPending = computed(() => pendingFiles.value.filter((file) => selectedIds.value.includes(file.id)));
const allSelected = computed(() => pendingFiles.value.length > 0 && selectedPending.value.length === pendingFiles.value.length);
const deleteTargets = computed(() => pendingFiles.value.filter((file) => deleteIds.value.includes(file.id)));

const cancelAllBtn = ref<HTMLButtonElement | null>(null);
const keepAllBtn = ref<HTMLButtonElement | null>(null);
const keepDeleteBtn = ref<HTMLButtonElement | null>(null);
let keepRowBtn: HTMLButtonElement | null = null;
function setKeepRow(el: unknown) {
  keepRowBtn = (el as HTMLButtonElement | null) ?? null;
}
function focusLater(target: () => HTMLElement | null | undefined) {
  void nextTick(() => target()?.focus?.());
}

function resetBatch() {
  uploadItems.value = [];
  uploadSources.clear();
  cancelledCount.value = 0;
  cancelAllUsed.value = false;
  confirmAll.value = false;
  confirmRowKey.value = null;
}

watch([user, currentTenantId], () => {
  resetBatch();
  // Old tenant/session records and responses are dropped; the list reloads below.
  pendingSeq += 1;
  pendingFiles.value = [];
  selectedIds.value = [];
  deleteIds.value = [];
  deleteError.value = '';
  pendingError.value = '';
}, { flush: 'sync' });

const fileInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);

async function loadRecent() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await listJobs({ page: 1, page_size: 10, tenantId: currentTenantId.value });
    recentJobs.value = data.items;
  } catch (e) {
    errorMsg.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

async function loadPending() {
  const seq = ++pendingSeq;
  const session = dataEpochs().session;
  const tenantId = currentTenantId.value;
  pendingLoading.value = true;
  pendingError.value = '';
  try {
    const data = await listPendingFiles(tenantId);
    if (seq !== pendingSeq || !sameContext(session, tenantId)) return;
    pendingFiles.value = data.items ?? [];
    const ids = new Set(pendingFiles.value.map((file) => file.id));
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
  } catch (e) {
    if (seq !== pendingSeq || !sameContext(session, tenantId)) return;
    pendingError.value = errorText(e);
  } finally {
    if (seq === pendingSeq) pendingLoading.value = false;
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
  loadPending();
  refreshQuota(); // 任务列表之外再刷新一次月页额度与有效期
  loadUnread();
});

// 个人/企业数据隔离：切换租户即重新拉取该租户的任务与 Pending
watch(() => currentTenantId.value, loadRecent);
watch([user, currentTenantId], () => { void loadPending(); });

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
  if (inputBusy.value) return;
  wsMenuOpen.value = !wsMenuOpen.value;
}

function selectTenant(tenant: Tenant) {
  if (inputBusy.value) return;
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

function sameContext(session: number, tenantId: number | null): boolean {
  return active && dataEpochs().session === session && currentTenantId.value === tenantId;
}

const SUPPORTED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

/** FR-UPLOAD-003/004: Files picks any type; only JPG/PNG/PDF upload. The server still sniffs real content. */
function isSupportedFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime && mime !== 'application/octet-stream') return SUPPORTED_MIME.includes(mime);
  return /\.(jpe?g|png|pdf)$/i.test(file.name);
}

function formatOf(file: File): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toUpperCase();
  if (ext) return ext === 'JPEG' ? 'JPG' : ext;
  return file.type.split('/')[1]?.toUpperCase() || '—';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pagesText(file: FileInfo): string {
  const pages = file.page_count || 1;
  return pages === 1 ? tt('home.pending.pageOne') : tt('home.pending.pageMany', { n: pages });
}

function isImageFile(file: FileInfo): boolean {
  return (file.mime_type || '').startsWith('image/');
}

/** Cancelled sessions are deleted once, best effort: failures are swallowed and never retried. */
function discardSession(fileId: string | undefined, refreshPending = false) {
  if (!fileId) return;
  void deleteFile(fileId).catch(() => undefined).then(() => { if (refreshPending) void loadPending(); });
}

async function onPicked(target: HTMLInputElement | null) {
  const files = Array.from(target?.files ?? []);
  if (target) target.value = ''; // Snapshot before resetting; allow selecting the same files again.
  if (!files.length || inputBusy.value) return;
  wsMenuOpen.value = false;
  errorMsg.value = '';
  resetBatch();
  uploadItems.value = files.map((file) => {
    const key = ++nextUploadKey;
    uploadSources.set(key, file);
    const rejected = !isSupportedFile(file);
    return {
      key,
      name: file.name,
      size: file.size,
      format: formatOf(file),
      image: file.type ? file.type.startsWith('image/') : /\.(jpe?g|png)$/i.test(file.name),
      status: rejected ? 'failed' : 'waiting',
      percent: 0,
      error: rejected ? tt('home.fileTypeError') : '',
      retryable: !rejected,
    };
  });
  await runQueue();
}

async function runQueue() {
  const session = dataEpochs().session;
  const tenantId = currentTenantId.value;
  uploading.value = true;
  try {
    for (;;) {
      if (!sameContext(session, tenantId)) break;
      const item = uploadItems.value.find((entry) => entry.status === 'waiting');
      const source = item ? uploadSources.get(item.key) : undefined;
      if (!item || !source) break;
      item.status = 'uploading';
      item.percent = 0;
      item.error = '';
      const controller = new AbortController();
      current = { key: item.key, controller };
      let ready: FileInfo | null = null;
      let failure: unknown = null;
      try {
        // One three-stage upload at a time; ordinary failures never block later files.
        ready = await uploadFile(source, tenantId, 'OCR_TASK', (percent) => {
          if (!item.cancelled && sameContext(session, tenantId)) item.percent = Math.max(item.percent, Math.min(95, percent));
        }, { signal: controller.signal, onSession: (id) => { item.sessionId = id; } });
      } catch (e) {
        failure = e;
      }
      current = null;
      if (item.cancelled) {
        discardSession(item.sessionId ?? ready?.id);
        continue;
      }
      if (!sameContext(session, tenantId)) break;
      if (confirmRowKey.value === item.key) confirmRowKey.value = null;
      if (ready) {
        item.fileId = ready.id;
        item.percent = 100;
        item.status = 'uploaded';
        void loadPending();
        continue;
      }
      item.status = 'failed';
      item.error = errorText(failure);
      if (failure instanceof ApiError && failure.status === 401) {
        for (const rest of uploadItems.value) {
          if (rest.status !== 'waiting') continue;
          rest.status = 'failed';
          rest.error = item.error;
        }
        break;
      }
    }
    if (!sameContext(session, tenantId)) resetBatch();
  } finally {
    uploading.value = false;
    current = null;
    confirmAll.value = false;
    confirmRowKey.value = null;
    if (sameContext(session, tenantId)) void refreshQuota();
  }
}

function removeFromQueue(item: UploadItem) {
  item.cancelled = true;
  cancelledCount.value += 1;
  uploadItems.value = uploadItems.value.filter((entry) => entry.key !== item.key);
  uploadSources.delete(item.key);
  if (confirmRowKey.value === item.key) confirmRowKey.value = null;
}

function askCancelAll() {
  if (!uploading.value || !unfinishedCount.value) return;
  confirmRowKey.value = null;
  confirmAll.value = true;
  focusLater(() => keepAllBtn.value);
}

function keepUploadingAll() {
  confirmAll.value = false;
  focusLater(() => cancelAllBtn.value);
}

function confirmCancelAll() {
  if (!uploading.value) return;
  const targets = uploadItems.value.filter((item) => item.status === 'uploading' || item.status === 'waiting');
  confirmAll.value = false;
  confirmRowKey.value = null;
  if (!targets.length) return;
  for (const item of targets) {
    item.cancelled = true;
    uploadSources.delete(item.key);
  }
  cancelledCount.value += targets.length;
  cancelAllUsed.value = true;
  uploadItems.value = uploadItems.value.filter((item) => !item.cancelled);
  current?.controller.abort();
}

function cancelItem(item: UploadItem) {
  if (!uploading.value || item.cancelled) return;
  if (item.status === 'waiting') {
    removeFromQueue(item); // Not started yet: remove directly, no confirmation.
    return;
  }
  if (item.status !== 'uploading') return;
  confirmAll.value = false;
  confirmRowKey.value = item.key;
  focusLater(() => keepRowBtn);
}

function keepItem() {
  confirmRowKey.value = null;
}

function confirmCancelItem(item: UploadItem) {
  confirmRowKey.value = null;
  if (!uploading.value || item.cancelled || item.status !== 'uploading') return;
  removeFromQueue(item);
  if (current?.key === item.key) current.controller.abort();
}

/** Failed row → back to the queue; joins the running batch, or starts a new run when idle. */
async function retryItem(item: UploadItem) {
  if (item.status !== 'failed' || !item.retryable || !uploadSources.has(item.key) || urlBusy.value) return;
  // A half-created session from the failed attempt must not linger or later surface in Pending.
  discardSession(item.sessionId, true);
  item.sessionId = undefined;
  item.status = 'waiting';
  item.percent = 0;
  item.error = '';
  cancelAllUsed.value = false;
  errorMsg.value = '';
  if (!uploading.value) await runQueue();
}

/** Failed row → removed immediately (nothing is uploading, so no confirmation). */
function cancelFailed(item: UploadItem) {
  if (item.status !== 'failed' || item.cancelled) return;
  discardSession(item.sessionId, true);
  removeFromQueue(item);
}

async function retryFailed() {
  if (inputBusy.value) return;
  const targets = uploadItems.value.filter((item) => item.status === 'failed' && item.retryable && uploadSources.has(item.key));
  if (!targets.length) return;
  errorMsg.value = '';
  cancelledCount.value = 0;
  cancelAllUsed.value = false;
  for (const item of targets) {
    discardSession(item.sessionId, true);
    item.sessionId = undefined;
    item.status = 'waiting';
    item.percent = 0;
    item.error = '';
  }
  await runQueue();
}

async function submitUrl() {
  const url = urlValue.value.trim();
  if (!url || inputBusy.value) return;
  const session = dataEpochs().session;
  const tenantId = currentTenantId.value;
  urlBusy.value = true;
  wsMenuOpen.value = false;
  errorMsg.value = '';
  try {
    const { file } = await importFromUrl(url, tenantId);
    if (!sameContext(session, tenantId)) return;
    urlMode.value = false;
    urlValue.value = '';
    navigate('confirm', { fileId: file.id });
  } catch (e) {
    if (sameContext(session, tenantId)) errorMsg.value = errorText(e);
  } finally {
    urlBusy.value = false;
  }
}

function toggleSelect(fileId: string) {
  selectedIds.value = selectedIds.value.includes(fileId)
    ? selectedIds.value.filter((id) => id !== fileId)
    : [...selectedIds.value, fileId];
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : pendingFiles.value.map((file) => file.id);
}

function processFiles(ids: string[]) {
  if (deleting.value) return;
  // Keep the Pending list order (latest first) for the confirm page.
  const ordered = pendingFiles.value.filter((file) => ids.includes(file.id)).map((file) => file.id);
  const first = ordered[0];
  if (!first) return;
  navigate('confirm', ordered.length === 1 ? { fileId: first } : { fileId: first, fileIds: JSON.stringify(ordered) });
}

function processSelected() {
  processFiles(selectedIds.value);
}

function askDelete(ids: string[]) {
  if (deleting.value) return;
  const targets = pendingFiles.value.filter((file) => ids.includes(file.id)).map((file) => file.id);
  if (!targets.length) return;
  deleteError.value = '';
  deleteIds.value = targets;
  focusLater(() => keepDeleteBtn.value);
}

function keepRecords() {
  if (deleting.value) return;
  deleteIds.value = [];
}

async function confirmDelete() {
  if (deleting.value || !deleteTargets.value.length) return;
  const ids = deleteTargets.value.map((file) => file.id);
  const session = dataEpochs().session;
  const tenantId = currentTenantId.value;
  deleting.value = true;
  deleteError.value = '';
  let failed = 0;
  let reason = '';
  try {
    for (const id of ids) {
      try {
        await deleteFile(id);
        if (!sameContext(session, tenantId)) return;
        pendingFiles.value = pendingFiles.value.filter((file) => file.id !== id);
        selectedIds.value = selectedIds.value.filter((selected) => selected !== id);
      } catch (e) {
        if (!sameContext(session, tenantId)) return;
        failed += 1; // Keep the record; the user decides whether to delete again.
        reason = errorText(e);
      }
    }
    deleteIds.value = [];
    if (failed) deleteError.value = tt('home.pending.deleteFailed', { n: failed, reason });
  } finally {
    deleting.value = false;
  }
  await loadPending();
}

function openJob(job: JobSummary) {
  navigate(jobRoute(job.stage), { jobId: job.id });
}

// 隐藏 input 由卡片点击触发
function pick(kind: 'camera' | 'files') {
  if (inputBusy.value) return;
  const el = kind === 'camera' ? cameraInput.value : fileInput.value;
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
          <button class="ws-pill" :disabled="inputBusy" :aria-expanded="wsMenuOpen" @click="toggleWsMenu">
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
              :disabled="inputBusy"
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
              plan: quotaView.plan.name_i18n?.[locale] || quotaView.plan.name || tt('sub.notActive'),
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

      <!-- 两个入口卡片：Camera / Files（Photos 入口已移除，图片从 Files 选择） -->
      <div class="entry-grid">
        <button class="entry-card" :disabled="inputBusy" @click="pick('camera')">
          <div class="entry-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <span>{{ tt('home.camera') }}</span>
        </button>
        <button class="entry-card" :disabled="inputBusy" @click="pick('files')">
          <div class="entry-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M13 2v7h7" />
            </svg>
          </div>
          <span>{{ tt('home.files') }}</span>
        </button>
      </div>

      <input ref="cameraInput" type="file" accept="image/jpeg,image/png" capture="environment" :disabled="inputBusy" hidden @change="onPicked(cameraInput)" />
      <!-- Files has no accept filter: any file can be picked; unsupported types are marked failed before upload. -->
      <input ref="fileInput" type="file" multiple :disabled="inputBusy" hidden @change="onPicked(fileInput)" />

      <!-- URL 导入 -->
      <button v-if="!urlMode" class="url-row" :disabled="inputBusy" @click="urlMode = true">
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
          :disabled="inputBusy"
          @keyup.enter="submitUrl"
        />
        <button class="url-submit" :class="{ busy: urlBusy }" :disabled="inputBusy || !urlValue.trim()" @click="submitUrl">
          <BrandLoading v-if="urlBusy" variant="button" :label="tt('common.loading')" />
          <template v-else>{{ tt('home.urlSubmit') }}</template>
        </button>
      </div>

      <section v-if="showUploadBox" class="upload-box" :aria-label="uploading ? tt('home.batch.title') : tt('home.batch.finished')">
        <template v-if="uploading">
          <div class="upload-head">
            <div class="upload-title">
              <span>{{ tt('home.batch.title') }}</span>
              <div class="upload-actions">
                <span class="upload-counter">{{ tt('home.batch.position', { n: currentPosition || uploadedCount, total: uploadItems.length }) }}</span>
                <button
                  ref="cancelAllBtn"
                  class="cancel-all"
                  :aria-label="tt('home.batch.cancelAllLabel')"
                  :aria-expanded="confirmAll"
                  :disabled="!unfinishedCount"
                  @click="askCancelAll"
                >
                  {{ tt('home.batch.cancelAll') }}
                </button>
              </div>
            </div>
            <div class="upload-meta">{{ batchSummary }}</div>
            <div class="segments" aria-hidden="true">
              <div v-for="item in uploadItems" :key="item.key" class="segment" :class="{ error: item.status === 'failed' }">
                <span :style="{ width: item.percent + '%' }" />
              </div>
            </div>
            <!-- Announce file changes only; percentages are not live so they are not read repeatedly. -->
            <span class="sr-only" role="status" aria-live="polite">{{ currentPosition ? tt('home.batch.status', { n: currentPosition, total: uploadItems.length }) : '' }}</span>
          </div>
          <div
            v-if="confirmAll"
            class="inline-confirm"
            role="alertdialog"
            aria-labelledby="cancel-all-title"
            aria-describedby="cancel-all-body"
            @keydown.esc.prevent="keepUploadingAll"
          >
            <p id="cancel-all-title" class="confirm-title">{{ tt('home.batch.cancelAllTitle') }}</p>
            <p id="cancel-all-body" class="confirm-body">{{ tt('home.batch.cancelAllBody', { n: unfinishedCount, m: uploadedCount }) }}</p>
            <div class="confirm-actions">
              <button ref="keepAllBtn" class="confirm-keep" @click="keepUploadingAll">{{ tt('home.batch.keepUploading') }}</button>
              <button class="confirm-danger" @click="confirmCancelAll">{{ tt('home.batch.cancelAllConfirm', { n: unfinishedCount }) }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div v-if="cancelledCount" class="batch-note cancelled" role="status">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M9 9l6 6M15 9l-6 6" />
            </svg>
            <p>
              {{ cancelAllUsed ? tt('home.batch.allCancelled') : tt('home.batch.finished') }}
              <small>{{ tt('home.batch.cancelledSummary', { n: cancelledCount, m: uploadedCount }) }}</small>
            </p>
          </div>
          <div v-else-if="!failedItems.length" class="batch-note done" role="status">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12l5 5L20 6" />
            </svg>
            <p>
              {{ uploadedCount === 1 ? tt('home.batch.doneOne') : tt('home.batch.doneMany', { n: uploadedCount }) }}
              <small>{{ tt('home.batch.readyInPending') }}</small>
            </p>
          </div>
          <div v-else class="upload-head">
            <div class="upload-title">
              <span>{{ tt('home.batch.finished') }}</span>
              <span class="upload-counter">{{ tt('home.batch.uploadedOf', { n: uploadedCount, total: uploadItems.length }) }}</span>
            </div>
            <div class="upload-meta">{{ batchSummary }}</div>
            <div class="segments" aria-hidden="true">
              <div v-for="item in uploadItems" :key="item.key" class="segment" :class="{ error: item.status === 'failed' }">
                <span :style="{ width: item.percent + '%' }" />
              </div>
            </div>
          </div>
        </template>
        <template v-for="item in visibleUploadItems" :key="item.key">
          <div class="upload-row" :class="{ failed: item.status === 'failed' }">
            <div class="file-icon" aria-hidden="true">
              <svg v-if="item.image" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <path d="M13 2v7h7" />
              </svg>
            </div>
            <div class="file-body">
              <div class="file-name" :title="item.name">{{ item.name }}</div>
              <div class="file-meta">
                <span>{{ formatSize(item.size) }} · {{ item.format }}</span>
                <span v-if="item.status === 'uploading'" class="row-state uploading">{{ tt('home.upload.uploading') }}</span>
              </div>
              <div
                v-if="item.status === 'uploading'"
                class="file-progress"
                role="progressbar"
                :aria-label="item.name"
                :aria-valuenow="item.percent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: item.percent + '%' }" />
              </div>
              <p v-if="item.error" class="row-error">{{ item.status === 'failed' ? `${tt('home.upload.failed')} · ${item.error}` : item.error }}</p>
            </div>
            <div class="row-end">
              <!-- Failed rows show the state in the red error line so narrow screens keep room for the file name. -->
              <span v-if="item.status !== 'failed'" class="row-state" :class="item.status">{{ item.status === 'uploading' ? item.percent + '%' : tt('home.upload.' + item.status) }}</span>
              <button
                v-if="item.status === 'failed' && item.retryable && uploadSources.has(item.key)"
                class="row-retry"
                :aria-label="tt('home.batch.retryFile', { name: item.name })"
                :disabled="urlBusy"
                @click="retryItem(item)"
              >
                {{ tt('home.batch.retry') }}
              </button>
              <button
                v-if="item.status === 'failed' || (uploading && (item.status === 'uploading' || item.status === 'waiting'))"
                class="row-cancel"
                :class="{ active: item.status === 'uploading' }"
                :aria-label="tt('home.batch.cancelFile', { name: item.name })"
                @click="item.status === 'failed' ? cancelFailed(item) : cancelItem(item)"
              >
                {{ tt('home.batch.cancel') }}
              </button>
            </div>
          </div>
          <div
            v-if="confirmRowKey === item.key && item.status === 'uploading'"
            class="inline-confirm row-confirm"
            role="alertdialog"
            :aria-labelledby="`row-confirm-title-${item.key}`"
            :aria-describedby="`row-confirm-body-${item.key}`"
            @keydown.esc.prevent="keepItem"
          >
            <p :id="`row-confirm-title-${item.key}`" class="confirm-title">{{ tt('home.batch.cancelOneTitle') }}</p>
            <p :id="`row-confirm-body-${item.key}`" class="confirm-body">{{ tt('home.batch.cancelOneBody') }}</p>
            <div class="confirm-actions">
              <button :ref="setKeepRow" class="confirm-keep" @click="keepItem">{{ tt('home.batch.keepUploading') }}</button>
              <button class="confirm-danger" @click="confirmCancelItem(item)">{{ tt('home.batch.cancelUpload') }}</button>
            </div>
          </div>
        </template>
        <div v-if="uploading" class="upload-foot"><span>{{ tt('home.batch.hint') }}</span></div>
        <div v-else-if="failedItems.length" class="upload-foot">
          <span>{{ tt('home.batch.failedHint') }}</span>
          <button v-if="canRetry" class="retry-btn" @click="retryFailed">{{ tt('home.batch.retryFailed') }}</button>
        </div>
      </section>
      <p v-if="errorMsg" class="status-line error">{{ errorMsg }}</p>

      <!-- Pending：已上传、未开始处理（FR-UPLOAD-013） -->
      <section class="pending-section" aria-labelledby="pending-title">
        <div class="section-head">
          <h2 id="pending-title" class="section-title">
            {{ tt('home.pending.title') }}
            <span class="count-badge">{{ pendingFiles.length }}</span>
          </h2>
          <button class="select-all" :disabled="!pendingFiles.length || deleting" @click="toggleSelectAll">
            {{ allSelected ? tt('home.pending.deselectAll') : tt('home.pending.selectAll') }}
          </button>
        </div>
        <p class="section-desc">{{ tt('home.pending.desc') }}</p>
        <div
          v-if="deleteTargets.length"
          class="inline-confirm delete-confirm"
          role="alertdialog"
          aria-labelledby="delete-title"
          aria-describedby="delete-body"
          @keydown.esc.prevent="keepRecords"
        >
          <p id="delete-title" class="confirm-title">
            {{ deleteTargets.length === 1 ? tt('home.pending.deleteTitleOne') : tt('home.pending.deleteTitleMany', { n: deleteTargets.length }) }}
          </p>
          <ul class="delete-names">
            <li v-for="file in deleteTargets" :key="file.id">{{ file.original_name }}</li>
          </ul>
          <p id="delete-body" class="confirm-body">{{ tt('home.pending.deleteBody') }}</p>
          <div class="confirm-actions">
            <button ref="keepDeleteBtn" class="confirm-keep" :disabled="deleting" @click="keepRecords">{{ tt('home.pending.keepRecords') }}</button>
            <button class="confirm-danger" :class="{ busy: deleting }" :disabled="deleting" @click="confirmDelete">
              <BrandLoading v-if="deleting" variant="button" :label="tt('common.loading')" />
              <template v-else>{{ tt('home.pending.deleteConfirm', { n: deleteTargets.length }) }}</template>
            </button>
          </div>
        </div>
        <p v-if="deleteError" class="status-line error" role="alert">{{ deleteError }}</p>
        <div class="pending-box">
          <div v-if="pendingLoading && !pendingFiles.length" class="pending-state">
            <BrandLoading variant="inline" :label="tt('common.loading')" />
          </div>
          <p v-else-if="pendingError && !pendingFiles.length" class="pending-state status-line error">{{ pendingError }}</p>
          <div v-else-if="!pendingFiles.length" class="pending-state pending-empty">
            {{ tt('home.pending.emptyTitle') }}<br />{{ tt('home.pending.emptyBody') }}
          </div>
          <template v-else>
            <div
              v-for="file in pendingFiles"
              :key="file.id"
              class="pending-row"
              :class="{ chosen: selectedIds.includes(file.id) }"
            >
              <label class="check">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(file.id)"
                  :aria-label="tt('home.pending.select', { name: file.original_name })"
                  @change="toggleSelect(file.id)"
                />
              </label>
              <div class="file-icon" aria-hidden="true">
                <svg v-if="isImageFile(file)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M13 2v7h7" />
                </svg>
              </div>
              <div class="file-body">
                <div class="file-name" :title="file.original_name">{{ file.original_name }}</div>
                <div class="file-meta">
                  <span>{{ pagesText(file) }}</span>
                  <span class="pending-badge">{{ tt('home.pending.badge') }}</span>
                </div>
              </div>
              <button
                class="process-btn"
                :disabled="deleting"
                :aria-label="tt('home.pending.processName', { name: file.original_name })"
                @click="processFiles([file.id])"
              >
                {{ tt('home.pending.process') }}
              </button>
              <button
                class="trash-btn"
                :disabled="deleting"
                :aria-label="tt('home.pending.deleteName', { name: file.original_name })"
                @click="askDelete([file.id])"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                </svg>
              </button>
            </div>
            <div class="batch-bar">
              <span class="batch-selected">{{ tt('home.pending.selected', { n: selectedPending.length }) }}</span>
              <div class="batch-actions">
                <button
                  class="bulk-delete"
                  :disabled="!selectedPending.length || deleting"
                  @click="askDelete(selectedIds)"
                >
                  {{ selectedPending.length ? tt('home.pending.deleteN', { n: selectedPending.length }) : tt('home.pending.deleteSelected') }}
                </button>
                <button
                  class="bulk-process"
                  :disabled="!selectedPending.length || deleting"
                  @click="processSelected"
                >
                  {{ selectedPending.length ? tt('home.pending.processN', { n: selectedPending.length }) : tt('home.pending.processSelected') }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </section>

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
  grid-template-columns: repeat(2, 1fr);
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

.entry-card:disabled,
.ws-pill:disabled,
.url-row:disabled {
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ---- 上传批次（FR-UPLOAD-010/013） ---- */
.upload-box {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  overflow: hidden;
}

.upload-head {
  padding: 13px 13px 10px;
}

.upload-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}

.upload-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}

.upload-counter {
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
}

.cancel-all,
.retry-btn {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.cancel-all:disabled {
  opacity: 0.5;
}

.upload-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.segments {
  display: flex;
  gap: 4px;
  height: 6px;
  margin: 10px 0 2px;
}

.segment {
  flex: 1;
  min-width: 0;
  border-radius: 4px;
  background: var(--primary-light);
  overflow: hidden;
}

.segment span {
  display: block;
  height: 100%;
  background: var(--primary);
  transition: width 0.12s linear;
}

.segment.error {
  background: rgba(230, 71, 77, 0.14);
}

.segment.error span {
  background: var(--danger);
}

.upload-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 13px;
  border-top: 1px solid var(--border);
}

.file-icon {
  width: 32px;
  height: 38px;
  border-radius: 9px;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-body {
  flex: 1;
  min-width: 0;
}

/* Failed rows carry Retry + Cancel; on narrow screens the buttons wrap below instead of squeezing the name. */
.upload-row.failed {
  flex-wrap: wrap;
}

.upload-row.failed .file-body {
  flex: 1 1 120px;
  min-width: 120px;
}

.upload-row.failed .row-end {
  margin-left: auto;
}

.file-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.file-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: 11px;
  color: var(--text-secondary);
}

.file-progress {
  height: 4px;
  margin-top: 6px;
  border-radius: 4px;
  background: var(--primary-light);
  overflow: hidden;
}

.file-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 0.12s linear;
}

.row-error {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--danger);
  overflow-wrap: anywhere;
}

.row-end {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.row-state {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.row-state.uploaded { color: var(--success); }
.row-state.uploading { color: var(--primary); }
.row-state.failed { color: var(--danger); }

.row-cancel {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--icon);
  font-size: 11px;
  font-weight: 600;
}

.row-cancel.active {
  border-color: var(--danger);
  color: var(--danger);
}

.row-retry {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
}

.row-retry:disabled {
  opacity: 0.5;
}

.inline-confirm {
  margin: 0 13px 12px;
  padding: 12px;
  border: 1px solid var(--danger);
  border-radius: 12px;
  background: rgba(230, 71, 77, 0.06);
}

.inline-confirm.delete-confirm {
  margin: 0;
  background: var(--card);
}

.confirm-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--danger);
}

.confirm-body {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--icon);
}

.delete-names {
  margin: 6px 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text);
  overflow-wrap: anywhere;
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.confirm-actions button {
  min-height: 38px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
}

.confirm-keep {
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--text);
}

.confirm-danger {
  background: var(--danger);
  border: 1px solid var(--danger);
  color: #fff;
}

.confirm-actions button:disabled {
  opacity: 0.6;
}

.upload-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 13px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}

.upload-foot span {
  flex: 1;
}

.batch-note {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px;
  font-size: 12px;
  font-weight: 600;
}

.batch-note p {
  margin: 0;
}

.batch-note small {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  font-weight: 400;
}

.batch-note.done {
  background: var(--success-bg);
  color: var(--success);
}

.batch-note.cancelled {
  background: var(--primary-light);
  color: var(--primary);
}

.batch-note.cancelled small {
  color: var(--icon);
}

.batch-note svg {
  flex-shrink: 0;
}

/* ---- Pending（FR-UPLOAD-013） ---- */
.pending-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.section-head .section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}

.count-badge {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 7px;
  background: var(--processing-bg);
  color: var(--processing);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.select-all {
  min-height: 36px;
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
}

.select-all:disabled {
  opacity: 0.5;
}

.section-desc {
  margin: -4px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.pending-box {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  overflow: hidden;
}

.pending-state {
  padding: 22px 12px;
  display: flex;
  justify-content: center;
}

.pending-empty {
  display: block;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-secondary);
  text-align: center;
}

.pending-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 10px 10px 4px;
  border-bottom: 1px solid var(--border);
}

.pending-row.chosen {
  background: var(--primary-light);
}

.check {
  width: 30px;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.check input {
  width: 17px;
  height: 17px;
  accent-color: var(--primary);
}

.pending-badge {
  padding: 2px 7px;
  border-radius: 7px;
  background: var(--processing-bg);
  color: var(--processing);
  white-space: nowrap;
}

.process-btn {
  min-height: 36px;
  padding: 0 9px;
  border: 1px solid var(--primary);
  border-radius: 9px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.trash-btn {
  width: 32px;
  min-height: 36px;
  border-radius: 8px;
  color: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.process-btn:disabled,
.trash-btn:disabled {
  opacity: 0.5;
}

.batch-bar {
  padding: 11px 12px;
  font-size: 11px;
}

.batch-selected {
  display: block;
  margin-bottom: 9px;
  color: var(--text-secondary);
}

.batch-actions {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 9px;
}

.batch-actions button {
  min-height: 42px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
}

.bulk-delete {
  border: 1px solid var(--danger);
  color: var(--danger);
}

.bulk-process {
  background: var(--primary);
  color: #fff;
}

.bulk-delete:disabled {
  border-color: var(--border);
  color: var(--text-secondary);
}

.bulk-process:disabled {
  background: var(--border);
  color: var(--text-secondary);
}

@media (max-width: 350px) {
  .pending-row { gap: 5px; }
  .file-icon { width: 28px; }
  .process-btn { padding: 0 6px; }
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
