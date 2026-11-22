import type { ChartLabels, ReportGridLabels } from "@saiflow/ui";
import type { ReportDesignerLabels, ReportErrorLabels } from "@saiflow/ui/report-designer";
import { useMemo } from "react";

import { useT, type T } from "../i18n";

/** Texts of the shared report designer in the console language (FR-SYS-143): the same
 * shapes as their English defaults, filled from the console dictionaries. */
export function errorLabels(t: T): ReportErrorLabels {
  return {
    invalid: t("rpe.invalid"),
    periodFrom: t("rpe.periodFrom"),
    periodTo: t("rpe.periodTo"),
    periodOrder: t("rpe.periodOrder"),
    rowHeight: t("rpe.rowHeight"),
    maxCards: (n) => t("rpe.maxCards", { n }),
    needCard: t("rpe.needCard"),
    tooLarge: t("rpe.tooLarge"),
    maxText: (n) => t("rpe.maxText", { n }),
    layout: t("rpe.layout"),
    overlaps: (other) => t("rpe.overlaps", { other }),
    precision: t("rpe.precision"),
    colors: t("rpe.colors"),
    color: t("rpe.color"),
    needTemplate: t("rpe.needTemplate"),
    templateGone: t("rpe.templateGone"),
    needVersions: t("rpe.needVersions"),
    versionUnavailable: t("rpe.versionUnavailable"),
    versionOther: t("rpe.versionOther"),
    needGrain: t("rpe.needGrain"),
    needTable: t("rpe.needTable"),
    tableNotInAll: t("rpe.tableNotInAll"),
    needMeasure: t("rpe.needMeasure"),
    needAgg: t("rpe.needAgg"),
    needField: t("rpe.needField"),
    columnOutside: t("rpe.columnOutside"),
    measureColumn: t("rpe.measureColumn"),
    fieldMissing: t("rpe.fieldMissing"),
    fieldNotInAll: t("rpe.fieldNotInAll"),
    fieldTypes: t("rpe.fieldTypes"),
    wrongType: (type) => t("rpe.wrongType", { type }),
    needTimeGrain: t("rpe.needTimeGrain"),
    metricNoDimension: t("rpe.metricNoDimension"),
    needDimension: t("rpe.needDimension"),
    noSeries: t("rpe.noSeries"),
    seriesSame: t("rpe.seriesSame"),
    needUnit: t("rpe.needUnit"),
    unitLength: t("rpe.unitLength"),
    confirm: (path) => t("rpe.confirm", { path }),
  };
}

