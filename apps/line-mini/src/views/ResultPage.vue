<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ApiError,
  applyTemplate,
  fetchSubscription,
  getJob,
  getJobResults,
  getTemplateOptions,
  getTemplateVersion,
  rerunJob,
  updateJobResults,
  useGenericResult,
  type JobResults,
  type JobSummary,
  type TemplateOptions,
  type TemplateVersionSnapshot,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { goTab, isAuthenticated, isGuest, jobTenantId, navigate, needsRegistration, rememberPendingJob } from '../store';
import {
  addFieldAt,
  addTableRowAt,
  getAtPath,
  isAmountKey,
  parseNumberText,
  removeFieldAt,
  removeTableRowAt,
  requiredMissing,
  setAtPath,
  templateTypeAtPath,
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
const structuredView = ref<InstanceType<typeof StructuredDataView> | null>(null);
const options = ref<TemplateOptions | null>(null);
const selecting = ref(false);
const confirmingSwitch = ref(false);
const target = ref<string>('generic');
const forceMapping = ref(false);
const previews = ref<Record<number, TemplateVersionSnapshot>>({});
const previewErrors = ref<Record<number, string>>({});
const pendingExpired = ref(false);
const toast = ref('');
let active = true;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pendingStarted = 0;
let pendingId: string | null = null;

const locked = computed(() => results.value?.review_status === 'CONFIRMED');
const pending = computed(() => !!results.value?.pending_mapping);
const busy = computed(() => saving.value || pending.value);
const missing = computed(() => results.value?.template_schema
  ? requiredMissing(results.value.template_schema, draft.value) : []);
const currentLabel = computed(() => results.value?.current_mapping?.template_name || t('template.generic'));
const currentSelection = computed(() => results.value?.current_mapping
  ? `mapping:${results.value.current_mapping.id}` : 'generic');
const historicalMappings = computed(() => (options.value?.mappings ?? []).filter((m) =>
  m.status === 'READY' && !options.value?.templates.some((o) => o.ready_mapping_id === m.id),
));
/** 草稿或尚在新增输入框中的字段有变更；Reset 同样可放弃这些输入。 */
const dirty = computed(
  () => !!results.value && (
    JSON.stringify(draft.value) !== JSON.stringify(results.value.structured)
    || !!structuredView.value?.hasPendingFields
  ),
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
    acceptResults(await getJobResults(props.jobId));
    await refreshOptions();
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
onBeforeUnmount(() => {
  active = false;
  clearTimeout(pollTimer);
  clearTimeout(toastTimer);
});

function notify(text: string): void {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 5000);
}

async function refreshOptions(): Promise<void> {
  try { options.value = await getTemplateOptions(props.jobId); }
  catch (e) {
    // 滚动发布期间旧后端没有模板接口，仍允许通用结果继续工作。
    if (!(e instanceof ApiError && e.status === 404)) {
      errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    }
  }
}

function acceptResults(payload: JobResults): void {
  if (!active) return;
  const wasDirty = dirty.value;
  const previousId = results.value?.latest_failed_mapping?.id;
  if (!results.value || (!wasDirty && results.value.version !== payload.version)) {
    draft.value = cloneStructured(payload.structured);
  }
  results.value = payload;
  if (payload.latest_failed_mapping && payload.latest_failed_mapping.id !== previousId) {
    notify(t('template.failed'));
  }
  clearTimeout(pollTimer);
  if (payload.pending_mapping) {
    if (pendingId !== payload.pending_mapping.id) {
      pendingId = payload.pending_mapping.id;
      pendingStarted = Date.now();
      pendingExpired.value = false;
    }
    if (!pendingExpired.value) pollTimer = setTimeout(pollMapping, 2000);
  } else {
    pendingId = null;
    pendingExpired.value = false;
  }
}

async function pollMapping(): Promise<void> {
  if (!active) return;
  if (Date.now() - pendingStarted >= 600000) {
    pendingExpired.value = true;
    notify(t('template.timeout'));
    return;
  }
  try {
    const payload = await getJobResults(props.jobId);
    if (!active) return;
    acceptResults(payload);
    if (!payload.pending_mapping) await refreshOptions();
  } catch (e) {
    if (!active) return;
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    if (!(e instanceof ApiError && [401, 404].includes(e.status))) {
      pollTimer = setTimeout(pollMapping, 2000);
    }
  }
}

async function openSelector(): Promise<void> {
  if (locked.value || saving.value) return;
  await refreshOptions();
  target.value = currentSelection.value;
  forceMapping.value = false;
  selecting.value = true;
}

async function preview(versionId: number): Promise<void> {
  if (previews.value[versionId]) return;
  delete previewErrors.value[versionId];
  try { previews.value[versionId] = await getTemplateVersion(versionId); }
  catch (e) { previewErrors.value[versionId] = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError'); }
}

function requestSwitch(): void {
  if (target.value === currentSelection.value && !pending.value && !results.value?.latest_failed_mapping) {
    selecting.value = false;
    return;
  }
  selecting.value = false;
  if (dirty.value) confirmingSwitch.value = true;
  else void switchResult();
}

async function switchResult(): Promise<void> {
  if (!results.value || locked.value || saving.value) return;
  if (!structuredView.value?.commitPendingFields()) { confirmingSwitch.value = false; return; }
  saving.value = true;
  confirmingSwitch.value = false;
  errorMsg.value = '';
  try {
    await saveDraft();
    const [kind, id] = target.value.split(':');
    let payload: JobResults | { mapping: import('../api').MappingSummary };
    if (kind === 'generic') {
      payload = await useGenericResult(props.jobId, results.value.version);
    } else if (kind === 'mapping') {
      payload = await applyTemplate(props.jobId, { expected_version: results.value.version, mapping_id: id });
    } else {
      const rawId = options.value?.raw_result_id ?? results.value.raw_result_id;
      if (!rawId) throw new Error('Missing raw result');
      payload = await applyTemplate(props.jobId, {
        expected_version: results.value.version, raw_result_id: rawId, template_id: Number(id),
        ...(forceMapping.value ? { force: true } : {}),
      });
    }
    // 同步切换时更新 draft；202 只展示 pending，当前结果不变。
    if ('mapping' in payload) {
      acceptResults({ ...results.value, pending_mapping: payload.mapping });
    } else {
      draft.value = cloneStructured(payload.structured);
      acceptResults(payload);
    }
    await refreshOptions();
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    if (e instanceof ApiError && e.body.code === 'VERSION_CONFLICT') {
      // 保留未保存草稿；重新打开页面前不以陈旧版本继续切换。
      notify(t('template.versionConflict'));
    }
  } finally { saving.value = false; }
}

async function retryMapping(): Promise<void> {
  await refreshOptions();
  const failedMapping = options.value?.mappings.find((m) => m.id === results.value?.latest_failed_mapping?.id);
  const option = options.value?.templates.find((o) => o.template_id === failedMapping?.template_id)
    ?? options.value?.templates.find((o) => o.recommended);
  if (!option) { await openSelector(); return; }
  target.value = `template:${option.template_id}`;
  // FR-OCR-020：失败后的重试应新建尝试，不能静默复用旧 READY 映射。
  forceMapping.value = true;
  requestSwitch();
}

function chooseGeneric(): void {
  target.value = 'generic';
  forceMapping.value = false;
  requestSwitch();
}

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
  const fieldType = results.value?.template_schema && templateTypeAtPath(results.value.template_schema, path);
  if (fieldType) {
    if (fieldType === 'amount' || fieldType === 'decimal') {
      // 金额/小数使用十进制字符串，避免长整数/多位小数经 Number 丢失精度。
      const decimal = current.trim().replace(/,/g, '');
      if (/^-?\d+(\.\d+)?$/.test(decimal)) setAtPath(draft.value, path, decimal);
    } else if (fieldType === 'integer' && current.trim()) {
      const integer = current.trim().replace(/,/g, '');
      if (/^-?\d+$/.test(integer) && Number.isSafeInteger(Number(integer))) {
        setAtPath(draft.value, path, Number(integer));
      }
    }
    return;
  }
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
  draft.value = cloneStructured(results.value.structured);
}

async function confirm(): Promise<void> {
  if (!results.value || !job.value || busy.value) return;
  errorMsg.value = '';
  // 新增输入必须先进入 draft，所有认证/订阅分支的保存及确认才不会遗漏。
  if (!locked.value && !structuredView.value?.commitPendingFields()) return;
  if (!locked.value && missing.value.length) {
    errorMsg.value = t('template.requiredMissing', { n: missing.value.length });
    await nextTick();
    structuredView.value?.focusMissing(missing.value);
    return;
  }

  saving.value = true;
  try {
    if (!isAuthenticated.value || needsRegistration.value) {
      await saveDraft();
      rememberPendingJob(props.jobId);
      navigate('auth', { jobId: props.jobId });
      return;
    }
    // 订阅到期/未开通即硬停：先存草稿，再按「有在审申请」分流到处理中页或套餐页
    const sub = await fetchSubscription(jobTenantId(job.value));
    if (sub.status !== 'ACTIVE') {
      await saveDraft();
      if (sub.pending) {
        navigate('plan-pending', {
          jobId: props.jobId,
          plan: sub.pending.plan_name ?? '',
          submittedAt: sub.pending.submitted_at ?? '',
        });
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
    if (e instanceof ApiError && e.status === 422) {
      const paths = e.body.field_errors.filter((f) => f.reason === 'required' && f.field)
        .map((f) => f.field!.replace(/^structured\./, ''));
      errorMsg.value = t('template.requiredMissing', { n: paths.length });
      // FR-VERIFY-020：先恢复输入框，再滚动聚焦；busy 期间只有只读单元格。
      saving.value = false;
      await nextTick();
      await structuredView.value?.focusMissing(paths);
    }
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
        <button v-if="options?.enabled || results.current_mapping" class="template-select" :disabled="locked || saving" @click="openSelector">
          <span class="template-caption">{{ t('template.label') }}</span>
          <span>{{ currentLabel }}</span><span v-if="!locked" aria-hidden="true">⌄</span>
        </button>
        <p v-if="options?.enabled && !options.templates.length" class="template-notice">{{ t('template.none') }}</p>
        <p v-if="results.current_mapping?.low_score" class="template-notice">
          {{ t('template.lowScore', { score: Math.round((results.current_mapping.match_score ?? 0) * 100) }) }}
        </p>
        <p v-if="missing.length" class="template-notice">{{ t('template.requiredMissing', { n: missing.length }) }}</p>
        <p v-if="results.validation?.type_warnings.length" class="template-notice">{{ t('template.typeWarnings') }}</p>
        <div v-if="results.latest_failed_mapping && !pending" class="template-notice danger" role="alert">
          {{ t('template.failed') }}
          <div v-if="!locked" class="template-actions">
            <button :disabled="saving" @click="retryMapping">{{ t('common.retry') }}</button>
            <button :disabled="saving" @click="openSelector">{{ t('template.chooseOther') }}</button>
            <button :disabled="saving" @click="chooseGeneric">{{ t('template.useGeneric') }}</button>
          </div>
        </div>
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

        <div class="data-area" :aria-busy="pending">
          <StructuredDataView
            ref="structuredView"
            :data="draft"
            :schema="results.template_schema"
            :type-warnings="results.validation?.type_warnings.map((warning) => warning.path)"
            :editable="!locked && !busy"
            @edit="onEdit"
            @commit="onCommit"
            @add-field="onAddField"
            @remove-field="onRemoveField"
            @add-row="onAddRow"
            @remove-row="onRemoveRow"
          />
          <div v-if="pending" class="mapping-mask" role="status">
            <BrandLoading variant="inline" :label="t('template.applying')" />
            <p v-if="pendingExpired">{{ t('template.timeout') }}</p>
            <div class="template-actions">
              <button v-if="pendingExpired" @click="pendingStarted = Date.now(); pendingExpired = false; pollMapping()">{{ t('common.retry') }}</button>
              <button :disabled="saving" @click="openSelector">{{ t('template.chooseOther') }}</button>
              <button :disabled="saving" @click="chooseGeneric">{{ t('template.useGeneric') }}</button>
            </div>
          </div>
        </div>

        <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      </div>

      <div class="action-bar">
        <p v-if="isGuest" class="guest-hint">{{ t('result.guestHint') }}</p>
        <div class="action-buttons">
          <button v-if="!locked" class="reset-btn" :disabled="!dirty || busy" @click="askReset">
            {{ t('result.reset') }}
          </button>
          <button class="primary-btn" :disabled="busy" @click="confirm">
            <BrandLoading v-if="saving" variant="button" :label="t('result.saving')" />
            <template v-else>{{ t('result.continue') }}</template>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="fatal"><BrandLoading :label="t('common.loading')" /></div>

    <div v-if="toast" class="template-toast" role="status">{{ toast }}</div>
    <FormDialog v-if="selecting" :title="t('template.choose')">
      <div v-for="option in options?.templates" :key="option.template_version_id" class="template-option">
        <label>
          <input v-model="target" type="radio" name="template" :value="option.ready_mapping_id ? `mapping:${option.ready_mapping_id}` : `template:${option.template_id}`" />
          <span>{{ option.name }}
            <small v-if="option.recommended">{{ t('template.recommended') }}</small>
            <small v-if="option.score !== null">{{ Math.round(option.score * 100) }}%</small>
            <small v-if="option.generated">{{ t('template.generated') }}</small>
          </span>
        </label>
        <details @toggle="($event.target as HTMLDetailsElement).open && preview(option.template_version_id)">
          <summary>{{ t('template.preview') }}</summary>
          <p v-if="previewErrors[option.template_version_id]" role="alert">{{ previewErrors[option.template_version_id] }}</p>
          <template v-else-if="previews[option.template_version_id]">
            <div v-for="group in previews[option.template_version_id].groups" :key="group.key" class="template-preview">
              <b>{{ group.name }}</b>
              <div v-for="item in group.items" :key="item.key">
                {{ item.name }}<span v-if="item.kind === 'field' && item.required"> *</span>
                <small v-if="item.kind === 'table'">{{ item.columns.map((c) => c.name + (c.required ? ' *' : '')).join(' · ') }}</small>
              </div>
            </div>
          </template>
          <span v-else>{{ t('common.loading') }}</span>
        </details>
      </div>
      <label v-for="mapping in historicalMappings" :key="mapping.id" class="template-option">
        <input v-model="target" type="radio" name="template" :value="`mapping:${mapping.id}`" />
        {{ mapping.template_name }} (v{{ mapping.template_version }}) · {{ t('template.generated') }}
      </label>
      <label class="template-option"><input v-model="target" type="radio" name="template" value="generic" /> {{ t('template.generic') }}</label>
      <div class="fd-actions">
        <button class="fd-btn secondary" @click="selecting = false">{{ t('common.cancel') }}</button>
        <button class="fd-btn primary" @click="requestSwitch">{{ t('template.apply') }}</button>
      </div>
    </FormDialog>
    <FormDialog v-if="confirmingSwitch" :title="t('template.saveSwitch')" :subtitle="t('template.unsaved')">
      <div class="fd-actions">
        <button class="fd-btn secondary" @click="confirmingSwitch = false">{{ t('common.cancel') }}</button>
        <button class="fd-btn primary" @click="switchResult">{{ t('template.saveSwitch') }}</button>
      </div>
    </FormDialog>

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
.template-select {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card);
  color: var(--text);
  font-size: 12px;
  text-align: left;
  overflow-wrap: anywhere;
}
.template-select:disabled { opacity: .7; }
.template-caption { color: var(--primary); font-weight: 700; flex-shrink: 0; }
.template-notice { margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 11px; line-height: 1.6; background: #fff5db; color: #80601b; }
.template-notice.danger { background: #fdeaea; color: var(--danger); }
.template-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
.template-actions button { color: var(--primary); font-size: 11px; font-weight: 700; }
.data-area { position: relative; }
.mapping-mask { position: absolute; inset: 0; z-index: 2; padding: 24px 12px; background: rgba(245,247,250,.92); border: 1px solid var(--border); border-radius: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; text-align: center; }
.template-option { display: block; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
.template-option label { display: flex; align-items: flex-start; gap: 8px; }
.template-option input { flex-shrink: 0; accent-color: var(--primary); }
.template-option small { display: inline-block; margin: 3px 4px 0 0; color: var(--primary); font-size: 10px; }
.template-option details { margin: 8px 0 0 24px; font-size: 11px; }
.template-option summary { cursor: pointer; color: var(--primary); }
.template-preview { padding: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
.template-preview small { display: block; color: var(--text-secondary); }
.template-toast { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); z-index: 60; width: max-content; max-width: calc(100% - 40px); border-radius: 12px; padding: 12px 18px; background: #29344b; color: white; font-size: 12px; }
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
