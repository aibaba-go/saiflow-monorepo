/**
 * saiflow v1 API client.
 *
 * 约定（PRD §14）：
 * - 会话是 HttpOnly Cookie（saiflow_session，Path=/api），前端不持有、不存储任何长期凭证；
 * - 成功响应统一为 { code: "OK", data }；错误为扁平的 { code, message_key, request_id, retryable, field_errors }；
 * - 所有写请求必须携带 X-CSRF-Token（登录或 GET /auth/session 时下发，仅存内存）；
 * - 401 触发 onUnauthorized 订阅者（试用页面恢复游客，认证窗口可重试），绝不把凭证写进 URL/localStorage。
 */

const API_BASE = '/api/v1';

export interface ApiFieldError {
  field?: string;
  reason?: string;
  message_key?: string;
}

export interface ApiErrorBody {
  code: string;
  message_key: string;
  request_id: string;
  retryable: boolean;
  field_errors: ApiFieldError[];
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message_key || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
  get messageKey(): string {
    return this.body.message_key;
  }
}

let csrfToken: string | null = null;
let sessionEpoch = 0;
// 每个写请求结束（无论成败）递增：读缓存据此判断期间是否可能有数据变化（NFR-PERF-005）。
let writeEpoch = 0;

/** 新会话/清理递增代次，旧并发请求的 401 不能清除新会话。 */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  sessionEpoch += 1;
}

/** 当前会话代次与写代次；只读，用于前端短时读缓存的失效判断。 */
export function dataEpochs(): { session: number; write: number } {
  return { session: sessionEpoch, write: writeEpoch };
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** 401 通知（清本地身份，由 App 按认证上下文恢复） */
export function onUnauthorized(fn: UnauthorizedListener): () => void {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

function emitUnauthorized(): void {
  setCsrfToken(null);
  unauthorizedListeners.forEach((fn) => fn());
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  rawBody?: XMLHttpRequestBodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  onUploadProgress?: (fraction: number) => void;
  timeoutMs?: number;
  /** FR-UPLOAD-001/010：三段上传统一使用移动 WebView 的同源 XHR 通道。 */
  transport?: 'xhr';
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', json, rawBody, contentType, headers = {}, idempotencyKey, onUploadProgress } = options;

  const requestEpoch = sessionEpoch;
  const h: Record<string, string> = { ...headers };
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite && csrfToken) {
    h['X-CSRF-Token'] = csrfToken;
  }
  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
  }
  let body: XMLHttpRequestBodyInit | undefined;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (rawBody !== undefined) {
    if (contentType) h['Content-Type'] = contentType;
    body = rawBody;
  }

  let res: Response;
  const useXhr = options.transport === 'xhr' || (!!onUploadProgress && rawBody instanceof Blob);
  const controller = options.timeoutMs && !useXhr ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : null;
  try {
    if (useXhr) {
      res = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, `${API_BASE}${path}`);
        xhr.withCredentials = true;
        xhr.timeout = options.timeoutMs ?? 0;
        Object.entries(h).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        if (onUploadProgress) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) onUploadProgress(event.loaded / event.total);
          };
        }
        xhr.onload = () => {
          try {
            // WebView 中状态 0 或无正文状态不能抛出未捕获异常、让上传永久等待。
            if (xhr.status === 0) { reject(new Error('Upload unavailable')); return; }
            const noBody = [204, 205, 304].includes(xhr.status);
            resolve(new Response(noBody ? null : xhr.responseText, {
              status: xhr.status,
              statusText: xhr.statusText,
            }));
          } catch (error) { reject(error); }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.onabort = () => reject(new Error('Upload aborted'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.send(body);
      });
    } else {
      res = await fetch(`${API_BASE}${path}`, { method, headers: h, body, credentials: 'same-origin', signal: controller?.signal });
    }
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message_key: 'error.network',
      request_id: '',
      retryable: true,
      field_errors: [],
    });
  } finally {
    if (timer !== null) window.clearTimeout(timer);
    // 响应已到达或网络失败：服务端都可能已执行写入，读缓存一律失效
    if (isWrite) writeEpoch += 1;
  }

  if (res.status === 401) {
    if (requestEpoch === sessionEpoch) emitUnauthorized();
    let body401: ApiErrorBody = {
      code: 'AUTH_REQUIRED',
      message_key: 'auth.login_required',
      request_id: '',
      retryable: false,
      field_errors: [],
    };
    try {
      body401 = { ...body401, ...(await res.json()) };
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(401, body401);
  }

  let payload: { code?: string; data?: T } & Partial<ApiErrorBody> = {};
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      /* 下载等二进制场景在上层处理，不会走到这里 */
    }
  }

  if (!res.ok || payload.code !== 'OK') {
    throw new ApiError(res.status, {
      code: payload.code ?? `HTTP_${res.status}`,
      message_key: payload.message_key ?? 'error.unknown',
      request_id: payload.request_id ?? '',
      retryable: payload.retryable ?? false,
      field_errors: payload.field_errors ?? [],
    });
  }
  return (payload.data ?? ({} as T));
}

