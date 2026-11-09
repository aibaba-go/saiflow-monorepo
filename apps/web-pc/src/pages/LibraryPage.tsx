import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Input, Select, Tooltip } from "antd";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { useT, type MessageKey } from "../i18n";
import { Icon } from "../layout/icons";
import { useJobs, useStageCounts } from "../ocr/api";
import { JobTable } from "../ocr/JobTable";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

/** The stage tabs, in the prototype's order; every stage of the list API stays reachable. */
const STAGES = ["VERIFYING", "PENDING_REVIEW", "CONFIRMED", "OCR_PROCESSING", "TEMPLATE_MATCHING", "OCR_FAILED"] as const;
const TABS: (string | undefined)[] = [undefined, ...STAGES];
const PAGE_SIZE = 20;

const isStage = (s: string | null): s is (typeof STAGES)[number] => STAGES.includes(s as (typeof STAGES)[number]);

function Library() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [params, setParams] = useSearchParams();
  // A metric on the home page opens the library on its stage (?stage=…).
  const [stage, setStage] = useState<string | undefined>(() => {
    const s = params.get("stage");
    return isStage(s) ? s : undefined;
  });
  const [template, setTemplate] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keyword, setKeyword] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    // read once: later filters live in the page, and a tenant switch starts empty
    if (params.has("stage")) setParams({}, { replace: true });
  }, [params, setParams]);
  const templates = useQuery({
    queryKey: ["templates", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/templates")),
    enabled: tenant !== null,
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(keyword.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);
  const jobs = useJobs({
    page,
    pageSize: PAGE_SIZE,
    stage,
    q: q || undefined,
    template,
    createdFrom: range?.[0]?.format("YYYY-MM-DD"),
    createdTo: range?.[1]?.format("YYYY-MM-DD"),
  });
  const counts = useStageCounts(TABS);
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const filtered = Boolean(stage || template || range || keyword);
  const reset = () => {
    setStage(undefined);
    setTemplate(undefined);
    setRange(null);
    setKeyword("");
    setQ("");
    setPage(1);
  };

  return (
    <Page
      name="library"
      title={t("nav.library")}
      description={t("layout.desc.library")}
      extra={
        can(tenant, "upload_ocr") && (
          <Button type="primary" icon={<Icon name="plus" />} onClick={() => navigate("/upload")}>
            {t("home.uploadCta")}
          </Button>
        )
      }
    >
      <section className="pc-panel pc-library">
        <div className="pc-tabs" role="tablist" aria-label={t("library.stage")}>
          {TABS.map((s, i) => {
            const n = counts[i]?.data;
            return (
              <button
                key={s ?? "all"}
                type="button"
                role="tab"
                aria-selected={stage === s}
                className={`pc-tab${stage === s ? " is-active" : ""}`}
                onClick={() => changed(setStage)(s)}
              >
                {s ? t(`stage.${s}` as MessageKey) : t("library.all")}
                {n !== undefined && <b className="num">{n}</b>}
              </button>
            );
          })}
        </div>
        <div className="pc-filters">
          <Input
            className="pc-filters__search"
            aria-label={t("library.search")}
            placeholder={t("library.search")}
            prefix={<Icon name="search" />}
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="pc-filters__select"
            aria-label={t("library.template")}
            allowClear
            placeholder={t("library.allTemplates")}
            value={template}
            onChange={changed(setTemplate)}
            options={[
              ...(templates.data ?? []).map((x) => ({ value: String(x.template_id), label: x.name, title: x.name })),
              { value: "generic", label: t("review.generic"), title: t("review.generic") },
            ]}
          />
          <DatePicker.RangePicker
            className="pc-filters__dates"
            aria-label={t("library.dates")}
            allowEmpty={[true, true]}
            placeholder={[t("library.dateFrom"), t("library.dateTo")]}
            value={range}
            onChange={(v) => changed(setRange)(v as [Dayjs | null, Dayjs | null] | null)}
          />
          <Tooltip title={t("library.reset")}>
            <Button className="pc-filters__reset" aria-label={t("library.reset")} icon={<Icon name="reset" />} disabled={!filtered} onClick={reset} />
          </Tooltip>
        </div>
        {jobs.isError && (
          <div className="pc-library__error">
            <ErrorText error={jobs.error} />
          </div>
        )}
        <JobTable
          rows={jobs.data?.items ?? []}
          loading={jobs.isPending}
          emptyText={t("library.empty")}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: jobs.data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (n) => t("library.total", { n, size: PAGE_SIZE }),
            onChange: setPage,
          }}
        />
      </section>
      <p className="pc-notice">
        <Icon name="info" />
        {t("library.notice")}
      </p>
    </Page>
  );
}

/** The document library (FR-SYS-130): the current tenant's visible tasks with combined
 * filters, 20 a page; a tenant switch starts with empty filters. */
export function LibraryPage() {
  const { tenant } = useTenant();
  return <Library key={tenant?.tenant_id ?? "none"} />;
}
