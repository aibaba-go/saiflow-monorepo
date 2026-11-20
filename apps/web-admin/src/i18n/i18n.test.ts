import { describe, expect, it } from "vitest";

import { en } from "./en";
import { zh } from "./zh";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("i18n resources (AC-FR-SYS-062-02)", () => {
  it("en has exactly the keys of zh", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
  it("no translation is empty and placeholders match", () => {
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(zh[key].trim(), key).not.toBe("");
      expect(en[key].trim(), key).not.toBe("");
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
    }
  });
});