// ---------- 类型 ----------

export interface User {
  id: number;
  display_name: string;
  avatar_url: string;
  language: 'th' | 'en';
  status: string;
  /** 游客会话：可试用上传/核验，确认前需登录或注册 */
  is_guest: boolean;
  /** 注册时使用 LINE 默认值或用户录入，个人中心可修改（PATCH /me phone） */
  phone: string;
  email: string;
  /** 已完成注册信息录入（FR-SYS-014） */
  registered: boolean;
  created_at: string;
}

/** 归属只有一个表达：tenant_id（PERSONAL 为本人个人租户，ENTERPRISE 为已授权企业租户） */
export interface Tenant {
  tenant_id: number;
  tenant_type: 'PERSONAL' | 'ENTERPRISE';
  /** 企业租户为企业名；个人租户为 null，由前端按语言渲染「个人」 */
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
}

export interface AuthPayload {
  user: User;
  csrf_token: string;
  tenants: Tenant[];
}

export interface FileInfo {
  id: string;
  tenant_id: number;
  original_name: string;
  mime_type: string;
  status: 'UPLOADING' | 'UPLOADED' | 'VALIDATING' | 'READY' | 'REJECTED';
  reject_reason: string;
  size_bytes: number;
  page_count: number;
  created_at: string;
}

export type JobStatus =
  | 'QUEUED'
  | 'PREPROCESSING'
  | 'PROCESSING'
  | 'POSTPROCESSING'
  | 'SUCCEEDED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export type ReviewStatus = 'UNREVIEWED' | 'EDITED' | 'CONFIRMED';

/** 流程阶段（服务端推导）；VERIFIED 仅出现在未注册用户的已确认任务 */
export type JobStage = 'OCR_PROCESSING' | 'OCR_FAILED' | 'VERIFYING' | 'VERIFIED' | 'COMPLETED';

