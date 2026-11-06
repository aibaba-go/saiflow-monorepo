import { Space, Typography } from "antd";
import type { ReactNode } from "react";

/** A page heading and its content. */
export function Page({ name, title, extra, children }: { name: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid={`page-${name}`}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </Space>
      {children}
    </div>
  );
}
