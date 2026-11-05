import { Typography } from "antd";
import type { ReactNode } from "react";

/** A console page: its title as the page heading, then the content. */
export function Page({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </div>
      {children}
    </section>
  );
}
