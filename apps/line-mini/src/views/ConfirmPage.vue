<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError, createJob, filePagePreviewUrl, getFile, type FileInfo } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { navigate } from '../store';
import { newIdempotencyKey } from '../upload';
import BrandLoading from '../components/BrandLoading.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useT();

const props = defineProps<{
  fileId: string;
}>();

const file = ref<FileInfo | null>(null);
const errorMsg = ref('');
const starting = ref(false);

onMounted(async () => {
  try {
    const { file: f } = await getFile(props.fileId);
    file.value = f;
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  }
});

async function start() {
  if (starting.value) return;
  starting.value = true;
  errorMsg.value = '';
  try {
    const job = await createJob({
      file_id: props.fileId,
      params: { parse_mode: 'scan', table: true, formula: false, rotate: true },
      idempotency_key: newIdempotencyKey(),
    });
    navigate('processing', { jobId: job.id });
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    starting.value = false;
  }
}
</script>

<template>
  <div class="confirm">
    <PageHeader :title="t('confirm.title')" @back="navigate('scan')" />

    <div class="content">
      <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      <template v-else-if="file">
        <div class="preview-wrap">
          <!-- 图片返回本体，PDF 由服务端渲染成 PNG，统一走页预览接口 -->
          <img class="preview" :src="filePagePreviewUrl(file.id, 1)" :alt="file.original_name" />
          <div class="page-badge">{{ t('confirm.pageOf', { n: 1, total: file.page_count || 1 }) }}</div>
        </div>

        <div class="file-summary">
          <div class="file-name">{{ file.original_name }}</div>
          <div class="file-meta">{{ t('result.meta', { pages: file.page_count, tables: 0 }) }}</div>
        </div>

        <button class="primary-btn" :disabled="starting || !file" @click="start">
          <BrandLoading v-if="starting" variant="button" :label="t('common.loading')" />
          <template v-else>{{ t('confirm.start') }}</template>
        </button>
      </template>
      <BrandLoading v-else variant="page" :label="t('common.loading')" />
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

.preview-wrap {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: var(--track);
  border: 1px solid var(--border);
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
}

.file-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
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
  color: var(--text-secondary);
}

.status-error {
  color: var(--danger);
}
</style>
