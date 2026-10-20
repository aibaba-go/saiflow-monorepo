<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ApiError,
  fetchSubscription,
  getJob,
  getJobResults,
  rerunJob,
  updateJobResults,
  type JobResults,
  type JobSummary,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { goTab, isAuthenticated, isGuest, jobWorkspace, navigate, rememberPendingJob } from '../store';
import {
  addFieldAt,
  addTableRowAt,
  getAtPath,
  isAmountKey,
  parseNumberText,
  removeFieldAt,
  removeTableRowAt,
  setAtPath,
  type Path,
  type TableRowTarget,
} from '../structured';
import BrandLoading from '../components/BrandLoading.vue';
import FormDialog from '../components/FormDialog.vue';
import OriginalPreview from '../components/OriginalPreview.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusChip from '../components/StatusChip.vue';
import StructuredDataView from '../components/StructuredDataView.vue';

const { t } = useT();

const props = defineProps<{
  jobId: string;
}>();

const results = ref<JobResults | null>(null);
const job = ref<JobSummary | null>(null);
const draft = ref<unknown>(null);
const errorMsg = ref('');
const saving = ref(false);
const retrying = ref(false);
const confirmingReset = ref(false);

const locked = computed(() => results.value?.review_status === 'CONFIRMED');
/** 草稿与当前结果版本有差异（编辑、增删字段或表格行） */
const dirty = computed(
  () => !!results.value && JSON.stringify(draft.value) !== JSON.stringify(results.value.structured),
);
const failed = computed(
  () => job.value?.status === 'FAILED' || job.value?.status === 'CANCELLED',
);
const failureReason = computed(() => {
  if (job.value?.error_code === 'TEXTIN_ERROR_40003') return t('err.ocr.vendor_balance');
  return job.value?.error_message || t('err.ocr.failed');
});

