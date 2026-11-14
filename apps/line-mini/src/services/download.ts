import { apiBaseUrl } from "../config";
import { ApiError } from "./errors";
import type { Liff } from "./liffTypes";

/** The working 20261104 snapshot uses server attachments, not Web Share or blob
 * navigation inside LINE (FR-ENTRY-015, FR-SYS-107, FR-SYS-144).
 * "client": the LIFF browser, which can open the phone browser through the SDK.
 * "browser": Android LINE whose isInClient() reports false (seen on real phones). A
 * download there shows "LINE's in-app browser doesn't support downloading files", so
 * it must also be handed to the phone browser. null: not Android LINE. */
function androidLine(liff: Liff): "client" | "browser" | null {
  const ua = navigator.userAgent;
  const androidLineUa = /Android/i.test(ua) && /\bLine\//i.test(ua);
  let inClient: boolean;
  try {
    inClient = liff.isInClient();
  } catch {
    return androidLineUa ? "client" : null; // Unknown state: the SDK fallback still applies.
  }
  if (!inClient) return androidLineUa ? "browser" : null;
  try {
    const os = liff.getOS?.();
    if (os) return os === "android" ? "client" : null;
  } catch { /* Older adapters fall back to the in-app browser's user agent. */ }
  return androidLineUa ? "client" : null;
}

function clickLink(url: string, attachment: boolean): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  // The server's Content-Disposition supplies the filename. A hand-off to the phone
  // browser is a plain navigation: LINE refuses download-attribute links in-app.
  if (attachment) link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** LINE's documented URL parameter: open this link in the phone's default browser. */
function openExternalBrowser(url: URL): void {
  url.searchParams.set("openExternalBrowser", "1");
  clickLink(url.href, false);
}

/** A fresh, authenticated ticket is a real HTTP attachment URL. It carries the
 * selected tenant/session without relying on headers from a phone downloader.
 * Never accept an unrelated origin, route, credentials or redirect parameters. */
export function deliverDownload(liff: Liff, rawUrl: string, prefix: string): "saved" | "external" {
  const base = new URL(apiBaseUrl || window.location.origin, window.location.origin);
  const url = new URL(rawUrl, base);
  const token = url.pathname.slice(prefix.length);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(token)) {
    throw new ApiError(0, "network", []);
  }
  const android = androidLine(liff);
  if (android === "browser") {
    openExternalBrowser(url);
    return "external";
  }
  if (android === "client") {
    try {
      liff.openWindow({ url: url.href, external: true });
    } catch {
      // LINE supports this parameter when its SDK cannot open the external browser.
      openExternalBrowser(url);
    }
    return "external";
  }
  clickLink(url.href, true);
  return "saved";
}
