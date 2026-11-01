<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ApiError,
  fetchPlans,
  fetchQuota,
  fetchSubscription,
  getJob,
  submitPlanApplication,
  type Plan,
  type PlanText,
  type QuotaTenant,
  type Subscription,
  type SubscriptionStatus,
} from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import {
  continueAfterAuth,
  currentTenantId,
  goTab,
  isAuthenticated,
  jobTenantId,
  navigate,
  tenants,
} from '../store';
import alibabaLogo from '../assets/alibaba-logo.png';
import BrandLoading from '../components/BrandLoading.vue';

const { t: tt, d, locale } = useT();

const props = withDefaults(
  defineProps<{
    jobId?: string;
  }>(),
  { jobId: '' },
);

const plans = ref<Plan[]>([]);
const myQuota = ref<QuotaTenant | null>(null);
const sub = ref<Subscription | null>(null);
const loading = ref(true);
const errorMsg = ref('');
const selectedCode = ref('');
const submitting = ref(false);
const submitError = ref('');
const received = ref(false);
const confirmCode = ref<string | null>(null);
const confirmPlan = computed(() => plans.value.find((p) => p.code === confirmCode.value) ?? null);

const checkMode = computed(() => !!props.jobId);
const selectedPlan = computed(() => plans.value.find((p) => p.code === selectedCode.value) ?? null);

// 订阅按租户计：确认页取任务所属租户，否则取当前租户（null = 个人租户）
const tenantId = ref<number | null>(currentTenantId.value);
const canManage = computed(() => sub.value?.can_manage ?? false);
const currentCode = computed(() => myQuota.value?.plan.code ?? '');
const pendingCode = computed(() => sub.value?.pending?.plan_code ?? null);
/** 同级套餐视为续订，弹窗文案区分升级/续订 */
const confirmIsRenew = computed(() => !!confirmCode.value && confirmCode.value === currentCode.value);
const showPending = computed(() => !checkMode.value && !!pendingCode.value);
const pendingSubmittedAt = computed(() => {
  const at = sub.value?.pending?.submitted_at;
  if (!at) return '';
  const d2 = new Date(at.endsWith('Z') ? at : `${at}Z`);
  return Number.isNaN(d2.getTime()) ? '' : d2.toLocaleString();
});

// ---- 订阅有效期（优先用 /me/subscription，未取到时回落配额里的 subscription）----
const subStatus = computed<SubscriptionStatus | null>(
  () => sub.value?.status ?? myQuota.value?.subscription.status ?? null,
);
const expiresAt = computed<string | null>(
  () => sub.value?.expires_at ?? myQuota.value?.subscription.expires_at ?? null,
);
const daysLeft = computed<number | null>(
  () => sub.value?.days_remaining ?? myQuota.value?.subscription.days_remaining ?? null,
);
const expired = computed(() => subStatus.value === 'EXPIRED');
/** 剩余 7 天及以内提示即将到期 */
const expiringSoon = computed(
  () => subStatus.value === 'ACTIVE' && daysLeft.value != null && daysLeft.value <= 7,
);

const statusLabel = computed(() => {
  if (subStatus.value === 'ACTIVE') return tt('plans.currentActive');
  if (subStatus.value === 'EXPIRED') return tt('sub.expired');
  return tt('sub.notActive');
});

const validUntilText = computed(() => {
  const date = d(expiresAt.value);
  return date ? tt('sub.validUntil', { date }) : '';
});

const daysLeftText = computed(() => {
  if (subStatus.value !== 'ACTIVE' || daysLeft.value == null) return '';
  return daysLeft.value <= 0 ? tt('sub.lastDay') : tt('sub.daysLeft', { n: daysLeft.value });
});

function rank(code: string | null): number {
  return plans.value.findIndex((p) => p.code === code);
}

function isCurrentPlan(p: Plan): boolean {
  return !!currentCode.value && p.code === currentCode.value;
}

type Cta = 'renew' | 'pending' | 'upgrade' | 'locked' | 'lower' | 'contact';

