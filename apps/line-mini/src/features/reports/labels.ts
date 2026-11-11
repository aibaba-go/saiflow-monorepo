import type { ChartLabels, ReportCardInfoLabels, ReportGridLabels } from "@saiflow/ui";
import { useMemo } from "react";

import { useT, type T } from "../../i18n";

/** Texts of the shared report components in the current language (FR-REPORT-018): the same
 * shapes as their English defaults, filled from the LINE dictionaries. */
const chartTypes = (t: T) => ({
  bar: t("rpc.type.bar"),
  line: t("rpc.type.line"),
  pie: t("rpc.type.pie"),
  donut: t("rpc.type.donut"),
  metric: t("rpc.type.metric"),
  table: t("rpc.type.table"),
});

export function chartLabels(t: T): ChartLabels {
  return {
    loading: t("rpc.loading"),
    empty: t("rpc.empty"),
    notApplicable: t("rpc.notApplicable"),
    error: t("rpc.error"),
    errors: {
      query_timeout: t("rpc.err.query_timeout"),
      group_limit: t("rpc.err.group_limit"),
      mixed_units: t("rpc.err.mixed_units"),
      negative_in_pie: t("rpc.err.negative_in_pie"),
      invalid_config: t("rpc.err.invalid_config"),
    },
    retry: t("common.retry"),
    unknown: t("rpc.unknown"),
    value: t("rpc.value"),
    count: t("rpc.count"),
    category: t("rpc.category"),
    series: t("rpc.series"),
    unit: t("rpc.unit"),
    noValue: "—",
    outOfRange: t("rpc.outOfRange"),
    chartTypes: chartTypes(t),
    summary: ({ title, type, points, series }) =>
      series > 1 ? t("rpc.summarySeries", { title, type, points, series }) : t("rpc.summary", { title, type, points }),
  };
}

export function infoLabels(t: T): ReportCardInfoLabels {
  return {
    source: t("rpi.source"),
    sourceValue: ({ name, versions }) => t("rpi.sourceValue", { name, versions }),
    sourceUnknown: t("rpi.sourceUnknown"),
    version: (n) => t("rpi.version", { n }),
    grain: t("rpi.grain"),
    grainDocument: t("rpi.grainDocument"),
    grainTable: (table) => t("rpi.grainTable", { table }),
    unit: t("rpi.unit"),
    unitFixed: (unit) => unit,
    unitField: t("rpi.unitField"),
    unitNone: t("rpi.unitNone"),
    counted: t("rpi.counted"),
    countedValue: ({ documents, items }) =>
      items === null ? t("rpi.countedDocs", { documents }) : t("rpi.countedRows", { documents, items }),
    excluded: t("rpi.excluded"),
    excludedNone: t("rpi.excludedNone"),
    excludedTotal: (n) => t("rpi.excludedTotal", { n }),
    reasons: {
      invalid_number: t("rpi.reason.invalid_number"),
      too_precise: t("rpi.reason.too_precise"),
      invalid_date: t("rpi.reason.invalid_date"),
      missing_date: t("rpi.reason.missing_date"),
      empty_row: t("rpi.reason.empty_row"),
      invalid_structure: t("rpi.reason.invalid_structure"),
      missing: t("rpi.reason.missing"),
    },
    details: t("rpt.details"),
  };
}

export interface ReportLabels {
  chart: ChartLabels;
  grid: Partial<ReportGridLabels>;
  info: ReportCardInfoLabels;
  locale: string;
}

export function useReportLabels(): ReportLabels {
  const t = useT();
  return useMemo(
    () => ({ chart: chartLabels(t), grid: { grid: t("rpg.grid") }, info: infoLabels(t), locale: t("rpt.locale") }),
    [t],
  );
}
