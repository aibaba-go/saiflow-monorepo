<script setup lang="ts">
import { ref } from 'vue';
import { useT } from '../i18nVue';
import { resizeAvatar } from '../profile';
import BrandLoading from './BrandLoading.vue';

defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'error', msg: string): void;
}>();

const { t } = useT();
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);

async function onPick(ev: Event) {
  const el = ev.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = '';
  if (!file) return;
  busy.value = true;
  try {
    emit('update:modelValue', await resizeAvatar(file));
  } catch (e) {
    emit('error', e instanceof Error ? e.message : t('profile.avatarInvalid'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="ap"
    :disabled="disabled || busy"
    :aria-label="t('profile.changeAvatar')"
    @click="input?.click()"
  >
    <img v-if="modelValue" :src="modelValue" alt="" />
    <svg v-else width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#596170" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
    <span class="ap-badge" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    </span>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onPick" />
  </button>
  <div class="ap-hint">
    <BrandLoading v-if="busy" variant="inline" :label="t('common.loading')" />
    <template v-else>{{ t('profile.changeAvatar') }}</template>
  </div>
</template>

<style scoped>
.ap {
  position: relative;
  align-self: center;
  width: 76px;
  height: 76px;
  border-radius: 999px;
  background: var(--track);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ap img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
}

.ap-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--primary);
  border: 2px solid var(--card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ap-hint {
  margin-top: -6px;
  font-size: 10px;
  color: var(--primary);
  font-weight: 600;
  text-align: center;
}
</style>
