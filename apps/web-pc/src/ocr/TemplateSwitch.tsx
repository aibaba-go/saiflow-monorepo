import { useQuery } from "@tanstack/react-query";
import { List, Modal, Spin, Tag, Typography } from "antd";

import { ErrorText } from "../components/ErrorText";
import { useT } from "../i18n";
import { templateOptions } from "./api";

export type SwitchTarget = { kind: "generic" } | { kind: "template"; versionId: number; name: string };

/** "Change template" (FR-SYS-129, FR-OCR-019/020): the published templates, best match
 * first and marked "recommended", plus the generic result. */
export function TemplateSwitch({
  jobId,
  open,
  onClose,
  onChoose,
}: {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onChoose: (target: SwitchTarget) => void;
}) {
  const t = useT();
  const options = useQuery({ queryKey: ["templateOptions", jobId], queryFn: () => templateOptions(jobId), enabled: open });
  const items: (SwitchTarget & { current?: boolean; recommended?: boolean; score?: number | null })[] = [
    ...(options.data?.templates ?? []).map((o) => ({
      kind: "template" as const,
      versionId: o.template_version_id,
      name: o.name,
      current: o.template_version_id === options.data?.current_template_version_id,
      recommended: o.recommended,
      score: o.score,
    })),
    ...(options.data?.generic ? [{ kind: "generic" as const }] : []),
  ];
  return (
    <Modal open={open} title={t("ocr.changeTemplate")} footer={null} onCancel={onClose} destroyOnHidden>
      {options.isPending ? (
        <Spin />
      ) : options.isError ? (
        <ErrorText error={options.error} />
      ) : (
        <List
          dataSource={items}
          renderItem={(o) => (
            <List.Item style={{ cursor: "pointer" }} onClick={() => onChoose(o)}>
              <Typography.Text strong={o.kind === "template" && o.current}>
                {o.kind === "generic" ? t("review.generic") : o.name}
              </Typography.Text>
              <span>
                {o.kind === "template" && o.recommended && <Tag color="green">{t("ocr.recommended")}</Tag>}
                {o.kind === "template" && o.current && <Tag>{t("ocr.current")}</Tag>}
                {o.kind === "template" && typeof o.score === "number" && (
                  <Typography.Text type="secondary">{Math.round(o.score * 100)}%</Typography.Text>
                )}
              </span>
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