function ctaKind(p: Plan): Cta {
  if (!isAuthenticated.value) return 'contact';
  if (p.code === pendingCode.value) return 'pending';
  // 同级续订已放开，仅拒绝降级
  if (rank(p.code) < rank(currentCode.value)) return 'lower';
  if (!canManage.value) return 'contact';
  if (pendingCode.value) return 'locked';
  return isCurrentPlan(p) ? 'renew' : 'upgrade';
}

/** 可提交（升级或同级续订） */
function ctaActionable(p: Plan): boolean {
  const kind = ctaKind(p);
  return kind === 'upgrade' || kind === 'renew';
}

function ctaLabel(p: Plan): string {
  switch (ctaKind(p)) {
    case 'renew':
      return tt('sub.renew');
    case 'pending':
      return tt('plans.upgradePending');
    case 'upgrade':
    case 'locked':
      return tt('plans.upgrade');
    default:
      return hasPrice(p) ? tt('plans.contactToBuy') : tt('plans.getQuote');
  }
}

function hasPrice(p: Plan): boolean {
  return p.price.monthly_thb != null || p.price.yearly_thb != null;
}

onMounted(async () => {
  try {
    if (props.jobId && isAuthenticated.value) tenantId.value = jobTenantId(await getJob(props.jobId));
    const s = isAuthenticated.value ? await fetchSubscription(tenantId.value) : null;
    if (props.jobId && s && (s.status === 'ACTIVE' || s.pending)) {
      // 已在有效期内或已有申请在审，不应停留在选择页（如从历史回退进入）
      await continueAfterAuth(props.jobId);
      return;
    }
    sub.value = s;
    const [p, q] = await Promise.all([fetchPlans(), isAuthenticated.value ? fetchQuota() : null]);
    plans.value = p.items;
    selectedCode.value = p.items.find((plan) => plan.is_default)?.code ?? p.items[0]?.code ?? '';
    myQuota.value = q
      ? q.tenants.find((x) => x.tenant_id === tenantId.value) ?? q.tenants[0] ?? null
      : null;
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
  } finally {
    loading.value = false;
  }
});

function goBack(): void {
  if (props.jobId) {
    navigate('result', { jobId: props.jobId });
    return;
  }
  navigate('my');
}

function askUpgrade(code: string | undefined): void {
  if (!code || submitting.value) return;
  submitError.value = '';
  confirmCode.value = code;
}

async function confirmUpgrade(): Promise<void> {
  await submitUpgrade(confirmCode.value ?? undefined);
  confirmCode.value = null;
}

async function submitUpgrade(code: string | undefined): Promise<void> {
  if (!code || submitting.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    sub.value = await submitPlanApplication(code, tenantId.value);
    received.value = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && props.jobId) {
      await continueAfterAuth(props.jobId).catch(() => undefined);
      return;
    }
    submitError.value = e instanceof ApiError ? messageText(e.messageKey) : tt('common.unknownError');
    if (e instanceof ApiError && e.status === 409) {
      sub.value = await fetchSubscription(tenantId.value).catch(() => sub.value);
    }
  } finally {
    submitting.value = false;
  }
}

function closeReceived(): void {
  received.value = false;
  goTab('scan');
}

const quotaPct = computed(() => {
  const q = myQuota.value;
  if (!q) return 0;
  const { remaining, monthly_total: total } = q.pages;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((remaining / total) * 100));
});

// 配额统一按「月页数」展示（已无免费次数概念）
const quotaMeta = computed(() => {
  const q = myQuota.value;
  if (!q) return '';
  return tt('plans.pagesLeft', {
    left: q.pages.remaining.toLocaleString('en-US'),
    total: q.pages.monthly_total.toLocaleString('en-US'),
  });
});

function tenantLabel(): string {
  const id = tenantId.value;
  const target = id == null ? null : tenants.value.find((x) => x.tenant_id === id) ?? null;
  if (!target || target.tenant_type === 'PERSONAL') return tt('plans.personalWorkspace');
  return target.name || tt('plans.enterpriseWorkspace');
}

