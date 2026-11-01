<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  ApiError,
  createExport,
  exportDownloadUrl,
  getJob,
  getJobResults,
  type JobResults,
  type JobSummary,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { clearPendingJob, goTab } from '../store';
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
const errorMsg = ref('');
const exporting = ref(false);
const exportReady = ref(false);

async function load() {
  try {
    const [resultPayload, jobPayload] = await Promise.all([
      getJobResults(props.jobId),
      getJob(props.jobId),
    ]);
    results.value = resultPayload;
    job.value = jobPayload;
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  }
}

onMounted(() => {
  clearPendingJob();
  load();
});

async function exportExcel() {
  if (exporting.value) return;
  errorMsg.value = '';
  exportReady.value = false;
  exporting.value = true;
  try {
    const info = await createExport(props.jobId, 'XLSX');
    const link = document.createElement('a');
    link.href = exportDownloadUrl(info.id);
    link.rel = 'noopener';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    exportReady.value = true;
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('export.failed');
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="final">
    <PageHeader :title="job?.file_name || t('final.title')" @back="goTab('history')" />

    <div v-if="errorMsg && !results" class="fatal">
      <p class="status-error">{{ errorMsg }}</p>
      <button class="home-btn" @click="goTab('history')">{{ t('common.back') }}</button>
    </div>

    <template v-else-if="results">
      <div class="summary">
        <div class="chips">
          <StatusChip v-if="job" :stage="job.stage" />
        </div>
        <div class="title">{{ t('final.title') }}</div>
        <div class="meta">
          {{ t('result.meta', { pages: job?.page_count ?? results.page_count, tables: results.table_count }) }}
        </div>
      </div>

      <div class="content">
        <OriginalPreview
          v-if="job"
          :file-id="job.file_id"
          :file-name="job.file_name"
          :page-count="job.page_count || results.page_count || 1"
        />

        <div v-if="results.current_mapping" class="meta">{{ t('template.label') }}: {{ results.current_mapping.template_name }}</div>
        <StructuredDataView :data="results.structured" :schema="results.template_schema" />

        <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
        <p v-if="exportReady" class="export-ready">{{ t('final.exportReady') }}</p>
      </div>

      <div class="action-bar">
        <button class="primary-btn" :disabled="exporting" @click="exportExcel">
          <BrandLoading v-if="exporting" variant="button" :label="t('final.exporting')" />
          <template v-else>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12" />
              <path d="M7 10l5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
            {{ t('final.exportExcel') }}
          </template>
        </button>
        <button class="secondary-btn" @click="goTab('scan')">{{ t('final.newScan') }}</button>
      </div>
    </template>

    <div v-else class="fatal"><BrandLoading :label="t('common.loading')" /></div>
  </div>
</template>

<style scoped>
.final {
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

.summary {
  padding: 2px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-size: 17px;
  font-weight: 800;
}

.meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.content {
  flex: 1;
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.export-ready {
  margin: 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--success);
  font-weight: 600;
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

.primary-btn {
  height: 53px;
  border-radius: 14px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.primary-btn:disabled {
  opacity: 0.6;
}

.secondary-btn {
  height: 40px;
  font-size: 12px;
  font-weight: 600;
  color: var(--icon);
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
