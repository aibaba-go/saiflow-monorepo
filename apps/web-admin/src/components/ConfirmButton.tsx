import { Button, Popconfirm } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";

import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";

export interface ConfirmButtonProps {
  label: string;
  /** The question shown before the action runs. */
  title: string;
  /** More about the consequence, under the question. */
  description?: ReactNode;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
  type?: ButtonProps["type"];
  disabled?: boolean;
}

/** A destructive or state-changing action: asks first, then runs once at a time
 * (FR-SYS-073-01). Errors are left to onConfirm to show. */
export function ConfirmButton({ label, title, description, onConfirm, danger, type, disabled }: ConfirmButtonProps) {
  const t = useT();
  const { run, pending } = useSubmit(onConfirm);
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={t("common.confirm")}
      cancelText={t("common.cancel")}
      okButtonProps={{ autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      disabled={disabled || pending}
      onConfirm={() => {
        void run().catch(() => {});
      }}
    >
      <Button danger={danger} type={type} loading={pending} disabled={disabled} autoInsertSpace={false}>
        {label}
      </Button>
    </Popconfirm>
  );
}
