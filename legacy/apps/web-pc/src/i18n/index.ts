import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations, type UiLanguage } from './locales';

export const LANGUAGE_STORAGE_KEY = 'saiflow.web-pc.language';
export const DEFAULT_LANGUAGE: UiLanguage = 'th';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'th' || value === 'en' || value === 'zh';
}

/** 从 localStorage 恢复上次选择的语言（无记录时回落默认泰语）。 */
export function readStoredLanguage(): UiLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isUiLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

export function storeLanguage(language: UiLanguage): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

void i18n.use(initReactI18next).init({
  resources: {
    th: { translation: translations.th },
    en: { translation: translations.en },
    zh: { translation: translations.zh },
  },
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export default i18n;