const chartTypes = (t: T) => ({
  bar: t("rpc.type.bar"),
  line: t("rpc.type.line"),
  pie: t("rpc.type.pie"),
  donut: t("rpc.type.donut"),
  metric: t("rpc.type.metric"),
  table: t("rpc.type.table"),
  image: t("rpc.type.image"),
  html: t("rpc.type.html"),
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
    previousPage: t("rpc.previousPage"),
    nextPage: t("rpc.nextPage"),
    pagination: (page, pages, total) => t("rpc.pagination", { page, pages, total }),
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

export function gridLabels(t: T): Partial<ReportGridLabels> {
  return { grid: t("rpg.grid"), designHelp: t("rpg.designHelp") };
}

export function designerLabels(t: T): ReportDesignerLabels {
  return {
    palette: t("rpd.palette"),
    add: (type) => t("rpd.add", { type }),
    cardLimit: (n) => t("rpd.cardLimit", { n }),
    canvas: t("rpd.canvas"),
    emptyCanvas: t("rpd.emptyCanvas"),
    previewHint: t("rpd.previewHint"),
    previewStale: t("rpd.previewStale"),
    previewSynthetic: t("rpd.previewSynthetic"),
    untitled: (type) => t("rpd.untitled", { type }),
    pagePanel: t("rpd.pagePanel"),
    cardPanel: t("rpd.cardPanel"),
    tabData: t("rpd.tabData"),
    tabStyle: t("rpd.tabStyle"),
    cardTitle: t("rpd.cardTitle"),
    cardType: t("rpd.cardType"),
    removeCard: t("rpd.removeCard"),
    removeConfirm: t("rpd.removeConfirm"),
    confirmOk: t("rpd.confirmOk"),
    cancel: t("common.cancel"),
    period: t("rpd.period"),
    periodModes: { current_year: t("rpd.period.current_year"), fixed: t("rpd.period.fixed") },
    periodFrom: t("rpd.periodFrom"),
    periodTo: t("rpd.periodTo"),
    periodHelp: t("rpd.periodHelp"),
    rowHeight: t("rpd.rowHeight"),
    template: t("rpd.template"),
    templatePlaceholder: t("rpd.templatePlaceholder"),
    templateKept: t("rpd.templateKept"),
    scopes: { system: t("rpd.scope.system"), tenant: t("rpd.scope.tenant") },
    versions: t("rpd.versions"),
    versionLabel: ({ version, name }) => t("rpd.versionLabel", { version, name }),
    versionCurrent: t("rpd.versionCurrent"),
    versionsHelp: t("rpd.versionsHelp"),
    loadingFields: t("rpd.loadingFields"),
    fieldsFailed: t("rpd.fieldsFailed"),
    retry: t("common.retry"),
    grain: t("rpd.grain"),
    grainDocument: t("rpd.grainDocument"),
    grainTable: (name) => t("rpd.grainTable", { name }),
    grainIncompatible: t("rpd.notInAll"),
    measure: t("rpd.measure"),
    agg: t("rpd.agg"),
    aggs: {
      sum: t("rpd.agg.sum"),
      avg: t("rpd.agg.avg"),
      min: t("rpd.agg.min"),
      max: t("rpd.agg.max"),
      count: t("rpd.agg.count"),
    },
    measureField: t("rpd.measureField"),
    dimension: t("rpd.dimension"),
    dimensionKinds: { date: t("rpd.dim.date"), category: t("rpd.dim.category"), none: t("rpd.dim.none") },
    dimensionField: t("rpd.dimensionField"),
    timeGrain: t("rpd.timeGrain"),
    timeGrains: { day: t("rpd.tg.day"), month: t("rpd.tg.month"), year: t("rpd.tg.year") },
    series: t("rpd.series"),
    dateField: t("rpd.dateField"),
    dateFieldHelp: t("rpd.dateFieldHelp"),
    none: t("rpd.none"),
    unit: t("rpd.unit"),
    unitModes: { fixed: t("rpd.unit.fixed"), field: t("rpd.unit.field") },
    unitValue: t("rpd.unitValue"),
    unitField: t("rpd.unitField"),
    unitCheckField: t("rpd.unitCheckField"),
    confirm: t("rpd.confirm"),
    confirmHelp: t("rpd.confirmHelp"),
    fieldIncompatible: t("rpd.notInAll"),
    fieldUnavailable: t("rpd.fieldUnavailable"),
    fieldTypes: {
      string: t("rpa.type.string"),
      integer: t("rpa.type.integer"),
      decimal: t("rpa.type.decimal"),
      amount: t("rpa.type.amount"),
      date: t("rpa.type.date"),
    },
    chooseField: t("rpd.chooseField"),
    precision: t("rpd.precision"),
    colors: t("rpd.colors"),
    colorsHelp: t("rpd.colorsHelp"),
    addColor: t("rpd.addColor"),
    removeColor: (n) => t("rpd.removeColor", { n }),
    legend: t("rpd.legend"),
    dataLabels: t("rpd.dataLabels"),
    stacked: t("rpd.stacked"),
    axis: t("rpd.axis"),
    showX: t("rpd.showX"),
    showY: t("rpd.showY"),
    xTitle: t("rpd.xTitle"),
    yTitle: t("rpd.yTitle"),
    errorSummary: (n) => t("rpd.errorSummary", { n }),
    errorsStale: t("rpd.errorsStale"),
    cardProblems: (title, n) => t("rpd.cardProblems", { title, n }),
    chartTypes: chartTypes(t),
    errors: errorLabels(t),
  };
}

export interface ReportLabels {
  designer: ReportDesignerLabels;
  chart: ChartLabels;
  grid: Partial<ReportGridLabels>;
}

export function useReportLabels(): ReportLabels {
  const t = useT();
  return useMemo(
    () => ({ designer: designerLabels(t), chart: chartLabels(t), grid: gridLabels(t) }),
    [t],
  );
}
