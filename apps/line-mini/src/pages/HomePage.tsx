import { ComingSoon } from "../components/ComingSoon";
import { UsageCard } from "../features/billing/UsageCard";
import { useT } from "../i18n";

/** Home: the usage card, and the scan entry once B-3 exists (FR-SYS-056). */
export function HomePage() {
  const t = useT();
  return (
    <div className="page">
      <h1 className="page__title">{t("nav.home")}</h1>
      <UsageCard />
      <ComingSoon />
    </div>
  );
}

export function HistoryPage() {
  const t = useT();
  return (
    <div className="page">
      <h1 className="page__title">{t("nav.history")}</h1>
      <ComingSoon />
    </div>
  );
}

export function ReportPage() {
  const t = useT();
  return (
    <div className="page">
      <h1 className="page__title">{t("nav.report")}</h1>
      <ComingSoon />
    </div>
  );
}