export interface JobSummary {
  id: string;
  file_id: string;
  file_name: string;
  tenant_id: number;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  review_status: ReviewStatus;
  page_count: number;
  table_count: number;
  field_count: number;
  error_code: string | null;
  error_message: string;
  parent_job_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobList {
  items: JobSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ResultCell {
  row_index: number;
  column_index: number;
  raw_text: string;
  current_text: string;
  review_status: 'UNREVIEWED' | 'EDITED' | 'CONFIRMED';
}

export interface ResultTable {
  table_id: string;
  row_count: number;
  column_count: number;
  cells: ResultCell[];
}

export interface ResultField {
  name: string;
  value: string;
  source?: string;
  source_page?: number;
}

export interface ResultPage {
  page_number: number;
  text: string;
  tables: ResultTable[];
  fields: ResultField[];
}

/** GET/PATCH /ocr/jobs/{id}/results：扁平负载，无嵌套 job */
export interface JobResults {
  job_id: string;
  version: number;
  review_status: ReviewStatus;
  page_count: number;
  table_count: number;
  field_count: number;
  missing_pages: number[];
  /** TextIn Prompt 模式结构化 JSON（key-value 字段 + 表格） */
  structured: unknown;
  pages: ResultPage[];
}

export interface ExportInfo {
  id: string;
  job_id: string;
  format: 'XLSX' | 'CSV' | 'TXT';
  status: string;
  expires_at: string;
  created_at: string;
}

/** GET /me/tenants：当前有效身份 + 在审申请（企业认证/套餐续期） */
export interface PendingApplication {
  id: number;
  type: string;
  status: string;
}

export interface TenantsPayload {
  tenants: Tenant[];
  pending_applications: PendingApplication[];
}

export interface PlanPrice {
  monthly_thb: number | null;
  yearly_thb: number | null;
  display: string;
}

export interface Plan {
  code: string;
  name: string;
  price: PlanPrice;
  quota_pages_per_month: number;
  seats: number;
  features: string[];
}

/** 订阅状态：ACTIVE 可用；EXPIRED 到期硬停；NONE 企业未认证（未开通） */
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'NONE';

/** 订阅有效期（/me/quota 内嵌的精简视图） */
export interface SubscriptionPeriod {
  status: SubscriptionStatus;
  starts_at: string | null;
  expires_at: string | null;
  /** 剩余自然日：当天到期为 0，已过期为负数 */
  days_remaining: number | null;
}

/** 只有一种计量：OCR_PAGE 月页额度（没有 Free 档位、没有赠送次数） */
export interface QuotaTenant {
  tenant_id: number;
  tenant_type: 'PERSONAL' | 'ENTERPRISE';
  name: string | null;
  plan: {
    code: string | null;
    name: string | null;
    is_paid: boolean;
    source?: 'DEFAULT' | 'APPROVED' | null;
    metering?: 'OCR_PAGE';
  };
  subscription: SubscriptionPeriod;
  pages: { monthly_total: number; remaining: number };
}

export interface QuotaPayload {
  tenants: QuotaTenant[];
}

export interface PlansPayload {
  currency: string;
  payment: string;
  items: Plan[];
}

export interface PlanApplicationBrief {
  plan_code: string | null;
  plan_name: string | null;
  application_id: number | null;
  submitted_at: string | null;
}

/**
 * GET /me/subscription：租户当前权益。
 * status 只表达「现在能不能用」；pending 为在审的续期/升级申请，既不提升也不降低当前权益。
 */
export interface Subscription extends PlanApplicationBrief {
  status: SubscriptionStatus;
  source?: 'DEFAULT' | 'APPROVED' | null;
  starts_at: string | null;
  expires_at: string | null;
  days_remaining: number | null;
  pending: PlanApplicationBrief | null;
  tenant_id: number;
  tenant_type: 'PERSONAL' | 'ENTERPRISE';
  /** 企业租户仅 OWNER 可提交续期/升级申请 */
  can_manage: boolean;
}

/** 租户引用：缺省/null 即调用者的个人租户 */
export type TenantRef = number | null | undefined;

/** 站内通知类型（首页铃铛） */
export type NotificationType =
  | 'PLAN_EXPIRING'
  | 'PLAN_EXPIRED'
  | 'OCR_DONE'
  | 'PLAN_UPGRADE_SUBMITTED'
  | 'MEMBERSHIP_ACTIVE';

export interface NotificationItem {
  id: number;
  type: NotificationType | string;
  title: string;
  body: string;
  read: boolean;
  created_at: string | null;
}

export interface NotificationsPayload {
  unread_count: number;
  items: NotificationItem[];
}

export interface CompanyDetail {
  id: number;
  /** 企业对应的租户 id（归属与订阅一律用它） */
  tenant_id: number;
  code: string;
  legal_name: string;
  registration_no: string;
  contact_phone: string;
  cert_file_id: string | null;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED' | 'DISABLED' | string;
  /** 人工认证通过时间；订阅有效期从此起算 */
  verified_at?: string | null;
  created_at?: string | null;
}

export interface MyCompany extends CompanyDetail {
  my_role: 'OWNER' | 'ADMIN' | 'MEMBER' | string;
  membership_status: 'PENDING' | 'ACTIVE' | string;
}

export interface CompanyInput {
  legal_name: string;
  registration_no: string;
  contact_phone: string;
  cert_file_id?: string | null;
}

// ---------- 认证 ----------

export function createGuestSession(language: 'th' | 'en'): Promise<AuthPayload> {
  return request<AuthPayload>('/auth/guest', { method: 'POST', json: { language } });
}

export function loginWithLine(idToken: string, language: 'th' | 'en'): Promise<AuthPayload> {
  return request<AuthPayload>('/auth/line', { method: 'POST', json: { id_token: idToken, language } });
}

/** 仅本地开发可用，后端仍需 AUTH_DEV_MODE=1；生产在发送请求前拒绝（FR-SYS-001/014） */
export async function loginWithDevId(devId: string, language: 'th' | 'en'): Promise<AuthPayload> {
  if (!import.meta.env.DEV) {
    throw new Error('Developer sign-in is only available in local development.');
  }
  return request<AuthPayload>('/auth/line', { method: 'POST', json: { dev_id: devId, language } });
}

export function fetchSession(timeoutMs?: number): Promise<AuthPayload> {
  return request<AuthPayload>('/auth/session', { timeoutMs });
}

export function completeRegistration(input: {
  display_name: string;
  avatar_url: string;
  phone: string;
  email: string;
  code: string;
}): Promise<User> {
  return request<User>('/me/registration', { method: 'POST', json: input });
}

/** 个人中心可改字段：昵称/头像/语言/手机号（手机号空串即清空） */
export function updateProfile(input: {
  display_name?: string;
  avatar_url?: string;
  language?: 'th' | 'en';
  phone?: string;
}): Promise<User> {
  return request<User>('/me', { method: 'PATCH', json: input });
}

export function sendEmailCode(email: string): Promise<{ sent: boolean; cooldown_seconds: number }> {
  return request('/me/email/code', { method: 'POST', json: { email } });
}

export function changeEmail(email: string, code: string): Promise<User> {
  return request<User>('/me/email', { method: 'POST', json: { email, code } });
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST', timeoutMs: 10000 });
  } finally {
    setCsrfToken(null);
  }
}

// ---------- 上传（三段式） ----------

/** tenantId 缺省/为 null 即个人租户，请求体不带该字段 */
function tenantBody(tenantId: TenantRef): { tenant_id?: number } {
  return tenantId == null ? {} : { tenant_id: tenantId };
}

export function createUpload(
  fileName: string,
  sizeBytes: number,
  tenantId?: TenantRef,
  purpose: 'OCR_TASK' | 'APPLICATION_MATERIAL' = 'OCR_TASK',
): Promise<{ file: FileInfo; upload_id: string }> {
  return request('/uploads', {
    method: 'POST',
    json: { file_name: fileName, size_bytes: sizeBytes, purpose, ...tenantBody(tenantId) },
    transport: 'xhr',
    timeoutMs: 120000,
  });
}

export function uploadContent(
  uploadId: string,
  data: Blob,
  contentType: string,
  onUploadProgress?: (fraction: number) => void,
): Promise<void> {
  return request(`/uploads/${uploadId}/content`, {
    method: 'PUT',
    rawBody: data,
    contentType,
    onUploadProgress,
    transport: 'xhr',
    timeoutMs: 120000,
  });
}

export function completeUpload(uploadId: string): Promise<{ file: FileInfo }> {
  return request(`/uploads/${uploadId}/complete`, { method: 'POST', transport: 'xhr', timeoutMs: 120000 });
}

export function importFromUrl(url: string, tenantId?: TenantRef): Promise<{ file: FileInfo }> {
  return request('/file-imports', { method: 'POST', json: { url, ...tenantBody(tenantId) } });
}

export function getFile(fileId: string): Promise<{ file: FileInfo }> {
  return request(`/files/${fileId}`);
}

/** 文件内容/预览走 cookie 鉴权的同源 URL，直接给 <img>/<a> 用 */
export function fileContentUrl(fileId: string): string {
  return `${API_BASE}/files/${fileId}/content`;
}
export function filePagePreviewUrl(fileId: string, page: number): string {
  return `${API_BASE}/files/${fileId}/pages/${page}/preview`;
}
/** 全部页的预览图 URL（图片为 1 页；PDF 由服务端逐页渲染） */
export function filePageUrls(fileId: string, pageCount: number): string[] {
  return Array.from({ length: Math.max(pageCount || 1, 1) }, (_, i) => filePagePreviewUrl(fileId, i + 1));
}

// ---------- OCR 任务 ----------

export interface CreateJobInput {
  file_id: string;
  params?: {
    parse_mode?: 'scan' | 'layout' | 'article';
    table?: boolean;
    formula?: boolean;
    rotate?: boolean;
    page?: number;
    page_count?: number;
  };
  field_names?: string[];
  idempotency_key?: string;
}

export function createJob(input: CreateJobInput): Promise<JobSummary> {
  const { idempotency_key, ...json } = input;
  return request<JobSummary>('/ocr/jobs', {
    method: 'POST',
    json,
    idempotencyKey: idempotency_key,
  });
}

export function listJobs(
  query: {
    status?: string;
    stage?: JobStage;
    q?: string;
    page?: number;
    page_size?: number;
    tenantId?: TenantRef;
  } = {},
): Promise<JobList> {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.stage) qs.set('stage', query.stage);
  if (query.q) qs.set('q', query.q);
  if (query.page) qs.set('page', String(query.page));
  if (query.page_size) qs.set('page_size', String(query.page_size));
  // 缺省不带 tenant_id，由后端解析为个人租户
  if (query.tenantId != null) qs.set('tenant_id', String(query.tenantId));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<JobList>(`/ocr/jobs${suffix}`);
}

