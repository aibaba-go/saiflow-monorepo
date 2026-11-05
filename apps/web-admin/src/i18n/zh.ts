/** Chinese is the console's default language and the source of the keys (FR-SYS-062). */
export const zh = {
  "app.title": "SaiFlow 运营后台",
  "lang.zh": "中文",
  "lang.en": "English",

  "login.title": "管理员登录",
  "login.username": "用户名",
  "login.password": "密码",
  "login.submit": "登录",

  "nav.home": "首页",
  "nav.organizationApplications": "组织申请",
  "nav.organizations": "组织",
  "nav.verification": "认证审核",
  "nav.planApplications": "套餐申请",
  "nav.plans": "套餐",
  "nav.settings": "系统设置",
  "nav.users": "用户",
  "nav.auditLog": "操作日志",
  "nav.ocr": "OCR 与 LLM",
  "nav.changePassword": "修改密码",
  "nav.logout": "退出登录",

  "common.confirm": "确定",
  "common.cancel": "取消",
  "common.loading": "加载中…",
  "common.retry": "重试",
  "common.save": "保存",
  "common.notFound": "页面不存在",

  "field.required": "请填写此项",
  "field.username": "请输入用户名",
  "field.password": "请输入密码",

  "err.unknown": "操作失败，请稍后重试",
  "err.network": "无法连接服务器，请检查网络后重试",
  "err.unauthenticated": "登录已过期，请重新登录",
  "err.admin_login_failed": "用户名或密码错误",
  "err.permission_denied": "没有权限执行此操作",
  "err.not_found": "记录不存在或已被删除",
  "err.validation_error": "输入有误，请检查后重试",
  "err.already_decided": "该申请已被处理，列表已刷新",
  "err.csrf_header_missing": "请求被拒绝，请刷新页面后重试",
} as const;

export type MessageKey = keyof typeof zh;
