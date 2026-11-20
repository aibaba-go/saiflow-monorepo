import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

/** 未登录 → 重定向登录页，登录后回跳原目标页。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export type PermissionKey = 'upload' | 'verify' | 'review' | 'entry' | 'configure' | 'manage';

/** 权限不足 → 403 提示页（FR-SYS-002 权限强制执行）。 */
export function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { permissions } = useAuth();
  const { t } = useTranslation();

  if (!permissions) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  }
  // manage 为分级权限（none/own/assigned/all），none 之外均允许进入（原型按全量展示）
  const allowed =
    permission === 'manage' ? permissions.manage !== 'none' : Boolean(permissions[permission]);
  if (!allowed) {
    return (
      <Result
        status="403"
        title={t('forbidden.title')}
        subTitle={t('forbidden.description')}
      />
    );
  }
  return <>{children}</>;
}
