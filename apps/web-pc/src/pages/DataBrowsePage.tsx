import { ComingSoon } from "../components/ComingSoon";
import { Page } from "../components/Page";
import { useT } from "../i18n";

/** Structured data browsing arrives after recognition and verification (FR-SYS-094, OQ-B5c-1). */
export function DataBrowsePage() {
  const t = useT();
  return (
    <Page name="data" title={t("nav.data")}>
      <ComingSoon />
    </Page>
  );
}
