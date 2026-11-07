import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { PageHeader } from "../scan/components/PageHeader";
import theme from "../scan/theme.module.css";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { type ReviewSettings, setReviewEmail, setReviewLevel, useReviewSettings } from "./api";
import s from "./reviews.module.css";

const LEVEL_KEYS = ["review.settings.none", "review.settings.l1", "review.settings.l2"] as const;

/** Review settings, owner only (FR-SYS-121): a level per published template and for the
 * generic result, saved on change; then the notification channels (in-app always on,
 * email switch, FR-SYS-126). A failed save puts the old value back. */
export function ReviewSettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tenant } = useCurrentTenant();
  const owner = tenant?.kind === "organization" && tenant.is_owner;
  const settings = useReviewSettings(owner);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const key = ["reviewSettings", tenant?.tenant_id];

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  // A failed save puts back only what it changed, so another change made meanwhile stays.
  async function save(
    change: (cur: ReviewSettings) => ReviewSettings,
    undo: (cur: ReviewSettings) => ReviewSettings,
    call: () => Promise<unknown>,
  ) {
    if (!queryClient.getQueryData<ReviewSettings>(key)) return;
    setError(null);
    queryClient.setQueryData<ReviewSettings>(key, (cur) => (cur ? change(cur) : cur));
    try {
      await call();
      setToast(t("review.saved"));
    } catch (e) {
      queryClient.setQueryData<ReviewSettings>(key, (cur) => (cur ? undo(cur) : cur));
      setError(e);
    }
  }

  return (
    <div className={`${theme.scan} ${s.page}`}>
      <PageHeader title={t("review.settings")} onBack={() => navigate("/org")} />
      <div className={s.content}>
        {!owner ? (
          <div className={s["status-line"]}>{t("review.ownerOnly")}</div>
        ) : !settings.data ? (
          settings.isError ? (
            <p className={s.error}>{errorMessage(settings.error, t)}</p>
          ) : (
            <BrandLoading variant="inline" label={t("common.loading")} />
          )
        ) : (
          <>
            <section className={s.section}>
              {settings.data.items.map((item) => {
                const name = item.name ?? t("template.generic");
                return (
                  <label key={item.template_id ?? "generic"} className={s.row}>
                    <span>{name}</span>
                    <select
                      className={s.select}
                      aria-label={name}
                      value={item.level}
                      onChange={(e) => {
                        const level = Number(e.target.value) as 0 | 1 | 2;
                        const before = item.level;
                        const put = (to: number) => (cur: ReviewSettings) => ({
                          ...cur,
                          items: cur.items.map((i) => (i.template_id === item.template_id ? { ...i, level: to } : i)),
                        });
                        void save(put(level), put(before), () => setReviewLevel(item.template_id ?? null, level));
                      }}
                    >
                      {LEVEL_KEYS.map((k, level) => (
                        <option key={k} value={level}>
                          {t(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </section>
            <section className={s.section}>
              <div className={s["section-title"]}>{t("review.settings.notify")}</div>
              <label className={s.row}>
                <span>{t("review.settings.inApp")}</span>
                <input type="checkbox" checked disabled aria-label={t("review.settings.inApp")} />
              </label>
              <label className={s.row}>
                <span>{t("review.settings.email")}</span>
                <input
                  type="checkbox"
                  aria-label={t("review.settings.email")}
                  checked={settings.data.email_enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    void save(
                      (cur) => ({ ...cur, email_enabled: enabled }),
                      (cur) => ({ ...cur, email_enabled: !enabled }),
                      () => setReviewEmail(enabled),
                    );
                  }}
                />
              </label>
            </section>
            {Boolean(error) && (
              <p className={s.error} role="alert">
                {errorMessage(error, t)}
              </p>
            )}
          </>
        )}
      </div>
      {toast && (
        <div className={s.toast} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
