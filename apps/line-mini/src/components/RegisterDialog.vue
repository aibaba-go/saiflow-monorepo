<script setup lang="ts">
import { computed, ref } from 'vue';
import { completeRegistration } from '../api';
import { useT } from '../i18nVue';
import { apiErrorText, isValidEmail, isValidPhone, useEmailCode } from '../profile';
import { user } from '../store';
import AvatarPicker from './AvatarPicker.vue';
import BrandLoading from './BrandLoading.vue';
import FormDialog from './FormDialog.vue';

const emit = defineEmits<{
  (e: 'done'): void;
  (e: 'cancel'): void;
}>();

const { t } = useT();

const lineEmail = user.value?.email ?? '';
const linePhone = user.value?.phone ?? '';
const phone = ref(linePhone);
const email = ref(lineEmail);
const code = ref('');
const nickname = ref(user.value?.display_name ?? '');
const avatar = ref(user.value?.avatar_url ?? '');
const { sentTo, cooldown, sending, send: sendCode } = useEmailCode();
const submitting = ref(false);
const errorMsg = ref('');
const touched = ref(false);

const trimmedEmail = computed(() => email.value.trim());
const phoneError = computed(() => isValidPhone(phone.value.trim()) ? '' : t('err.error.phone_invalid'));
const emailError = computed(() => {
  if (!trimmedEmail.value) return t('profile.emailRequired');
  return isValidEmail(trimmedEmail.value) ? '' : t('err.error.email_invalid');
});
const codeError = computed(() => {
  if (sentTo.value !== trimmedEmail.value) return t('profile.codeSendFirst');
  if (!code.value.trim()) return t('profile.codeRequired');
  return /^[0-9]{6}$/.test(code.value.trim()) ? '' : t('err.error.email_code_invalid');
});
const nicknameError = computed(() => (nickname.value.trim() ? '' : t('profile.nicknameRequired')));
const canSend = computed(() => !emailError.value && cooldown.value === 0 && !sending.value && !submitting.value);

const emailHint = computed(() => {
  if (sentTo.value && sentTo.value === trimmedEmail.value) return t('profile.codeSent', { email: sentTo.value });
  if (sentTo.value) return t('profile.codeResendNeeded');
  return lineEmail ? t('register.fromLineEditable') : t('register.emailMissing');
});

async function send() {
  if (!canSend.value) return;
  errorMsg.value = '';
  try {
    await sendCode(trimmedEmail.value);
  } catch (e) {
    errorMsg.value = apiErrorText(e);
  }
}

async function submit() {
  touched.value = true;
  errorMsg.value = '';
  if (phoneError.value || emailError.value || codeError.value || nicknameError.value || submitting.value) return;
  submitting.value = true;
  try {
    user.value = await completeRegistration({
      display_name: nickname.value.trim(),
      avatar_url: avatar.value,
      phone: phone.value.trim(),
      email: trimmedEmail.value,
      code: code.value.trim(),
    });
    emit('done');
  } catch (e) {
    errorMsg.value = apiErrorText(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <FormDialog :title="t('register.title')" :subtitle="t('register.subtitle')">
    <AvatarPicker v-model="avatar" :disabled="submitting" @error="errorMsg = $event" />

    <div class="fd-field">
      <label class="fd-label" for="reg-phone">{{ t('profile.phone') }}</label>
      <input
        id="reg-phone"
        v-model="phone"
        class="fd-input"
        :class="{ invalid: touched && phoneError }"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        maxlength="32"
        :disabled="submitting"
        :placeholder="t('profile.phonePlaceholder')"
      />
      <span v-if="touched && phoneError" class="fd-hint danger">{{ phoneError }}</span>
      <span v-else class="fd-hint">{{ linePhone ? t('register.fromLineEditable') : t('register.phoneMissing') }}</span>
    </div>

    <div class="fd-field">
      <label class="fd-label" for="reg-email">{{ t('profile.email') }}<span class="fd-required">*</span></label>
      <div class="fd-inline">
        <input
          id="reg-email"
          v-model="email"
          class="fd-input"
          :class="{ invalid: touched && emailError }"
          type="email"
          inputmode="email"
          autocomplete="email"
          maxlength="254"
          :disabled="submitting"
          :placeholder="t('profile.emailPlaceholder')"
        />
        <button class="fd-mini-btn" :disabled="!canSend" @click="send">
          <BrandLoading v-if="sending" variant="button" :label="t('profile.sendCode')" />
          <template v-else>{{ cooldown > 0 ? t('profile.resendIn', { n: cooldown }) : sentTo ? t('profile.resendCode') : t('profile.sendCode') }}</template>
        </button>
      </div>
      <span v-if="touched && emailError" class="fd-hint danger">{{ emailError }}</span>
      <span v-else class="fd-hint">{{ emailHint }}</span>
    </div>

    <div class="fd-field">
      <label class="fd-label" for="reg-code">{{ t('profile.code') }}<span class="fd-required">*</span></label>
      <input
        id="reg-code"
        v-model="code"
        class="fd-input"
        :class="{ invalid: touched && !emailError && codeError }"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        :disabled="submitting"
        :placeholder="t('profile.codePlaceholder')"
      />
      <span v-if="touched && !emailError && codeError" class="fd-hint danger">{{ codeError }}</span>
    </div>

    <div class="fd-field">
      <label class="fd-label" for="reg-name">{{ t('profile.nickname') }}<span class="fd-required">*</span></label>
      <input
        id="reg-name"
        v-model="nickname"
        class="fd-input"
        :class="{ invalid: touched && nicknameError }"
        maxlength="128"
        autocomplete="nickname"
        :disabled="submitting"
      />
      <span v-if="touched && nicknameError" class="fd-hint danger">{{ nicknameError }}</span>
      <span v-else class="fd-hint">{{ t('register.fromLineEditable') }}</span>
    </div>

    <p v-if="errorMsg" class="fd-error">{{ errorMsg }}</p>

    <div class="fd-actions">
      <button class="fd-btn secondary" :disabled="submitting" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="fd-btn primary" :disabled="submitting" @click="submit">
        <BrandLoading v-if="submitting" variant="button" :label="t('register.submitting')" />
        <template v-else>{{ t('register.submit') }}</template>
      </button>
    </div>
  </FormDialog>
</template>
