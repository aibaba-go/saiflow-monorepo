import { useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, Select, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import type { Document, DocumentType } from '../../api/types';
import { headerFieldKeys } from '../../mock/dataset';
import { DocTypeTag, StatusTag } from './meta';

/** 跨文档批量更正（P1，FR-VERIFY-003）：多选单据 → 同一字段批量赋值 → 逐单记录变更日志。 */
export default function BatchEditPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const storeState = useMockStoreState();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fieldKey, setFieldKey] = useState<string | undefined>(undefined);
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 可更正的单据：核验中（字段可编辑）状态
  const editableDocs = useMemo(
    () =>
      (storeState?.documents ?? [])
        .filter((doc) => doc.status === 'extracted' || doc.status === 'in_review')
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [storeState],
  );
  const selectedDocs = useMemo(
    () => editableDocs.filter((doc) => selectedIds.includes(doc.id)),
    [editableDocs, selectedIds],
  );

  // 字段选项：所选单据类型的字段键并集（不同类型字段名不同，仅交集才有意义）
  const fieldOptions = useMemo(() => {
    const types = new Set<DocumentType>(selectedDocs.map((doc) => doc.doc_type));
    if (types.size === 0) return [];
    let keys = types.size === 1 ? headerFieldKeys([...types][0]) : undefined;
    if (!keys) {
      // 多类型并集：仅保留各类型共有的键（如 supplier_name / total_price）
      const all = [...types].map((type) => new Set(headerFieldKeys(type)));
      keys = headerFieldKeys([...types][0]).filter((key) => all.every((set) => set.has(key)));
    }
    return keys.map((key) => ({
      value: key,
      label: t(`fields.${key}`) === `fields.${key}` ? key : t(`fields.${key}`),
    }));
  }, [selectedDocs, t]);

  const handleSubmit = async (): Promise<void> => {
    if (selectedIds.length === 0) {
      message.warning(t('batch.noSelection'));
      return;
    }
    if (!fieldKey || !newValue.trim()) {
      message.warning(t('batch.noField'));
      return;
    }
    setSubmitting(true);
    try {
      await api.batchUpdateField({
        document_ids: selectedIds,
        field_key: fieldKey,
        new_value: newValue.trim(),
        reason: reason.trim() || undefined,
      });
      message.success(t('batch.submitSuccess', { count: selectedIds.length }));
      setSelectedIds([]);
      setFieldKey(undefined);
      setNewValue('');
      setReason('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: t('batch.listColumns.docType'),
        dataIndex: 'doc_type',
        render: (docType: DocumentType) => <DocTypeTag docType={docType} />,
      },
      { title: t('batch.listColumns.docNumber'), dataIndex: 'doc_number' },
      { title: t('batch.listColumns.enterprise'), dataIndex: 'enterprise_name' },
      {
        title: t('batch.listColumns.status'),
        dataIndex: 'status',
        render: (status: Document['status']) => <StatusTag status={status} />,
      },
    ],
    [t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('batch.title')}
      </Typography.Title>
      <Typography.Text type="secondary">{t('batch.hint')}</Typography.Text>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={editableDocs}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: t('common.noData') }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
          }}
        />
      </Card>

      <Card>
        <Form layout="vertical" style={{ maxWidth: 560 }}>
          <Form.Item label={t('batch.fieldKey')}>
            <Select
              value={fieldKey}
              options={fieldOptions}
              placeholder={t('batch.fieldKey')}
              onChange={(value) => setFieldKey(value)}
              disabled={selectedIds.length === 0}
            />
          </Form.Item>
          <Form.Item label={t('batch.newValue')}>
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              disabled={!fieldKey}
              placeholder={t('batch.newValue')}
            />
          </Form.Item>
          <Form.Item label={t('batch.reason')}>
            <Input.TextArea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('batch.reasonPlaceholder')}
              disabled={!fieldKey}
            />
          </Form.Item>
          <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            {t('batch.submit')}
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
