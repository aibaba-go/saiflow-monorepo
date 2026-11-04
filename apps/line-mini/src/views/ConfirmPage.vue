<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiError, createJob, dataEpochs, filePagePreviewUrl, filePageUrls, getFile, type FileInfo } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { currentTenantId, navigate, user } from '../store';
import { newIdempotencyKey } from '../upload';
import BrandLoading from '../components/BrandLoading.vue';
import ImageViewer from '../components/ImageViewer.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useT();

const props = defineProps<{
  fileId: string;
  fileIds?: string;
}>();

function selectedIds(): string[] {
  try {
    const ids: unknown = JSON.parse(props.fileIds || 'null');
    if (Array.isArray(ids) && ids.length && ids.every((id) => typeof id === 'string' && id.trim())) {
      return [...new Set(ids as string[])];
    }
  } catch { /* Older single-file routes do not carry JSON. */ }
  return props.fileId ? [props.fileId] : [];
}

type ConfirmItem = { id: string; file: FileInfo | null; error: string; jobId: string; key: string };
// FR-UPLOAD-013: Pending files are previewed first; OCR starts only on the explicit Start button.
const items = ref<ConfirmItem[]>(selectedIds().map((id) => ({ id, file: null, error: '', jobId: '', key: '' })));
const selectedIndex = ref(0);
const selectedItem = computed(() => items.value[selectedIndex.value]);
const file = computed(() => selectedItem.value?.file ?? null);
const multiple = computed(() => items.value.length > 1);
const remaining = computed(() => items.value.filter((item) => !item.jobId));
const startedCount = computed(() => items.value.length - remaining.value.length);
/** Multi-file start needs every not-yet-started file loaded and READY; otherwise the user returns to Pending. */
const remainingReady = computed(() => remaining.value.length > 0
  && remaining.value.every((item) => item.file?.status === 'READY'));
const loading = ref(true);
const errorMsg = ref('');
const starting = ref(false);
const viewerOpen = ref(false);
const session = dataEpochs().session;
const tenantId = currentTenantId.value;
let active = true;
const contextValid = ref(true);
onBeforeUnmount(() => { active = false; });

function sameContext(): boolean {
  return active && contextValid.value && session === dataEpochs().session && tenantId === currentTenantId.value;
}

function invalidateContext() {
  if (!active) return;
  contextValid.value = false;
  items.value = [];
  viewerOpen.value = false;
  loading.value = false;
  errorMsg.value = t('confirm.contextChanged');
}

watch([user, currentTenantId], invalidateContext, { flush: 'sync' });

onMounted(async () => {
  if (!items.value.length) errorMsg.value = t('err.error.not_found');
  await Promise.all(items.value.map(async (item) => {
    try {
      const { file: f } = await getFile(item.id);
      if (!sameContext()) { invalidateContext(); return; }
      item.file = f;
    } catch (e) {
      if (!sameContext()) { invalidateContext(); return; }
      item.error = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
      if (e instanceof ApiError && e.status === 401) invalidateContext();
    }
  }));
  if (sameContext()) loading.value = false;
});

const unavailable = computed(() => multiple.value && !loading.value && remaining.value.some((item) => item.file?.status !== 'READY'));

function selectFile(index: number) {
  if (starting.value || !sameContext() || index < 0 || index >= items.value.length) return;
  selectedIndex.value = index;
  viewerOpen.value = false;
}

function startLabel(): string {
  if (!multiple.value) return t('confirm.start');
  const n = remaining.value.length;
  return n === 1 ? t('confirm.startOne') : t('confirm.startMany', { n });
}

/** Returns true when the job was created; false after an error that is already shown. */
async function createFor(item: ConfirmItem): Promise<boolean> {
  try {
    // Keep the key for an explicit retry after an ambiguous response, never retry automatically.
    item.key ||= newIdempotencyKey();
    const job = await createJob({
      file_id: item.id,
      params: { parse_mode: 'scan', table: true, formula: false, rotate: true },
      idempotency_key: item.key,
    });
    if (!sameContext()) { invalidateContext(); return false; }
    item.jobId = job.id;
    return true;
  } catch (e) {
    if (!sameContext()) { invalidateContext(); return false; }
    // 402 PLAN_EXPIRED：沿用单文件确认时的套餐分流。
    if (e instanceof ApiError && e.status === 402 && e.body.code === 'PLAN_EXPIRED') {
      errorMsg.value = messageText(e.messageKey);
      navigate('plans');
      return false;
    }
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    if (e instanceof ApiError && e.status === 401) invalidateContext();
    return false;
  }
}

