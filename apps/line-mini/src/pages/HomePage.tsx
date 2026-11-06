import { ComingSoon } from "../components/ComingSoon";
import { ScanHomePage } from "../features/scan/ScanHomePage";
import { useT } from "../i18n";

/** Home is main's scan home (FR-SYS-056, 057, 058, 109–111): plan banner, scan entry,
 * upload batch, Pending and recent tasks. */
export function HomePage() {
  return <ScanHomePage />;
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
