<script setup lang="ts">
/**
 * 修改手机号（FR-SYS-015）：PATCH /me { phone }。
 * - 空串即清空手机号（后端允许）；
 * - 本地沿用注册页的 isValidPhone 做前置校验，后端字段级错误
 *   （error.phone_invalid）同样渲染在输入框下方，不做全局报错。
 */
import { computed, ref } from 'vue';
import { updateProfile } from '../api';
import { useT } from '../i18nVue';
import { apiErrorText, isValidPhone } from '../profile';
import { user } from '../store';
import BrandLoading from './BrandLoading.vue';
import FormDialog from './FormDialog.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useT();

const phone = ref(user.value?.phone ?? '');
const saving = ref(false);
/** 字段级错误：只显示在手机号输入框下面 */
const fieldError = ref('');

const trimmed = computed(() => phone.value.trim());
const localError = computed(() => (isValidPhone(trimmed.value) ? '' : t('err.error.phone_invalid')));
const shownError = computed(() => localError.value || fieldError.value);
const canSubmit = computed(
  () => !saving.value && !localError.value && trimmed.value !== (user.value?.phone ?? ''),
);

async function submit() {
  if (!canSubmit.value) return;
  fieldError.value = '';
  saving.value = true;
  try {
    user.value = await updateProfile({ phone: trimmed.value });
    emit('close');
  } catch (e) {
    // 400 带 field_errors[0] = {field:'phone', message_key:'error.phone_invalid'}；403 为游客禁止修改
    fieldError.value = apiErrorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FormDialog :title="t('profile.changePhoneTitle')">
    <div class="fd-field">
      <label class="fd-label" for="cp-phone">{{ t('profile.newPhone') }}</label>
      <input
        id="cp-phone"
        v-model="phone"
        class="fd-input"
        :class="{ invalid: shownError }"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        maxlength="32"
        :placeholder="t('profile.phonePlaceholder')"
        @input="fieldError = ''"
        @keyup.enter="submit"
      />
      <span v-if="shownError" class="fd-hint danger" role="alert">{{ shownError }}</span>
      <span v-else class="fd-hint">{{ t('profile.phoneClearHint') }}</span>
    </div>

    <div class="fd-actions">
      <button class="fd-btn secondary" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="fd-btn primary" :disabled="!canSubmit" @click="submit">
        <BrandLoading v-if="saving" variant="button" :label="t('profile.saving')" />
        <template v-else>{{ t('profile.save') }}</template>
      </button>
    </div>
  </FormDialog>
</template>