function cloneStructured(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

async function load() {
  try {
    const jobPayload = await getJob(props.jobId);
    job.value = jobPayload;
    if (jobPayload.status === 'FAILED' || jobPayload.status === 'CANCELLED') return;
    results.value = await getJobResults(props.jobId);
    draft.value = cloneStructured(results.value.structured);
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  }
}

async function retry(): Promise<void> {
  if (retrying.value) return;
  retrying.value = true;
  errorMsg.value = '';
  try {
    const next = await rerunJob(props.jobId);
    navigate('processing', { jobId: next.id });
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  } finally {
    retrying.value = false;
  }
}

onMounted(load);

function onEdit(path: Path, value: string): void {
  setAtPath(draft.value, path, value);
}

/** 只接受无前导零的纯数字，避免把编号类文本（00123）误转成数字 */
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** 新增值的类型推断：金额类字段的纯数字转成数字，与 OCR 数字的显示/导出规则一致 */
function inferValue(key: string, text: string): string | number {
  if (!isAmountKey(key)) return text;
  const trimmed = text.trim();
  return PLAIN_NUMBER.test(trimmed.replace(/,/g, '')) ? Number(trimmed.replace(/,/g, '')) : text;
}

/** 失焦提交时，原值为数字的字段转回数字，保持 JSON 类型并按金额格式（2 位小数）回显 */
function onCommit(path: Path): void {
  const original = getAtPath(results.value?.structured, path);
  const current = getAtPath(draft.value, path);
  if (typeof current !== 'string') return;
  const last = path[path.length - 1];
  const key = typeof last === 'number' ? String(path[path.length - 2] ?? '') : String(last);
  if (typeof original === 'number') {
    const parsed = parseNumberText(current);
    if (parsed !== null) setAtPath(draft.value, path, parsed);
  } else if ((original === undefined || original === null) && current.trim() !== '') {
    // 新增字段 / 新增表格行没有原值，按字段名推断金额并保持数字类型
    const inferred = inferValue(key, current);
    if (typeof inferred === 'number') setAtPath(draft.value, path, inferred);
  }
}

function onAddField(parts: Path, name: string, value: string): void {
  addFieldAt(draft.value, parts, name, inferValue(name, value));
}

function onRemoveField(path: Path): void {
  removeFieldAt(draft.value, path);
}

function onAddRow(target: TableRowTarget): void {
  addTableRowAt(draft.value, target);
}

function onRemoveRow(parts: Path, index: number): void {
  removeTableRowAt(draft.value, parts, index);
}

function askReset(): void {
  if (!dirty.value || locked.value) return;
  confirmingReset.value = true;
}

/** 放弃本次所有改动，恢复到当前结果版本（含字段与表格行的增删） */
function resetDraft(): void {
  if (!results.value) return;
  draft.value = cloneStructured(results.value.structured);
  confirmingReset.value = false;
}

async function saveDraft(): Promise<void> {
  if (!results.value || locked.value || !dirty.value) return;
  results.value = await updateJobResults(props.jobId, {
    expected_version: results.value.version,
    structured: draft.value,
    confirm: false,
  });
}

async function confirm(): Promise<void> {
  if (!results.value || !job.value || saving.value) return;
  errorMsg.value = '';

  saving.value = true;
  try {
    if (!isAuthenticated.value) {
      await saveDraft();
      rememberPendingJob(props.jobId);
      navigate('auth', { jobId: props.jobId });
      return;
    }
    const sub = await fetchSubscription(jobWorkspace(job.value));
    if (sub.status !== 'ACTIVE') {
      await saveDraft();
      if (sub.status === 'PENDING') {
        navigate('plan-pending', { jobId: props.jobId, plan: sub.plan_name ?? '', submittedAt: sub.submitted_at ?? '' });
      } else {
        navigate('plans', { jobId: props.jobId });
      }
      return;
    }
    if (!locked.value) {
      const updated = await updateJobResults(props.jobId, {
        expected_version: results.value.version,
        structured: draft.value,
        confirm: true,
      });
      results.value = updated;
      draft.value = cloneStructured(updated.structured);
    } else if (job.value.stage === 'VERIFIED') {
      results.value = await updateJobResults(props.jobId, {
        expected_version: results.value.version,
        confirm: true,
      });
    }
    navigate('final', { jobId: props.jobId });
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="result">
    <PageHeader :title="job?.file_name || '…'" @back="goTab('history')" />

    <div v-if="failed" class="failure">
      <div class="failure-badge">!</div>
      <h2>{{ job?.status === 'CANCELLED' ? t('result.cancelledTitle') : t('result.failedTitle') }}</h2>
      <p class="failure-file">{{ job?.file_name }}</p>
      <p class="failure-reason">{{ failureReason }}</p>
      <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      <button class="primary-btn" :disabled="retrying" @click="retry">
        <BrandLoading v-if="retrying" variant="button" :label="t('result.retrying')" />
        <template v-else>{{ t('result.retry') }}</template>
      </button>
      <button class="home-btn" @click="goTab('history')">{{ t('common.back') }}</button>
    </div>

    <div v-else-if="errorMsg && !results" class="fatal">
      <p class="status-error">{{ errorMsg }}</p>
      <button class="home-btn" @click="goTab('history')">{{ t('common.back') }}</button>
    </div>

    <template v-else-if="results">
      <div class="summary">
        <div class="chips">
          <StatusChip v-if="job" :stage="job.stage" />
          <span class="review-chip" :class="results.review_status.toLowerCase()">
            {{ t(`job.review.${results.review_status}`) }}
          </span>
        </div>
        <div class="meta">
          {{ t('result.meta', { pages: job?.page_count ?? results.page_count, tables: results.table_count }) }}
        </div>
      </div>

      <div class="content">
        <!-- 原图置于表格上方，点击放大 / 缩小 -->
        <OriginalPreview
          v-if="job"
          :file-id="job.file_id"
          :file-name="job.file_name"
          :page-count="job.page_count || results.page_count || 1"
        />

        <div class="edit-hint">
          <template v-if="locked">{{ t('result.lockedHint') }}</template>
          <template v-else>{{ t('result.editHint') }}</template>
        </div>

        <StructuredDataView
          :data="draft"
          :editable="!locked"
          @edit="onEdit"
          @commit="onCommit"
          @add-field="onAddField"
          @remove-field="onRemoveField"
          @add-row="onAddRow"
          @remove-row="onRemoveRow"
        />

        <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      </div>

      <div class="action-bar">
        <p v-if="isGuest" class="guest-hint">{{ t('result.guestHint') }}</p>
        <div class="action-buttons">
          <button v-if="!locked" class="reset-btn" :disabled="!dirty || saving" @click="askReset">
            {{ t('result.reset') }}
          </button>
          <button class="primary-btn" :disabled="saving" @click="confirm">
            <BrandLoading v-if="saving" variant="button" :label="t('result.saving')" />
            <template v-else>{{ t('result.continue') }}</template>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="fatal"><BrandLoading :label="t('common.loading')" /></div>

    <FormDialog
      v-if="confirmingReset && !locked"
      :title="t('result.resetConfirm')"
      :subtitle="t('result.resetConfirmBody')"
    >
      <div class="fd-actions">
        <button class="fd-btn secondary" @click="confirmingReset = false">{{ t('common.cancel') }}</button>
        <button class="fd-btn danger" @click="resetDraft">{{ t('result.reset') }}</button>
      </div>
    </FormDialog>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.fatal {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
}

.failure {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.failure-badge {
  width: 46px;
  height: 46px;
  border-radius: 999px;
  background: #fdeaea;
  color: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
}

.failure h2 {
  margin: 2px 0 0;
  font-size: 16px;
}

.failure-file {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
}

.failure-reason {
  margin: 4px 0 10px;
  max-width: 320px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--danger);
}

.failure .primary-btn,
.failure .home-btn {
  width: 100%;
  max-width: 320px;
}

.failure .home-btn {
  height: 44px;
}

.summary {
  padding: 2px 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.review-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--track);
  color: var(--icon);
  font-size: 9px;
  font-weight: 700;
}

.review-chip.confirmed {
  background: var(--success-bg);
  color: var(--success);
}

.review-chip.edited {
  background: var(--processing-bg);
  color: var(--processing);
}

.content {
  flex: 1;
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-hint {
  font-size: 10.5px;
  color: var(--text-secondary);
  padding: 0 2px;
}

.action-bar {
  position: sticky;
  bottom: 0;
  background: linear-gradient(180deg, rgba(245, 247, 250, 0) 0%, var(--bg) 28%);
  padding: 12px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guest-hint {
  margin: 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--processing);
  font-weight: 600;
}

.action-buttons {
  display: flex;
  gap: 10px;
}

.action-buttons .primary-btn,
.action-buttons .reset-btn {
  flex: 1 1 0;
  min-width: 0;
}

.reset-btn {
  height: 53px;
  border: 0;
  /* 用内阴影画边框，避免 border 宽度让两个等宽按钮出现 1px 偏差 */
  box-shadow: inset 0 0 0 1px var(--border);
  border-radius: 14px;
  background: var(--card);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.reset-btn:disabled {
  opacity: 0.45;
  cursor: default;
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
  margin: 0;
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}

.home-btn {
  height: 44px;
  padding: 0 24px;
  border-radius: 12px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}
</style>