function seatsLabel(p: Plan): string {
  return p.seats === 1 ? tt('plans.seat') : tt('plans.seats', { n: p.seats });
}

// FR-SYS-019：套餐文案由后台按语言配置，当前语言缺失时回退英文字段
function planText(p: Plan): PlanText | undefined {
  return p.i18n?.[locale.value];
}

function planName(p: Plan): string {
  return planText(p)?.name || p.name;
}

function planFeatures(p: Plan): string[] {
  return planText(p)?.features ?? p.features;
}

const currentPlanName = computed(() => {
  const plan = myQuota.value?.plan;
  if (!plan) return '';
  return plan.name_i18n?.[locale.value] || plan.name || '';
});

/** 在审申请的套餐名按当前语言取目录文案，目录里找不到时用接口返回的英文名 */
const pendingPlanName = computed(() => {
  const target = plans.value.find((p) => p.code === pendingCode.value);
  return target ? planName(target) : sub.value?.pending?.plan_name ?? '';
});

function priceLabel(p: Plan): string {
  // 无标价套餐的“Contact us / ติดต่อเรา”同样来自配置
  return planText(p)?.price_display || p.price.display || 'Contact us';
}

function priceSub(p: Plan): string {
  const { monthly_thb: monthly, yearly_thb: yearly } = p.price;
  if (monthly == null || yearly == null) return '';
  const yearlyText = yearly.toLocaleString('en-US');
  // 展示文案已含年价（如 “THB 599 / mo · THB 5,990 / yr”）时不再重复副标题
  if (priceLabel(p).includes(yearlyText)) return '';
  return `THB ${yearlyText} / yr`;
}
</script>

