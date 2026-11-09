import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../services/errors";
import { useSession } from "../../stores/session";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { homeRefreshKeys, useHomeRefresh, type HomePart, type HomeRefreshScope } from "./useHomeRefresh";

type Fn = () => Promise<unknown>;

/** A read that waits until opened, once armed. */
function gated(value: string) {
  let gate: Promise<void> | null = null;
  let open = () => {};
  return {
    fn: () => (gate ? gate.then(() => value) : Promise.resolve(`${value}-first`)),
    arm() {
      gate = new Promise<void>((r) => (open = r));
    },
    open: () => open(),
  };
}

/** Observers for every home query of tenant 70 (enabled per scope), plus the refresh hook. */
function setup(scope: HomeRefreshScope, fns: Partial<Record<HomePart, Fn>> = {}) {
  const calls: Record<HomePart, number> = { usage: 0, pending: 0, recent: 0, unread: 0, reviewSummary: 0 };
  const fn = (part: HomePart) => () => {
    calls[part] += 1;
    return fns[part]?.() ?? Promise.resolve(`${part}-${calls[part]}`);
  };
  const keys = Object.fromEntries(homeRefreshKeys({ tenantId: 70, isUser: true, review: true })) as Record<HomePart, QueryKey>;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSettled = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const usage = useQuery({ queryKey: keys.usage, queryFn: fn("usage") });
      const pending = useQuery({ queryKey: keys.pending, queryFn: fn("pending") });
      const recent = useQuery({ queryKey: keys.recent, queryFn: fn("recent") });
      const unread = useQuery({ queryKey: keys.unread, queryFn: fn("unread"), enabled: scope.isUser });
      const review = useQuery({ queryKey: keys.reviewSummary, queryFn: fn("reviewSummary"), enabled: scope.review });
      const home = useHomeRefresh({ ...scope, onSettled });
      return { home, data: { usage: usage.data, pending: pending.data, recent: recent.data, unread: unread.data, review: review.data } };
    },
    { wrapper },
  );
  return { ...hook, calls, client, onSettled };
}

const loaded = (r: { current: { data: Record<string, unknown> } }) =>
  waitFor(() => expect(r.current.data.recent).toBeDefined());

beforeEach(() => {
  localStorage.clear();
  useTenantChoice.getState().choose(null);
  signedIn(USER, [PERSONAL, ORG]);
});

describe("useHomeRefresh (FR-SYS-109)", () => {
  it("reads exactly the current tenant's home keys for the scope (109-03, 109-07)", () => {
    expect(homeRefreshKeys({ tenantId: null, isUser: true, review: true })).toEqual([]);
    expect(homeRefreshKeys({ tenantId: 90, isUser: false, review: false })).toEqual([
      ["usage", ["usage", 90]],
      ["pending", ["files", "pending", 90]],
      ["recent", ["jobs", 90, "recent"]],
    ]);
    expect(homeRefreshKeys({ tenantId: 5, isUser: true, review: true })).toEqual([
      ["usage", ["usage", 5]],
      ["pending", ["files", "pending", 5]],
      ["recent", ["jobs", 5, "recent"]],
      ["unread", ["notifications", "unread"]],
      ["reviewSummary", ["reviewSummary", 5]],
    ]);
  });

  it("refetches every read once and reports done (109-03)", async () => {
    const { result, calls, onSettled } = setup({ tenantId: 70, isUser: true, review: true });
    await loaded(result);
    await act(() => result.current.home.refresh());
    expect(calls).toEqual({ usage: 2, pending: 2, recent: 2, unread: 2, reviewSummary: 2 });
    expect(result.current.data).toEqual({ usage: "usage-2", pending: "pending-2", recent: "recent-2", unread: "unread-2", review: "reviewSummary-2" });
    expect(result.current.home.outcome).toBe("done");
    expect(result.current.home.refreshing).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect([...(onSettled.mock.calls[0]?.[0] as Set<HomePart>)].sort()).toEqual(["pending", "recent", "reviewSummary", "unread", "usage"]);
  });

  it("one round at a time: repeat calls while running do nothing (109-04)", async () => {
    const slow = gated("late");
    const { result, calls } = setup({ tenantId: 70, isUser: false, review: false }, { pending: slow.fn });
    await loaded(result);
    slow.arm();
    let first!: Promise<void>;
    act(() => {
      first = result.current.home.refresh();
    });
    expect(result.current.home.refreshing).toBe(true);
    await act(async () => {
      await result.current.home.refresh();
      await result.current.home.refresh();
    });
    expect(calls).toMatchObject({ usage: 2, pending: 2, recent: 2 });
    expect(result.current.home.refreshing).toBe(true);
    await act(async () => {
      slow.open();
      await first;
    });
    expect(result.current.home.refreshing).toBe(false);
    expect(result.current.data.pending).toBe("late");
    await act(() => result.current.home.refresh()); // usable again after the round
    expect(calls.usage).toBe(3);
  });

  it("guest and no-review scopes never read notifications or the review summary (109-07)", async () => {
    signedIn(GUEST, []);
    const { result, calls } = setup({ tenantId: 70, isUser: false, review: false });
    await loaded(result);
    await act(() => result.current.home.refresh());
    expect(calls).toEqual({ usage: 2, pending: 2, recent: 2, unread: 0, reviewSummary: 0 });
  });

  it("no tenant: no reads and no waiting state", async () => {
    const { result, calls } = setup({ tenantId: null, isUser: true, review: true });
    await loaded(result);
    await act(() => result.current.home.refresh());
    expect(calls).toMatchObject({ usage: 1, pending: 1, recent: 1 });
    expect(result.current.home.outcome).toBeNull();
  });

  it("a failed read keeps its old data and reports partial; a retry can succeed (109-05)", async () => {
    let down = false;
    const { result, onSettled } = setup(
      { tenantId: 70, isUser: true, review: false },
      { pending: () => (down ? Promise.reject(new ApiError(0, "network", [])) : Promise.resolve("pending-ok")) },
    );
    await loaded(result);
    down = true;
    await act(() => result.current.home.refresh());
    expect(result.current.home.outcome).toBe("partial");
    expect(result.current.data.pending).toBe("pending-ok");
    expect(result.current.data.usage).toBe("usage-2");
    expect([...(onSettled.mock.calls[0]?.[0] as Set<HomePart>)]).not.toContain("pending");
    down = false;
    await act(() => result.current.home.refresh());
    expect(result.current.home.outcome).toBe("done");
  });

  it("a 401 leaves the notice to the session expiry handling (109 auth)", async () => {
    let expired = false;
    const { result } = setup(
      { tenantId: 70, isUser: true, review: false },
      { usage: () => (expired ? Promise.reject(new ApiError(401, "unauthenticated", [])) : Promise.resolve("u")) },
    );
    await loaded(result);
    expired = true;
    await act(() => result.current.home.refresh());
    expect(result.current.home.outcome).toBeNull();
    expect(result.current.home.refreshing).toBe(false);
  });

  it("a round that outlives its tenant is ignored (109-08)", async () => {
    const slow = gated("old");
    const { result, onSettled } = setup({ tenantId: 70, isUser: true, review: false }, { recent: slow.fn });
    await loaded(result);
    slow.arm();
    let round!: Promise<void>;
    act(() => {
      round = result.current.home.refresh();
    });
    act(() => useTenantChoice.getState().choose(ORG.tenant_id));
    await act(async () => {
      slow.open();
      await round;
    });
    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.home.outcome).toBeNull();
    expect(result.current.home.refreshing).toBe(false);
    expect(useSession.getState().me).toEqual(USER);
  });
});
