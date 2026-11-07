import { useQuery } from "@tanstack/react-query";
import { DatePicker, Input, Select, Space, Table } from "antd";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { type JobOut, useJobs } from "../ocr/api";
import { jobTarget } from "../ocr/stage";
import { StageTag } from "../ocr/StageTag";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

const STAGES = ["OCR_PROCESSING", "OCR_FAILED", "TEMPLATE_MATCHING", "VERIFYING", "PENDING_REVIEW", "CONFIRMED"] as const;
const PAGE_SIZE = 20;

function Library() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const canVerify = can(tenant, "verify_own") || can(tenant, "verify_others");
  const [stage, setStage] = useState<string | undefined>();
  const [template, setTemplate] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keyword, setKeyword] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
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
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <Page name="library" title={t("nav.library")}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          aria-label={t("library.stage")}
          allowClear
          placeholder={t("library.stage")}
          style={{ width: 180 }}
          value={stage}
          onChange={changed(setStage)}
          options={STAGES.map((s) => ({ value: s, label: t(`stage.${s}`), title: t(`stage.${s}`) }))}
        />
        <Select
          aria-label={t("library.template")}
          allowClear
          placeholder={t("library.template")}
          style={{ width: 200 }}
          value={template}
          onChange={changed(setTemplate)}
          options={[
            ...(templates.data ?? []).map((x) => ({ value: String(x.template_id), label: x.name, title: x.name })),
            { value: "generic", label: t("review.generic"), title: t("review.generic") },
          ]}
        />
        <DatePicker.RangePicker
          aria-label={t("library.dates")}
          allowEmpty={[true, true]}
          value={range}
          onChange={(v) => changed(setRange)(v as [Dayjs | null, Dayjs | null] | null)}
        />
        <Input.Search
          aria-label={t("library.search")}
          placeholder={t("library.search")}
          allowClear
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </Space>
      {jobs.isError && <ErrorText error={jobs.error} />}
      <Table<JobOut>
        rowKey="id"
        loading={jobs.isPending}
        dataSource={jobs.data?.items ?? []}
        locale={{ emptyText: t("library.empty") }}
        onRow={(j) => ({ onClick: () => navigate(jobTarget(j, canVerify)), style: { cursor: "pointer" } })}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: jobs.data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { key: "file", title: t("review.col.file"), render: (_, j) => j.file_name },
          { key: "template", title: t("review.col.template"), render: (_, j) => j.template_name ?? t("review.generic") },
          { key: "stage", title: t("ocr.status"), render: (_, j) => <StageTag stage={j.stage} level={j.review_level} /> },
          { key: "pages", title: t("review.col.pages"), render: (_, j) => j.page_count },
          { key: "at", title: t("library.createdAt"), render: (_, j) => formatBangkokDateTime(j.created_at) },
        ]}
      />
    </Page>
  );
}

/** The document library (FR-SYS-130): the current tenant's visible tasks with combined
 * filters, 20 a page; a tenant switch starts with empty filters. */
export function LibraryPage() {
  const { tenant } = useTenant();
  return <Library key={tenant?.tenant_id ?? "none"} />;
}