export function getJob(jobId: string): Promise<JobSummary> {
  return request<JobSummary>(`/ocr/jobs/${jobId}`);
}

export function cancelJob(jobId: string): Promise<JobSummary> {
  return request<JobSummary>(`/ocr/jobs/${jobId}/cancel`, { method: 'POST' });
}

export function rerunJob(jobId: string): Promise<JobSummary> {
  return request<JobSummary>(`/ocr/jobs/${jobId}/rerun`, { method: 'POST' });
}

export function deleteJob(jobId: string): Promise<{ id: string; results_deleted: boolean }> {
  return request(`/ocr/jobs/${jobId}`, { method: 'DELETE' });
}

// ---------- 结果与复核 ----------

export function getJobResults(jobId: string): Promise<JobResults> {
  return request<JobResults>(`/ocr/jobs/${jobId}/results`);
}

export interface ResultsUpdateInput {
  expected_version: number;
  /** Prompt 模式完整结构化结果（字段 + 表格）；与逐页 cell edits 二选一 */
  structured?: unknown;
  confirm?: boolean;
}

export function updateJobResults(jobId: string, input: ResultsUpdateInput): Promise<JobResults> {
  return request<JobResults>(`/ocr/jobs/${jobId}/results`, { method: 'PATCH', json: input });
}

