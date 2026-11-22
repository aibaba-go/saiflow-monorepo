import type { components } from "@saiflow/api-client";
import type { QueryResult, ReportConfig } from "@saiflow/ui";
import { useQuery } from "@tanstack/react-query";

import { api, call } from "../../services/api";
import { deliverDownload } from "../../services/download";
import { serverAttachmentBranch } from "../../services/liffDiagnostics";
import type { Liff } from "../../services/liffTypes";
import { useCurrentTenant } from "../tenants/useCurrentTenant";

/** The LINE report tab's calls (FR-SYS-056, FR-REPORT-002, -010, -015, -016, -018), typed
 * from the generated client. Read only: LINE never designs, saves or publishes. Every query
 * is keyed by the current tenant, so a switch never shows the other account's reports. */
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportDetail = components["schemas"]["ReportDetail"];
export type Published = NonNullable<ReportDetail["published"]>;
export interface Period {
  from: string;
  to: string;
}

const rid = (id: number) => ({ params: { path: { report_id: id } } });

export const listReports = () => call(api.GET("/api/v1/reports"));
export const readReportAsset = (assetId: string, reportId: number, signal: AbortSignal) => call(api.GET("/api/v1/reports/assets/{asset_id}", {
  signal, params: { path: { asset_id: assetId }, query: { report_id: reportId } }, parseAs: "blob",
})) as Promise<Blob>;

export function useReportContentPolicy(wanted: boolean) {
  const { tenant } = useCurrentTenant();
  return useQuery({ queryKey: ["report-content-policy", tenant?.tenant_id], queryFn: () => call(api.GET("/api/v1/reports/content-policy")), enabled: wanted && !!tenant });
}

export const getReport = (id: number) => call(api.GET("/api/v1/reports/{report_id}", rid(id)));
export const reportData = (id: number, period: Period | null, refresh: boolean, pages?: Record<string, number>) =>
  call(api.POST("/api/v1/reports/{report_id}/data", { ...rid(id), body: { period, refresh, ...(pages && Object.keys(pages).length ? { pages } : {}) } })) as Promise<QueryResult>;

/** Only published reports belong in LINE: a manager's list also has drafts. */
export function useReports() {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["reports", tenant?.tenant_id],
    queryFn: async () => (await listReports()).items.filter((r) => r.published_version !== null),
    enabled: tenant !== null,
  });
}

export function useReport(id: number) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["report", tenant?.tenant_id, id],
    queryFn: () => getReport(id),
    enabled: tenant !== null && Number.isInteger(id) && id > 0,
    retry: false,
  });
}

/** The page configuration of a stored snapshot (always a v1 page with a card list). */
export function configOf(raw: Record<string, unknown> | null | undefined): ReportConfig {
  const cards = raw && Array.isArray(raw.cards) ? raw.cards : [];
  return { ...(raw ?? {}), version: 1, cards } as ReportConfig;
}

/** How an export went: saved directly outside LINE, or downloaded via a server ticket
 * inside LINE with the authenticated file retained for preview and copy (FR-SYS-144,
 * FR-REPORT-016). `text` is the CSV without its BOM, for the preview and clipboard. */
export type CsvOutcome = { how: "saved" } | { how: "prepared"; file: File; text: string };

/** The CSV as rows of cells (RFC 4180 quoting), for the in-LINE preview (FR-SYS-144). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Put text on the clipboard from a tap: the older copy command on a hidden text box, else
 * the Clipboard API (FR-SYS-144). `host` should be inside the open
 * sheet, whose focus trap would otherwise pull focus away from a box on the page body. */
export async function copyText(text: string, host: HTMLElement = document.body): Promise<boolean> {
  const legacy = () => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.setAttribute("aria-hidden", "true");
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.left = "0";
    box.style.opacity = "0";
    host.appendChild(box);
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, text.length);
    let ok: boolean;
    try {
      ok = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      ok = false;
    }
    box.remove();
    back?.focus({ preventScroll: true });
    return ok;
  };
  // The copy command runs first, synchronously inside the tap; the Clipboard API is then still
  // called within the same user activation (iOS refuses either one after an await).
  if (legacy()) return true;
  if (typeof navigator.clipboard?.writeText !== "function") return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** One card's aggregated rows as CSV (view + export; FR-REPORT-016) for the page period on
 * screen. Inside LINE (LIFF client or LINE browser UA) validate the authenticated CSV first, then request a fresh ticket
 * for server-link delivery and retain the bytes for preview/copy (FR-SYS-144). Elsewhere
 * save the authenticated blob through an object URL without requesting a ticket. */
export async function downloadCsv(
  liff: Liff,
  id: number,
  cardId: string,
  period: Period | null,
  reportVersion: number,
  signal?: AbortSignal,
): Promise<CsvOutcome> {
  const name = `report-${id}-${cardId}.csv`;
  const blob = (await call(
    api.GET("/api/v1/reports/{report_id}/csv", {
      signal,
      params: {
        path: { report_id: id },
        query: { card_id: cardId, report_version: reportVersion, ...(period ? { from: period.from, to: period.to } : {}) },
      },
      parseAs: "blob",
    }),
  )) as unknown as Blob;
  signal?.throwIfAborted(); // even a transport that ignores abort cannot deliver an old account's file
  if (serverAttachmentBranch(liff, "csv")) {
    const bytes = await blob.arrayBuffer();
    signal?.throwIfAborted();
    // TextDecoder drops the byte-order mark the server adds for Excel; the file keeps it.
    const text = new TextDecoder("utf-8").decode(bytes);
    const ticket = await call(api.POST("/api/v1/reports/{report_id}/csv/ticket", {
      ...rid(id),
      signal,
      body: { card_id: cardId, period, report_version: reportVersion },
    }));
    signal?.throwIfAborted(); // a late ticket must not download after a tenant/version change
    deliverDownload(liff, ticket.url, "/api/v1/report-downloads/");
    return { how: "prepared", file: new File([bytes], name, { type: "text/csv" }), text };
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { how: "saved" };
}
