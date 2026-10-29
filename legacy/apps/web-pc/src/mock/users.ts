import type { Role, User } from '../api/types';

/**
 * Mock 用户集（design.md 决策 6）：密码一律等于用户名。
 * 覆盖 EPIC-06 §3 权限矩阵中的五种演示角色。
 */
export const MOCK_USERS: (User & { password: string })[] = [
  { id: 'user-clerk1', username: 'clerk1', display_name: 'สมชาย วีระกุล (Somchai W.)', roles: ['clerk'], password: 'clerk1' },
  { id: 'user-finance1', username: 'finance1', display_name: 'Somsri Finance (สมศรี ก.)', roles: ['finance'], password: 'finance1' },
  { id: 'user-reviewer1', username: 'reviewer1', display_name: 'Anucha Review (อนุชา ร.)', roles: ['reviewer'], password: 'reviewer1' },
  { id: 'user-viewer1', username: 'viewer1', display_name: 'Paper Viewer (ผู้ชม)', roles: ['viewer'], password: 'viewer1' },
  { id: 'user-admin', username: 'admin', display_name: 'System Administrator (ผู้ดูแลระบบ)', roles: ['admin'], password: 'admin' },
];

/** EPIC-06 §3 权限矩阵 → 每个导航/动作域的角色白名单。 */
export interface Permissions {
  upload: boolean;
  verify: boolean;
  review: boolean;
  entry: boolean;
  manage: 'none' | 'own' | 'assigned' | 'all';
  report: boolean;
  configure: boolean;
}

export function permissionsFor(roles: Role[]): Permissions {
  const has = (role: Role) => roles.includes(role);
  const any = (...rs: Role[]) => rs.some(has);
  const manage: Permissions['manage'] = has('admin') || has('finance') || has('viewer')
    ? 'all' // admin/finance 全量；viewer 只读查看
    : has('reviewer')
      ? 'assigned'
      : 'own'; // clerk 仅本人
  return {
    upload: any('clerk', 'finance', 'admin'),
    verify: any('clerk', 'finance', 'admin'),
    review: any('reviewer', 'finance', 'admin'),
    entry: any('clerk', 'finance', 'admin'),
    manage,
    report: has('admin'),
    configure: has('admin'),
  };
}
