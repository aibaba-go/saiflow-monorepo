import { createApiClient, getBackendHealth, type BackendHealth } from "@saiflow/api-client";

import { apiBaseUrl } from "../config";

const client = createApiClient({ baseUrl: apiBaseUrl });

export function fetchBackendHealth(): Promise<BackendHealth> {
  return getBackendHealth(client);
}
