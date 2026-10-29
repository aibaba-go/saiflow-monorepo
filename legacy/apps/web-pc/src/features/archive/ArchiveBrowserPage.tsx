import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { RollbackOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import type { ArchivePage, DocumentType } from '../../api/types';
import { DocTypeTag, StatusTag, fieldLabel, lineItemColumns, userLabel } from '../verification/meta';

const PAGE_SIZE = 20; // FR-MGMT-001：默认每页 20 条

const DOC_TYPES: DocumentType[] = ['INVOICE', 'DELIVERY_NOTE', 'PO', 'RECEIPT'];

/** 组合搜索条件（多条件 AND，FR-MGMT-002/003/004/005）。 */
interface FilterDraft {
  docType: DocumentType | '';
  docNumber: string;
  enterprise: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_DRAFT: FilterDraft = { docType: '', docNumber: '', enterprise: '', dateFrom: '', dateTo: '' };

/**
 * 归档浏览（web-pc/archive-browser spec）：
 * 分类列表（分页 20）+ 并排文档预览（原图/提取数据 + 变更/复核日志）+ 编号/日期/企业/类型组合搜索（P1）。
 */
export default function ArchiveBrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const docId = searchParams.get('doc');

  if (docId) {
    return <ArchivePreview docId={docId} onBack={() => setSearchParams({})} />;
  }
  return <ArchiveList onOpen={(id) => setSearchParams({ doc: id })} />;
}

function ArchiveList({ onOpen }: { onOpen: (docId: string) => void }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<FilterDraft>(EMPTY_DRAFT);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ArchivePage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getArchiveRecords({
        doc_type: applied.docType || undefined,
        doc_number: applied.docNumber.trim() || undefined,
        enterprise: applied.enterprise.trim() || undefined,
        date_from: applied.dateFrom || undefined,
        date_to: applied.dateTo || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, applied, page]);

  const hasCriteria = Object.values(applied).some((value) => value !== '');

  const columns = useMemo(
    () => [
      {
        title: t('archive.listColumns.docType'),
        key: 'doc_type',
        render: (_: unknown, item: ArchivePage['items'][number]) => (
          <DocTypeTag docType={item.document.doc_type} />
        ),
      },
      {
        title: t('archive.listColumns.docNumber'),
        key: 'doc_number',
        render: (_: unknown, item: ArchivePage['items'][number]) => item.document.doc_number,
      },
      {
        title: t('archive.listColumns.enterprise'),
        key: 'enterprise',
        render: (_: unknown, item: ArchivePage['items'][number]) => item.document.enterprise_name,
      },
      {
        title: t('archive.listColumns.docDate'),
        key: 'doc_date',
        render: (_: unknown, item: ArchivePage['items'][number]) => item.document.doc_date ?? '—',
      },
      {
        title: t('archive.listColumns.status'),
        key: 'status',
        render: (_: unknown, item: ArchivePage['items'][number]) => (
          <StatusTag status={item.document.status} />
        ),
      },
      {
        title: t('archive.listColumns.archivedAt'),
        dataIndex: 'archived_at',
        render: (v: string) => new Date(v).toLocaleString(),
      },
      {
        title: t('archive.listColumns.actions'),
        key: 'actions',
        render: (_: unknown, item: ArchivePage['items'][number]) => (
          <Button type="link" onClick={() => onOpen(item.document.id)}>
            {t('archive.openPreview')}
          </Button>
        ),
      },
    ],
    [onOpen, t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('archive.title')}
      </Typography.Title>

      <Card>
        <Space wrap size="middle">
          <Select
            style={{ width: 180 }}
            placeholder={t('archive.filters.allTypes')}
            value={draft.docType || undefined}
            onChange={(value) => setDraft({ ...draft, docType: value ?? '' })}
            allowClear
            options={DOC_TYPES.map((type) => ({ value: type, label: t(`docTypes.${type}`) }))}
          />
          <Input
            style={{ width: 200 }}
            placeholder={t('archive.filters.docNumber')}
            value={draft.docNumber}
            onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
            allowClear
          />
          <Input
            style={{ width: 240 }}
            placeholder={t('archive.filters.enterprise')}
            value={draft.enterprise}
            onChange={(e) => setDraft({ ...draft, enterprise: e.target.value })}
            allowClear
          />
          <Input
            style={{ width: 170 }}
            type="date"
            placeholder={t('archive.filters.dateFrom')}
            value={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
          />
          <Input
            style={{ width: 170 }}
            type="date"
            placeholder={t('archive.filters.dateTo')}
            value={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() => {
              setPage(1);
              setApplied(draft);
            }}
          >
            {t('archive.filters.search')}
          </Button>
          <Button
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setApplied(EMPTY_DRAFT);
              setPage(1);
            }}
          >
            {t('archive.filters.reset')}
          </Button>
        </Space>
      </Card>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          locale={{ emptyText: hasCriteria ? t('archive.noMatch') : t('common.noData') }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: (next) => setPage(next),
          }}
        />
      </Card>
    </Space>
  );
}

