<script setup lang="ts">
import type { JobStage } from '../api';
import { useT } from '../i18nVue';

const { t } = useT();

defineProps<{
  stage: JobStage;
}>();
</script>

<template>
  <span class="chip" :class="stage.toLowerCase()">
    {{ t(`job.stage.${stage}`) }}
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.ocr_processing {
  background: var(--processing-bg);
  color: var(--processing);
}

.chip.ocr_failed {
  background: #fdeaea;
  color: var(--danger);
}

.chip.verifying,
.chip.verified {
  background: var(--primary-light);
  color: var(--primary);
}

.chip.completed {
  background: var(--success-bg);
  color: var(--success);
}
</style>
