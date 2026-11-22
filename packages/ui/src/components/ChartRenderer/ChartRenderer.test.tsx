import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ReportGrid } from "../ReportGrid/ReportGrid";
import userEvent from "@testing-library/user-event";

import type { CardResult, ChartType, ReportCard } from "../reportTypes";
import { buildChartModel } from "./model";
import { buildEchartsOption } from "./option";
import { DEFAULT_CHART_LABELS } from "./labels";
import { ChartRenderer } from "./ChartRenderer";

// ECharts cannot draw in jsdom: replace the lazily imported module with a recording fake.
const ec = vi.hoisted(() => {
  const instances = new Map<Element, { setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>();
  const init = vi.fn((el: Element) => {
    const inst = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(() => instances.delete(el)) };
    instances.set(el, inst);
    return inst;
  });
  const getInstanceByDom = vi.fn((el: Element) => instances.get(el));
  return { instances, init, getInstanceByDom };
});
vi.mock("./echartsModules", () => ({ init: ec.init, getInstanceByDom: ec.getInstanceByDom }));

interface SeriesOption {
  type: string;
  name?: string;
  radius?: unknown;
  data: ({ value: number; display: string; name?: string } | null)[];
}
interface Option {
  color: string[];
  xAxis?: { data: string[] };
  yAxis?: { name: string };
  series: SeriesOption[];
}

const lastOption = (): Option => {
  const inst = [...ec.instances.values()].at(-1)!;
  return inst.setOption.mock.calls.at(-1)![0] as Option;
};

const card = (type: ChartType, extra: Partial<ReportCard> = {}): ReportCard => ({
  id: `c-${type}`,
  type,
  title: "Sales",
  layout: { x: 0, y: 0, w: 6, h: 4 },
  data: { measure: { path: "header.total", agg: "sum" }, dimension: { kind: "category", path: "header.branch" } },
  style: { precision: 2 },
  ...extra,
});

const ok = (rows: CardResult["rows"], status: CardResult["status"] = "ok"): CardResult => ({ card_id: "c", status, rows });
const row = (dimension: string | null, value: string | null, extra: Partial<CardResult["rows"][number]> = {}) => ({
  dimension,
  series: null,
  unit: null,
  value,
  count: 1,
  ...extra,
});

beforeEach(() => {
  ec.instances.clear();
  ec.init.mockClear();
  ec.getInstanceByDom.mockClear();
});

it.each(["image", "html"] as const)("removes frame padding around %s content but not ordinary charts (FR-REPORT-021)", (type) => {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = readFileSync("src/components/components.css", "utf8");
  document.head.append(stylesheet);
  try {
    const media = card(type, { data: null, content: type === "html" ? { mode: "html", html: "<p>Hello</p>" } : {} });
    const chart = card("table");
    render(<ReportGrid cards={[media, chart]} mode="stack" renderCard={(c) => <ChartRenderer card={c} />} />);
    const frames = document.querySelectorAll(".sf-rg-card");
    expect(frames[0]).toHaveStyle({ padding: "0px" });
    expect(frames[1]).toHaveStyle({ padding: "12px" });
    if (type === "html") {
      const iframe = frames[0]!.querySelector("iframe")!;
      expect(iframe).toHaveStyle({ position: "absolute", inset: "0" });
      expect(iframe).not.toHaveAttribute("tabindex", "-1");
      expect(iframe.style.pointerEvents).not.toBe("none");
    }
  } finally {
    stylesheet.remove();
  }
});

it("refuses external frames without a server-approved origin", () => {
  render(<ChartRenderer card={card("html", { data: null, content: { mode: "url", url: "https://unapproved.example/page" } })} />);
  expect(document.querySelector("iframe")).toBeNull();
});

it("does not add body margins inside sanitized HTML (FR-REPORT-020)", () => {
  render(<ChartRenderer card={card("html", { data: null, content: { mode: "html", html: "<div style='height:100%;background-color:#123456'>Content</div>" } })} />);
  const frame = document.querySelector("iframe")!;
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(frame.getAttribute("srcdoc")!);
  doc.close();
  expect(doc.defaultView!.getComputedStyle(doc.body).margin).toBe("0px");
  expect(doc.body.textContent).toBe("Content");
  expect(frame).toHaveAttribute("sandbox", "");
});

it("renders static HTML without a query using a restrictive sandbox", () => {
  render(<ChartRenderer card={card("html", { data: null, content: { mode: "html", html: "<h2>Hello</h2>" } })} />);
  const frame = screen.getAllByTitle("Sales").find((el) => el.tagName === "IFRAME")!;
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  expect(ec.init).not.toHaveBeenCalled();
});

