import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Space,
  Table,
  Tree,
  Typography,
} from 'antd';
import { FileImageOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import { ExportGateError } from '../../api/errors';
import type { ArchiveRecord, Document } from '../../api/types';
import { buildArchiveFileName } from '../../mock/naming';
import { canEnterBusiness } from '../../mock/stateMachine';
import { DocTypeTag, StatusTag } from '../verification/meta';
import { buildExportWorkbook, downloadWorkbook, exportFileName } from './exportWorkbook';

/** 录入区可见状态：已提取 → 已批准（含各待复核中间态，便于演示"未批准被拦截"）。 */
const ENTRY_STATUSES = new Set<Document['status']>([
  'extracted',
  'in_review',
  'verified',
  'pending_review_level_1',
  'pending_review_level_2',
  'approved_for_business',
]);

interface ArchiveEntry {
  record: ArchiveRecord;
  document: Document | undefined;
}

/**
 * 录入与归档（web-pc/entry-archiving spec）：
 * Excel 模板一键填充导出（仅 approved_for_business）、批量导出与保存路径回显、
 * Mock 归档（双重存储工件 + 自动命名预览 + 类型/年/月/企业分类树）。
 */
export default function EntryArchivingPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const storeState = useMockStoreState();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 导出对话框状态：待导出的单据集合；null = 关闭。 */
  const [exportTargets, setExportTargets] = useState<Document[] | null>(null);
  const [pathValue, setPathValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const settings = storeState?.settings;
  const documents = useMemo(() => storeState?.documents ?? [], [storeState]);
  const fields = useMemo(() => storeState?.fields ?? [], [storeState]);

  const entryDocs = useMemo(
    () =>
      documents
        .filter((doc) => ENTRY_STATUSES.has(doc.status))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [documents],
  );

  const archiveEntries = useMemo<ArchiveEntry[]>(
    () =>
      (storeState?.archive_records ?? [])
        .map((record) => ({ record, document: documents.find((d) => d.id === record.document_id) }))
        .sort((a, b) => (a.record.archived_at < b.record.archived_at ? 1 : -1)),
    [storeState, documents],
  );

  const namingPreview = (doc: Document): string | null => {
    if (!canEnterBusiness(doc.status) || !settings) return null;
    return buildArchiveFileName(doc, settings.archive_naming_rule);
  };

  const openExport = (docs: Document[]): void => {
    setPathValue(settings?.export_save_path ?? '');
    setExportTargets(docs);
  };

  const handleExport = async (): Promise<void> => {
    if (!exportTargets) return;
    setSubmitting(true);
    try {
      // 门控：仅 approved_for_business 可录入/导出（FR-VERIFY-012）
      await api.assertExportable(exportTargets.map((doc) => doc.id));
      // 保存路径变更即时生效（FR-ENTRY-004：记录并回显）
      if (pathValue.trim() && pathValue !== settings?.export_save_path) {
        await api.updateSettings({ export_save_path: pathValue.trim() });
      }
      const targetIds = new Set(exportTargets.map((doc) => doc.id));
      const workbook = buildExportWorkbook(exportTargets, fields.filter((f) => targetIds.has(f.document_id)));
      downloadWorkbook(workbook, exportFileName());
      message.success(t('entry.exportSuccess', { count: exportTargets.length }));
      setExportTargets(null);
    } catch (error) {
      if (error instanceof ExportGateError) {
        message.error(t('entry.notApproved'));
      } else {
        message.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (): Promise<void> => {
    const approved = selectedIds
      .map((id) => documents.find((d) => d.id === id))
      .filter((doc): doc is Document => !!doc && canEnterBusiness(doc.status));
    if (approved.length === 0) {
      message.warning(t('entry.noApprovedSelected'));
      return;
    }
    try {
      const created = await api.archiveDocuments(approved.map((doc) => doc.id));
      message.success(t('entry.archiveSuccess', { count: created.length }));
      setSelectedIds([]);
    } catch (error) {
      if (error instanceof ExportGateError) {
        message.error(t('entry.notApproved'));
      } else {
        message.error(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const columns = useMemo(
    () => [
      {
        title: t('entry.listColumns.docType'),
        dataIndex: 'doc_type',
        render: (docType: Document['doc_type']) => <DocTypeTag docType={docType} />,
      },
      { title: t('entry.listColumns.docNumber'), dataIndex: 'doc_number' },
      { title: t('entry.listColumns.enterprise'), dataIndex: 'enterprise_name' },
      {
        title: t('entry.listColumns.docDate'),
        dataIndex: 'doc_date',
        render: (v: string | null) => v ?? '—',
      },
      {
        title: t('entry.listColumns.status'),
        dataIndex: 'status',
        render: (status: Document['status']) => <StatusTag status={status} />,
      },
      {
        title: t('entry.listColumns.namingPreview'),
        key: 'namingPreview',
        render: (_: unknown, record: Document) => {
          const preview = namingPreview(record);
          return preview ? <Typography.Text code>{preview}</Typography.Text> : '—';
        },
      },
      {
        title: t('entry.listColumns.actions'),
        key: 'actions',
        render: (_: unknown, record: Document) => (
          // 不禁用：非批准单据点击后由门控拦截并提示（spec「pending 状态单据被拦截」场景）
          <Button type="link" onClick={() => openExport([record])}>
            {t('entry.exportOne')}
          </Button>
        ),
      },
    ],
    [t, settings, documents, fields], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const archiveColumns = useMemo(
    () => [
      {
        title: t('entry.archiveColumns.fileName'),
        dataIndex: 'file_name',
        render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
      },
      {
        title: t('entry.archiveColumns.original'),
        dataIndex: 'original_uri',
        render: (v: string) => (
          <Space>
            <FileImageOutlined />
            <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>
          </Space>
        ),
      },
      {
        title: t('entry.archiveColumns.data'),
        dataIndex: 'data_uri',
        render: (v: string) => (
          <Space>
            <FileTextOutlined />
            <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>
          </Space>
        ),
      },
      {
        title: t('entry.archiveColumns.prefix'),
        dataIndex: 'archive_prefix',
        render: (v: string) => <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>,
      },
      {
        title: t('entry.archiveColumns.archivedAt'),
        dataIndex: 'archived_at',
        render: (v: string) => new Date(v).toLocaleString(),
      },
    ],
    [t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('entry.title')}
      </Typography.Title>

      <Card title={t('entry.listTitle')}>
        <Space style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            disabled={selectedIds.length === 0}
            onClick={() =>
              openExport(selectedIds.map((id) => documents.find((d) => d.id === id)).filter((d): d is Document => !!d))
            }
          >
            {t('entry.exportSelected')} ({selectedIds.length})
          </Button>
          <Button disabled={selectedIds.length === 0} onClick={() => void handleArchive()}>
            {t('entry.archiveSelected')}
          </Button>
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={entryDocs}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: t('common.noData') }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
        />
      </Card>

      <Card title={t('entry.archiveSection')}>
        <Row gutter={16}>
          <Col span={14}>
            <Table
              rowKey="id"
              size="small"
              columns={archiveColumns}
              dataSource={archiveEntries.map((e) => e.record)}
              pagination={false}
              locale={{ emptyText: t('common.noData') }}
            />
          </Col>
          <Col span={10}>
            <Typography.Text strong>{t('entry.archiveTreeTitle')}</Typography.Text>
            <ArchiveTree entries={archiveEntries} />
          </Col>
        </Row>
      </Card>

      <Modal
        open={exportTargets !== null}
        title={t('entry.exportModal.title')}
        confirmLoading={submitting}
        onOk={() => void handleExport()}
        onCancel={() => setExportTargets(null)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Typography.Paragraph>
          {t('entry.exportModal.count', { count: exportTargets?.length ?? 0 })}
        </Typography.Paragraph>
        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          {t('entry.exportModal.savePath')}
        </Typography.Paragraph>
        <Input value={pathValue} onChange={(e) => setPathValue(e.target.value)} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('entry.exportModal.pathHint')}
        </Typography.Text>
      </Modal>
    </Space>
  );
}

/** 类型/年/月/企业四层分类树；叶子展示原始图像与结构化数据两类工件（双重存储）。 */
function ArchiveTree({ entries }: { entries: ArchiveEntry[] }) {
  const { t } = useTranslation();

  const treeData = useMemo(() => {
    interface Node {
      title: string;
      key: string;
      children?: Node[];
    }
    const root: Node = { title: 'gs://saiflow-documents', key: 'root', children: [] };
    for (const { record, document } of entries) {
      if (!document) continue;
      const segments = [
        document.doc_type,
        document.doc_date?.slice(0, 4) ?? 'UNKNOWN',
        document.doc_date?.slice(5, 7) ?? 'UNKNOWN',
        document.enterprise_name ?? 'UNKNOWN',
      ];
      let level = root;
      segments.forEach((segment) => {
        const key = `${level.key}/${segment}`;
        let next = level.children?.find((child) => child.key === key);
        if (!next) {
          next = { title: segment, key, children: [] };
          level.children!.push(next);
        }
        level = next;
      });
      level.children!.push(
        {
          title: `${t('entry.artifacts.original')} — ${record.file_name}`,
          key: `${record.id}-original`,
        },
        {
          title: `${t('entry.artifacts.data')} — ${record.data_uri.split('/').pop()}`,
          key: `${record.id}-data`,
        },
      );
    }
    return root.children ?? [];
  }, [entries, t]);

  if (entries.length === 0) return <Typography.Text type="secondary">{t('common.noData')}</Typography.Text>;
  return <Tree treeData={treeData} defaultExpandAll showLine />;
}
