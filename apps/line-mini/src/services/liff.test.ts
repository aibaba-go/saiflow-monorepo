import liff from "@line/liff";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realLiff } from "./liff";

vi.mock("@line/liff", () => ({
  default: { isInClient: vi.fn(), logout: vi.fn(), login: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("LINE token retry (AC-FR-SYS-041-03)", () => {
  it("clears native SDK authorization and re-enters through the official LIFF URL, not a cached reload", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    vi.mocked(liff.isInClient).mockReturnValue(true);
    const target = realLiff("2012285578-test");
    target.reauthorize!("https://app.example/#/scan/jobs/j1/result");
    expect(liff.logout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("https://liff.line.me/2012285578-test");
    expect(liff.login).not.toHaveBeenCalled();
    expect(vi.mocked(liff.isInClient).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(liff.logout).mock.invocationCallOrder[0]!);
    expect(vi.mocked(liff.logout).mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]!);
  });

  it("clears external-browser SDK authorization before starting a fresh OAuth login", () => {
    vi.mocked(liff.isInClient).mockReturnValue(false);
    const target = realLiff("2012285578-test");
    const redirectUri = "https://app.example/#/scan/jobs/j1/result";
    target.reauthorize!(redirectUri);
    expect(liff.logout).toHaveBeenCalledTimes(1);
    expect(liff.login).toHaveBeenCalledWith({ redirectUri });
    expect(vi.mocked(liff.logout).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(liff.login).mock.invocationCallOrder[0]!);
  });
});
