import { create } from "zustand";

/** UI language (FR-SYS-004): English by default (D4), the choice kept on this device only. */
export type Lang = "en" | "th" | "zh";
export const LANGS: Lang[] = ["en", "th", "zh"];
const KEY = "saiflow.lang";

interface LanguageState {
  lang: Lang;
  setLang(lang: Lang): void;
}

function stored(): Lang {
  try {
    const value = localStorage.getItem(KEY);
    return LANGS.includes(value as Lang) ? (value as Lang) : "en";
  } catch {
    return "en";
  }
}

export function createLanguageStore() {
  return create<LanguageState>((set) => ({
    lang: stored(),
    setLang(lang) {
      try {
        localStorage.setItem(KEY, lang);
      } catch {
        // storage blocked: the choice lasts for this visit only
      }
      set({ lang });
    },
  }));
}

export const useLanguage = createLanguageStore();
