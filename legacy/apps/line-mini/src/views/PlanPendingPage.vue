<script setup lang="ts">
import { computed } from 'vue';
import { useT } from '../i18nVue';
import { goTab } from '../store';
import PageHeader from '../components/PageHeader.vue';

const { t } = useT();

const props = withDefaults(
  defineProps<{
    planName?: string;
    submittedAt?: string;
  }>(),
  { planName: '', submittedAt: '' },
);

const submittedLabel = computed(() => {
  if (!props.submittedAt) return '';
  const d = new Date(props.submittedAt.endsWith('Z') ? props.submittedAt : `${props.submittedAt}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
});
</script>

<template>
  <div class="pending">
    <PageHeader :title="t('planPending.title')" @back="goTab('scan')" />

    <div class="body">
      <div class="card">
        <div class="icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#D98F1F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h2>{{ t('planPending.heading') }}</h2>
        <p class="desc">{{ t('planPending.body') }}</p>

        <dl v-if="planName || submittedLabel" class="meta">
          <template v-if="planName">
            <dt>{{ t('planPending.plan') }}</dt>
            <dd>{{ planName }}</dd>
          </template>
          <template v-if="submittedLabel">
            <dt>{{ t('planPending.submittedAt') }}</dt>
            <dd>{{ submittedLabel }}</dd>
          </template>
        </dl>
      </div>

      <button class="home-btn" @click="goTab('scan')">{{ t('planPending.home') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pending {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.body {
  padding: 8px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 26px 18px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

.icon {
  width: 52px;
  height: 52px;
  border-radius: 999px;
  background: var(--processing-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

h2 {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 700;
}

.desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.meta {
  width: 100%;
  margin: 10px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  font-size: 12px;
  text-align: left;
}

.meta dt {
  color: var(--text-secondary);
}

.meta dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}

.home-btn {
  width: 100%;
  height: 52px;
  border-radius: 14px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
</style>
