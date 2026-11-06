import { beforeEach, describe, expect, it } from "vitest";

import { createLanguageStore } from "./language";

describe("web-pc language (AC-FR-SYS-093-01, 093-02)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to English", () => {
    expect(createLanguageStore().getState().lang).toBe("en");
  });

  it("remembers Thai on this device", () => {
    createLanguageStore().getState().setLang("th");
    expect(localStorage.getItem("saiflow.pc.lang")).toBe("th");
    expect(createLanguageStore().getState().lang).toBe("th");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("saiflow.pc.lang", "fr");
    expect(createLanguageStore().getState().lang).toBe("en");
  });
});
