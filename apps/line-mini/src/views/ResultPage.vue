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
import { normalizeStructuredForView, setAtPath, type Path } from '../structured';
import BrandLoading from '../components/BrandLoading.vue';
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

const locked = computed(() => results.value?.review_status === 'CONFIRMED');
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
    draft.value = cloneStructured(normalizeStructuredForView(results.value.structured));
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

async function saveDraft(): Promise<void> {
  if (!results.value || locked.value || JSON.stringify(draft.value) === JSON.stringify(results.value.structured)) return;
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
        />

        <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      </div>

      <div class="action-bar">
        <p v-if="isGuest" class="guest-hint">{{ t('result.guestHint') }}</p>
        <button class="primary-btn" :disabled="saving" @click="confirm">
          <BrandLoading v-if="saving" variant="button" :label="t('result.saving')" />
          <template v-else>{{ t('result.continue') }}</template>
        </button>
      </div>
    </template>

    <div v-else class="fatal"><BrandLoading :label="t('common.loading')" /></div>
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
