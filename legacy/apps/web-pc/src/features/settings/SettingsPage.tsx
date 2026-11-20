import { useState } from 'react';
import { App, Button, Card, Input, Select, Space, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import type { DocumentType, ReviewLevel, Settings } from '../../api/types';
import { DocTypeTag } from '../verification/meta';

const DOC_TYPES: DocumentType[] = ['INVOICE', 'DELIVERY_NOTE', 'PO', 'RECEIPT'];
const LEVELS: ReviewLevel[] = [0, 1, 2];

/**
 * 系统设置（web-pc/settings-admin spec，仅 admin）：
 * 导出路径 / 归档命名规则 / 分类前缀模板 / 按类型复核级别（0/1/2）。
 * 保存写回 Mock 存储并立即驱动相关页面（FR-SYS-005/006，FR-VERIFY-010）。
 */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const storeState = useMockStoreState();
  const settings = storeState?.settings;

  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  // 未编辑时直接派生自 store 设置（避免 effect 内同步 setState）
  const current: Settings | null =
    draft ?? (settings ? { ...settings, review_levels: { ...settings.review_levels } } : null);
  if (!current) return null;

  const dirty =
    !!draft &&
    !!settings &&
    (draft.export_save_path !== settings.export_save_path ||
      draft.archive_naming_rule !== settings.archive_naming_rule ||
      draft.archive_prefix_template !== settings.archive_prefix_template ||
      JSON.stringify(draft.review_levels) !== JSON.stringify(settings.review_levels));

  const update = (partial: Partial<Settings>): void => {
    setDraft({ ...current, ...partial });
  };
  const updateLevel = (docType: DocumentType, level: ReviewLevel): void => {
    setDraft({ ...current, review_levels: { ...current.review_levels, [docType]: level } });
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.updateSettings({
        export_save_path: current.export_save_path,
        archive_naming_rule: current.archive_naming_rule,
        archive_prefix_template: current.archive_prefix_template,
        review_levels: { ...current.review_levels },
      });
      message.success(t('settings.saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('settings.title')}
      </Typography.Title>

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 720 }}>
          <div>
            <Typography.Text strong>{t('settings.exportPath')}</Typography.Text>
            <Input
              value={draft?.export_save_path ?? current.export_save_path}
              onChange={(e) => update({ export_save_path: e.target.value })}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text strong>{t('settings.namingRule')}</Typography.Text>
            <Input
              value={draft?.archive_naming_rule ?? current.archive_naming_rule}
              onChange={(e) => update({ archive_naming_rule: e.target.value })}
              style={{ marginTop: 4 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {t('settings.placeholderHint')}
            </Typography.Text>
          </div>
          <div>
            <Typography.Text strong>{t('settings.prefixTemplate')}</Typography.Text>
            <Input
              value={draft?.archive_prefix_template ?? current.archive_prefix_template}
              onChange={(e) => update({ archive_prefix_template: e.target.value })}
              style={{ marginTop: 4 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {t('settings.prefixHint')}
            </Typography.Text>
          </div>
        </Space>
      </Card>

      <Card title={t('settings.reviewLevels')}>
        <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 720 }}>
          {DOC_TYPES.map((docType) => (
            <Space key={docType} size="middle">
              <DocTypeTag docType={docType} />
              <Select
                value={(draft ?? current).review_levels[docType]}
                onChange={(level) => updateLevel(docType, level)}
                style={{ width: 200 }}
                options={LEVELS.map((level) => ({ value: level, label: t(`settings.reviewLevel.${level}`) }))}
              />
            </Space>
          ))}
        </Space>
      </Card>

      <Space>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty}
          onClick={() => void handleSave()}
        >
          {t('settings.save')}
        </Button>
      </Space>
    </Space>
  );
}
