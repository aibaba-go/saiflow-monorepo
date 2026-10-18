/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发免登录开关：'true' 时显示开发者登录；vite dev 下 LINE 按钮直接使用开发身份（需后端 AUTH_DEV_MODE=1） */
  readonly VITE_AUTO_DEV_LOGIN?: string;
  /** 开发者登录身份（默认 demo-user；输入框可修改） */
  readonly VITE_DEV_LOGIN_ID?: string;
  /** 'true' 时生产构建也让 LINE 按钮直接使用开发身份（临时，需后端 AUTH_DEV_MODE=1） */
  readonly VITE_DEV_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
