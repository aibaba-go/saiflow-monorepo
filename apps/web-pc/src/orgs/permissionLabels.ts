// Ported from apps/line-mini/src/features/orgs/permissionLabels.ts (web-pc-account plan: copied, not shared).
import type { MessageKey } from "../i18n";
import type { Permission } from "../tenants/permissions";

/** The localized name of each permission point (FR-SYS-049). */
export const permissionKey = (p: Permission | string): MessageKey => `perm.${p}` as MessageKey;
