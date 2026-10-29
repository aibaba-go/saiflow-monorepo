/**
 * 会话 store：登录态用户、CSRF、租户（tenant）+ 极简视图路由。
 * 凭据仅内存/HttpOnly Cookie；持久化仅语言、当前租户与非凭据退出标记，
 * OAuth 待续意图/任务仅 sessionStorage。
 */
import { computed, reactive, ref } from 'vue';
import { signOutLiff } from './liff';
import {
  ApiError,
  createGuestSession,
  fetchQuota,
  fetchSession,
  getJob,
  logout,
  loginWithDevId,
  loginWithLine,
  onUnauthorized,
  setCsrfToken,
  type AuthPayload,
  type QuotaTenant,
  type Tenant,
  type User,
} from './api';

export const user = ref<User | null>(null);
export const tenants = ref<Tenant[]>([]);
export const booted = ref(false); // 启动检查是否结束（无论成败）
export const quota = ref<QuotaTenant[]>([]); // 各租户月页额度（PRD v1.4 §20）

/** 游客可完成上传/OCR/核验；确认前要求登录或注册 */
export const isGuest = computed(() => !user.value || user.value.is_guest);
export const isAuthenticated = computed(() => !!user.value && !user.value.is_guest);
/** LINE 登录成功但尚未补录注册信息（FR-SYS-014） */
export const needsRegistration = computed(() => isAuthenticated.value && !user.value!.registered);

export const currentTenant = ref<Tenant | null>(null);

/** 当前租户 id（null 表示会话尚未就绪） */
export const currentTenantId = computed<number | null>(() => currentTenant.value?.tenant_id ?? null);

// 按用户记住上次选择的租户（值为数字 tenant_id）
const TENANT_KEY_PREFIX = 'saiflow_tenant_';

