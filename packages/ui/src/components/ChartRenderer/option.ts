import type { EChartsCoreOption } from "echarts/core";

import { BRAND_COLORS, COLORS, FONT_STACK } from "../../tokens";
import { clampPrecision } from "../decimal";
import type { ReportCard } from "../reportTypes";
import type { ChartModel, ChartPoint } from "./model";

/** Default series colours from the STD-008 tokens (brand blue first, teal decorative). */
export const DEFAULT_CHART_COLORS: readonly string[] = [
  BRAND_COLORS["brand-blue"],
  BRAND_COLORS["brand-teal"],
  COLORS.warning,
  BRAND_COLORS["brand-navy-2"],
  COLORS.success,
  COLORS.review,
  COLORS.danger,
  COLORS["text-secondary"],
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function chartColors(card: ReportCard, palette?: readonly string[]): string[] {
  const own = (card.style?.colors ?? []).filter((c) => typeof c === "string" && HEX_RE.test(c));
  if (own.length) return own;
  return [...(palette && palette.length ? palette : DEFAULT_CHART_COLORS)];
}

/** Escape text for the ECharts HTML tooltip (labels come from documents). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

interface PointData {
  value: number;
  exact: string | null;
  display: string;
  unit: string | null;
}

function pointData(p: ChartPoint): PointData | null {
  if (p.value === null) return null;
  return { value: p.value, exact: p.exact, display: p.display, unit: p.unit };
}

const withUnit = (display: string, unit: string | null | undefined) => (unit ? `${display} ${unit}` : display);

interface TooltipParam {
  marker?: string;
  seriesName?: string;
  name?: string;
  axisValueLabel?: string;
  data?: PointData | null;
  percent?: number;
}

export interface OptionContext {
  colors: string[];
  locale?: string;
  noValue: string;
}

/** ECharts option for bar / line / pie / donut. Coordinates are numbers; texts use exact strings. */
export function buildEchartsOption(card: ReportCard, model: ChartModel, ctx: OptionContext): EChartsCoreOption {
  const style = card.style ?? {};
  const precision = clampPrecision(style.precision);
  const showLabels = !!style.labels;
  const singleUnit = model.units.length === 1 ? model.units[0] : undefined;
  const legend = style.legend ?? model.series.length > 1;
  const textStyle = { fontFamily: FONT_STACK, color: BRAND_COLORS["brand-navy"], fontSize: 12 };
  const tooltipStyle = {
    backgroundColor: COLORS.surface,
    borderColor: BRAND_COLORS.border,
    borderWidth: 1,
    padding: [10, 14],
    textStyle,
    extraCssText: "border-radius:10px;line-height:1.6",
  };
  const legendStyle = { show: legend, type: "scroll" as const, bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle };
  const base = { color: ctx.colors, textStyle, animationDuration: 200 };

  if (card.type === "pie" || card.type === "donut") {
    const data = model.series.flatMap((s) =>
      s.points.flatMap((p, i) => {
        const d = pointData(p);
        if (!d) return [];
        const cat = model.categories[i] ?? "";
        const name = !model.hasDimension ? s.name : model.series.length > 1 ? `${cat} · ${s.name}` : cat;
        return [{ ...d, name }];
      }),
    );
    return {
      ...base,
      tooltip: {
        ...tooltipStyle,
        trigger: "item",
        confine: true,
        formatter: (raw: unknown) => {
          const p = raw as TooltipParam;
          const pct = typeof p.percent === "number" ? ` (${p.percent.toFixed(1)}%)` : "";
          return `${p.marker ?? ""}${escapeHtml(p.name ?? "")}: <b>${escapeHtml(withUnit(p.data?.display ?? ctx.noValue, p.data?.unit))}</b>${pct}`;
        },
      },
      legend: legendStyle,
      series: [
        {
          type: "pie",
          radius: card.type === "donut" ? ["58%", "76%"] : "72%",
          itemStyle: { borderColor: COLORS.surface, borderWidth: 2, borderRadius: 4 },
          center: ["50%", legend ? "45%" : "50%"],
          avoidLabelOverlap: true,
          label: {
            show: showLabels,
            formatter: (raw: unknown) => {
              const p = raw as TooltipParam;
              return `${p.name ?? ""}: ${withUnit(p.data?.display ?? "", p.data?.unit)}`;
            },
          },
          data,
        },
      ],
    };
  }

  const numberFormat = new Intl.NumberFormat(ctx.locale || undefined, { maximumFractionDigits: precision });
  const axis = style.axis ?? {};
  const showX = axis.show_x ?? true;
  const showY = axis.show_y ?? true;
  const xTitle = axis.x_title?.trim() || "";
  // The y axis name defaults to the single unit/currency of the card (FR-REPORT-012/013).
  const yTitle = axis.y_title?.trim() || singleUnit || "";
  const horizontal = card.type === "bar" && style.direction === "horizontal";
  const categoryAxis = {
    type: "category" as const,
    data: model.categories,
    axisLabel: { hideOverlap: true, overflow: "truncate", width: 96, color: COLORS["text-secondary"] },
    axisLine: { lineStyle: { color: BRAND_COLORS.border } },
    axisTick: { show: false, alignWithLabel: true },
  };
  const valueAxis = {
    type: "value" as const,
    axisLabel: { color: COLORS["text-secondary"], formatter: (v: number) => numberFormat.format(v) },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: BRAND_COLORS.border, type: "dashed" } },
  };
  return {
    ...base,
    tooltip: {
      ...tooltipStyle,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: BRAND_COLORS.border, type: "dashed" } },
      confine: true,
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as TooltipParam[];
        const head = escapeHtml(list[0]?.axisValueLabel ?? list[0]?.name ?? "");
        const lines = list.map(
          (p) =>
            `${p.marker ?? ""}${escapeHtml(p.seriesName ?? "")}: <b>${escapeHtml(
              p.data ? withUnit(p.data.display, p.data.unit) : ctx.noValue,
            )}</b>`,
        );
        return [head, ...lines].join("<br/>");
      },
    },
    legend: legendStyle,
    grid: {
      containLabel: true,
      left: 8,
      right: xTitle ? 48 : 16,
      top: showY && yTitle ? 36 : 20,
      bottom: legend ? 40 : 12,
    },
    xAxis: {
      ...(horizontal ? valueAxis : categoryAxis),
      show: showX,
      name: axis.x_title?.trim() || (horizontal ? singleUnit || "" : xTitle),
      nameTextStyle: { color: COLORS["text-secondary"] },
    },
    yAxis: {
      ...(horizontal ? categoryAxis : valueAxis),
      show: showY,
      name: horizontal ? axis.y_title?.trim() || "" : yTitle,
      nameTextStyle: { color: COLORS["text-secondary"], align: "left" },
    },
    series: model.series.map((s) => ({
      type: card.type === "line" ? "line" : "bar",
      name: s.name,
      stack: style.stacked ? "total" : undefined,
      connectNulls: false,
      barMaxWidth: card.type === "bar" ? 36 : undefined,
      itemStyle: card.type === "bar" ? { borderRadius: 3 } : undefined,
      lineStyle: card.type === "line" ? { width: 3 } : undefined,
      areaStyle: card.type === "line" && !style.stacked && (style.fill ?? true) ? { opacity: 0.08 } : undefined,
      symbolSize: card.type === "line" ? 6 : undefined,
      showSymbol: card.type === "line" ? true : undefined,
      // ECharts' "auto" hides symbols on a long category axis, which loses an isolated point
      // between gaps (connectNulls is off); always show them (FR-REPORT-013).
      showAllSymbol: card.type === "line" ? true : undefined,
      emphasis: { focus: "series" },
      label: {
        show: showLabels,
        position: card.type === "line" ? "top" : style.stacked ? "inside" : horizontal ? "right" : "top",
        formatter: (raw: unknown) => (raw as TooltipParam).data?.display ?? "",
      },
      data: s.points.map(pointData),
    })),
  };
}
