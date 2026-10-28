<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError, getMyCompanies, type Tenant } from '../api';
import BrandLoading from '../components/BrandLoading.vue';
import ChangeEmailDialog from '../components/ChangeEmailDialog.vue';
import ChangePhoneDialog from '../components/ChangePhoneDialog.vue';
import EditProfileDialog from '../components/EditProfileDialog.vue';
import FormDialog from '../components/FormDialog.vue';
import { getLocale, messageText, setLocale, type Locale } from '../i18n';
import { useT } from '../i18nVue';
import { currentTenantId, isGuest, navigate, setTenant, signOutAccount, tenants, user } from '../store';

const { t, locale } = useT();

const loggingOut = ref(false);
const confirmingLogout = ref(false);
const logoutError = ref('');
const guest = isGuest;
const editingProfile = ref(false);
const changingEmail = ref(false);
const changingPhone = ref(false);

const enterpriseList = computed(() => tenants.value.filter((x) => x.tenant_type === 'ENTERPRISE'));
const personalTenant = computed(
  () => tenants.value.find((x) => x.tenant_type === 'PERSONAL') ?? null,
);

const pendingCount = ref(0);

onMounted(async () => {
  if (guest.value) return;
  try {
    const data = await getMyCompanies();
    pendingCount.value = data.items.filter(
      (c) => c.status === 'PENDING_VERIFICATION' && c.membership_status === 'ACTIVE',
    ).length;
  } catch {
    /* 公司列表失败不阻塞本页 */
  }
});

function isCurrentTenant(tenant: Tenant): boolean {
  return currentTenantId.value === tenant.tenant_id;
}

function switchTenant(tenant: Tenant) {
  setTenant(tenant);
}

function switchLanguage(l: Locale) {
  setLocale(l);
}

function startAuth(): void {
  navigate('auth', { from: 'my' });
}

