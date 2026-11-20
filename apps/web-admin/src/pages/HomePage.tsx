import { useQuery } from "@tanstack/react-query";
import { Card, Col, Row, Spin, Typography } from "antd";
import { Link } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { useT, type MessageKey } from "../i18n";
import {
  organizationQueue,
  planQueue,
  queueKey,
  verificationQueue,
  type Queue,
} from "../services/applications";

function PendingCount({ label, queue, to }: { label: MessageKey; queue: Queue<unknown>; to: string }) {
  const t = useT();
  const list = useQuery({ queryKey: queueKey(queue.kind, "pending"), queryFn: () => queue.list("pending") });
  return (
    <Card className="ad-stat">
      <Typography.Text type="secondary" className="ad-stat__label">
        {t(label)}
      </Typography.Text>
      <div className="ad-stat__value">
        {list.isPending ? <Spin size="small" /> : list.isError ? "—" : <Link to={to}>{list.data.length}</Link>}
      </div>
      <ErrorText error={list.error} />
    </Card>
  );
}

/** Home: how many applications wait in each queue (FR-SYS-060-04). */
export function HomePage() {
  const t = useT();
  return (
    <Page name="home" title={t("nav.home")}>
      <Typography.Title level={2} className="ad-section-title">
        {t("home.pendingTitle")}
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <PendingCount
            label="nav.organizationApplications"
            queue={organizationQueue as Queue<unknown>}
            to="/organization-applications?status=pending"
          />
        </Col>
        <Col xs={24} md={8}>
          <PendingCount
            label="nav.verification"
            queue={verificationQueue as Queue<unknown>}
            to="/verification-applications?status=pending"
          />
        </Col>
        <Col xs={24} md={8}>
          <PendingCount
            label="nav.planApplications"
            queue={planQueue as Queue<unknown>}
            to="/plan-applications?status=pending"
          />
        </Col>
      </Row>
    </Page>
  );
}
