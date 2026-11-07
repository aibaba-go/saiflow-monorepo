import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Tests run from the app directory (vitest root); jsdom makes import.meta.url an http URL.
const SRC = resolve(process.cwd(), "src");

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}

describe("ADR-010 guards", () => {
  it("no antd-mobile anywhere", () => {
    const hits = files(SRC, /\.(ts|tsx)$/).filter(
      (f) => !f.endsWith("guards.test.ts") && /["']antd-mobile/.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
    expect(readFileSync(join(SRC, "../package.json"), "utf8")).not.toMatch(/antd-mobile/);
  });

  it("no hard-coded colours in styles or components (FR-SYS-132)", () => {
    const hex = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;
    const hits = files(SRC, /\.(css|tsx)$/).filter(
      (f) => !/\.test\.tsx$/.test(f) && hex.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("light only (FR-SYS-132-03)", () => {
    const all = files(SRC, /\.css$/)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(all).not.toMatch(/prefers-color-scheme/);
  });

  it("main's local colour names are gone (FR-SYS-137)", () => {
    const all = files(SRC, /\.(css|tsx)$/)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(all).not.toMatch(/--primary-light|--processing\b|--processing-bg/);
  });
});
