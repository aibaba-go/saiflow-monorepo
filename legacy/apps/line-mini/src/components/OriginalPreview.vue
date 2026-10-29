<script setup lang="ts">
import { computed, ref } from 'vue';
import { filePagePreviewUrl, filePageUrls } from '../api';
import { useT } from '../i18nVue';
import ImageViewer from './ImageViewer.vue';

const props = defineProps<{
  fileId: string;
  fileName: string;
  pageCount: number;
}>();

const { t } = useT();

const activePage = ref(1);
const viewerOpen = ref(false);

const pageNumbers = computed(() =>
  Array.from({ length: Math.max(props.pageCount || 1, 1) }, (_, index) => index + 1),
);
const pageSources = computed(() => filePageUrls(props.fileId, props.pageCount));
</script>

<template>
  <section class="original-card">
    <div class="original-head">
      <span class="original-title">{{ t('result.original') }}</span>
      <span class="original-hint">{{ t('result.tapZoom') }}</span>
    </div>
    <div v-if="pageNumbers.length > 1" class="pager">
      <button
        v-for="page in pageNumbers"
        :key="page"
        class="page-pill"
        :class="{ active: activePage === page }"
        @click="activePage = page"
      >
        {{ page }}
      </button>
    </div>
    <button class="original-frame" :aria-label="t('result.tapZoom')" @click="viewerOpen = true">
      <img
        class="original"
        :src="filePagePreviewUrl(fileId, activePage)"
        :alt="fileName"
      />
      <span class="zoom-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
        </svg>
      </span>
    </button>
  </section>

  <!-- 全屏查看器：双指捏合缩放、双击放大、拖动平移、多页滑动翻页（FR-VERIFY-014） -->
  <ImageViewer
    v-if="viewerOpen"
    :sources="pageSources"
    :index="activePage - 1"
    :alt="fileName"
    @update:index="activePage = $event + 1"
    @close="viewerOpen = false"
  />
</template>

<style scoped>
.original-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.original-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
}

.original-title {
  font-size: 12px;
  font-weight: 700;
}

.original-hint {
  font-size: 10px;
  color: var(--text-secondary);
}

.pager {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 14px 10px;
}

.page-pill {
  min-width: 30px;
  height: 28px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 10px;
  font-weight: 600;
  color: var(--icon);
}

.page-pill.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.original-frame {
  position: relative;
  display: block;
  width: 100%;
  background: var(--track);
  border-top: 1px solid var(--border);
}

.original {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  background: #fff;
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
</style>
