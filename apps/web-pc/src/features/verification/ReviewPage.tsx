import { useMemo, useState } from 'react';
import { App, Button, Card, Drawer, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, FileSearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import type { Document, ReviewRecord } from '../../api/types';
import { currentReviewLevel } from '../../mock/stateMachine';
import { DocTypeTag, StatusTag, userLabel } from './meta';

/**
 * 待复核工作台（web-pc/verification-workbench spec）：
 * 0/1/2 级复核流程 —— 待复核列表、通过/拒绝（意见保留）、复核记录展示。
 */
export default function ReviewPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const storeState = useMockStoreState();
  /** 当前操作的单据与决定；Modal 打开时非空。 */
  const [decisionFor, setDecisionFor] = useState<{ doc: Document; decision: 'approved' | 'rejected' } | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recordsFor, setRecordsFor] = useState<Document | null>(null);

  const pendingDocs = useMemo(
    () =>
      (storeState?.documents ?? [])
        .filter((doc) => currentReviewLevel(doc.status) !== null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [storeState],
  );

  const records = useMemo(
    () =>
      (storeState?.review_records ?? [])
        .filter((r) => r.document_id === recordsFor?.id)
        .sort((a, b) => (a.reviewed_at < b.reviewed_at ? 1 : -1)),
    [storeState, recordsFor],
  );

  const handleDecide = async (): Promise<void> => {
    if (!decisionFor) return;
    setSubmitting(true);
    try {
      await api.decideReview({
        document_id: decisionFor.doc.id,
        decision: decisionFor.decision,
        comment: comment.trim() || undefined,
      });
      message.success(
        decisionFor.decision === 'approved' ? t('review.approveSuccess') : t('review.rejectSuccess'),
      );
      setDecisionFor(null);
      setComment('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const openDecision = (doc: Document, decision: 'approved' | 'rejected'): void => {
    setComment('');
    setDecisionFor({ doc, decision });
  };

  const columns = useMemo(
    () => [
      {
        title: t('review.listColumns.docType'),
        dataIndex: 'doc_type',
        key: 'doc_type',
        render: (docType: Document['doc_type']) => <DocTypeTag docType={docType} />,
      },
      { title: t('review.listColumns.docNumber'), dataIndex: 'doc_number', key: 'doc_number' },
      { title: t('review.listColumns.enterprise'), dataIndex: 'enterprise_name', key: 'enterprise_name' },
      {
        title: t('review.listColumns.docDate'),
        dataIndex: 'doc_date',
        key: 'doc_date',
        render: (v: string | null) => v ?? '—',
      },
      {
        title: t('review.listColumns.totalAmount'),
        dataIndex: 'total_amount',
        key: 'total_amount',
        render: (v: number | null) => (v === null ? '—' : v.toLocaleString()),
      },
      {
        title: t('review.listColumns.level'),
        key: 'level',
        render: (_: unknown, record: Document) => {
          const level = currentReviewLevel(record.status);
          return <Tag color={level === 1 ? 'orange' : 'volcano'}>{t('review.level')} {level}</Tag>;
        },
      },
      { title: t('review.listColumns.status'), dataIndex: 'status', render: (status: Document['status']) => <StatusTag status={status} /> },
      {
        title: t('review.listColumns.actions'),
        key: 'actions',
        render: (_: unknown, record: Document) => (
          <Space>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => openDecision(record, 'approved')}
            >
              {t('review.approve')}
            </Button>
            <Button danger size="small" icon={<CloseOutlined />} onClick={() => openDecision(record, 'rejected')}>
              {t('review.reject')}
            </Button>
            <Button size="small" icon={<FileSearchOutlined />} onClick={() => setRecordsFor(record)}>
              {t('review.records')}
            </Button>
          </Space>
        ),
      },
    ],
    [t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('review.title')}
      </Typography.Title>
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={pendingDocs}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: t('common.noData') }}
        />
      </Card>

      <Modal
        open={decisionFor !== null}
        title={`${decisionFor?.decision === 'approved' ? t('review.approve') : t('review.reject')} — ${decisionFor?.doc.doc_number ?? ''}`}
        confirmLoading={submitting}
        onOk={() => void handleDecide()}
        onCancel={() => setDecisionFor(null)}
        okText={decisionFor?.decision === 'approved' ? t('review.approve') : t('review.reject')}
        cancelText={t('common.cancel')}
      >
        <Typography.Paragraph>{t('review.commentLabel')}</Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('review.commentPlaceholder')}
        />
      </Modal>

      <Drawer
        title={`${t('review.records')} — ${recordsFor?.doc_number ?? ''}`}
        open={recordsFor !== null}
        onClose={() => setRecordsFor(null)}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={records}
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
              render: (decision: ReviewRecord['decision']) => (
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