<template>
  <div class="plans" :class="{ 'check-mode': checkMode }">
    <header class="plans-header">
      <button class="back" @click="goBack">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="title">{{ checkMode ? tt('plans.checkTitle') : tt('plans.title') }}</div>
      <div class="spacer" />
    </header>

    <div class="body">
      <BrandLoading v-if="loading" variant="page" :label="tt('common.loading')" />
      <div v-else-if="errorMsg" class="status error">{{ errorMsg }}</div>

      <template v-else>
        <p v-if="checkMode" class="check-hint">{{ tt('plans.checkHint') }}</p>
        <p v-if="sub && !canManage" class="admin-hint">{{ tt('plans.ownerOnly') }}</p>

        <div v-if="showPending" class="pending-card" role="status">
          <div class="pending-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 2h12M6 22h12" />
              <path d="M7 2v4a5 5 0 0 0 5 5 5 5 0 0 0 5-5V2" />
              <path d="M7 22v-4a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4" />
            </svg>
          </div>
          <div class="pending-content">
            <div class="pending-title">
              <span class="pending-dot" />
              {{ tt('plans.pendingTitle', { plan: pendingPlanName }) }}
            </div>
            <div class="pending-body">{{ tt('plans.pendingNotice', { plan: pendingPlanName }) }}</div>
            <div v-if="pendingSubmittedAt" class="pending-meta">
              {{ tt('planPending.submittedAt') }} · {{ pendingSubmittedAt }}
            </div>
          </div>
        </div>

        <!-- 已过期提醒：醒目横幅 + 线下续订指引（不展示价格或支付链接） -->
        <div v-if="expired" class="expired-card" role="alert">
          <div class="expired-head">
            <span class="expired-badge">{{ tt('sub.expired') }}</span>
            <span class="expired-title">{{ tt('sub.expiredTitle') }}</span>
          </div>
          <p class="expired-body">{{ tt('sub.expiredBody') }}</p>
          <p class="expired-body">{{ tt('plans.offlineBody') }}</p>
        </div>

        <!-- 当前套餐：渐变卡片 -->
        <div v-if="myQuota" class="current-card">
          <div class="current-top">
            <div class="current-name">
              {{ currentPlanName }} · <span class="current-free">{{ statusLabel }}</span>
            </div>
            <span v-if="expired || expiringSoon" class="current-badge" :class="{ danger: expired }">
              {{ expired ? tt('sub.expired') : tt('sub.expiringSoon') }}
            </span>
          </div>
          <div class="current-track">
            <div class="current-fill" :style="{ width: quotaPct + '%' }" />
          </div>
          <div class="current-meta">
            <span>{{ quotaMeta }}</span>
            <span class="current-ws">{{ tenantLabel() }}</span>
          </div>
          <div v-if="validUntilText || daysLeftText" class="current-expiry">
            <span v-if="validUntilText">{{ validUntilText }}</span>
            <span v-if="daysLeftText" class="current-days">{{ daysLeftText }}</span>
          </div>
          <div v-else-if="subStatus === 'NONE'" class="current-expiry">{{ tt('sub.enterprisePending') }}</div>
        </div>

        <!-- 套餐目录 -->
        <p v-if="!checkMode && submitError" class="submit-error">{{ submitError }}</p>
        <div class="packages-label">{{ tt('plans.packages') }}</div>
        <div class="plan-grid">
          <div
            v-for="p in plans"
            :key="p.code"
            class="plan-card"
            :class="{
              default: !checkMode && isCurrentPlan(p),
              pending: !checkMode && ctaKind(p) === 'pending',
              dark: p.theme === 'DARK',
              selectable: checkMode,
              selected: checkMode && selectedCode === p.code,
            }"
            :role="checkMode ? 'button' : undefined"
            :tabindex="checkMode ? 0 : undefined"
            @click="checkMode && (selectedCode = p.code)"
            @keyup.enter="checkMode && (selectedCode = p.code)"
          >
            <div v-if="checkMode ? selectedCode === p.code : isCurrentPlan(p)" class="plan-flag">
              {{ checkMode ? tt('plans.selected') : tt('plans.current') }}
            </div>
            <div v-else-if="!checkMode && ctaKind(p) === 'pending'" class="plan-flag pending-flag">
              {{ tt('plans.inReview') }}
            </div>
            <div class="plan-name">{{ planName(p) }}</div>
            <div class="plan-price">{{ priceLabel(p) }}</div>
            <div v-if="priceSub(p)" class="plan-price-sub">{{ priceSub(p) }}</div>
            <ul class="plan-features">
              <li>{{ tt('plans.pagesPerMonth', { n: p.quota_pages_per_month.toLocaleString('en-US') }) }}</li>
              <li>{{ seatsLabel(p) }}</li>
              <li v-for="f in planFeatures(p)" :key="f">{{ f }}</li>
            </ul>
            <button
              v-if="!checkMode && ctaKind(p) !== 'lower'"
              class="plan-cta"
              :class="{
                primary: ctaActionable(p) || (ctaKind(p) === 'contact' && hasPrice(p)),
                dark: p.theme === 'DARK',
              }"
              :disabled="!ctaActionable(p) || submitting"
              :title="ctaKind(p) === 'contact' ? tt('plans.offlineTitle') : undefined"
              @click="askUpgrade(p.code)"
            >
              <BrandLoading v-if="submitting && confirmCode === p.code && ctaActionable(p)" variant="button" :label="tt('plans.submitting')" :announce="false" />
              <template v-else>{{ ctaLabel(p) }}</template>
            </button>
          </div>
        </div>

        <!-- 线下支付说明 -->
        <div class="offline-notice">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D98F1F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <div class="offline-title">{{ tt('plans.offlineTitle') }}</div>
            <div class="offline-body">{{ tt('plans.offlineBody') }}</div>
          </div>
        </div>

        <div class="footnote">{{ tt('plans.footnote') }}</div>

        <div class="footer">
          <span class="footer-brand">saiflow</span>
          <span class="footer-by">by</span>
          <img class="footer-logo" :src="alibabaLogo" alt="Alibaba" />
        </div>
      </template>
    </div>

    <div v-if="checkMode && !loading && !errorMsg" class="continue-bar">
      <p v-if="submitError" class="submit-error">{{ submitError }}</p>
      <button
        class="continue-btn"
        :disabled="!selectedPlan || submitting || (!!sub && !canManage)"
        @click="askUpgrade(selectedPlan?.code)"
      >
        <BrandLoading v-if="submitting" variant="button" :label="tt('plans.submitting')" :announce="false" />
        <template v-else>{{ tt('plans.upgradeTo', { plan: selectedPlan ? planName(selectedPlan) : '' }) }}</template>
      </button>
    </div>

    <div v-if="confirmPlan" class="dialog-mask" role="dialog" aria-modal="true">
      <div class="dialog">
        <div class="dialog-title">{{ confirmIsRenew ? tt('sub.renewTitle') : tt('plans.confirmTitle') }}</div>
        <p class="dialog-body">
          {{ confirmIsRenew ? tt('sub.renewBody', { plan: planName(confirmPlan) }) : tt('plans.confirmBody', { plan: planName(confirmPlan) }) }}
        </p>
        <div class="dialog-actions">
          <button class="dialog-cancel" :disabled="submitting" @click="confirmCode = null">{{ tt('common.cancel') }}</button>
          <button class="continue-btn" :disabled="submitting" @click="confirmUpgrade">
            <BrandLoading v-if="submitting" variant="button" :label="tt('plans.submitting')" />
            <template v-else>{{ tt('plans.confirmOk') }}</template>
          </button>
        </div>
      </div>
    </div>

    <div v-if="received" class="dialog-mask" role="dialog" aria-modal="true">
      <div class="dialog">
        <div class="dialog-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div class="dialog-title">{{ tt('plans.receivedTitle') }}</div>
        <p class="dialog-body">{{ tt('plans.receivedBody') }}</p>
        <button class="continue-btn" @click="closeReceived">{{ tt('plans.receivedOk') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plans {
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* 订阅确认页：内容区独立滚动，底部继续按钮常驻 */
.plans.check-mode {
  height: 100%;
  min-height: 0;
}

.plans.check-mode .body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.check-hint {
  margin: 0 2px;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.admin-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--processing-bg);
  color: var(--processing);
  font-size: 11px;
  line-height: 1.5;
}

.continue-bar {
  flex-shrink: 0;
  padding: 10px 16px calc(14px + env(safe-area-inset-bottom));
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.continue-btn {
  width: 100%;
  min-width: 0;
  min-height: 52px;
  padding: 4px 6px;
  border-radius: 14px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.continue-btn:disabled {
  opacity: 0.6;
}

.submit-error {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--danger);
  text-align: center;
}

.pending-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, #f5a623 0%, #e8891a 100%);
  color: #fff;
  box-shadow: 0 6px 18px rgba(232, 137, 26, 0.32);
}

.pending-icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pending-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pending-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}

.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #fff;
  animation: pending-pulse 1.6s ease-in-out infinite;
}

