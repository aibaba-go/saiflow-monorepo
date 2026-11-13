import { describe, expect, it } from "vitest";

import { en } from "./en";
import { th } from "./th";
import { zh } from "./zh";
import { translate } from "./index";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("i18n resources (AC-FR-SYS-093-03)", () => {
  it("th and zh have exactly the keys of en", () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("no translation is empty", () => {
    for (const dict of [en, th, zh]) {
      for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe("");
    }
  });

  it("placeholders match across languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(th[key]), key).toEqual(placeholders(en[key]));
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("substitutes variables", () => {
    expect(translate("en", "common.secondsLeft", { n: 42 })).toBe(en["common.secondsLeft"].replace("{n}", "42"));
  });

  it("has localized report loading, Bangkok publication and read-only guidance (FR-SYS-161/163/164)", () => {
    for (const dict of [en, th, zh] as Record<string, string>[]) {
      for (const key of ["rpt.listLoadFailed", "rpt.readOnlyNote", "rpt.publishedAt", "rpc.loading", "rpt.staleTitle", "rpt.staleBody"]) {
        expect(dict[key], key).toBeTruthy();
      }
    }
    expect(en["rpt.publishedAt"]).toContain("Bangkok");
    expect(th["rpt.publishedAt"]).toContain("กรุงเทพฯ");
    expect(zh["rpt.publishedAt"]).toContain("曼谷");
    expect(th["eyebrow.reportView"]).not.toBe(en["eyebrow.reportView"]);
    expect(zh["eyebrow.reportView"]).not.toBe(en["eyebrow.reportView"]);
  });
});
