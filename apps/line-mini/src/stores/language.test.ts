import { beforeEach, describe, expect, it } from "vitest";

import { createLanguageStore } from "./language";

describe("language store (AC-FR-SYS-004-01/02)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to English", () => {
    expect(createLanguageStore().getState().lang).toBe("en");
  });

  it("persists the choice", () => {
    createLanguageStore().getState().setLang("zh");
    expect(localStorage.getItem("saiflow.lang")).toBe("zh");
    expect(createLanguageStore().getState().lang).toBe("zh");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("saiflow.lang", "fr");
    expect(createLanguageStore().getState().lang).toBe("en");
  });
});
