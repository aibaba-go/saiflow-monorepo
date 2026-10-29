<script setup lang="ts">
import { computed, ref } from 'vue';
import { changeEmail } from '../api';
import { useT } from '../i18nVue';
import { apiErrorText, isValidEmail, useEmailCode } from '../profile';
import { user } from '../store';
import BrandLoading from './BrandLoading.vue';
import FormDialog from './FormDialog.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useT();

const newEmail = ref('');
const code = ref('');
const { sentTo, cooldown, sending, send: sendCode } = useEmailCode();
const saving = ref(false);
const errorMsg = ref('');

const trimmed = computed(() => newEmail.value.trim());
const emailError = computed(() => {
  if (!trimmed.value) return '';
  if (!isValidEmail(trimmed.value)) return t('err.error.email_invalid');
  if (trimmed.value.toLowerCase() === (user.value?.email ?? '').toLowerCase()) return t('err.error.email_unchanged');
  return '';
});
const canSend = computed(() => !!trimmed.value && !emailError.value && cooldown.value === 0 && !sending.value);
const canSubmit = computed(
  () => sentTo.value === trimmed.value && !!code.value.trim() && !emailError.value && !saving.value,
);

async function send() {
  if (!canSend.value) return;
  errorMsg.value = '';
  try {
    await sendCode(trimmed.value);
  } catch (e) {
    errorMsg.value = apiErrorText(e);
  }
}

async function submit() {
  if (!canSubmit.value) return;
  errorMsg.value = '';
  saving.value = true;
  try {
    user.value = await changeEmail(trimmed.value, code.value.trim());
    emit('close');
  } catch (e) {
    errorMsg.value = apiErrorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FormDialog :title="t('profile.changeEmailTitle')">
    <div class="fd-field">
      <span class="fd-label">{{ t('profile.currentEmail') }}</span>
      <input class="fd-input" :value="user?.email || t('profile.emailNotSet')" readonly />
    </div>

    <div class="fd-field">
      <label class="fd-label" for="ce-email">{{ t('profile.newEmail') }}<span class="fd-required">*</span></label>
      <div class="fd-inline">
        <input
          id="ce-email"
          v-model="newEmail"
          class="fd-input"
          :class="{ invalid: emailError }"
          type="email"
          inputmode="email"
          autocomplete="email"
          maxlength="254"
          :placeholder="t('profile.emailPlaceholder')"
        />
        <button class="fd-mini-btn" :disabled="!canSend" @click="send">
          <BrandLoading v-if="sending" variant="button" :label="t('profile.sendCode')" />
          <template v-else>{{ cooldown > 0 ? t('profile.resendIn', { n: cooldown }) : sentTo ? t('profile.resendCode') : t('profile.sendCode') }}</template>
        </button>
      </div>
      <span v-if="emailError" class="fd-hint danger">{{ emailError }}</span>
      <span v-else-if="sentTo && sentTo === trimmed" class="fd-hint">{{ t('profile.codeSent', { email: sentTo }) }}</span>
      <span v-else-if="sentTo" class="fd-hint">{{ t('profile.codeResendNeeded') }}</span>
    </div>

    <div class="fd-field">
      <label class="fd-label" for="ce-code">{{ t('profile.code') }}<span class="fd-required">*</span></label>
      <input
        id="ce-code"
        v-model="code"
        class="fd-input"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        :placeholder="t('profile.codePlaceholder')"
        @keyup.enter="submit"
      />
    </div>

    <p v-if="errorMsg" class="fd-error">{{ errorMsg }}</p>
    <div class="fd-actions">
      <button class="fd-btn secondary" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="fd-btn primary" :disabled="!canSubmit" @click="submit">
        <BrandLoading v-if="saving" variant="button" :label="t('profile.saving')" />
        <template v-else>{{ t('profile.confirmChange') }}</template>
      </button>
    </div>
  </FormDialog>
</template>
