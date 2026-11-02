import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./generated/schema";

export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** Defaults to "" (same origin: Caddy routes /api to the backend). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return createClient<paths>({ baseUrl: options.baseUrl ?? "", fetch: options.fetch });
}
