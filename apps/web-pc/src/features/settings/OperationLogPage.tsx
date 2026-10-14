import { useEffect, useState } from 'react';
import { Card, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '../../api/context';
import type { OperationLog } from '../../api/types';
import { userLabel } from '../verification/meta';

/**
 * 操作日志（web-pc/settings-admin spec，仅 admin）：
 * 用户/操作/目标/时间/结果，按时间倒序（FR-SYS-003）。
 */
export default function OperationLogPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .listOperationLogs()
      .then((result) => {
        if (!cancelled) {
          setLogs(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('operationLog.title')}
      </Typography.Title>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={logs}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: t('common.noData') }}
          columns={[
            {
              title: t('operationLog.columns.user'),
              dataIndex: 'user_id',
              render: userLabel,
            },
            { title: t('operationLog.columns.action'), dataIndex: 'action' },
            {
              title: t('operationLog.columns.target'),
              key: 'target',
              render: (_: unknown, record: OperationLog) => `${record.target_type}: ${record.target_id}`,
            },
            {
              title: t('operationLog.columns.time'),
              dataIndex: 'timestamp',
              render: (v: string) => new Date(v).toLocaleString(),
              defaultSortOrder: 'descend',
              sorter: (a: OperationLog, b: OperationLog) => (a.timestamp < b.timestamp ? -1 : 1),
            },
            { title: t('operationLog.columns.result'), dataIndex: 'result' },
          ]}
        />
      </Card>
    </Space>
  );
}
