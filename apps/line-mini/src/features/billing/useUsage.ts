import { useQuery } from "@tanstack/react-query";

import { api, call } from "../../services/api";
import { useCurrentTenant } from "../tenants/useCurrentTenant";

/** The current tenant's usage (FR-SYS-033); the tenant header comes from the api layer. */
export function useUsage() {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["usage", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/billing/usage")),
    enabled: tenant !== null,
  });
}
