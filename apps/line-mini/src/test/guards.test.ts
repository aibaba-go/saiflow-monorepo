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
});
