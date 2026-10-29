import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Card, Space, Table, Tag, Typography, Upload } from 'antd';
import { InboxOutlined, RedoOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiClient, useMockStoreState } from '../../api/context';
import type { UploadStatus, UploadQueueItem } from '../../api/types';
import { validateUploadFile } from './validate';

/** 状态 → 标签颜色（失败红、进行中蓝、完成绿）。 */
const STATUS_COLORS: Record<UploadStatus, string> = {
  queued: 'default',
  uploading: 'processing',
  preprocessing: 'processing',
  ocr_processing: 'processing',
  completed: 'success',
  failed: 'error',
};

/** 上传工作台：文件选择/校验 + 批量上传 + 状态队列（web-pc/upload-queue spec）。 */
export default function UploadPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const api = useApiClient();
  const navigate = useNavigate();
  const storeState = useMockStoreState();
  const uploads = useMemo(() => storeState?.uploads ?? [], [storeState]);

  const handleFiles = useCallback(
    async (files: { name: string; size: number }[]): Promise<void> => {
      let rejected = 0;
      for (const file of files) {
        const check = validateUploadFile(file);
        if (!check.ok) {
          message.error(t(`upload.errors.${check.reason}`));
          rejected += 1;
          continue;
        }
        try {
          await api.enqueueUpload(file);
        } catch (error) {
          // Mock 客户端的兜底错误（如会话失效）
          message.error(error instanceof Error ? error.message : String(error));
        }
      }
      if (files.length > 1 && rejected === 0) {
        message.success(t('upload.queue'));
      }
    },
    [api, message, t],
  );

  const columns = useMemo(
    () => [
      {
        title: t('upload.columns.fileName'),
        dataIndex: 'file_name',
        key: 'file_name',
      },
      {
        title: t('upload.columns.size'),
        dataIndex: 'size',
        key: 'size',
        render: (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`,
      },
      {
        title: t('upload.columns.status'),
        dataIndex: 'status',
        key: 'status',
        render: (status: UploadStatus) => (
          <Tag color={STATUS_COLORS[status]}>{t(`upload.statuses.${status}`)}</Tag>
        ),
      },
      {
        title: t('upload.columns.createdAt'),
        dataIndex: 'created_at',
        key: 'created_at',
        render: (value: string) => new Date(value).toLocaleString(),
      },
      {
        title: t('upload.columns.actions'),
        key: 'actions',
        render: (_: unknown, record: UploadQueueItem) => (
          <Space>
            {record.status === 'completed' && record.document_id && (
              <Button type="link" onClick={() => navigate(`/verification?doc=${record.document_id}`)}>
                {t('upload.viewDocument')}
              </Button>
            )}
            {record.status === 'failed' && (
              <Button
                type="link"
                icon={<RedoOutlined />}
                onClick={() => {
                  void api.retryUpload(record.id);
                }}
              >
                {t('upload.retry')}
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [api, navigate, t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {t('upload.title')}
        </Typography.Title>
        <Upload.Dragger
          multiple
          showUploadList={false}
          beforeUpload={(file) => {
            void handleFiles([{ name: file.name, size: file.size }]);
            // 阻止 antd 默认上传行为，由 Mock 队列接管
            return false;
          }}
          // 目录拖入 / 批量粘贴时antd 会逐个触发 beforeUpload；用 fileList 受控清空避免重复渲染
          fileList={[] as UploadFile[]}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t('upload.selectFile')}</p>
          <p className="ant-upload-hint">{t('upload.hint')}</p>
        </Upload.Dragger>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>
          {t('upload.autoFlowNote')}
        </Typography.Paragraph>
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          {t('upload.failHint')}
        </Typography.Text>
      </Card>

      <Card title={t('upload.queue')}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={uploads}
          pagination={false}
          locale={{ emptyText: t('common.noData') }}
        />
      </Card>
    </Space>
  );
}
