<script setup lang="ts">
import { computed, ref } from 'vue';
import { filePagePreviewUrl } from '../api';
import { useT } from '../i18nVue';

const props = defineProps<{
  fileId: string;
  fileName: string;
  pageCount: number;
}>();

const { t } = useT();

const activePage = ref(1);
const zoomOpen = ref(false);
const zoomedIn = ref(false);

const pageNumbers = computed(() =>
  Array.from({ length: Math.max(props.pageCount || 1, 1) }, (_, index) => index + 1),
);

function openZoom(): void {
  zoomedIn.value = false;
  zoomOpen.value = true;
}
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
    <button class="original-frame" @click="openZoom">
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

  <Teleport to="body">
    <div v-if="zoomOpen" class="zoom-backdrop" @click.self="zoomOpen = false">
      <button class="zoom-close" :aria-label="t('common.close')" @click="zoomOpen = false">×</button>
      <img
        class="zoom-image"
        :class="{ zoomed: zoomedIn }"
        :src="filePagePreviewUrl(fileId, activePage)"
        :alt="fileName"
        @click="zoomedIn = !zoomedIn"
      />
      <div class="zoom-tip">{{ zoomedIn ? t('result.tapToShrink') : t('result.tapToEnlarge') }}</div>
    </div>
  </Teleport>
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

.zoom-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(10, 12, 16, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
}

.zoom-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 24px;
  line-height: 1;
}

.zoom-image {
  max-width: 100%;
  max-height: 88dvh;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
  transition: transform 0.18s ease;
  cursor: zoom-in;
}

.zoom-image.zoomed {
  max-width: none;
  max-height: none;
  width: 180%;
  cursor: zoom-out;
}

.zoom-tip {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
}
</style>
