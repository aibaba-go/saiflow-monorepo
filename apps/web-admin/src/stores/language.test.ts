import { beforeEach, describe, expect, it } from "vitest";

import { createLanguageStore } from "./language";

describe("admin language (AC-FR-SYS-062-01)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to Chinese and remembers English", () => {
    expect(createLanguageStore().getState().lang).toBe("zh");
    createLanguageStore().getState().setLang("en");
    expect(localStorage.getItem("saiflow.admin.lang")).toBe("en");
    expect(createLanguageStore().getState().lang).toBe("en");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("saiflow.admin.lang", "th");
    expect(createLanguageStore().getState().lang).toBe("zh");
  });
});
