import { describe, expect, it } from "vitest";

import { formatBangkokDate, formatBangkokDateTime, formatCount } from "./format";

describe("format (A7)", () => {
  it("shows dates in Bangkok time", () => {
    expect(formatBangkokDate("2026-01-31T18:00:00Z")).toBe("2026-02-01");
    expect(formatBangkokDateTime("2026-12-10T03:00:00+00:00")).toBe("2026-12-10 10:00");
  });
  it("groups thousands", () => {
    expect(formatCount(4880)).toBe("4,880");
    expect(formatCount(100000)).toBe("100,000");
  });
});