it("uses numeric X and category Y for horizontal bars without changing exact points", () => {
  const c = card("bar", { style: { direction: "horizontal" } });
  const model = buildChartModel(c, ok([row("A", "10.00"), row("B", null)]), DEFAULT_CHART_LABELS);
  const opt = buildEchartsOption(c, model, { colors: ["#123456"], noValue: "—" });
  expect(opt.xAxis).toMatchObject({ type: "value" });
  expect(opt.yAxis).toMatchObject({ type: "category", data: ["A", "B"] });
  expect((opt.series as { data: unknown[] }[])[0]!.data).toEqual([expect.objectContaining({ exact: "10.00" }), null]);
});

describe("ChartRenderer chart types", () => {
  const rows = [row("Bangkok", "3244.8", { unit: "THB" }), row("Chiang Mai", "1000", { unit: "THB" })];

  it.each(["bar", "line"] as const)("renders a %s chart with exact labels and a hidden table", async (type) => {
    render(<ChartRenderer card={card(type)} result={ok(rows)} />);
    const img = screen.getByRole("img", { name: `Sales: ${DEFAULT_CHART_LABELS.chartTypes[type]}, 2 data points` });
    await waitFor(() => expect(ec.init).toHaveBeenCalledWith(img, undefined, { renderer: "canvas" }));
    const opt = lastOption();
    expect(opt.series[0]!.type).toBe(type);
    expect(opt.xAxis!.data).toEqual(["Bangkok", "Chiang Mai"]);
    expect(opt.yAxis!.name).toBe("THB");
    expect(opt.series[0]!.data[0]).toMatchObject({ value: 3244.8, display: "3,244.80" });
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3,244.80" })).toHaveAttribute("title", "3244.8");
  });

  it.each(["pie", "donut"] as const)("renders a %s chart", async (type) => {
    render(<ChartRenderer card={card(type)} result={ok(rows)} />);
    await waitFor(() => expect(ec.init).toHaveBeenCalled());
    const s = lastOption().series[0]!;
    expect(s.type).toBe("pie");
    expect(s.radius).toEqual(type === "donut" ? ["58%", "76%"] : "72%");
    expect(s.data.map((d) => d?.name)).toEqual(["Bangkok", "Chiang Mai"]);
  });

  it("renders a metric as text without ECharts", async () => {
    render(
      <ChartRenderer
        card={card("metric", { data: { measure: { agg: "sum" }, unit: { mode: "fixed", value: "THB" } }, style: { precision: 0 } })}
        result={ok([row(null, "123456789012345678.5")])}
      />,
    );
    const list = screen.getByRole("list", { name: "Sales: Metric, 1 data point" });
    expect(within(list).getByText("123,456,789,012,345,679")).toHaveAttribute("title", "123456789012345678.5");
    expect(within(list).getByText("THB")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(ec.init).not.toHaveBeenCalled();
  });

  it("renders only raw selected columns, duplicates and nulls with server pagination", async () => {
    const onPageChange = vi.fn();
    const result = { ...ok([]), table: {
      columns: [{ key: "vendor", label: "Customer", type: "string" }, { key: "amount", label: "Amount", type: "decimal" }],
      rows: [{ vendor: "ACME", amount: "12.00" }, { vendor: "ACME", amount: "12.00" }, { vendor: null, amount: null }],
      page: 1, page_size: 5, total: 12,
    } };
    render(<ChartRenderer card={card("table")} result={result} onPageChange={onPageChange} />);
    const region = screen.getByRole("region", { name: "Sales" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("columnheader", { name: "Customer" })).toBeInTheDocument();
    expect(within(region).getAllByRole("cell", { name: "12.00" })).toHaveLength(2);
    expect(within(region).getAllByRole("cell", { name: "—" })).toHaveLength(2);
    expect(screen.queryByRole("columnheader", { name: "Count" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(ec.init).not.toHaveBeenCalled();
  });

  it("keeps the pager usable on an empty out-of-range page", async () => {
    const onPageChange = vi.fn();
    render(<ChartRenderer card={card("table")} onPageChange={onPageChange} result={{ ...ok([]), table: {
      columns: [{ key: "vendor", label: "Customer", type: "string" }], rows: [], page: 4, page_size: 5, total: 12,
    } }} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("uses style.colors, else the token palette", async () => {
    const { unmount } = render(<ChartRenderer card={card("bar", { style: { colors: ["#112233", "nope"] } })} result={ok(rows)} />);
    await waitFor(() => expect(ec.init).toHaveBeenCalled());
    expect(lastOption().color).toEqual(["#112233"]);
    unmount();
    render(<ChartRenderer card={card("bar")} result={ok(rows)} palette={["#abcdef"]} />);
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(2));
    expect(lastOption().color).toEqual(["#abcdef"]);
  });

  it("applies the axis style: hidden axes and own titles over the unit", async () => {
    const style = { axis: { show_x: false, show_y: true, x_title: " Branch ", y_title: "Amount" } };
    render(<ChartRenderer card={card("bar", { style })} result={ok(rows)} />);
    await waitFor(() => expect(ec.init).toHaveBeenCalled());
    const opt = lastOption() as Option & { xAxis: { show: boolean; name: string }; yAxis: { show: boolean; name: string } };
    expect(opt.xAxis).toMatchObject({ show: false, name: "Branch" });
    expect(opt.yAxis).toMatchObject({ show: true, name: "Amount" });
  });
});

describe("ChartRenderer data mapping", () => {
  it("labels null dimensions Unknown and leaves null / missing buckets as gaps", async () => {
    const result = ok([
      row("Jan", "10", { series: "A" }),
      row(null, "5", { series: "A" }),
      row("Jan", null, { series: "B" }),
    ]);
    const c = card("line", { data: { dimension: { kind: "date", path: "header.date" }, series: { path: "header.branch" } } });
    render(<ChartRenderer card={c} result={result} />);
    await waitFor(() => expect(ec.init).toHaveBeenCalled());
    const opt = lastOption();
    expect(opt.xAxis!.data).toEqual(["Jan", "Unknown"]);
    expect(opt.series.map((s) => s.name)).toEqual(["A", "B"]);
    expect(opt.series[1]!.data).toEqual([null, null]);
    // a point between gaps stays visible however long the date axis is (FR-REPORT-013)
    expect(opt.series.every((s) => (s as { showAllSymbol?: unknown }).showAllSymbol === true)).toBe(true);
    expect(screen.getByRole("rowheader", { name: "Unknown" })).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("Sales: Line chart, 3 data points in 2 series");
  });

  it("splits series by unit when units differ", () => {
    const model = buildChartModel(
      card("bar"),
      ok([row("X", "1", { unit: "THB" }), row("X", "2", { unit: "USD" })]),
      DEFAULT_CHART_LABELS,
    );
    expect(model.series.map((s) => s.name)).toEqual(["Sales (THB)", "Sales (USD)"]);
    expect(model.units).toEqual(["THB", "USD"]);
  });
});

describe("ChartRenderer presentation (FR-REPORT-013)", () => {
  it("leaves category labels inside the plot while preserving gaps and exact values", () => {
    const c = card("line", { style: { precision: 2, legend: true } });
    const model = buildChartModel(c, ok([row("A", "1.234567"), row("B", null), row("C", "-2")]), DEFAULT_CHART_LABELS);
    const opt = buildEchartsOption(c, model, { colors: ["#112233"], noValue: "—" }) as {
      grid: { containLabel: boolean };
      series: { areaStyle?: { opacity: number }; lineStyle: { width: number }; connectNulls: boolean; data: unknown[] }[];
    };
    expect(opt.grid.containLabel).toBe(true);
    expect(opt.series[0]).toMatchObject({ connectNulls: false, lineStyle: { width: 3 }, areaStyle: { opacity: 0.08 } });
    expect(opt.series[0]!.data).toEqual([
      { value: 1.234567, exact: "1.234567", display: "1.23", unit: null },
      null,
      { value: -2, exact: "-2", display: "-2.00", unit: null },
    ]);
  });

  it("does not layer area fills over stacked lines", () => {
    const c = card("line", { style: { stacked: true } });
    const model = buildChartModel(c, ok([row("A", "1")]), DEFAULT_CHART_LABELS);
    const opt = buildEchartsOption(c, model, { colors: ["#112233"], noValue: "—" }) as { series: { areaStyle?: unknown }[] };
    expect(opt.series[0]!.areaStyle).toBeUndefined();
  });
});

describe("ChartRenderer states", () => {
  it("shows loading while there is no result", () => {
    render(<ChartRenderer card={card("bar")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("shows the empty state", () => {
    render(<ChartRenderer card={card("bar")} result={ok([], "empty")} />);
    expect(screen.getByRole("status")).toHaveTextContent("No data for this period");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the error state with the error code text and retry", async () => {
    const onRetry = vi.fn();
    render(
      <ChartRenderer
        card={card("bar")}
        result={{ card_id: "c", status: "error", error_code: "group_limit", rows: [] }}
        onRetry={onRetry}
        labels={{ errors: { group_limit: "Trop de groupes" } }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("This card could not be loaded");
    expect(status).toHaveTextContent("Trop de groupes");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("treats negative values in a pie as an error", () => {
    render(<ChartRenderer card={card("pie")} result={ok([row("A", "-1"), row("B", "2")])} />);
    expect(screen.getByRole("status")).toHaveTextContent("Pie and donut charts cannot show negative values");
  });

  it("shows the not_applicable note with the data", () => {
    render(<ChartRenderer card={card("table")} result={ok([row("A", "1")], "not_applicable")} />);
    expect(screen.getByText("The page date range does not apply to this card")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.00" })).toBeInTheDocument();
  });

  it("shows the not_applicable note when there are no rows", () => {
    render(<ChartRenderer card={card("bar")} result={ok([], "not_applicable")} />);
    expect(screen.getByText("The page date range does not apply to this card")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No data for this period");
  });
});
