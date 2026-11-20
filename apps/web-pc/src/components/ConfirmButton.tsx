// Ported from apps/web-admin/src/components/ConfirmButton.tsx (web-pc-account plan: copied, not shared).
import { Button, Popconfirm } from "antd";
import { useRef } from "react";
import type { ButtonProps } from "antd";

import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";

export interface ConfirmButtonProps {
  label: string;
  /** The question shown before the action runs. */
  title: string;
  /** What else happens, under the question. */
  description?: string;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
  type?: ButtonProps["type"];
  disabled?: boolean;
  size?: ButtonProps["size"];
}

/** A destructive or state-changing action: asks first, then runs once at a time
 * (FR-SYS-104-02). Errors are left to onConfirm to show. */
export function ConfirmButton({ label, title, description, onConfirm, danger, type, disabled, size }: ConfirmButtonProps) {
  const t = useT();
  const { run, pending } = useSubmit(onConfirm);
  // One confirmation per opening: the OK button stays clickable while the box fades out,
  // and a fast backend may already have finished the first run (AC-104-02).
  const armed = useRef(false);
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={t("common.confirm")}
      cancelText={t("common.cancel")}
      okButtonProps={{ autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      disabled={disabled || pending}
      onOpenChange={(open) => {
        if (open) armed.current = true;
      }}
      onConfirm={() => {
        if (!armed.current) return;
        armed.current = false;
        void run().catch(() => {});
      }}
    >
      <Button danger={danger} type={type} size={size} loading={pending} disabled={disabled} autoInsertSpace={false}>
        {label}
      </Button>
    </Popconfirm>
  );
}
