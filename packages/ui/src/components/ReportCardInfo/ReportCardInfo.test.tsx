import { render, screen, within } from "@testing-library/react";

import type { CardResult, ReportCard } from "../reportTypes";
import { describeCard, ReportCardDetails, ReportCardInfo, type ReportCardSource } from "./ReportCardInfo";

const SOURCES: ReportCardSource[] = [
  { template_id: 12, name: "Invoice", versions: [{ id: 103, version: 3 }, { id: 101, version: 1 }, { id: 102, version: 2 }] },
];

const card = (data: ReportCard["data"]): ReportCard => ({ id: "c1", type: "bar", title: "Sales", layout: { x: 0, y: 0, w: 6, h: 4 }, data });

const base = { template_id: 12, template_version_ids: [103, 101], measure: { path: "header.total", agg: "sum" as const } };

const result = (over: Partial<CardResult> = {}): CardResult => ({
  card_id: "c1",
  status: "ok",
  rows: [],
  diagnostics: { documents: 8, items: 20, excluded: { invalid_number: 2, missing_date: 1, too_precise: 0 } },
  ...over,
});

describe("describeCard (FR-REPORT-002, FR-REPORT-011)", () => {
  it("names the template with only the chosen versions in version order", () => {
    const d = describeCard(card({ ...base, unit: { mode: "fixed", value: "THB" } }), SOURCES, result());
    expect(d.source).toBe("Invoice · v1, v3");
    expect(d.grain).toBe("Document");
    expect(d.unit).toBe("THB");
    expect(d.counted).toBe("8 documents");
    expect(d.excluded.map((e) => [e.reason, e.n])).toEqual([
      ["invalid_number", 2],
      ["missing_date", 1],
    ]);
    expect(d.excludedTotal).toBe(3);
  });

  it("says when the template is no longer available", () => {
    expect(describeCard(card({ ...base, template_id: 99 }), SOURCES, null).source).toBe("Template not available");
    expect(describeCard(card({ ...base, template_version_ids: [555] }), SOURCES, null).source).toBe("Template not available");
  });

  it("counts table rows for table grain and names the table", () => {
    const d = describeCard(card({ ...base, grain: "table", table_key: "lines", unit: { mode: "field", path: "lines.cur" } }), SOURCES, result());
    expect(d.grain).toBe("Row of table lines");
    expect(d.unit).toBe("From the unit field of each record");
    expect(d.counted).toBe("8 documents, 20 rows");
  });

  it("has no unit for a count without one, and none otherwise", () => {
    expect(describeCard(card({ ...base, measure: { agg: "count" } }), SOURCES, null).unit).toBeNull();
    expect(describeCard(card(base), SOURCES, null).unit).toBe("None");
  });

  it("reports no counts for an error or a missing result", () => {
    expect(describeCard(card(base), SOURCES, result({ status: "error", error_code: "query_timeout" })).counted).toBeNull();
    expect(describeCard(card(base), SOURCES, null)).toMatchObject({ counted: null, excluded: [], excludedTotal: 0 });
  });
});

describe("ReportCardInfo", () => {
  it("shows two compact lines, the exclusion count as a warning, and the actions", () => {
    const { container } = render(
      <ReportCardInfo card={card(base)} sources={SOURCES} result={result()} actions={<button type="button">CSV</button>} />,
    );
    expect(screen.getByText("Invoice · v1, v3 · Document · None")).toBeInTheDocument();
    const stats = screen.getByText("8 documents · 3 excluded");
    expect(stats).toHaveClass("sf-card-info__line--warn");
    expect(stats).toHaveAttribute("title", "8 documents · 3 excluded");
    expect(screen.getByRole("button", { name: "CSV" })).toBeInTheDocument();
    expect(container.querySelector("dl")).toBeNull();
  });

  it("omits the stats line before a result and has no warning without exclusions", () => {
    const { rerender } = render(<ReportCardInfo card={card(base)} sources={SOURCES} result={null} />);
    expect(screen.queryByText(/documents/)).toBeNull();
    rerender(<ReportCardInfo card={card(base)} sources={SOURCES} result={result({ diagnostics: { documents: 2, excluded: {} } })} />);
    expect(screen.getByText("2 documents")).not.toHaveClass("sf-card-info__line--warn");
  });

  it("expanded shows every reason with its count, in the given language", () => {
    render(
      <ReportCardInfo
        expanded
        card={card(base)}
        sources={SOURCES}
        result={result()}
        labels={{ excluded: "ไม่นับ", reasons: { invalid_number: "ตัวเลขไม่ถูกต้อง" } as never }}
      />,
    );
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["ตัวเลขไม่ถูกต้อง: 2", "No date: 1"]);
    expect(screen.getByText("ไม่นับ")).toBeInTheDocument();
  });

  it("details say None when nothing was excluded", () => {
    render(<ReportCardDetails card={card(base)} sources={SOURCES} result={result({ diagnostics: { documents: 1, excluded: {} } })} />);
    expect(screen.getByText("Excluded").nextElementSibling).toHaveTextContent("None");
  });
});