@keyframes pending-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pending-dot {
    animation: none;
  }
}

.pending-body {
  font-size: 11.5px;
  line-height: 1.5;
}

.pending-meta {
  font-size: 10px;
  opacity: 0.9;
}

.plan-card.pending {
  border-color: #e8891a;
  box-shadow: 0 0 0 1.5px #e8891a;
}

.plan-flag.pending-flag {
  background: #e8891a;
}

.plan-cta:disabled:not(.primary) {
  cursor: default;
}

.plan-cta.primary:disabled {
  opacity: 0.6;
}

.plans {
  position: relative;
}

.dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.45);
}

.dialog {
  width: 100%;
  max-width: 320px;
  background: var(--card);
  border-radius: 18px;
  padding: 22px 18px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.dialog-icon {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-title {
  font-size: 15px;
  font-weight: 700;
}

.dialog-body {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.dialog-actions {
  width: 100%;
  display: flex;
  gap: 10px;
}

.dialog-actions .continue-btn,
.dialog-cancel {
  flex: 1 1 0;
  min-width: 0;
  min-height: 46px;
}

.dialog-cancel {
  padding: 4px 6px;
  border-radius: 14px;
  background: var(--track);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.plans-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 20px 12px;
}

.back {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--icon);
}

.title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
}

.spacer {
  width: 34px;
}

.body {
  padding: 4px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.status {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  padding: 24px 0;
}

.status.error {
  color: var(--danger);
}

/* ---- 当前套餐渐变卡 ---- */
.current-card {
  border-radius: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #5a76ff 0%, #4a66f7 55%, #3a55e0 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.current-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.current-name {
  font-size: 17px;
  font-weight: 700;
}

.current-free {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.9;
}

.current-badge {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

/* 已过期徽标更醒目 */
.current-badge.danger {
  background: rgba(255, 255, 255, 0.95);
  color: var(--danger);
}

/* ---- 有效期信息 ---- */
.current-expiry {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 10px;
  opacity: 0.92;
}

.current-days {
  font-weight: 700;
}

/* ---- 已过期横幅 ---- */
.expired-card {
  border-radius: 16px;
  padding: 14px;
  background: linear-gradient(135deg, #ff6b6b 0%, #e23b3b 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 6px 18px rgba(226, 59, 59, 0.28);
}

.expired-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.expired-badge {
  background: rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

.expired-title {
  font-size: 14px;
  font-weight: 700;
}

.expired-body {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
}

.current-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.current-fill {
  height: 100%;
  border-radius: 3px;
  background: #fff;
}

.current-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  opacity: 0.92;
}

/* ---- 套餐网格 ---- */
.packages-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.plan-card {
  position: relative;
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plan-card.default {
  border-color: var(--primary);
}

.plan-card.selectable {
  cursor: pointer;
}

.plan-card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1.5px var(--primary);
}

.plan-card.dark.selected {
  border-color: #7f92ff;
  box-shadow: 0 0 0 1.5px #7f92ff;
}

.plan-card.dark {
  background: #1a1f29;
  border-color: #1a1f29;
  color: #fff;
}

.plan-flag {
  position: absolute;
  top: -8px;
  right: 10px;
  background: var(--primary);
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.4px;
  border-radius: 999px;
  padding: 3px 8px;
}

.plan-name {
  font-size: 13px;
  font-weight: 700;
}

.plan-price {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.plan-card.dark .plan-price {
  color: #fff;
}

.plan-price-sub {
  font-size: 9px;
  color: var(--text-secondary);
}

.plan-card.dark .plan-price-sub {
  color: #99a1b0;
}

.plan-features {
  margin: 2px 0 4px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 9.5px;
  color: var(--icon);
  flex: 1;
}

.plan-card.dark .plan-features {
  color: #99a1b0;
}

.plan-cta {
  min-width: 0;
  border-radius: 10px;
  padding: 8px 4px;
  font-size: 11px;
  font-weight: 700;
  background: var(--track);
  color: var(--icon);
  overflow-wrap: anywhere;
}

.plan-cta.primary {
  background: var(--primary);
  color: #fff;
}

.plan-card.dark .plan-cta,
.plan-cta.dark {
  background: #ffffff;
  color: #1a1f29;
}

/* ---- 线下支付说明 ---- */
.offline-notice {
  display: flex;
  gap: 10px;
  background: var(--processing-bg);
  border-radius: 12px;
  padding: 12px 14px;
}

.offline-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--processing);
}

.offline-body {
  font-size: 10px;
  color: var(--processing);
  margin-top: 2px;
  line-height: 1.5;
}

.footnote {
  font-size: 9.5px;
  color: var(--text-secondary);
  text-align: center;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 4px;
}

.footer-brand {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
}

.footer-by {
  font-size: 10px;
  color: var(--text-secondary);
}

.footer-logo {
  height: 14px;
  display: block;
}
</style>
