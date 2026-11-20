import { act, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { translate, type MessageKey } from "../../i18n";
import { LANGS, useLanguage } from "../../stores/language";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { BellBadge } from "./BellBadge";
import { NotificationsPage } from "./NotificationsPage";
import { renderNotification, type NotificationItem } from "./render";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const item = (id: number, type: string, data: Record<string, unknown>, read = false): NotificationItem => ({
  id,
  type,
  tenant_id: 5,
  data,
  created_at: "2026-11-05T03:00:00Z",
  read,
});

const SAMPLES: NotificationItem[] = [
  ...["d7", "d3", "d1", "d0", "after"].map((stage, i) =>
    item(i + 1, "subscription_expiry", { stage, plan_code: "starter", ends_at: "2026-12-10T03:00:00+00:00" }),
  ),
  ...["low", "month_end"].map((stage, i) =>
    item(i + 10, "usage", { stage, plan_code: "starter", quota: 5000, used: 4100, remaining: 900, month: "2026-11-01" }),
  ),
  ...["d7", "d3", "d1", "d0"].map((stage, i) =>
    item(i + 20, "free_quota_expiry", { stage, remaining: 60, expires_at: "2026-12-10T03:00:00+00:00" }),
  ),
];

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
});

describe("renderNotification", () => {
  it("words every kind and stage in all three languages", () => {
    for (const lang of LANGS) {
      const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
      for (const n of SAMPLES) {
        const { title, body } = renderNotification(n, t, "Siam Tools");
        for (const text of [title, body]) {
          expect(text, `${lang} ${n.type} ${String(n.data.stage)}`).not.toMatch(/\{|undefined|NaN/);
          expect(text.trim()).not.toBe("");
        }
      }
    }
  });

  it("puts the values in", () => {
    const t = (k: MessageKey, v?: Record<string, string | number>) => translate("en", k, v);
    const expiry = renderNotification(SAMPLES[0]!, t, "Siam Tools");
    expect(expiry.title).toBe("Your plan expires in 7 days");
    expect(expiry.body).toContain("2026-12-10 10:00");
    expect(renderNotification(SAMPLES[5]!, t, "Siam Tools").body).toContain("900");
    expect(renderNotification(item(99, "something_new", {}), t, "X").title).toBe(t("notif.generic"));
  });
});

function centerApi(items: NotificationItem[]) {
  const state = { items: [...items] };
  const unread = () => state.items.filter((n) => !n.read).length;
  const api = mockApi({
    "GET /api/v1/me/notifications": (r) => {
      const url = new URL(r.url);
      const before = Number(url.searchParams.get("before") ?? Infinity);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const page = state.items.filter((n) => n.id < before).sort((a, b) => b.id - a.id);
      const shown = page.slice(0, limit);
      const next = page.length > limit ? shown[shown.length - 1]!.id : null;
      return json(200, { unread_count: unread(), items: shown, next_before: next });
    },
    "POST /api/v1/me/notifications/read": async (r) => {
      const body = (await r.json()) as { ids?: number[] | null };
      let updated = 0;
      for (const n of state.items) {
        if (!n.read && (body.ids == null || body.ids.includes(n.id))) {
          n.read = true;
          updated += 1;
        }
      }
      return json(200, { updated, unread_count: unread() });
    },
  });
  return api;
}

describe("notification center (FR-SYS-054)", () => {
  it("shows the unread count on the bell (054-01)", async () => {
    centerApi([SAMPLES[0]!, SAMPLES[1]!]);
    signedIn(USER, [PERSONAL, ORG]);
    renderWithProviders(<BellBadge />);
    expect(await screen.findByLabelText("Notifications, 2 unread")).toBeInTheDocument();
  });

  it("lists in the current language, marks one and then all read (054-01, 054-02)", async () => {
    const api = centerApi([SAMPLES[0]!, SAMPLES[1]!]);
    signedIn(USER, [PERSONAL, ORG]);
    renderWithProviders(
      <>
        <BellBadge />
        <NotificationsPage />
      </>,
    );
    expect(await screen.findByText("Your plan expires in 7 days")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Your plan expires in 3 days"));
    await waitFor(() => expect(screen.getByLabelText("Notifications, 1 unread")).toBeInTheDocument());
    expect(await api.bodies("POST /api/v1/me/notifications/read")).toEqual([{ ids: [2] }]);
    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(screen.getByLabelText("Notifications")).toBeInTheDocument());
    expect((await api.bodies("POST /api/v1/me/notifications/read"))[1]).toEqual({});
  });

  it("follows a language switch (054-03)", async () => {
    centerApi([SAMPLES[5]!]);
    useLanguage.getState().setLang("zh");
    signedIn(USER, [PERSONAL, ORG]);
    renderWithProviders(<NotificationsPage />);
    const zh = translate("zh", "notif.usage.low");
    expect(await screen.findByText(zh)).toBeInTheDocument();
    act(() => useLanguage.getState().setLang("en"));
    expect(await screen.findByText(translate("en", "notif.usage.low"))).toBeInTheDocument();
  });

  it("guests have no bell (054-04)", () => {
    const api = centerApi([]);
    signedIn(GUEST, []);
    renderWithProviders(<BellBadge />);
    expect(screen.queryByLabelText(/Notifications/)).toBeNull();
    expect(api.count("GET /api/v1/me/notifications")).toBe(0);
  });

  it("loads the next page with before=next_before", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      item(i + 1, "usage", { stage: "low", plan_code: "starter", quota: 5000, used: 4100, remaining: 900, month: "2026-11-01" }, true),
    );
    const api = centerApi(many);
    signedIn(USER, [PERSONAL]);
    renderWithProviders(<NotificationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(api.count("GET /api/v1/me/notifications")).toBe(2));
    const second = new URL(api.calls.filter((c) => c.method === "GET")[1]!.url);
    expect(second.searchParams.get("before")).toBe("6");
    expect(await screen.findAllByText(translate("en", "notif.usage.low"))).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});


describe("left organizations (minor-fixes-ui)", () => {
  it("left org notice label and no tenant switch", async () => {
    const note = item(9, "review_pending", { stage: "l1", job_id: "j1", file_name: "inv.pdf", level: 1 });
    mockApi({
      "GET /api/v1/me/notifications": () => json(200, { unread_count: 1, items: [{ ...note, tenant_id: 99 }], next_before: null }),
      "POST /api/v1/me/notifications/read": () => json(200, { updated: 1, unread_count: 0 }),
    });
    signedIn(USER, [PERSONAL]);
    useTenantChoice.getState().choose(null);
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByText(/Left organization/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("A document is waiting for your review"));
    expect(await screen.findByText("This document has already been handled by someone else.")).toBeInTheDocument();
    expect(useTenantChoice.getState().id).toBeNull();
  });
});
