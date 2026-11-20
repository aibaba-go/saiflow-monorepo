import { Alert, DatePicker, Form, Modal } from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";

import { toBangkokIso } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import type { ApproveDates } from "../services/applications";
import { fieldErrorText } from "./FieldError";

export interface PlanApproveDialogProps {
  open: boolean;
  onCancel(): void;
  /** Throws an ApiError naming starts_at / ends_at to show it under the field. */
  onSubmit(dates: ApproveDates): Promise<void>;
}

/** Approve a plan application: start and end may stay empty (FR-SYS-067-01). */
export function PlanApproveDialog({ open, onCancel, onSubmit }: PlanApproveDialogProps) {
  const t = useT();
  const [startsAt, setStartsAt] = useState<Dayjs | null>(null);
  const [endsAt, setEndsAt] = useState<Dayjs | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, pending } = useSubmit(async () => {
    setError(null);
    const dates: ApproveDates = {};
    if (startsAt) dates.starts_at = toBangkokIso(startsAt);
    if (endsAt) dates.ends_at = toBangkokIso(endsAt);
    try {
      await onSubmit(dates);
    } catch (e) {
      setError(e);
    }
  });
  const startError = fieldErrorText(error, "starts_at", t);
  const endError = fieldErrorText(error, "ends_at", t);
  return (
    <Modal
      open={open}
      title={t("planApprove.title")}
      okText={t("planApprove.submit")}
      cancelText={t("common.cancel")}
      okButtonProps={{ loading: pending, autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      onOk={() => void run()}
      onCancel={onCancel}
      afterClose={() => {
        setStartsAt(null);
        setEndsAt(null);
        setError(null);
      }}
      destroyOnHidden
    >
      <Alert type="info" showIcon message={t("planApprove.hint")} style={{ marginBottom: 16 }} />
      <Form layout="vertical">
        <Form.Item
          label={t("planApprove.startsAt")}
          validateStatus={startError ? "error" : undefined}
          help={startError}
        >
          <DatePicker showTime value={startsAt} onChange={setStartsAt} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          label={t("planApprove.endsAt")}
          validateStatus={endError ? "error" : undefined}
          help={endError}
        >
          <DatePicker showTime value={endsAt} onChange={setEndsAt} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
