<script setup lang="ts">
import { computed, ref } from 'vue';
import { updateProfile } from '../api';
import { useT } from '../i18nVue';
import { apiErrorText } from '../profile';
import { user } from '../store';
import AvatarPicker from './AvatarPicker.vue';
import BrandLoading from './BrandLoading.vue';
import FormDialog from './FormDialog.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useT();

const nickname = ref(user.value?.display_name ?? '');
const avatar = ref(user.value?.avatar_url ?? '');
const saving = ref(false);
const errorMsg = ref('');

const nicknameError = computed(() => (nickname.value.trim() ? '' : t('profile.nicknameRequired')));

async function save() {
  errorMsg.value = '';
  if (nicknameError.value || saving.value) return;
  const patch: { display_name?: string; avatar_url?: string } = {};
  if (nickname.value.trim() !== user.value?.display_name) patch.display_name = nickname.value.trim();
  if (avatar.value !== user.value?.avatar_url) patch.avatar_url = avatar.value;
  if (!Object.keys(patch).length) {
    emit('close');
    return;
  }
  saving.value = true;
  try {
    user.value = await updateProfile(patch);
    emit('close');
  } catch (e) {
    errorMsg.value = apiErrorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FormDialog :title="t('profile.editTitle')">
    <AvatarPicker v-model="avatar" :disabled="saving" @error="errorMsg = $event" />
    <div class="fd-field">
      <label class="fd-label" for="ep-name">{{ t('profile.nickname') }}<span class="fd-required">*</span></label>
      <input
        id="ep-name"
        v-model="nickname"
        class="fd-input"
        :class="{ invalid: nicknameError }"
        maxlength="128"
        autocomplete="nickname"
        @keyup.enter="save"
      />
      <span v-if="nicknameError" class="fd-hint danger">{{ nicknameError }}</span>
    </div>
    <p v-if="errorMsg" class="fd-error">{{ errorMsg }}</p>
    <div class="fd-actions">
      <button class="fd-btn secondary" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="fd-btn primary" :disabled="saving || !!nicknameError" @click="save">
        <BrandLoading v-if="saving" variant="button" :label="t('profile.saving')" />
        <template v-else>{{ t('profile.save') }}</template>
      </button>
    </div>
  </FormDialog>
</template>
