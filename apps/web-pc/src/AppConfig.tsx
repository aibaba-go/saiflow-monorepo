import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import thTH from "antd/locale/th_TH";
import zhCN from "antd/locale/zh_CN";
import { loadChineseFont, pcTheme } from "@saiflow/ui";
import { useEffect, type ReactNode } from "react";

const LOCALES = { en: enUS, th: thTH, zh: zhCN };

/** antd with the STD-008 theme (ADR-010 §2) and the UI language's locale. */
export function AppConfig({ lang, children }: { lang: keyof typeof LOCALES; children: ReactNode }) {
  useEffect(() => {
    if (lang === "zh") void loadChineseFont();
  }, [lang]);
  return (
    <ConfigProvider locale={LOCALES[lang]} theme={pcTheme} button={{ autoInsertSpace: false }}>
      {children}
    </ConfigProvider>
  );
}