async function doLogout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  logoutError.value = '';
  try {
    await signOutAccount(getLocale());
    confirmingLogout.value = false;
  } catch (error) {
    logoutError.value = error instanceof ApiError ? messageText(error.messageKey) : t('common.unknownError');
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div class="my">
    <header class="my-header">
      <h1>{{ t('my.title') }}</h1>
    </header>

    <div class="content">
      <!-- 资料卡：已登录可点击修改昵称/头像 -->
      <component
        :is="guest ? 'div' : 'button'"
        class="profile-card"
        :class="{ editable: !guest }"
        @click="!guest && (editingProfile = true)"
      >
        <div class="avatar">
          <img v-if="user?.avatar_url" :src="user.avatar_url" :alt="user?.display_name" />
          <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#596170" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
          </svg>
        </div>
        <div class="profile-main">
          <div class="profile-name">{{ guest ? t('my.guest') : user?.display_name || '—' }}</div>
          <div v-if="guest" class="guest-hint">{{ t('my.guestHint') }}</div>
          <div v-else class="line-connected">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1F9E6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {{ t('my.lineConnected') }}
          </div>
        </div>
        <span v-if="!guest" class="profile-edit">
          {{ t('profile.edit') }}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      </component>

      <!-- 账号信息：手机号可修改（空串即清空）；邮箱凭验证码更换 -->
      <div v-if="!guest" class="account-card">
        <div class="account-row">
          <span class="row-label">{{ t('profile.phone') }}</span>
          <span class="account-value" :class="{ muted: !user?.phone }">{{ user?.phone || t('profile.phoneNotSet') }}</span>
          <button class="account-action" @click="changingPhone = true">{{ t('profile.changePhone') }}</button>
        </div>
        <div class="account-row">
          <span class="row-label">{{ t('profile.email') }}</span>
          <span class="account-value" :class="{ muted: !user?.email }">{{ user?.email || t('profile.emailNotSet') }}</span>
          <button class="account-action" @click="changingEmail = true">{{ t('profile.changeEmail') }}</button>
        </div>
      </div>

      <!-- 语言 -->
      <div class="row-card">
        <span class="row-label">{{ t('my.language') }}</span>
        <div class="lang-switch">
          <button :class="{ active: locale === 'th' }" @click="switchLanguage('th')">ไทย</button>
          <button :class="{ active: locale === 'en' }" @click="switchLanguage('en')">EN</button>
        </div>
      </div>

      <!-- 套餐与定价 -->
      <button class="row-card plans-row" @click="navigate('plans')">
        <span class="row-label">{{ t('my.plans') }}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1B0" stroke-width="2.2" stroke-linecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      <!-- 公司（游客不可加入/管理公司，登录后开放） -->
      <div v-if="!guest" class="company-card">
        <div class="company-head">
          <div class="company-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-4h6v4" />
            </svg>
          </div>
          <div class="company-main">
            <div class="company-title">{{ t('my.company') }}</div>
            <div v-if="enterpriseList.length === 0 && pendingCount === 0" class="company-empty">
              {{ t('my.companyEmpty') }}
            </div>
            <div v-else-if="pendingCount > 0" class="company-pending">
              {{ t('company.status.PENDING_VERIFICATION') }} · {{ pendingCount }}
            </div>
          </div>
        </div>

        <!-- 身份切换：个人 + 已认证企业 -->
        <div class="identity-label">{{ t('my.identity') }}</div>
        <button v-if="personalTenant" class="company-row clickable" :class="{ current: isCurrentTenant(personalTenant) }" @click="switchTenant(personalTenant)">
          <span>{{ t('home.workspacePersonal') }}</span>
          <svg v-if="isCurrentTenant(personalTenant)" class="current-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1F9E6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
        <button
          v-for="tenant in enterpriseList"
          :key="tenant.tenant_id"
          class="company-row clickable"
          :class="{ current: isCurrentTenant(tenant) }"
          @click="switchTenant(tenant)"
        >
          <span>{{ tenant.name }}</span>
          <em>{{ tenant.role }}</em>
          <svg v-if="isCurrentTenant(tenant)" class="current-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1F9E6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>

        <button class="company-cta" @click="navigate('company')">
          {{ t('my.companyManage') }}
        </button>
      </div>

      <!-- 游客：登录/注册入口；已登录：登出 -->
      <button v-if="guest" class="login-btn" @click="startAuth">{{ t('my.loginOrRegister') }}</button>
      <button v-else class="logout-btn" :disabled="loggingOut" @click="confirmingLogout = true">
        {{ t('my.logout') }}
      </button>
    </div>

    <EditProfileDialog v-if="editingProfile" @close="editingProfile = false" />
    <ChangeEmailDialog v-if="changingEmail" @close="changingEmail = false" />
    <ChangePhoneDialog v-if="changingPhone" @close="changingPhone = false" />
    <FormDialog v-if="confirmingLogout" :title="t('my.logoutConfirmTitle')" :subtitle="t('my.logoutConfirmBody')">
      <p v-if="logoutError" role="alert" style="color: var(--danger)">{{ logoutError }}</p>
      <div class="fd-actions" :class="{ 'logout-busy': loggingOut }">
        <button class="fd-btn secondary" :disabled="loggingOut" @click="confirmingLogout = false">{{ t('common.cancel') }}</button>
        <button class="fd-btn danger" :disabled="loggingOut" @click="doLogout">
          <BrandLoading v-if="loggingOut" variant="button" :label="t('my.loggingOut')" />
          <template v-else>{{ t('my.logout') }}</template>
        </button>
      </div>
    </FormDialog>
  </div>
</template>

<style scoped>
.my {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.my-header {
  padding: 20px 20px 12px;
}

.my-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.content {
  padding: 0 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.profile-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.avatar {
  width: 62px;
  height: 62px;
  border-radius: 999px;
  background: var(--track);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-main {
  min-width: 0;
  flex: 1;
  text-align: left;
}

.profile-card.editable {
  width: 100%;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.profile-card.editable:active {
  background: var(--bg);
}

.profile-edit {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  flex-shrink: 0;
}

.profile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 2px 16px;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
}

.account-row + .account-row {
  border-top: 1px solid var(--border);
}

.account-row .row-label {
  flex-shrink: 0;
}

.account-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 12px;
  color: var(--icon);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-value.muted {
  color: var(--text-secondary);
}

.account-action {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
}

.profile-name {
  font-size: 14px;
  font-weight: 700;
}

.line-connected {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--success);
  margin-top: 4px;
}

.guest-hint {
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-top: 4px;
}

.row-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.row-label {
  font-size: 12px;
  font-weight: 600;
}

.plans-row {
  cursor: pointer;
  width: 100%;
}

.lang-switch {
  display: flex;
  background: var(--track);
  border-radius: 999px;
  padding: 3px;
}

.lang-switch button {
  height: 28px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--icon);
}

.lang-switch button.active {
  background: var(--card);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(23, 26, 28, 0.12);
}

.company-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.company-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.company-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.company-title {
  font-size: 12px;
  font-weight: 700;
}

.company-empty {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.company-pending {
  font-size: 10px;
  color: var(--processing);
  font-weight: 600;
  margin-top: 2px;
}

.identity-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.6px;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.company-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  font-size: 11px;
  padding: 8px 2px 0;
  border-top: 1px solid var(--border);
  width: 100%;
  text-align: left;
  color: var(--text);
}

.company-row.clickable {
  padding: 8px 8px;
  margin: 0 -8px;
  width: calc(100% + 16px);
  border-radius: 10px;
  border-top: 1px solid var(--border);
}

.company-row.clickable:active {
  background: var(--bg);
}

.company-row.current {
  font-weight: 700;
}

.company-row em {
  font-style: normal;
  color: var(--text-secondary);
  font-weight: 600;
  margin-left: auto;
}

.current-mark {
  flex-shrink: 0;
}

.company-cta {
  height: 38px;
  border-radius: 10px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
}

.login-btn {
  height: 48px;
  border-radius: 14px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  margin-top: 6px;
}

.logout-btn {
  height: 48px;
  border-radius: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--danger);
  font-size: 13px;
  font-weight: 700;
  margin-top: 6px;
}

.logout-btn:disabled {
  opacity: 0.6;
}

.fd-actions.logout-busy .fd-btn {
  min-width: 0;
}

@media (max-width: 360px) {
  .fd-actions.logout-busy {
    flex-direction: column;
  }

  .fd-actions.logout-busy .fd-btn {
    flex: none;
  }
}
</style>
