import { useQuery } from "@tanstack/react-query";

import type { BackendHealth } from "@saiflow/api-client";

import { fetchBackendHealth } from "../services/health";
import { EmptyState } from "../components/ui/empty-state";

function label(health: BackendHealth | undefined, failed: boolean): string {
  if (failed) return "Backend: UNREACHABLE";
  if (!health) return "Backend: checking…";
  if (health.state === "ok") return `Backend: OK (${health.version})`;
  if (health.state === "degraded") return `Backend: DEGRADED (${health.version})`;
  return "Backend: UNREACHABLE";
}

const STATUS = { ok: "success", degraded: "waiting", unreachable: "error" } as const;

export function HealthPage() {
  const { data, isError } = useQuery({ queryKey: ["backend-health"], queryFn: fetchBackendHealth });
  const status = isError ? "error" : data ? STATUS[data.state] : "waiting";
  return <EmptyState status={status} title={"SaiFlow LINE"} description={label(data, isError)} />;
}