async function start() {
  if (starting.value || !sameContext()) return;
  if (!multiple.value) {
    const item = selectedItem.value;
    if (!item?.file || item.file.status !== 'READY' || item.jobId) return;
    starting.value = true;
    errorMsg.value = '';
    try {
      if (await createFor(item)) navigate('processing', { jobId: item.jobId });
    } finally {
      starting.value = false;
    }
    return;
  }
  // Multiple files: one explicit click starts the not-yet-started files in order; stop at the first failure.
  if (loading.value || !remainingReady.value) return;
  const queue = [...remaining.value];
  starting.value = true;
  errorMsg.value = '';
  try {
    for (const item of queue) {
      if (!(await createFor(item))) {
        if (sameContext() && startedCount.value > 0 && errorMsg.value) {
          errorMsg.value = `${errorMsg.value} ${t('confirm.partialStarted', { n: startedCount.value, total: items.value.length })}`;
        }
        return;
      }
    }
    navigate('scan'); // Started files now appear in Recent tasks.
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="confirm">
    <PageHeader :title="t('confirm.title')" @back="navigate('scan')" />

    <div class="content">
      <p v-if="multiple" class="review-context">{{ t('confirm.reviewSelected') }}</p>
      <p v-if="errorMsg" class="status-error" role="alert">{{ errorMsg }}</p>
      <div v-if="multiple" class="file-switch">
        <button
          class="switch-btn"
          :aria-label="t('confirm.prevFile')"
          :disabled="starting || selectedIndex === 0"
          @click="selectFile(selectedIndex - 1)"
        >
          ‹
        </button>
        <span class="switch-position">{{ t('confirm.filePosition', { n: selectedIndex + 1, total: items.length }) }}</span>
        <button
          class="switch-btn"
          :aria-label="t('confirm.nextFile')"
          :disabled="starting || selectedIndex >= items.length - 1"
          @click="selectFile(selectedIndex + 1)"
        >
          ›
        </button>
      </div>
      <p v-if="selectedItem?.error" class="status-error" role="alert">{{ selectedItem.error }}</p>
      <template v-if="file">
        <button class="preview-wrap" :aria-label="t('result.tapZoom')" @click="viewerOpen = true">
          <!-- 图片返回本体，PDF 由服务端渲染成 PNG，统一走页预览接口 -->
          <img class="preview" :src="filePagePreviewUrl(file.id, 1)" :alt="file.original_name" />
          <div class="page-badge">{{ t('confirm.pageOf', { n: 1, total: file.page_count || 1 }) }}</div>
          <span class="zoom-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
            </svg>
          </span>
        </button>
        <ImageViewer
          v-if="viewerOpen"
          :sources="filePageUrls(file.id, file.page_count)"
          :alt="file.original_name"
          @close="viewerOpen = false"
        />

        <div class="file-summary">
          <div class="file-name">{{ file.original_name }}</div>
          <div class="file-meta">{{ t('result.meta', { pages: file.page_count, tables: 0 }) }}</div>
          <div v-if="multiple" class="file-state" :class="{ started: !!selectedItem?.jobId }">
            {{ selectedItem?.jobId ? t('confirm.started') : t('confirm.notStarted') }}
          </div>
        </div>
      </template>
      <BrandLoading v-else-if="loading && !selectedItem?.error" variant="page" :label="t('common.loading')" />

      <p v-if="unavailable" class="status-error" role="alert">{{ t('confirm.unavailable') }}</p>
      <button
        v-if="multiple ? items.length > 0 : !!file"
        class="primary-btn"
        :disabled="starting || !contextValid || (multiple ? loading || !remainingReady : file?.status !== 'READY')"
        @click="start"
      >
        <BrandLoading v-if="starting" variant="button" :label="t('common.loading')" />
        <template v-else>{{ startLabel() }}</template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.content {
  padding: 8px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.review-context {
  margin: -6px 0 -4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.file-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--icon);
}

.switch-position {
  flex: 1;
  text-align: center;
}

.switch-btn {
  min-width: 38px;
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-size: 18px;
}

.switch-btn:disabled {
  opacity: 0.4;
}

.preview-wrap {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border-radius: 16px;
  overflow: hidden;
  background: var(--track);
  border: 1px solid var(--border);
}

.zoom-badge {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 26, 28, 0.68);
  color: #fff;
}

.preview {
  display: block;
  width: 100%;
  max-height: 300px;
  object-fit: contain;
}

.page-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(23, 26, 28, 0.72);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
}

.file-summary {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
}

.file-name {
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.file-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
}

.file-state {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--processing);
}

.file-state.started {
  color: var(--success);
}

.primary-btn {
  height: 53px;
  border-radius: 14px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.primary-btn:disabled {
  opacity: 0.6;
}

.status-error {
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}
</style>
