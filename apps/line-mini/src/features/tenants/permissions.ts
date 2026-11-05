import type { CurrentTenant } from "../../stores/session";

/** The 13 permission points (FR-SYS-002); the owner holds all of them. */
export type Permission =
  | "upload_ocr"
  | "verify_own"
  | "verify_others"
  | "review_l1"
  | "review_l2"
  | "export"
  | "data_browse"
  | "member_manage"
  | "role_manage"
  | "plan_apply"
  | "verification_apply"
  | "template_manage"
  | "report_view";

export const PERMISSIONS: Permission[] = [
  "upload_ocr",
  "verify_own",
  "verify_others",
  "review_l1",
  "review_l2",
  "export",
  "data_browse",
  "member_manage",
  "role_manage",
  "plan_apply",
  "verification_apply",
  "template_manage",
  "report_view",
];

/** Whether the user may do this in the tenant (A8: actions without permission are hidden). */
export function can(tenant: CurrentTenant | null, permission: Permission): boolean {
  if (!tenant) return false;
  return tenant.is_owner || tenant.permissions.includes(permission);
}