// ---------- 导出 ----------

export function createExport(jobId: string, format: 'XLSX' | 'CSV' | 'TXT'): Promise<ExportInfo> {
  return request<ExportInfo>(`/ocr/jobs/${jobId}/exports`, { method: 'POST', json: { format } });
}

export function getExport(exportId: string): Promise<ExportInfo> {
  return request<ExportInfo>(`/exports/${exportId}`);
}

export function exportDownloadUrl(exportId: string): string {
  return `${API_BASE}/exports/${exportId}/download`;
}

// ---------- 公司（添加/修改/编号绑定/解绑） ----------

export function createCompany(input: CompanyInput): Promise<{ enterprise: CompanyDetail }> {
  return request<{ enterprise: CompanyDetail }>('/enterprises', { method: 'POST', json: input });
}

export function getMyCompanies(): Promise<{ items: MyCompany[] }> {
  return request<{ items: MyCompany[] }>('/enterprises/mine');
}

export function updateCompany(
  enterpriseId: number,
  input: CompanyInput,
): Promise<{ enterprise: CompanyDetail }> {
  return request<{ enterprise: CompanyDetail }>(`/enterprises/${enterpriseId}`, { method: 'PATCH', json: input });
}

export function bindCompany(code: string): Promise<{ enterprise: CompanyDetail; role: string }> {
  return request<{ enterprise: CompanyDetail; role: string }>('/enterprises/bind', {
    method: 'POST',
    json: { code },
  });
}

export function unbindCompany(enterpriseId: number): Promise<{ enterprise_id: number; status: string }> {
  return request<{ enterprise_id: number; status: string }>(`/enterprises/${enterpriseId}/unbind`, {
    method: 'POST',
    json: {},
  });
}

// ---------- 套餐与配额（PRD v1.4 §20） ----------

export function fetchPlans(): Promise<PlansPayload> {
  return request<PlansPayload>('/plans');
}

export function fetchQuota(): Promise<QuotaPayload> {
  return request<QuotaPayload>('/me/quota');
}

/** GET /me/tenants：身份列表 + 在审申请 */
export function fetchTenants(): Promise<TenantsPayload> {
  return request<TenantsPayload>('/me/tenants');
}

export function fetchSubscription(tenantId?: TenantRef): Promise<Subscription> {
  const qs = tenantId != null ? `?tenant_id=${tenantId}` : '';
  return request<Subscription>(`/me/subscription${qs}`);
}

export function submitPlanApplication(planCode: string, tenantId?: TenantRef): Promise<Subscription> {
  return request<Subscription>('/me/plan-applications', {
    method: 'POST',
    json: { plan_code: planCode, ...tenantBody(tenantId) },
  });
}

// ---------- 站内通知（首页铃铛） ----------

export function fetchNotifications(): Promise<NotificationsPayload> {
  return request<NotificationsPayload>('/me/notifications');
}

/** ids 缺省即全部标记已读 */
export function markNotificationsRead(ids?: number[]): Promise<{ updated: number; unread_count: number }> {
  return request('/me/notifications/read', {
    method: 'POST',
    json: ids && ids.length ? { ids } : {},
  });
}
