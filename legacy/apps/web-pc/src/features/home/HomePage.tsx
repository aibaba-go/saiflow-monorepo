import { Card, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

export default function HomePage() {
  const { t } = useTranslation();
  return (
    <Card>
      <Typography.Title level={3}>{t('nav.home')}</Typography.Title>
      <Typography.Text type="secondary">SaiFlow — “We turn paper into process.”</Typography.Text>
    </Card>
  );
}
