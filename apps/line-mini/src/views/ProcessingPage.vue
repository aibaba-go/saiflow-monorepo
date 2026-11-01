<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError, cancelJob, getFile, getJob, type JobSummary } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { goTab, navigate } from '../store';
import BrandLoading from '../components/BrandLoading.vue';
import FormDialog from '../components/FormDialog.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useT();

const props = defineProps<{
  jobId: string;
}>();

const job = ref<JobSummary | null>(null);
const filePageCount = ref<number | null>(null);
const errorMsg = ref('');
const cancelling = ref(false);
const confirmingCancel = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let active = true;
let mappingStarted = 0;

const RUNNING = ['QUEUED', 'PREPROCESSING', 'PROCESSING', 'POSTPROCESSING', 'CANCEL_REQUESTED'];
const MAPPING_WAIT_MS = 90000;

// 三步流程：上传 → OCR 处理（排队/预处理/识别/后处理均归入此步）→ 模板匹配（job.stage=TEMPLATE_MATCHING）
const matching = computed(() => job.value?.stage === 'TEMPLATE_MATCHING');
const ocrFailed = computed(() => ['FAILED', 'CANCELLED'].includes(job.value?.status ?? ''));
const steps = computed(() => {
  const status = job.value?.status ?? 'QUEUED';
  const ocrRunning = RUNNING.includes(status);
  const ocrDone = ['SUCCEEDED', 'PARTIAL_SUCCESS'].includes(status);
  return [
    { key: 'UPLOAD', done: true, active: false, failed: false },
    { key: 'OCR', done: ocrDone, active: ocrRunning, failed: ocrFailed.value },
    { key: 'TEMPLATE_MATCHING', done: ocrDone && !matching.value, active: matching.value, failed: false },
  ];
});

async function poll() {
  try {
    const payload = await getJob(props.jobId);
    if (!active) return;
    job.value = payload;
    errorMsg.value = '';
    // worker 跑完才写 job.page_count；排队中回退显示文件页数，避免 "All 0 pages"
    if (job.value.page_count == null && filePageCount.value == null) {
      getFile(job.value.file_id)
        .then((r) => (filePageCount.value = r.file.page_count))
        .catch(() => (filePageCount.value = 0));
    }
    if (RUNNING.includes(job.value.status)) {
      timer = setTimeout(poll, 2000);
    } else if (['SUCCEEDED', 'PARTIAL_SUCCESS'].includes(job.value.status)) {
      // OCR 成功后若有进行中的模板映射，停在「模板匹配」步继续轮询，最多等 90 秒
      if (!mappingStarted) mappingStarted = Date.now();
      if (matching.value && Date.now() - mappingStarted < MAPPING_WAIT_MS) timer = setTimeout(poll, 2000);
      else navigate('result', { jobId: props.jobId });
    }
  } catch (e) {
    if (!active) return;
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    if (mappingStarted && Date.now() - mappingStarted >= MAPPING_WAIT_MS) navigate('result', { jobId: props.jobId });
    else if (!(e instanceof ApiError && [401, 404].includes(e.status))) timer = setTimeout(poll, 2000);
  }
}

onMounted(poll);

onBeforeUnmount(() => {
  active = false;
  if (timer) clearTimeout(timer);
});

async function cancel() {
  if (cancelling.value || !job.value) return;
  cancelling.value = true;
  errorMsg.value = '';
  try {
    job.value = await cancelJob(props.jobId);
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  } finally {
    cancelling.value = false;
    confirmingCancel.value = false;
  }
}
</script>

