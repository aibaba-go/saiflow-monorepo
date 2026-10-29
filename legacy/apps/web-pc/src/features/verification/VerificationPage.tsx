import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Input,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, RollbackOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import { ConfirmGateError } from '../../api/errors';
import type { DocStatus, Document, ExtractedField } from '../../api/types';
import { isFieldReadOnly } from '../../mock/stateMachine';
import {
  StatusTag,
  DocTypeTag,
  ConfidenceTag,
  confidenceText,
  fieldLabel,
  lineItemColumns,
  userLabel,
} from './meta';

/** 待核验列表展示的状态（其余状态只读查看或经归档浏览访问）。 */
const LIST_STATUSES: DocStatus[] = ['extracted', 'in_review'];

/**
 * 核验工作台（web-pc/verification-workbench spec）：
 * 列表 + 并排核验视图（原图 / 字段 / 行项目 / 置信度 / 红色标记 / 确认门控）。
 */
export default function VerificationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const docId = searchParams.get('doc');

  if (docId) {
    return <VerificationDetail docId={docId} onBack={() => setSearchParams({})} />;
  }
  return <VerificationList onOpen={(id) => setSearchParams({ doc: id })} />;
}

function VerificationList({ onOpen }: { onOpen: (docId: string) => void }) {
  const { t } = useTranslation();
  const storeState = useMockStoreState();

  const docs = useMemo(
    () =>
      (storeState?.documents ?? [])
        .filter((doc) => LIST_STATUSES.includes(doc.status))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [storeState],
  );

  const columns = useMemo(
    () => [
      {
        title: t('verification.listColumns.docType'),
        dataIndex: 'doc_type',
        key: 'doc_type',
        render: (docType: Document['doc_type']) => <DocTypeTag docType={docType} />,
      },
      { title: t('verification.listColumns.docNumber'), dataIndex: 'doc_number', key: 'doc_number' },
      { title: t('verification.listColumns.enterprise'), dataIndex: 'enterprise_name', key: 'enterprise_name' },
      {
        title: t('verification.listColumns.docDate'),
        dataIndex: 'doc_date',
        key: 'doc_date',
        render: (v: string | null) => v ?? '—',
      },
      {
        title: t('verification.listColumns.totalAmount'),
        dataIndex: 'total_amount',
        key: 'total_amount',
        render: (v: number | null) => (v === null ? '—' : v.toLocaleString()),
      },
      {
        title: t('verification.listColumns.status'),
        dataIndex: 'status',
        key: 'status',
        render: (status: DocStatus) => <StatusTag status={status} />,
      },
      {
        title: t('verification.listColumns.confidence'),
        dataIndex: 'confidence_avg',
        key: 'confidence_avg',
        render: (v: number | null) => (v === null ? '—' : confidenceText(v)),
      },
      {
        title: t('verification.listColumns.actions'),
        key: 'actions',
        render: (_: unknown, record: Document) => (
          <Button type="link" onClick={() => onOpen(record.id)}>
            {t('verification.openDetail')}
          </Button>
        ),
      },
    ],
    [onOpen, t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('verification.title')}
      </Typography.Title>
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={docs}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: t('common.noData') }}
        />
      </Card>
    </Space>
  );
}

