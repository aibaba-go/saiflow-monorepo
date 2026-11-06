import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Col, Input, Modal, Row, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { ChangeLogTable } from "../reviews/ChangeLogTable";
import { OriginalPages } from "../reviews/OriginalPages";
import { ReadonlyResult, type Group } from "../reviews/ReadonlyResult";
import { ReviewRecordList } from "../reviews/ReviewRecordList";
import { type Decision, decideReview, type Level, useChanges, useResult, useReviewDetail } from "../reviews/api";
import { ApiError } from "../services/errors";
import { useLanguage } from "../stores/language";

const COMMENT_MAX = 500;

/** Review detail (FR-SYS-124): the original on the left, the confirmed result read-only on
 * the right, the review history and change log below; Approve (optional comment) and
 * Return (comment required), each confirmed in a dialog. A document someone else already
 * handled sends the user back to the queue with a warning. */
export function ReviewDetailPage() {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { id = "" } = useParams();
  const detail = useReviewDetail(id);
  const result = useResult(id, detail.isSuccess);
  const changes = useChanges(id, detail.isSuccess);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handled = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 409);
  const backHandled = () => {
    void message.warning(t("review.handled"));
    void queryClient.invalidateQueries({ queryKey: ["reviews"] });
    navigate("/reviews", { replace: true });
  };

  useEffect(() => {
    if (detail.isError && handled(detail.error)) backHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.isError, detail.error]);

  async function submit() {
    if (!dialog || !detail.data?.level) return;
    setBusy(true);
    setError(null);
    try {
      await decideReview(id, detail.data.level as Level, dialog, comment.trim() || null);
      void message.success(t(dialog === "approve" ? "review.approved" : "review.returned"));
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
      navigate("/reviews", { replace: true });
    } catch (e) {
      if (handled(e)) {
        setDialog(null);
        backHandled();
        return;
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data;
  const data = result.data;
  if (detail.isError && !handled(detail.error)) {
    return (
      <Page name="review-detail" title={t("nav.reviews")}>
        <ErrorText error={detail.error} />
      </Page>
    );
  }
  if (!d || !data) return <Spin />;
  const groups = (data.template?.groups ?? null) as Group[] | null;
  const canDecide = Boolean(d.level && !d.block_reason);
  const text = comment.trim();
  return (
    <Page
      name="review-detail"
      title={d.job.file_name}
      extra={
        canDecide ? (
          <Space>
            <Button danger onClick={() => { setComment(""); setDialog("return"); }}>
              {t("review.return")}
            </Button>
            <Button type="primary" onClick={() => { setComment(""); setDialog("approve"); }}>
              {t("review.approve")}
            </Button>
          </Space>
        ) : null
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Typography.Text type="secondary">
          {t(d.level === 2 ? "review.pending2" : "review.pending1")} · {t("review.confirmedBy", { name: d.confirmed_by_name ?? "-" })}
          {d.confirmed_at ? ` · ${formatBangkokDateTime(d.confirmed_at)}` : ""}
        </Typography.Text>
        {d.block_reason && (
          <Typography.Text type="warning">
            {t(d.block_reason === "did_level1" ? "review.blocked.did_level1" : "review.blocked.own_confirmation")}
          </Typography.Text>
        )}
        <Row gutter={16}>
          <Col span={10}>
            <Card size="small" title={t("review.original")}>
              <OriginalPages fileId={d.job.file_id} fileName={d.job.file_name} pageCount={d.job.page_count} />
            </Card>
          </Col>
          <Col span={14}>
            <Card size="small" title={`${t("review.col.template")}: ${data.template?.name ?? t("review.generic")}`}>
              <ReadonlyResult value={data.structured} groups={groups} lang={lang} t={t} />
            </Card>
          </Col>
        </Row>
        <Card size="small" title={t("review.records")}>
          <ReviewRecordList records={data.review.records} t={t} />
        </Card>
        <Card size="small" title={t("review.changes")}>
          <ChangeLogTable entries={changes.data ?? []} groups={groups} t={t} lang={lang} />
        </Card>
      </Space>
      <Modal
        open={dialog !== null}
        title={t(dialog === "approve" ? "review.approveConfirm" : "review.returnConfirm")}
        okText={t(dialog === "approve" ? "review.approve" : "review.return")}
        cancelText={t("common.cancel")}
        okButtonProps={{
          danger: dialog === "return",
          loading: busy,
          disabled: text.length > COMMENT_MAX || (dialog === "return" && !text),
        }}
        onOk={() => void submit()}
        onCancel={() => setDialog(null)}
      >
        <Typography.Text>{t(dialog === "approve" ? "review.commentOptional" : "review.commentRequired")}</Typography.Text>
        <Input.TextArea rows={4} value={comment} maxLength={COMMENT_MAX} showCount onChange={(e) => setComment(e.target.value)} />
        <ErrorText error={error} />
      </Modal>
    </Page>
  );
}
