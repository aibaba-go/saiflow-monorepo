import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ApiError } from "../../services/errors";
import { useSession } from "../../stores/session";
import { notificationKeys } from "../notifications/data";
import { resolveTenant, useTenantChoice } from "../tenants/useCurrentTenant";
import { pendingKey } from "./jobs";

/** The home page reads a manual refresh may repeat (FR-SYS-109). */
export type HomePart = "usage" | "pending" | "recent" | "unread" | "reviewSummary";
export type RefreshOutcome = "done" | "partial";

/** The recent-tasks query of the home page: the newest 10 jobs of a tenant. */
export const recentKey = (tenantId: number | undefined) => ["jobs", tenantId, "recent"];

export interface HomeRefreshScope {
  /** The current tenant, or null when there is none (then nothing is read). */
  tenantId: number | null;
  /** A signed-in user (not a guest): the own unread count is read too. */
  isUser: boolean;
  /** The "To review" entry is shown (FR-SYS-119): its summary is read too. */
  review: boolean;
}

/** The exact query keys one refresh reads: only the current tenant's, never another's. */
export function homeRefreshKeys(scope: HomeRefreshScope): [HomePart, QueryKey][] {
  const id = scope.tenantId;
  if (id === null) return [];
  const keys: [HomePart, QueryKey][] = [
    ["usage", ["usage", id]],
    ["pending", pendingKey(id)],
    ["recent", recentKey(id)],
  ];
  if (scope.isUser) keys.push(["unread", notificationKeys.unread]);
  if (scope.review) keys.push(["reviewSummary", ["reviewSummary", id]]);
  return keys;
}

/** Who the page acts for right now: the round's results apply only while this is unchanged. */
function identity(): string {
  const { me, tenants } = useSession.getState();
  const tenant = resolveTenant(me, tenants, useTenantChoice.getState().id);
  return `${me?.kind ?? "-"}:${me?.user_id ?? "-"}:${tenant?.tenant_id ?? "-"}`;
}

export interface HomeRefreshOptions extends HomeRefreshScope {
  /** A round finished for the same tenant and user; `fresh` lists the reads that succeeded. */
  onSettled?(fresh: ReadonlySet<HomePart>): void;
}

export interface HomeRefresh {
  refreshing: boolean;
  /** The last round's result for this page, or null (none yet, a new round, or a 401). */
  outcome: RefreshOutcome | null;
  refresh(): Promise<void>;
}

const DONE_VISIBLE_MS = 4000;

/** Manual home refresh (FR-SYS-109): re-reads only the current tenant's home queries, one
 * round at a time. Failed reads keep their old data; a 401 is left to the session-expiry
 * handling; a round that outlives its tenant or user is ignored. Never writes, never clears
 * the cache, never reloads the page or restarts LINE login. */
export function useHomeRefresh(options: HomeRefreshOptions): HomeRefresh {
  const client = useQueryClient();
  const running = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(options);
  const [refreshing, setRefreshing] = useState(false);
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);

  useLayoutEffect(() => {
    latest.current = options; // the scope as of the last render, read when a tap starts
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (outcome !== "done") return;
    const timer = setTimeout(() => setOutcome(null), DONE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const refresh = useCallback(async () => {
    if (running.current) return; // one round at a time
    const keys = homeRefreshKeys(latest.current);
    if (!keys.length) return; // no tenant: no tenant requests
    running.current = true;
    const who = identity();
    setRefreshing(true);
    setOutcome(null);
    try {
      const results = await Promise.allSettled(
        keys.map(async ([part, queryKey]) => {
          await client.refetchQueries({ queryKey, exact: true, type: "active" }, { throwOnError: true });
          return part;
        }),
      );
      if (!mounted.current || identity() !== who) return; // another tenant or user now
      const fresh = new Set<HomePart>();
      let unauthenticated = false;
      for (const result of results) {
        if (result.status === "fulfilled") fresh.add(result.value);
        else if (result.reason instanceof ApiError && result.reason.status === 401) unauthenticated = true;
      }
      latest.current.onSettled?.(fresh);
      // A 401 is handled by the session expiry flow; no refresh notice on top of it.
      setOutcome(unauthenticated ? null : fresh.size === keys.length ? "done" : "partial");
    } finally {
      running.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [client]);

  return { refreshing, outcome, refresh };
}
