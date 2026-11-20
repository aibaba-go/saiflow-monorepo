import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadChineseFont } from "./fonts";

const base = readFileSync(new URL("./styles/fonts.css", import.meta.url), "utf8");
const sc = readFileSync(new URL("./styles/fonts-sc.css", import.meta.url), "utf8");

describe("fonts (FR-SYS-132)", () => {
  it("the always-loaded fonts are Latin and Thai only", () => {
    expect(base).toMatch(/ibm-plex-sans\//);
    expect(base).toMatch(/ibm-plex-sans-thai\//);
    expect(base).not.toMatch(/noto-sans-sc/);
    expect(sc).toMatch(/noto-sans-sc\/400/);
  });

  it("the Chinese font loads once", async () => {
    const a = loadChineseFont();
    const b = loadChineseFont();
    expect(a).toBe(b);
    await expect(a).resolves.toBeUndefined();
  });
});
