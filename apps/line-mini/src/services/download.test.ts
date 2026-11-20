import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiBaseUrl } from "../config";
import { fakeLiff } from "../test/fakeLiff";
import { deliverDownload } from "./download";

const PREFIX = "/api/v1/export-downloads/";
const LINK = `${PREFIX}synthetic.signature`;
let links: { href: string; download: string | null; rel: string }[];

beforeEach(() => {
  links = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    // null = no download attribute (a navigation LINE can hand to the phone browser).
    links.push({ href: this.href, download: this.hasAttribute("download") ? this.download : null, rel: this.rel });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("server attachment delivery (FR-ENTRY-015, FR-SYS-107, FR-SYS-144)", () => {
  it("iOS LINE clicks the real server URL without Web Share or blob URLs", () => {
    const liff = fakeLiff({ inClient: true, os: "ios" });
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("saved");
    expect(links).toEqual([{ href: `${apiBaseUrl || window.location.origin}${LINK}`, download: "", rel: "noopener noreferrer" }]);
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(document.querySelector("a")).toBeNull();
  });

  it("Android LINE opens the short-lived server link in the phone browser", () => {
    const liff = fakeLiff({ inClient: true, os: "android" });
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
    expect(liff.openWindow).toHaveBeenCalledWith({ url: `${apiBaseUrl || window.location.origin}${LINK}`, external: true });
    expect(links).toHaveLength(0);
  });

  it("falls back to Android LINE's openExternalBrowser parameter if the SDK throws", () => {
    const liff = fakeLiff({ inClient: true, os: "android" });
    liff.openWindow.mockImplementation(() => { throw new Error("SDK unavailable"); });
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
    expect(new URL(links[0]!.href).searchParams.get("openExternalBrowser")).toBe("1");
    // A download attribute makes LINE's in-app browser refuse the file instead of handing off.
    expect(links[0]!.download).toBeNull();
    expect(document.querySelector("a")).toBeNull();
  });

  it("Android LINE reporting isInClient()=false hands off to the phone browser, never an in-app download", () => {
    const liff = fakeLiff({ inClient: false, os: "android" });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Line/15.0.0");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(links).toHaveLength(1);
    const url = new URL(links[0]!.href);
    expect(`${url.origin}${url.pathname}`).toBe(`${apiBaseUrl || window.location.origin}${LINK}`);
    expect(url.searchParams.get("openExternalBrowser")).toBe("1");
    expect(links[0]!.download).toBeNull();
    expect(links[0]!.rel).toBe("noopener noreferrer");
  });

  it("Android LINE with an unreadable client state still leaves the in-app browser", () => {
    const liff = fakeLiff({ os: "android" });
    liff.isInClient = () => { throw new Error("not initialised"); };
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Android 14 Line/14.0");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
    expect(liff.openWindow).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(0);
  });

  it("uses LINE+Android user agent only when the OS adapter is missing", () => {
    const liff = fakeLiff({ inClient: true });
    Reflect.deleteProperty(liff, "getOS");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Android 14 Line/14.0");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
    expect(liff.openWindow).toHaveBeenCalledTimes(1);
  });

  it.each(["undefined", "throws"])("falls back to the UA when getOS is %s", (mode) => {
    const liff = fakeLiff({ inClient: true });
    liff.getOS = () => { if (mode === "throws") throw new Error("OS unavailable"); return undefined; };
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Android 14 Line/14.0");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("external");
  });

  it("a normal Android browser (no LINE UA) keeps the direct attachment", () => {
    const liff = fakeLiff({ inClient: false, os: "android" });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("saved");
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(links).toEqual([{ href: `${apiBaseUrl || window.location.origin}${LINK}`, download: "", rel: "noopener noreferrer" }]);
  });

  it("iPhone LINE reporting isInClient()=false keeps the real attachment link", () => {
    const liff = fakeLiff({ inClient: false, os: "ios" });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Line/15.0.0");
    expect(deliverDownload(liff, LINK, PREFIX)).toBe("saved");
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(new URL(links[0]!.href).search).toBe("");
  });

  it.each([
    "https://untrusted.example/api/v1/export-downloads/synthetic.signature",
    "javascript:alert(1)",
    "/api/v1/report-downloads/synthetic.signature",
    "/api/v1/export-downloads/../login",
    "/api/v1/export-downloads/synthetic.signature?redirect=evil",
    "/api/v1/export-downloads/synthetic.signature#fragment",
  ])("rejects unexpected download URLs without handing them to LINE: %s", (url) => {
    const liff = fakeLiff({ inClient: true, os: "android" });
    expect(() => deliverDownload(liff, url, PREFIX)).toThrow();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
  });
});
