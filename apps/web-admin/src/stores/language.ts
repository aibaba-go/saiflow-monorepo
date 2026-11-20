import { create } from "zustand";

/** Console language (FR-SYS-062): Chinese by default, the choice kept in this browser. */
export type Lang = "zh" | "en";
export const LANGS: Lang[] = ["zh", "en"];
const KEY = "saiflow.admin.lang";

interface LanguageState {
  lang: Lang;
  setLang(lang: Lang): void;
}

function stored(): Lang {
  try {
    const value = localStorage.getItem(KEY);
    return LANGS.includes(value as Lang) ? (value as Lang) : "zh";
  } catch {
    return "zh";
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