/** 归档单据预览：原图与提取数据并排，可查看变更/复核日志（FR-MGMT-006，只读）。 */
function ArchivePreview({ docId, onBack }: { docId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const storeState = useMockStoreState();
  const [logDrawer, setLogDrawer] = useState(false);
  const [reviewDrawer, setReviewDrawer] = useState(false);

  const doc = storeState?.documents.find((d) => d.id === docId) ?? null;
  const record = storeState?.archive_records.find((r) => r.document_id === docId) ?? null;
  const fields = useMemo(
    () => (storeState?.fields ?? []).filter((f) => f.document_id === docId),
    [storeState, docId],
  );
  const lineItems = useMemo(
    () => (storeState?.line_items ?? []).filter((li) => li.document_id === docId),
    [storeState, docId],
  );
  const changeLogs = useMemo(
    () =>
      (storeState?.change_logs ?? [])
        .filter((c) => c.document_id === docId)
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [storeState, docId],
  );
  const reviewRecords = useMemo(
    () =>
      (storeState?.review_records ?? [])
        .filter((r) => r.document_id === docId)
        .sort((a, b) => (a.reviewed_at < b.reviewed_at ? 1 : -1)),
    [storeState, docId],
  );

  if (!doc) {
    return (
      <Space direction="vertical">
        <Alert type="error" message={`${docId} not found`} showIcon />
        <Button icon={<RollbackOutlined />} onClick={onBack}>
          {t('verification.backToList')}
        </Button>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<RollbackOutlined />} onClick={onBack}>
          {t('verification.backToList')}
        </Button>
        <DocTypeTag docType={doc.doc_type} />
        <StatusTag status={doc.status} />
        <Button onClick={() => setLogDrawer(true)}>{t('verification.changeLogs')}</Button>
        <Button onClick={() => setReviewDrawer(true)}>{t('verification.reviewRecords')}</Button>
      </Space>

      {record && (
        <Card size="small">
          <Space split={<Typography.Text type="secondary">|</Typography.Text>} wrap>
            <span>
              <Typography.Text type="secondary">{t('archive.preview.fileName')}</Typography.Text>
              {': '}
              <Typography.Text code>{record.file_name}</Typography.Text>
            </span>
            <span>
              <Typography.Text type="secondary">{t('archive.preview.prefix')}</Typography.Text>
              {': '}
              <Typography.Text style={{ fontSize: 12 }}>{record.archive_prefix}</Typography.Text>
            </span>
          </Space>
        </Card>
      )}

      <Row gutter={16}>
        {/* 与核验工作台同一骨架：左栏原图 sticky，右栏提取数据（ADR-003） */}
        <Col xs={24} lg={6}>
          <Card
            size="small"
            title={t('archive.preview.originalImage')}
            styles={{ body: { padding: 8 } }}
            style={{ position: 'sticky', top: 80, alignSelf: 'flex-start' }}
          >
            <img
              src={doc.original_file_uri}
              alt={doc.doc_number ?? doc.id}
              style={{ width: '100%', border: '1px solid #f0f0f0', background: '#fafafa' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={18}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title={t('archive.preview.extractedData')}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Row
                    key={field.id}
                    gutter={8}
                    style={{ borderBottom: '1px dashed #f0f0f0', paddingBottom: 4 }}
                  >
                    <Col span={10}>
                      <Typography.Text strong>
                        {fieldLabel(t, field.field_key)}
                        {field.required && <Typography.Text type="danger"> *</Typography.Text>}
                      </Typography.Text>
                    </Col>
                    <Col span={14}>
                      <Typography.Text>{field.value ?? '—'}</Typography.Text>
                    </Col>
                  </Row>
                ))}
              </Space>
            </Card>

            {lineItems.length > 0 && (
              <Card size="small" title={t('verification.detail.lineItems')}>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={lineItems}
                  pagination={false}
                  locale={{ emptyText: t('common.noData') }}
                  columns={lineItemColumns(t)}
                />
              </Card>
            )}
          </Space>
        </Col>
      </Row>

      <Drawer
        title={t('verification.changeLogs')}
        open={logDrawer}
        onClose={() => setLogDrawer(false)}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={changeLogs}
          pagination={false}
          locale={{ emptyText: t('common.noData') }}
          columns={[
            { title: t('verification.changeLogColumns.field'), dataIndex: 'field_key' },
            { title: t('verification.changeLogColumns.oldValue'), dataIndex: 'old_value' },
            { title: t('verification.changeLogColumns.newValue'), dataIndex: 'new_value' },
            { title: t('verification.changeLogColumns.user'), dataIndex: 'user_id', render: userLabel },
            {
              title: t('verification.changeLogColumns.time'),
              dataIndex: 'timestamp',
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: t('verification.changeLogColumns.reason'),
              dataIndex: 'reason',
              render: (v: string | null) => v ?? '—',
            },
          ]}
        />
      </Drawer>

      <Drawer
        title={t('verification.reviewRecords')}
        open={reviewDrawer}
        onClose={() => setReviewDrawer(false)}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={reviewRecords}
          pagination={false}
          locale={{ emptyText: t('common.noData') }}
          columns={[
            { title: t('verification.reviewColumns.level'), dataIndex: 'review_level', width: 72 },
            { title: t('verification.reviewColumns.reviewer'), dataIndex: 'reviewer_id', render: userLabel },
            {
              title: t('verification.reviewColumns.decision'),
              dataIndex: 'decision',
              render: (decision: 'approved' | 'rejected') => (
                <Tag color={decision === 'approved' ? 'success' : 'error'}>
                  {t(`verification.decisions.${decision}`)}
                </Tag>
              ),
            },
            {
              title: t('verification.reviewColumns.comment'),
              dataIndex: 'comment',
              render: (v: string | null) => v ?? '—',
            },
            {
              title: t('verification.reviewColumns.time'),
              dataIndex: 'reviewed_at',
              render: (v: string) => new Date(v).toLocaleString(),
            },
          ]}
        />
      </Drawer>
    </Space>
  );
}
