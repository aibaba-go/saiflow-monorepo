/**
 * 会话 store：登录态用户、CSRF、工作空间 + 极简视图路由。
 * 除语言偏好（i18n.ts）与按用户记忆的当前工作空间（localStorage）外均为内存态。
 */
import { computed, reactive, ref } from 'vue';
import {
  createGuestSession,
  fetchQuota,
  fetchSession,
  fetchSubscription,
  getJob,
  loginWithDevId,
  loginWithLine,
  onUnauthorized,
  setCsrfToken,
  type AuthPayload,
  type QuotaWorkspace,
  type User,
  type Workspace,
  type WorkspaceRef,
} from './api';

export const user = ref<User | null>(null);
export const workspaces = ref<Workspace[]>([]);
export const booted = ref(false); // 启动检查是否结束（无论成败）
export const quota = ref<QuotaWorkspace[]>([]); // 各工作空间免费额度（PRD v1.4 §20）

/** 游客可完成上传/OCR/核验；确认前要求登录或注册 */
export const isGuest = computed(() => !user.value || user.value.is_guest);
export const isAuthenticated = computed(() => !!user.value && !user.value.is_guest);
/** LINE 登录成功但尚未补录注册信息（FR-SYS-014） */
export const needsRegistration = computed(() => isAuthenticated.value && !user.value!.registered);

export const currentWorkspace = ref<Workspace | null>(null);

// 按用户记住上次选择的工作空间（值为企业 id；个人空间存 PERSONAL）
const WS_KEY_PREFIX = 'saiflow_ws_';

function savedEnterpriseId(userId: number): number | null {
  try {
    const raw = localStorage.getItem(WS_KEY_PREFIX + userId);
    const id = raw && raw !== 'PERSONAL' ? Number(raw) : NaN;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

function saveWorkspace(userId: number, ws: Workspace | null): void {
  try {
    localStorage.setItem(WS_KEY_PREFIX + userId, ws?.enterprise_id != null ? String(ws.enterprise_id) : 'PERSONAL');
  } catch {
    /* localStorage 不可用时仅丢失刷新后的空间记忆 */
  }
}

/** 切换工作空间（个人/企业数据、套餐、配额互相隔离） */
export function setWorkspace(ws: Workspace | null): void {
  currentWorkspace.value = ws;
  if (user.value) saveWorkspace(user.value.id, ws);
  void refreshQuota();
}

export function applyAuth(payload: AuthPayload): void {
  const sameUser = !!user.value && user.value.id === payload.user.id;
  user.value = payload.user;
  workspaces.value = payload.workspaces;
  setCsrfToken(payload.csrf_token);
  const list = payload.workspaces;
  const personal = list.find((w) => w.workspace_type === 'PERSONAL') ?? list[0] ?? null;
  const wantedId =
    sameUser && currentWorkspace.value ? currentWorkspace.value.enterprise_id : savedEnterpriseId(payload.user.id);
  // 已解绑/企业失效时回落个人空间
  currentWorkspace.value =
    wantedId == null
      ? personal
      : list.find((w) => w.workspace_type === 'ENTERPRISE' && w.enterprise_id === wantedId) ?? personal;
}

/** 拉取配额视图；静默失败（横幅缺省隐藏，不阻塞主流程） */
export async function refreshQuota(): Promise<void> {
  try {
    quota.value = (await fetchQuota()).workspaces;
  } catch {
    quota.value = [];
  }
}

/** 当前工作空间对应的配额条目 */
export function quotaForWorkspace(): QuotaWorkspace | null {
  const ws = currentWorkspace.value;
  if (!ws || !quota.value.length) return null;
  return (
    quota.value.find(
      (q) =>
        q.workspace_type === ws.workspace_type &&
        q.enterprise_id === ws.enterprise_id,
    ) ?? null
  );
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
  workspaces.value = [];
  currentWorkspace.value = null;
  quota.value = [];
  setCsrfToken(null);
}

// 401 → 清空本地态，App 回到登录页
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

/** 任务所属工作空间（订阅/配额按空间计） */
export function jobWorkspace(job: { workspace_type: string; enterprise_id: number | null }): WorkspaceRef {
  return { enterprise_id: job.workspace_type === 'ENTERPRISE' ? job.enterprise_id : null };
}

export async function continueAfterAuth(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  const sub = await fetchSubscription(jobWorkspace(job));
  if (sub.status === 'ACTIVE') {
    navigate(job.stage === 'COMPLETED' ? 'final' : 'result', { jobId });
  } else if (sub.status === 'PENDING') {
    navigate('plan-pending', { jobId, plan: sub.plan_name ?? '', submittedAt: sub.submitted_at ?? '' });
  } else {
    navigate('plans', { jobId });
  }
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

export function takePendingJob(): string | null {
  try {
    const jobId = sessionStorage.getItem(PENDING_JOB_KEY);
    if (jobId) sessionStorage.removeItem(PENDING_JOB_KEY);
    return jobId;
  } catch {
    return null;
  }
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
