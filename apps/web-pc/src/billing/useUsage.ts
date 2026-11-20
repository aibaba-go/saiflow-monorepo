import { useQuery } from "@tanstack/react-query";

import { api, call } from "../services/api";
import { useTenant } from "../tenants/useTenant";

/** The current tenant's usage; the tenant header comes from the api layer. `wanted` false
 * skips the request (a caller that only needs it in some tenants). */
export function useUsage(wanted = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["usage", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/billing/usage")),
    enabled: tenant !== null && wanted,
  });
}
