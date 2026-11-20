<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError, createJob, filePagePreviewUrl, filePageUrls, getFile, type FileInfo } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { navigate } from '../store';
import { newIdempotencyKey } from '../upload';
import BrandLoading from '../components/BrandLoading.vue';
import ImageViewer from '../components/ImageViewer.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useT();

const props = defineProps<{
  fileId: string;
}>();

const file = ref<FileInfo | null>(null);
const errorMsg = ref('');
const starting = ref(false);
const viewerOpen = ref(false);

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
    // 402 PLAN_EXPIRED：订阅已过期，给出明确文案并引导到套餐页（沿用确认前的 plans 分流）
    if (e instanceof ApiError && e.status === 402 && e.body.code === 'PLAN_EXPIRED') {
      errorMsg.value = messageText(e.messageKey);
      starting.value = false;
      navigate('plans');
      return;
    }
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
