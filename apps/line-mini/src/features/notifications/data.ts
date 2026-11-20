import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, call } from "../../services/api";
import { useSession } from "../../stores/session";

export const PAGE_SIZE = 20;
export const notificationKeys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: ["notifications", "list"] as const,
};

const signedIn = () => useSession.getState().me?.kind === "user";

/** The unread count (FR-SYS-054); guests have no notifications and make no request. */
export function useUnreadCount() {
  const isUser = useSession((s) => s.me?.kind === "user");
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () =>
      (await call(api.GET("/api/v1/me/notifications", { params: { query: { limit: "1" } } })))
        .unread_count,
    enabled: isUser,
  });
}

export function useNotificationPages() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) =>
      call(
        api.GET("/api/v1/me/notifications", {
          params: {
            query: { limit: String(PAGE_SIZE), ...(pageParam ? { before: String(pageParam) } : {}) },
          },
        }),
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: signedIn(),
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
