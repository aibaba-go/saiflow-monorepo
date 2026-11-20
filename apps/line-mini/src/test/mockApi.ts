import { vi } from "vitest";

type Handler = (request: Request) => Response | Promise<Response>;

export interface MockApi {
  calls: Request[];
  /** Bodies of the calls to this "METHOD /path", parsed as JSON. */
  bodies(route: string): Promise<unknown[]>;
  count(route: string): number;
  set(route: string, handler: Handler): void;
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const key = (r: Request) => `${r.method} ${new URL(r.url).pathname}`;

/** Stub global fetch with handlers keyed "METHOD /path"; unknown routes answer 404. */
export function mockApi(routes: Record<string, Handler>): MockApi {
  const table = new Map(Object.entries(routes));
  const calls: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push(request.clone());
    const handler = table.get(key(request));
    if (!handler) return json(404, { code: "not_found", message_key: "error.not_found" });
    return handler(request);
  });
  return {
    calls,
    count: (route) => calls.filter((c) => key(c) === route).length,
    async bodies(route) {
      const matching = calls.filter((c) => key(c) === route);
      return Promise.all(matching.map(async (c) => JSON.parse((await c.clone().text()) || "null")));
    },
    set: (route, handler) => table.set(route, handler),
  };
}
