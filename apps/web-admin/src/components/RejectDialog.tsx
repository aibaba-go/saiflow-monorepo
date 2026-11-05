import { Form, Input, Modal } from "antd";
import { useState } from "react";

import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { fieldErrorText, requireFields } from "./FieldError";

export interface RejectDialogProps {
  open: boolean;
  onCancel(): void;
  /** Throws an ApiError naming "reason" to show it under the field; anything else is the
   * caller's to show. */
  onSubmit(reason: string): Promise<void>;
}

/** Reject with a reason; the reason is required (FR-SYS-063-02, 065, 067-02). */
export function RejectDialog({ open, onCancel, onSubmit }: RejectDialogProps) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const { run, pending } = useSubmit(async () => {
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setError(e);
    }
  });
  const fieldError = fieldErrorText(error, "reason", t);
  return (
    <Modal
      open={open}
      title={t("reject.title")}
      okText={t("reject.submit")}
      cancelText={t("common.cancel")}
      okButtonProps={{ danger: true, loading: pending, autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      onOk={() => {
        const missing = requireFields({ reason });
        if (missing) setError(missing);
        else void run();
      }}
      onCancel={onCancel}
      afterClose={() => {
        setReason("");
        setError(null);
      }}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item
          label={t("reject.reason")}
          htmlFor="reject-reason"
          validateStatus={fieldError ? "error" : undefined}
          help={fieldError}
        >
          <Input.TextArea
            id="reject-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
