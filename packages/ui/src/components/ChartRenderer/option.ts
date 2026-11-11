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
  const textStyle = { fontFamily: FONT_STACK, color: COLORS.text };
  const base = { color: ctx.colors, textStyle, animationDuration: 300 };

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
        trigger: "item",
        confine: true,
        formatter: (raw: unknown) => {
          const p = raw as TooltipParam;
          const pct = typeof p.percent === "number" ? ` (${p.percent.toFixed(1)}%)` : "";
          return `${p.marker ?? ""}${escapeHtml(p.name ?? "")}: <b>${escapeHtml(withUnit(p.data?.display ?? ctx.noValue, p.data?.unit))}</b>${pct}`;
        },
      },
      legend: { show: legend, type: "scroll", bottom: 0, textStyle },
      series: [
        {
          type: "pie",
          radius: card.type === "donut" ? ["45%", "70%"] : "70%",
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
  return {
    ...base,
    tooltip: {
      trigger: "axis",
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
    legend: { show: legend, type: "scroll", bottom: 0, textStyle },
    grid: {
      left: 12,
      right: xTitle ? 48 : 16,
      top: showY && yTitle ? 36 : 20,
      bottom: legend ? 40 : 12,
    },
    xAxis: {
      type: "category",
      show: showX,
      name: xTitle,
      nameTextStyle: { color: COLORS["text-secondary"] },
      data: model.categories,
      axisLabel: { hideOverlap: true, overflow: "truncate", width: 96, color: COLORS["text-secondary"] },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      show: showY,
      name: yTitle,
      nameTextStyle: { color: COLORS["text-secondary"], align: "left" },
      axisLabel: { color: COLORS["text-secondary"], formatter: (v: number) => numberFormat.format(v) },
      splitLine: { lineStyle: { color: COLORS.border } },
    },
    series: model.series.map((s) => ({
      type: card.type === "line" ? "line" : "bar",
      name: s.name,
      stack: style.stacked ? "total" : undefined,
      connectNulls: false,
      showSymbol: card.type === "line" ? true : undefined,
      emphasis: { focus: "series" },
      label: {
        show: showLabels,
        position: card.type === "line" ? "top" : style.stacked ? "inside" : "top",
        formatter: (raw: unknown) => (raw as TooltipParam).data?.display ?? "",
      },
      data: s.points.map(pointData),
    })),
  };
}
