import { useCallback } from "react";

import { useLanguage, type Lang } from "../stores/language";
import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type { MessageKey } from "./zh";
export type Vars = Record<string, string | number>;
export type T = (key: MessageKey, vars?: Vars) => string;

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { zh, en };

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const text = DICTIONARIES[lang][key] ?? zh[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function isMessageKey(key: string): key is MessageKey {
  return key in zh;
}

/** t() for the current language; components re-render when the language changes. */
export function useT(): T {
  const lang = useLanguage((s) => s.lang);
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
}
