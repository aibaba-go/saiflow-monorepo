/**
 * LINE LIFF 接入：初始化并取 ID token，桌面浏览器也支持 LIFF OAuth 登录。
 * 未登录时仅在用户点击 LINE 按钮后重定向，不打断游客试用；
 * 未配置或初始化失败时提示不可用或重试，不降级到开发登录。
 */
import liff from '@line/liff';

export interface LiffState {
  isInLine: boolean;
  idToken: string | null;
  /** 仅初始化成功、外部浏览器且位于已登记 Endpoint 下时允许 OAuth。 */
  loginAvailable: boolean;
  /** SDK 已初始化但客户端握手或入口域名不匹配：仅显式点击时从官方入口恢复。 */
  needsReopen?: boolean;
  /** 配置了 VITE_LIFF_ID 但初始化/读取 SDK 会话失败：可重试 */
  initFailed: boolean;
  /** 仅返回安全的错误分类，不暴露 token、SDK 原始异常或 URL。 */
  failureReason?: 'timeout' | 'init' | 'session';
}

const LIFF_INIT_TIMEOUT_MS = 20_000;
const INIT_TIMEOUT = Symbol('LIFF initialization timeout');
const REOPEN_KEY = 'saiflow_liff_reopen';
let initPromise: Promise<void> | null = null;
let initialized = false;

export async function initLiff(): Promise<LiffState> {
  const liffId = import.meta.env.VITE_LIFF_ID as string | undefined;
  if (!liffId) return { isInLine: false, idToken: null, loginAvailable: false, initFailed: false };
  let stage: 'init' | 'session' = 'init';
  let timedOut = false;
  try {
    if (!initPromise) {
      const sdkInit = liff.init({ liffId });
      initPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          reject(INIT_TIMEOUT);
        }, LIFF_INIT_TIMEOUT_MS);
        sdkInit.then(() => {
          clearTimeout(timer);
          if (!timedOut) { initialized = true; resolve(); }
        }, error => { clearTimeout(timer); reject(error); });
      });
    }
    await initPromise;
    stage = 'session';
    // 只缓存初始化，不缓存 token；退出/重新授权后读取 SDK 当前状态。
    const idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
    const isInLine = liff.isInClient();
    const endpointUrl = !isInLine && !idToken ? liff.getContext()?.endpointUrl : null;
    let loginAvailable = false;
    if (!isInLine && endpointUrl) {
      const endpoint = new URL(endpointUrl);
      const current = new URL(window.location.href);
      const prefix = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`;
      // 两种 run.app 地址也不是同源：跨源回调会丢失 PKCE 与游客 Cookie，不能强行 OAuth。
      loginAvailable = current.origin === endpoint.origin
        && (current.pathname === endpoint.pathname || current.pathname.startsWith(prefix));
    }
    const needsReopen = !idToken && !loginAvailable;
    // 仅真正可继续认证时清标记；LINE 内“初始化成功但无 token”不能反复重开。
    if (!needsReopen) {
      try { sessionStorage.removeItem(REOPEN_KEY); } catch { /* 不依赖浏览器存储完成初始化 */ }
    }
    return { isInLine, idToken, loginAvailable, needsReopen, initFailed: false };
  } catch (error) {
    initPromise = null;
    initialized = false;
    return { isInLine: false, idToken: null, loginAvailable: false, initFailed: true,
      failureReason: error === INIT_TIMEOUT ? 'timeout' : stage };
  }
}

/**
 * FR-SYS-001/011：仅由登录按钮在 SDK 失败时调用，重走官方 LIFF 入口以恢复客户端握手。
 * sessionStorage 保留原有 auth intent/待续单据；最多重开一次，失败不循环、不用开发身份。
 * 不携带当前 URL 查询参数，避免转发 OAuth code 或 token。
 */
export function reopenLineLogin(): boolean {
  const liffId = import.meta.env.VITE_LIFF_ID as string | undefined;
  if (!liffId) return false;
  try {
    if (sessionStorage.getItem(REOPEN_KEY) === liffId) return false;
    sessionStorage.setItem(REOPEN_KEY, liffId);
  } catch { return false; } // 无法记录重开次数时宁可停止，避免循环
  try {
    window.location.href = `https://liff.line.me/${encodeURIComponent(liffId)}`;
    return true;
  } catch {
    try { sessionStorage.removeItem(REOPEN_KEY); } catch { /* ignore */ }
    return false;
  }
}

/** LIFF 内可能不支持 logout；应用始终不在启动时静默兑换残留 token。 */
export function signOutLiff(): void {
  try {
    if (initialized && liff.isLoggedIn()) liff.logout();
  } catch { /* 应用会话的撤销不依赖 SDK */ }
}

/** token 被服务端拒绝后清旧 SDK 缓存，下一次显式点击重新授权。 */
export function resetLiffLogin(): void {
  signOutLiff();
  initPromise = null;
  initialized = false;
}

/** FR-SYS-001/011：仅由 loginAvailable 分支显式调用，使用 LINE 已登记 Endpoint。
 * 不覆盖 redirectUri，避免把 OAuth 残留参数或未登记的当前 URL 带入授权。
 */
export function redirectToLineLogin(): void {
  liff.login();
}

/** LINE 内关闭窗口（如不可用则忽略） */
export function closeLiffWindow(): void {
  try {
    if (liff.isInClient()) liff.closeWindow();
  } catch {
    /* ignore */
  }
}
