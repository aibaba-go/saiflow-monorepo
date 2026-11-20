// Ported from apps/line-mini/src/features/notifications/data.ts (web-pc-account plan: copied,
// not shared). web-pc has no guest, so every request is a user's.
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { api, call } from "../services/api";

export const PAGE_SIZE = 20;
export const notificationKeys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: ["notifications", "list"] as const,
};

export function useNotificationPages() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) =>
      call(
        api.GET("/api/v1/me/notifications", {
          params: { query: { limit: String(PAGE_SIZE), ...(pageParam ? { before: String(pageParam) } : {}) } },
        }),
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
}

/** Mark the given notifications read, or all of them when ids is undefined. */
export function useMarkRead(): (ids?: number[]) => Promise<void> {
  const client = useQueryClient();
  return async (ids) => {
    await call(api.POST("/api/v1/me/notifications/read", { body: ids ? { ids } : {} }));
    await client.invalidateQueries({ queryKey: notificationKeys.all });
  };
}
