import { createApiClient } from "@saiflow/api-client";

import { apiBaseUrl } from "../config";
import type { Liff } from "./liffTypes";

/** Diagnostic observations only (FR-SYS-040/107, FR-REPORT-016, FR-PLAT-002/003).
 * No tokens, cookies, raw URLs/query strings, document identifiers/content, or raw UA.
 * A trace is random for this page load; it is not persisted or an account identifier. */
type InitState = "not_started" | "ready" | "failed" | "timeout";
interface Context {
  trace: string;
  liffId: string;
  adapter: "real" | "dev";
  init: InitState;
  started: number;
  events: number;
}
const contexts = new WeakMap<Liff, Context>();
let pageTrace: string | undefined;
const HEADER = "X-SaiFlow-Liff";
const transport = createApiClient({
  baseUrl: apiBaseUrl,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
});
transport.use({
  onRequest({ request }) {
    // Never forward session cookies or permit a diagnostic redirect to another origin.
    return new Request(request, { credentials: "omit", keepalive: true, cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
  },
});

export function registerLiffDiagnostics(target: Liff, publicLiffId: string, adapter: "real" | "dev"): void {
  try {
    pageTrace ??= crypto.randomUUID().replaceAll("-", "");
    contexts.set(target, {
      trace: pageTrace,
      liffId: /^[0-9]{6,20}-[A-Za-z0-9]{1,32}$/.test(publicLiffId) ? publicLiffId : "unconfigured",
      adapter, init: "not_started", started: Date.now(), events: 0,
    });
  } catch { /* Diagnostics unavailable: the application still works normally. */ }
}

function safely<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function pageKind(): "home" | "final" | "report" | "other" {
  // The deployed app uses HashRouter. Reduce the route to a fixed category only;
  // neither hash/query text nor identifiers are retained in the observation.
  const path = (window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1) : window.location.pathname).split("?")[0];
  if (path === "/") return "home";
  if (/^\/scan\/jobs\/[^/]+\/final\/?$/.test(path ?? "")) return "final";
  if (/^\/report\/[^/]+\/?$/.test(path ?? "")) return "report";
  return "other";
}

function observe(target: Liff, event: "init" | "xlsx_branch" | "csv_branch", inClient: boolean | null): void {
  try {
    const context = contexts.get(target);
    if (!context || context.events >= 24) return;
    context.events++;
    const os = safely(() => target.getOS?.());
    const ua = navigator.userAgent;
    const uaOs = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      ? "ios" : /Android/i.test(ua) ? "android" : "other";
    const value = {
      v: 1, trace: context.trace, event, init: context.init,
      in_client: inClient, logged_in: safely(() => target.isLoggedIn()),
      os: os === null ? "error" : ["ios", "android", "web"].includes(os ?? "") ? os : "unknown",
      ua_line: /\bLine\//i.test(ua), ua_os: uaOs, page: pageKind(),
      loopback: ["localhost", "127.0.0.1"].includes(window.location.hostname),
      api_same_origin: new URL(apiBaseUrl || window.location.origin, window.location.origin).origin === window.location.origin,
      liff_id: context.liffId, adapter: context.adapter,
      branch: event === "init" ? "none" : inClient === null ? "error" : inClient ? "ticket" : "blob",
      elapsed_ms: Math.max(0, Math.min(86_400_000, Math.round(Date.now() - context.started))),
    };
    // One fixed prefix is also useful if iOS Safari Web Inspector is connected.
    try { console.info("[SaiFlow LIFF]", value); } catch { /* Optional console. */ }
    const header = JSON.stringify(value);
    if (header.length > 1024) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    // Generated client, existing read-only route. Never await or call the global 401 handler.
    // keepalive allows an already-started observation to survive download navigation.
    void transport.GET("/api/v1/health", { headers: { [HEADER]: header }, signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch { /* A probe/transport failure must not change authentication or delivery. */ }
}

export function logLiffInit(target: Liff, state: Exclude<InitState, "not_started">): void {
  const context = contexts.get(target);
  if (!context) return;
  context.init = state;
  observe(target, "init", safely(() => target.isInClient()));
}

/** Capture the original decision once. SDK failure still throws the same error; no
 * UA override or new fallback is introduced by diagnostics. */
export function downloadInClient(target: Liff, format: "xlsx" | "csv"): boolean {
  let inClient: boolean;
  try {
    inClient = target.isInClient();
  } catch (error) {
    observe(target, `${format}_branch`, null);
    throw error;
  }
  observe(target, `${format}_branch`, inClient);
  return inClient;
}
