/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** LINE LIFF 应用 ID；需启用 openid scope；未配置时 LINE 登录不可用，不自动重定向或降级开发登录 */
  readonly VITE_LIFF_ID?: string;
  /** 仅 import.meta.env.DEV 且值为 'true' 时显示手动开发者登录（需后端 AUTH_DEV_MODE=1）；生产无效，LINE 按钮始终走 LINE 认证 */
  readonly VITE_AUTO_DEV_LOGIN?: string;
  /** 本地开发者登录身份（默认 demo-user；输入框可修改） */
  readonly VITE_DEV_LOGIN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
