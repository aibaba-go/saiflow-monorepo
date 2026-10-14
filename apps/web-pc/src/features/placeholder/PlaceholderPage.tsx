import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';

/** 功能占位页：后续任务将逐个替换为真实页面。 */
export default function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <Typography.Title level={3}>{t(titleKey)}</Typography.Title>
      <Typography.Text type="secondary">{t('placeholder.page')}</Typography.Text>
    </>
  );
}
