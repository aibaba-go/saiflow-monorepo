import type { components } from "@saiflow/api-client";
import type { QueryResult, ReportConfig } from "@saiflow/ui";
import { useQuery } from "@tanstack/react-query";

import { apiBaseUrl } from "../../config";
import { api, call } from "../../services/api";
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
export const getReport = (id: number) => call(api.GET("/api/v1/reports/{report_id}", rid(id)));
export const reportData = (id: number, period: Period | null, refresh: boolean) =>
  call(api.POST("/api/v1/reports/{report_id}/data", { ...rid(id), body: { period, refresh } })) as Promise<QueryResult>;

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

/** Whether this browser can hand a file to the system share sheet (FR-SYS-144). */
export function canShareFiles(): boolean {
  try {
    const probe = new File(["x"], "probe.csv", { type: "text/csv" });
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** How an export went: opened in the phone browser, saved directly, or prepared for the
 * share sheet (the caller shares it from a tap, which the browser requires). */
export type CsvOutcome = { how: "external" } | { how: "saved" } | { how: "share"; file: File };

/** One card's aggregated rows as CSV (view + export; FR-REPORT-016) for the page period on
 * screen. Inside LINE the file is fetched with the session and prepared for the system
 * share sheet when the browser supports it (FR-SYS-144); otherwise, or when `external` is
 * asked for, a 60-second ticket stands in for the session in the system browser (as
 * FR-ENTRY-015). Elsewhere the file is fetched with the tenant header and saved through an
 * object URL. */
export async function downloadCsv(
  liff: Liff,
  id: number,
  cardId: string,
  period: Period | null,
  reportVersion: number,
  signal?: AbortSignal,
  external = false,
): Promise<CsvOutcome> {
  const name = `report-${id}-${cardId}.csv`;
  if (liff.isInClient() && (external || !canShareFiles())) {
    const ticket = await call(
      api.POST("/api/v1/reports/{report_id}/csv/ticket", { ...rid(id), signal, body: { card_id: cardId, period, report_version: reportVersion } }),
    );
    signal?.throwIfAborted();
    liff.openWindow({ url: new URL(ticket.url, apiBaseUrl || window.location.origin).href, external: true });
    return { how: "external" };
  }
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
  if (liff.isInClient()) {
    const bytes = await blob.arrayBuffer();
    signal?.throwIfAborted();
    return { how: "share", file: new File([bytes], name, { type: "text/csv" }) };
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
