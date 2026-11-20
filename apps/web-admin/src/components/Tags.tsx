import { Tag } from "antd";

import { useT } from "../i18n";

export function OrgStatusTag({ status }: { status: "active" | "disabled" }) {
  const t = useT();
  return <Tag color={status === "active" ? "green" : "red"}>{t(`org.status.${status}`)}</Tag>;
}

const VERIFY_COLOR = { none: "default", pending: "gold", verified: "blue", rejected: "red" } as const;

export function VerificationTag({ status }: { status: keyof typeof VERIFY_COLOR }) {
  const t = useT();
  return <Tag color={VERIFY_COLOR[status]}>{t(`verify.${status}`)}</Tag>;
}