function VerificationDetail({ docId, onBack }: { docId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const storeState = useMockStoreState();
  const [logDrawer, setLogDrawer] = useState(false);
  const [reviewDrawer, setReviewDrawer] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const doc = storeState?.documents.find((d) => d.id === docId) ?? null;
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

  const readOnly = doc ? isFieldReadOnly(doc.status) : true;
  const canConfirm = doc?.status === 'extracted' || doc?.status === 'in_review';

  // 待处理标记清单（确认门控的可视化前置提醒）
  const pendingMarks = useMemo(() => {
    if (!doc) return [];
    const marks: string[] = [];
    for (const field of fields) {
      if (field.required && !field.value) {
        marks.push(`${t('verification.detail.marks.missingRequired')}: ${fieldLabel(t, field.field_key)}`);
      } else if (field.needs_review && !field.verified) {
        marks.push(`${t('verification.detail.marks.needsReview')}: ${fieldLabel(t, field.field_key)}`);
      }
    }
    if (doc.amount_mismatch) {
      marks.push(t('verification.detail.marks.amountMismatch'));
    }
    return marks;
  }, [doc, fields, t]);

  const handleSaveField = async (field: ExtractedField, newValue: string): Promise<void> => {
    if (!doc) return;
    try {
      await api.updateField({ document_id: doc.id, field_key: field.field_key, new_value: newValue });
      message.success(t('verification.detail.saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!doc) return;
    setConfirming(true);
    try {
      await api.confirmVerification(doc.id);
      message.success(t('verification.detail.confirmSuccess'));
    } catch (error) {
      if (error instanceof ConfirmGateError) {
        const fieldKey = error.reason.kind === 'amount_mismatch' ? '' : error.reason.field_key;
        message.error(t(`verification.gateErrors.${error.reason.kind}`, { field: fieldLabel(t, fieldKey) }));
      } else {
        message.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setConfirming(false);
    }
  };

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
        {canConfirm && (
          <Button type="primary" loading={confirming} onClick={() => void handleConfirm()}>
            {t('verification.detail.confirmVerification')}
          </Button>
        )}
        <Button onClick={() => setLogDrawer(true)}>{t('verification.changeLogs')}</Button>
        <Button onClick={() => setReviewDrawer(true)}>{t('verification.reviewRecords')}</Button>
      </Space>

      {pendingMarks.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('verification.detail.pendingAlertTitle')}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {pendingMarks.map((mark) => (
                <li key={mark}>
                  <Typography.Text type="danger">{mark}</Typography.Text>
                </li>
              ))}
            </ul>
          }
        />
      )}

      <Row gutter={16}>
        {/* 左栏原图 sticky 固定：滚动字段/行项目时保持可见（ADR-003） */}
        <Col xs={24} lg={6}>
          <Card
            size="small"
            title={t('verification.detail.originalImage')}
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
            <Card size="small" title={t('verification.detail.headerFields')}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <FieldRow
                    key={`${field.id}:${field.value ?? ''}`}
                    field={field}
                    readOnly={readOnly}
                    onSave={(value) => handleSaveField(field, value)}
                  />
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
            {
              title: t('verification.changeLogColumns.user'),
              dataIndex: 'user_id',
              render: userLabel,
            },
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
            {
              title: t('verification.reviewColumns.reviewer'),
              dataIndex: 'reviewer_id',
              render: userLabel,
            },
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

/** 单字段行：标签 + 可编辑值 + 置信度 + 红色标记 + 保存。 */
function FieldRow({
  field,
  readOnly,
  onSave,
}: {
  field: ExtractedField;
  readOnly: boolean;
  onSave: (newValue: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(field.value ?? '');
  const dirty = value !== (field.value ?? '');
  const flagged = (field.needs_review && !field.verified) || (field.required && !field.value);

  const save = (): void => {
    if (!dirty) return;
    void onSave(value);
  };

  return (
    <Row align="middle" gutter={8} wrap={false} style={{ borderBottom: '1px dashed #f0f0f0', paddingBottom: 4 }}>
      <Col span={8}>
        <Typography.Text strong>
          {fieldLabel(t, field.field_key)}
          {field.required && <Typography.Text type="danger"> *</Typography.Text>}
        </Typography.Text>
      </Col>
      <Col span={10}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={value}
            disabled={readOnly}
            status={flagged ? 'error' : undefined}
            onChange={(e) => setValue(e.target.value)}
            onPressEnter={save}
            placeholder={readOnly ? t('verification.detail.fieldLocked') : undefined}
          />
          {!readOnly && dirty && (
            <Button icon={<CheckOutlined />} onClick={save}>
              {t('verification.detail.save')}
            </Button>
          )}
        </Space.Compact>
      </Col>
      <Col span={6}>
        <Space size={4}>
          <ConfidenceTag value={field.confidence} />
          {field.required && !field.value && (
            <Tag color="error">{t('verification.detail.marks.missingRequired')}</Tag>
          )}
          {field.needs_review && !field.verified && (
            <Tag color="error">{t('verification.detail.marks.needsReview')}</Tag>
          )}
        </Space>
      </Col>
    </Row>
  );
}
