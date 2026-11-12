import { apiBaseUrl } from "../config";
import { ApiError } from "./errors";
import type { Liff } from "./liffTypes";

/** The working 20261104 snapshot uses server attachments, not Web Share or blob
 * navigation inside LINE (FR-ENTRY-015, FR-SYS-107, FR-SYS-144). */
function androidLine(liff: Liff): boolean {
  try {
    if (!liff.isInClient()) return false;
    const os = liff.getOS?.();
    if (os) return os === "android";
  } catch { /* Older adapters fall back to the in-app browser's user agent. */ }
  return /Android/i.test(navigator.userAgent) && /\bLine\//i.test(navigator.userAgent);
}

function clickAttachment(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  link.download = ""; // The server's Content-Disposition supplies the filename.
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  if (androidLine(liff)) {
    try {
      liff.openWindow({ url: url.href, external: true });
    } catch {
      // LINE supports this parameter when its SDK cannot open the external browser.
      url.searchParams.set("openExternalBrowser", "1");
      clickAttachment(url.href);
    }
    return "external";
  }
  clickAttachment(url.href);
  return "saved";
}
