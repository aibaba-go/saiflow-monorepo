import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  Layout as AntLayout,
  Menu,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  AuditOutlined,
  BookOutlined,
  CloudUploadOutlined,
  EditOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { UiLanguage } from '../i18n/locales';
import { storeLanguage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import type { PermissionKey } from '../auth/guards';

const { Header, Sider, Content } = AntLayout;

export interface NavItem {
  key: string;
  path: string;
  icon: React.ReactNode;
  labelKey: string;
  /** 无 permission 的项对所有角色可见。 */
  permission?: PermissionKey;
}

/** 全部导航项；可见性按 EPIC-06 §3 权限矩阵过滤。 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', path: '/', icon: <HomeOutlined />, labelKey: 'nav.home' },
  { key: 'upload', path: '/upload', icon: <CloudUploadOutlined />, labelKey: 'nav.upload', permission: 'upload' },
  { key: 'verification', path: '/verification', icon: <AuditOutlined />, labelKey: 'nav.verification', permission: 'verify' },
  { key: 'review', path: '/review', icon: <FileSearchOutlined />, labelKey: 'nav.review', permission: 'review' },
  { key: 'batch-edit', path: '/verification/batch', icon: <EditOutlined />, labelKey: 'nav.batchEdit', permission: 'verify' },
  { key: 'entry-archiving', path: '/entry-archiving', icon: <BookOutlined />, labelKey: 'nav.entryArchiving', permission: 'entry' },
  { key: 'archive-browser', path: '/archive', icon: <FolderOpenOutlined />, labelKey: 'nav.archiveBrowser' },
  { key: 'settings', path: '/settings', icon: <SettingOutlined />, labelKey: 'nav.settings', permission: 'configure' },
  { key: 'operation-log', path: '/settings/operation-log', icon: <FileTextOutlined />, labelKey: 'nav.operationLog', permission: 'configure' },
];

const LANGUAGE_OPTIONS: { label: string; value: UiLanguage }[] = [
  { label: 'ไทย', value: 'th' },
  { label: 'English', value: 'en' },
  { label: '中文', value: 'zh' },
];

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, permissions, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.permission || permissions?.[item.permission]),
    [permissions],
  );

  const selectedKey = useMemo(() => {
    const match = [...visibleItems]
      .sort((a, b) => b.path.length - a.path.length)
      .find((item) => location.pathname === item.path || location.pathname.startsWith(item.path + '/'));
    return match?.key ?? 'home';
  }, [location.pathname, visibleItems]);

  const currentLanguage = (i18n.language as UiLanguage) ?? 'th';

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Space size="middle">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('app.title')}
          </Typography.Title>
          <Tag color="warning">{t('app.mockBadge')}</Tag>
        </Space>
        <Space size="middle">
          {session && (
            <Typography.Text>
              {session.user.display_name} ·{' '}
              {session.user.roles.map((role) => t(`roles.${role}`)).join(', ')}
            </Typography.Text>
          )}
          <Segmented
            options={LANGUAGE_OPTIONS}
            value={currentLanguage}
            onChange={(value) => {
              const language = value as UiLanguage;
              void i18n.changeLanguage(language);
              storeLanguage(language);
            }}
          />
          <Typography.Link
            onClick={() => {
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            <LogoutOutlined /> {t('common.logout')}
          </Typography.Link>
        </Space>
      </Header>
      <AntLayout>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          theme="light"
          style={{ borderRight: '1px solid #f0f0f0' }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={visibleItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: t(item.labelKey),
            }))}
            onClick={({ key }) => {
              const item = visibleItems.find((nav) => nav.key === key);
              if (item) navigate(item.path);
            }}
          />
        </Sider>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
