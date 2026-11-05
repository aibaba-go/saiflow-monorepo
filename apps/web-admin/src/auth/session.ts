import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";

export interface Admin {
  admin_id: number;
  username: string;
}

export const ADMIN_KEY = ["admin", "me"] as const;

/** The signed-in admin, or null when there is no session (FR-SYS-060). */
export function useAdmin() {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: async (): Promise<Admin | null> => {
      try {
        return await call(api.GET("/api/v1/admin/me"), { own401: true });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

/** Mark the session as gone: RequireAdmin then sends the admin to login. */
export function useForgetAdmin() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.clear();
    queryClient.setQueryData(ADMIN_KEY, null);
  }, [queryClient]);
}

/** Where to go after login: an in-app path only; anything else goes home (060-03). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}

export function loginPath(location: { pathname: string; search: string }): string {
  const here = location.pathname + location.search;
  return here === "/" || location.pathname === "/login"
    ? "/login"
    : `/login?next=${encodeURIComponent(here)}`;
}
