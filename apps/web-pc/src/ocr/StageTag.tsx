import { Tag } from "antd";

import { useT } from "../i18n";
import { stageKey } from "./stage";

const COLOR: Record<string, string> = {
  OCR_PROCESSING: "gold",
  TEMPLATE_MATCHING: "gold",
  OCR_FAILED: "red",
  VERIFYING: "blue",
  PENDING_REVIEW: "orange",
  CONFIRMED: "green",
};

export function StageTag({ stage, level }: { stage: string; level?: number | null }) {
  const t = useT();
  return <Tag color={COLOR[stage]}>{t(stageKey(stage, level))}</Tag>;
}
