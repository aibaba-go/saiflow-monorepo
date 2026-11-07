import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { adminTheme } from "@saiflow/ui";
import type { ReactNode } from "react";

/** antd with the STD-008 colours, radius and font (STD-008 §11.3, ADR-010 §3). */
export function AppConfig({ lang, children }: { lang: "en" | "zh"; children: ReactNode }) {
  return (
    <ConfigProvider locale={lang === "zh" ? zhCN : enUS} theme={adminTheme} button={{ autoInsertSpace: false }}>
      {children}
    </ConfigProvider>
  );
}
