import { useQuery } from "@tanstack/react-query";
import { Result, Typography } from "antd";

import type { BackendHealth } from "@saiflow/api-client";

import { fetchBackendHealth } from "../services/health";

function label(health: BackendHealth | undefined, failed: boolean): string {
  if (failed) return "Backend: UNREACHABLE";
  if (!health) return "Backend: checking…";
  if (health.state === "ok") return `Backend: OK (${health.version})`;
  if (health.state === "degraded") return `Backend: DEGRADED (${health.version})`;
  return "Backend: UNREACHABLE";
}

const STATUS = { ok: "success", degraded: "warning", unreachable: "error" } as const;

export function HealthPage() {
  const { data, isError } = useQuery({ queryKey: ["backend-health"], queryFn: fetchBackendHealth });
  const status = isError ? "error" : data ? STATUS[data.state] : "info";
  return (
    <Result
      status={status}
      title={<Typography.Title level={2}>{"SaiFlow"}</Typography.Title>}
      subTitle={<Typography.Text>{label(data, isError)}</Typography.Text>}
    />
  );
}
