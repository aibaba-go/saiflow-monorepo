import { describe, expect, it } from "vitest";

import { en } from "./en";
import { th } from "./th";
import { zh } from "./zh";
import { translate } from "./index";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("i18n resources (AC-FR-SYS-004-03)", () => {
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
});
