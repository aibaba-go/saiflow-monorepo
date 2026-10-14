import { Tag } from 'antd';
import type { TableProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { DocStatus, DocumentType, LineItem } from '../../api/types';
import { CONFIDENCE_THRESHOLD } from '../../mock/defaults';
import { MOCK_USERS } from '../../mock/users';

/** 状态 → 标签颜色（与上传队列一致的处理中/成功/失败语义）。 */
const STATUS_TAG_COLORS: Partial<Record<DocStatus, string>> = {
  extracted: 'blue',
  in_review: 'geekblue',
  verified: 'cyan',
  pending_review_level_1: 'orange',
  pending_review_level_2: 'volcano',
  approved_for_business: 'success',
  entered: 'purple',
  archived: 'default',
  failed: 'error',
};

/** 单据状态标签（i18n 文案 + 语义颜色）。 */
export function StatusTag({ status }: { status: DocStatus }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_TAG_COLORS[status] ?? 'default'}>{t(`docStatuses.${status}`)}</Tag>;
}

/** 单据类型标签。 */
export function DocTypeTag({ docType }: { docType: DocumentType }) {
  const { t } = useTranslation();
  return <Tag color={docType === 'INVOICE' ? 'gold' : docType === 'PO' ? 'geekblue' : docType === 'DELIVERY_NOTE' ? 'green' : 'purple'}>{t(`docTypes.${docType}`)}</Tag>;
}

/** 用户 id → 显示名（变更日志/复核记录展示用）。 */
export function userLabel(userId: string): string {
  const user = MOCK_USERS.find((u) => u.id === userId);
  return user ? `${user.display_name} (${user.username})` : userId;
}

/** 置信度 0–1 → 百分比文案；低于阈值标红由调用方处理颜色。 */
export function confidenceText(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** 字段键 → 本地化标签（未定义的键原样展示）。 */
export function fieldLabel(t: (key: string) => string, fieldKey: string): string {
  const label = t(`fields.${fieldKey}`);
  return label === `fields.${fieldKey}` ? fieldKey : label;
}

/** 置信度标签：低于 0.85 阈值红色（EPIC-02 §4.4）。 */
export function ConfidenceTag({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={value < CONFIDENCE_THRESHOLD ? 'error' : 'green'}>
      {t('verification.detail.confidence')} {confidenceText(value)}
    </Tag>
  );
}

/** 行项目表列定义：核验视图与归档预览共用（verification-detail-sticky-layout ADR-003）。 */
export function lineItemColumns(t: (key: string) => string) {
  return [
    { title: t('verification.lineItemColumns.lineNo'), dataIndex: 'line_no', width: 56 },
    { title: t('verification.lineItemColumns.productName'), dataIndex: 'product_name' },
    { title: t('verification.lineItemColumns.productCode'), dataIndex: 'product_code' },
    { title: t('verification.lineItemColumns.quantity'), dataIndex: 'quantity' },
    {
      title: t('verification.lineItemColumns.unitPrice'),
      dataIndex: 'unit_price',
      render: (v: number | null) => v?.toLocaleString() ?? '—',
    },
    {
      title: t('verification.lineItemColumns.lineTotal'),
      dataIndex: 'line_total',
      render: (v: number | null) => v?.toLocaleString() ?? '—',
    },
    {
      title: t('verification.lineItemColumns.taxAmount'),
      dataIndex: 'tax_amount',
      render: (v: number | null) => v?.toLocaleString() ?? '—',
    },
    {
      title: t('verification.lineItemColumns.confidence'),
      dataIndex: 'confidence',
      render: (v: number) => <ConfidenceTag value={v} />,
    },
  ] satisfies TableProps<LineItem>['columns'];
}
