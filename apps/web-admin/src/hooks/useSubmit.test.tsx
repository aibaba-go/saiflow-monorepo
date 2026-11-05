import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSubmit } from "./useSubmit";

describe("useSubmit (AC-FR-SYS-055-01)", () => {
  it("ignores calls while one is pending", async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<string>((r) => (release = () => r("ok"))));
    const { result } = renderHook(() => useSubmit(fn));
    let first!: Promise<string | undefined>;
    act(() => {
      first = result.current.run();
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      expect(await result.current.run()).toBeUndefined();
    });
    await act(async () => {
      release();
      expect(await first).toBe("ok");
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("re-throws errors and clears pending", async () => {
    const { result } = renderHook(() => useSubmit(() => Promise.reject(new Error("no"))));
    await act(async () => {
      await expect(result.current.run()).rejects.toThrow("no");
    });
    expect(result.current.pending).toBe(false);
  });
});