function savedTenantId(userId: number): number | null {
  try {
    const raw = localStorage.getItem(TENANT_KEY_PREFIX + userId);
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

function saveTenant(userId: number, tenant: Tenant | null): void {
  try {
    if (tenant) localStorage.setItem(TENANT_KEY_PREFIX + userId, String(tenant.tenant_id));
    else localStorage.removeItem(TENANT_KEY_PREFIX + userId);
  } catch {
    /* localStorage 不可用时仅丢失刷新后的租户记忆 */
  }
}

/** 切换租户（个人/企业数据、套餐、配额互相隔离） */
export function setTenant(tenant: Tenant | null): void {
  currentTenant.value = tenant;
  if (user.value) saveTenant(user.value.id, tenant);
  void refreshQuota();
}

export function applyAuth(payload: AuthPayload): void {
  const sameUser = !!user.value && user.value.id === payload.user.id;
  user.value = payload.user;
  tenants.value = payload.tenants ?? [];
  setCsrfToken(payload.csrf_token);
  const list = tenants.value;
  const personal = list.find((t) => t.tenant_type === 'PERSONAL') ?? list[0] ?? null;
  const wantedId =
    sameUser && currentTenant.value ? currentTenant.value.tenant_id : savedTenantId(payload.user.id);
  // 已解绑/企业失效时回落个人租户
  currentTenant.value =
    wantedId == null ? personal : list.find((t) => t.tenant_id === wantedId) ?? personal;
}

/** 拉取配额视图；静默失败（横幅缺省隐藏，不阻塞主流程） */
export async function refreshQuota(): Promise<void> {
  try {
    quota.value = (await fetchQuota()).tenants ?? [];
  } catch {
    quota.value = [];
  }
}

/** 当前租户对应的配额条目 */
export function quotaForTenant(): QuotaTenant | null {
  const id = currentTenantId.value;
  if (id == null || !quota.value.length) return null;
  return quota.value.find((q) => q.tenant_id === id) ?? null;
}

export async function refreshSession(): Promise<boolean> {
  try {
    const payload = await fetchSession();
    applyAuth(payload);
    return true;
  } catch {
    return false;
  }
}

export async function signInWithLine(idToken: string, language: 'th' | 'en'): Promise<void> {
  applyAuth(await loginWithLine(idToken, language));
  clearAuthIntent();
  clearLogoutPending();
  await refreshQuota();
}

export async function signInWithDevId(devId: string, language: 'th' | 'en'): Promise<void> {
  applyAuth(await loginWithDevId(devId, language));
  await refreshQuota();
}

/** 未登录时静默建立游客会话（上传/OCR/核验可用，数据在登录后归并） */
export async function ensureGuestSession(language: 'th' | 'en'): Promise<void> {
  applyAuth(await createGuestSession(language));
  await refreshQuota();
}

export function signOutLocally(): void {
  user.value = null;
  tenants.value = [];
  currentTenant.value = null;
  quota.value = [];
  setCsrfToken(null);
}

// FR-SYS-001/010：退出与游客恢复互斥，避免 401 监听抢先复用旧 Cookie。
export const sessionTransition = ref(false);
export const logoutBlocked = ref(false);
const LOGOUT_PENDING_KEY = 'saiflow_logout_pending';

function markLogoutPending(): void {
  try { localStorage.setItem(LOGOUT_PENDING_KEY, '1'); } catch { /* best effort */ }
}

function clearLogoutPending(): void {
  try { localStorage.removeItem(LOGOUT_PENDING_KEY); } catch { /* best effort */ }
  logoutBlocked.value = false;
}

export function hasLogoutPending(): boolean {
  try { return localStorage.getItem(LOGOUT_PENDING_KEY) === '1'; } catch { return false; }
}

/** 网络失败时保留撤销标记；刷新先撤销，绝不展示旧正式 Cookie 的身份。 */
export async function finishPendingLogout(): Promise<void> {
  if (!hasLogoutPending()) return;
  try {
    const payload = await fetchSession(10000);
    setCsrfToken(payload.csrf_token); // 仅用于撤销，不应用旧身份
    await logout();
  } catch (error) {
    // 无会话已视为退出成功；其他错误不得伪装为已撤销。
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  signOutLocally();
  clearLogoutPending();
}

export async function signOutAccount(language: 'th' | 'en'): Promise<void> {
  if (sessionTransition.value) return;
  sessionTransition.value = true;
  const retrying = hasLogoutPending();
  markLogoutPending();
  clearAuthIntent();
  clearPendingJob();
  try {
    if (retrying) {
      await finishPendingLogout();
    } else {
      try { await logout(); } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }
    signOutLocally();
    signOutLiff();
    await ensureGuestSession(language);
    clearLogoutPending();
    navigate('scan');
  } catch (error) {
    signOutLocally();
    logoutBlocked.value = true;
    throw error;
  } finally {
    sessionTransition.value = false;
  }
}

onUnauthorized(signOutLocally);

export interface Route {
  name:
    | 'scan'
    | 'history'
    | 'my'
    | 'confirm'
    | 'processing'
    | 'result'
    | 'auth'
    | 'final'
    | 'company'
    | 'plans'
    | 'plan-pending';
  /** 各子页参数，如 { fileId } / { jobId } */
  params?: Record<string, string>;
}

export const route = reactive<Route>({ name: 'scan' });

export function navigate(name: Route['name'], params?: Record<string, string>): void {
  route.name = name;
  route.params = params;
}

/** 任务所属租户（订阅/配额按租户计） */
export function jobTenantId(job: { tenant_id: number }): number | null {
  return job.tenant_id ?? null;
}

export async function continueAfterAuth(jobId: string): Promise<void> {
  if (!isAuthenticated.value || needsRegistration.value) return;
  const job = await getJob(jobId);
  // FR-SYS-011/012：认证完成只恢复任务，不自动确认，也不送到订阅页。
  navigate(job.stage === 'COMPLETED' ? 'final' : 'result', { jobId });
  clearPendingJob();
}

// OAuth 回跳会重建 SPA，用 sessionStorage 记住待继续核验的任务
const PENDING_JOB_KEY = 'saiflow_pending_job';

export function rememberPendingJob(jobId: string): void {
  try {
    sessionStorage.setItem(PENDING_JOB_KEY, jobId);
  } catch {
    /* sessionStorage 不可用时仅丢失回跳续接 */
  }
}

export function peekPendingJob(): string | null {
  try {
    return sessionStorage.getItem(PENDING_JOB_KEY);
  } catch {
    return null;
  }
}

const AUTH_INTENT_KEY = 'saiflow_auth_intent';
export interface AuthIntent { jobId?: string; from?: string }

/** 只由用户点击 LINE 按钮写入，不能把待续任务当成自动登录许可。 */
export function rememberAuthIntent(): void {
  try {
    sessionStorage.setItem(AUTH_INTENT_KEY, JSON.stringify({
      jobId: route.params?.jobId, from: route.params?.from,
    }));
  } catch { /* OAuth 回跳续接不可用 */ }
}

export function getAuthIntent(): AuthIntent | null {
  try {
    const raw = sessionStorage.getItem(AUTH_INTENT_KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw);
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return null;
    return {
      jobId: typeof intent.jobId === 'string' ? intent.jobId : undefined,
      from: typeof intent.from === 'string' ? intent.from : undefined,
    };
  } catch { return null; }
}

export function clearAuthIntent(): void {
  try { sessionStorage.removeItem(AUTH_INTENT_KEY); } catch { /* ignore */ }
}

export function clearPendingJob(): void {
  try {
    sessionStorage.removeItem(PENDING_JOB_KEY);
  } catch {
    /* ignore */
  }
}

export function goTab(name: 'scan' | 'history' | 'my'): void {
  navigate(name);
}

// 启动流程：先尝试用既有 Cookie 恢复会话
export async function boot(): Promise<void> {
  if (booted.value) return;
  await refreshSession();
  booted.value = true;
  if (user.value) await refreshQuota();
}
