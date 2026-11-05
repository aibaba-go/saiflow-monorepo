import type { MessageKey } from "./zh";

export const en: Record<MessageKey, string> = {
  "app.title": "SaiFlow Admin Console",
  "lang.zh": "中文",
  "lang.en": "English",

  "login.title": "Admin login",
  "login.username": "Username",
  "login.password": "Password",
  "login.submit": "Log in",

  "nav.home": "Home",
  "nav.organizationApplications": "Organization applications",
  "nav.organizations": "Organizations",
  "nav.verification": "Verification",
  "nav.planApplications": "Plan applications",
  "nav.plans": "Plans",
  "nav.settings": "Settings",
  "nav.users": "Users",
  "nav.auditLog": "Operation log",
  "nav.ocr": "OCR & LLM",
  "nav.changePassword": "Change password",
  "nav.logout": "Log out",

  "common.confirm": "OK",
  "common.cancel": "Cancel",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.save": "Save",
  "common.notFound": "Page not found",

  "field.required": "This field is required",
  "field.username": "Enter the username",
  "field.password": "Enter the password",

  "err.unknown": "Something went wrong. Please try again later.",
  "err.network": "Cannot reach the server. Check the network and try again.",
  "err.unauthenticated": "Your session has expired. Please log in again.",
  "err.admin_login_failed": "Wrong username or password",
  "err.permission_denied": "You are not allowed to do this",
  "err.not_found": "The record does not exist or was deleted",
  "err.validation_error": "Some input is invalid. Please check and try again.",
  "err.already_decided": "This application was already handled. The list has been refreshed.",
  "err.csrf_header_missing": "The request was refused. Refresh the page and try again.",
};