<template>
  <div class="processing">
    <PageHeader :title="t('processing.title')" @back="goTab('scan')" />

    <div class="content">
      <div class="status-card" v-if="job">
        <BrandLoading v-if="RUNNING.includes(job.status) || matching" :label="matching ? t('template.matching') : t('processing.recognizing')" />
        <template v-else>
          <div class="done-mark" :class="{ failed: ocrFailed }" />
          <div class="status-title">{{ ocrFailed ? t('job.stage.OCR_FAILED') : t('processing.recognizing') }}</div>
        </template>
        <div class="status-sub">{{ job.file_name }} · {{ t('processing.pagesAll', { n: job.page_count ?? filePageCount ?? 0 }) }}</div>

        <div class="steps">
          <div v-for="(step, i) in steps" :key="step.key" class="step">
            <div
              class="step-dot"
              :class="{ done: step.done, active: step.active, failed: step.failed }"
            >
              <svg v-if="step.done" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <svg v-else-if="step.failed" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              <span v-else-if="step.active" class="step-pulse" />
            </div>
            <span class="step-label" :class="{ on: step.done || step.active, failed: step.failed }">{{ t(`processing.step.${step.key}`) }}</span>
            <div v-if="i < steps.length - 1" class="step-line" :class="{ done: steps[i + 1].done || steps[i + 1].active }" />
          </div>
        </div>
      </div>

      <div v-else-if="errorMsg" class="info-box error">{{ errorMsg }}</div>
      <div v-else class="status-card"><BrandLoading :label="t('common.loading')" /></div>

      <div class="info-box">{{ t('processing.info') }}</div>

      <p v-if="errorMsg && job" class="status-error">{{ errorMsg }}</p>

      <button class="home-btn" @click="goTab('scan')">{{ t('processing.backHome') }}</button>
      <button
        v-if="job && RUNNING.includes(job.status)"
        class="cancel-btn"
        :disabled="cancelling"
        @click="confirmingCancel = true"
      >
        {{ t('processing.cancelTask') }}
      </button>
      <button v-else-if="job && !matching" class="cancel-btn" @click="navigate('result', { jobId: job.id })">
        {{ t('common.done') }}
      </button>
    </div>

    <FormDialog
      v-if="confirmingCancel && job && RUNNING.includes(job.status)"
      :title="t('processing.cancelConfirm')"
      :subtitle="t('processing.cancelConfirmBody')"
    >
      <div class="fd-actions">
        <button class="fd-btn secondary" :disabled="cancelling" @click="confirmingCancel = false">
          {{ t('processing.keepRunning') }}
        </button>
        <button class="fd-btn danger" :disabled="cancelling" @click="cancel">
          <BrandLoading v-if="cancelling" variant="button" :label="t('processing.cancelTask')" />
          <template v-else>{{ t('processing.cancelTask') }}</template>
        </button>
      </div>
    </FormDialog>
  </div>
</template>

<style scoped>
.processing {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.content {
  padding: 12px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.status-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 26px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.done-mark {
  width: 32px;
  height: 32px;
  border: 3.5px solid var(--success);
  border-radius: 50%;
}

.done-mark.failed {
  border-color: var(--danger);
}

.status-title {
  font-size: 14px;
  font-weight: 700;
  margin-top: 6px;
}

.status-sub {
  font-size: 11px;
  color: var(--text-secondary);
}

.steps {
  display: flex;
  align-items: flex-start;
  margin-top: 20px;
  width: 100%;
  justify-content: center;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  width: 96px;
}

.step-dot {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--track);
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-dot.done {
  background: var(--primary);
}

.step-dot.active {
  background: var(--primary-light);
}

.step-dot.failed {
  background: var(--danger);
}

.step-pulse {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--primary);
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    transform: scale(0.7);
    opacity: 0.6;
  }
}

.step-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-align: center;
}

.step-label.on {
  color: var(--primary);
  font-weight: 600;
}

.step-label.failed {
  color: var(--danger);
  font-weight: 600;
}

.step-line {
  position: absolute;
  top: 13px;
  left: calc(50% + 15px);
  width: calc(100% - 30px);
  height: 2px;
  background: var(--track);
  border-radius: 2px;
}

.step-line.done {
  background: var(--primary);
}

.info-box {
  background: var(--primary-light);
  border-radius: 12px;
  padding: 13px 16px;
  font-size: 11px;
  color: var(--icon);
  line-height: 1.6;
}

.info-box.error {
  background: #fdeaea;
  color: var(--danger);
}

.status-error {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}

.home-btn {
  height: 48px;
  border-radius: 14px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

.cancel-btn {
  height: 40px;
  font-size: 13px;
  font-weight: 600;
  color: var(--danger);
}

.cancel-btn:disabled {
  opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
  .step-pulse { animation: none; }
}
</style>
