import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Radio, Space, Switch, Table, Typography } from "antd";
import { useState } from "react";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { useT } from "../i18n";
import { getReviewSettings, type ReviewSettings, setReviewEmail, setReviewLevel } from "../reviews/api";
import { useTenant } from "../tenants/useTenant";

type Row = ReviewSettings["items"][number];
const LEVELS = ["review.settings.none", "review.settings.l1", "review.settings.l2"] as const;

/** Review settings, owner only (FR-SYS-125): a level per published template and for the
 * generic result, saved on change; then the notification channels (FR-SYS-126). A failed
 * save puts the old value back. */
export function ReviewSettingsPage() {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const owner = tenant?.kind === "organization" && tenant.is_owner;
  const key = ["reviewSettings", tenant?.tenant_id];
  const settings = useQuery({ queryKey: key, queryFn: getReviewSettings, enabled: owner });
  const [error, setError] = useState<unknown>(null);

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
      void message.success(t("review.saved"));
    } catch (e) {
      queryClient.setQueryData<ReviewSettings>(key, (cur) => (cur ? undo(cur) : cur));
      setError(e);
    }
  }

  if (!owner) {
    return (
      <Page name="review-settings" title={t("nav.reviewSettings")}>
        <Typography.Text>{t("review.ownerOnly")}</Typography.Text>
      </Page>
    );
  }
  return (
    <Page name="review-settings" title={t("nav.reviewSettings")}>
      <Space direction="vertical" style={{ width: "100%", maxWidth: 900 }} size="middle">
        <ErrorText error={settings.error ?? error} />
        <Table<Row>
          rowKey={(r) => String(r.template_id ?? "generic")}
          loading={settings.isPending}
          pagination={false}
          dataSource={settings.data?.items ?? []}
          columns={[
            { key: "name", title: t("review.col.template"), render: (_, r) => r.name ?? t("review.generic") },
            {
              key: "level",
              title: t("review.col.levels"),
              render: (_, r) => (
                <Radio.Group
                  optionType="button"
                  value={r.level}
                  onChange={(e) => {
                    const level = e.target.value as 0 | 1 | 2;
                    const before = r.level;
                    const put = (to: number) => (cur: ReviewSettings) => ({
                      ...cur,
                      items: cur.items.map((i) => (i.template_id === r.template_id ? { ...i, level: to } : i)),
                    });
                    void save(put(level), put(before), () => setReviewLevel(r.template_id ?? null, level));
                  }}
                  options={LEVELS.map((k, level) => ({ value: level, label: t(k) }))}
                />
              ),
            },
          ]}
        />
        {settings.data && (
          <Card size="small" title={t("review.settings.notify")}>
            <Space direction="vertical">
              <Space>
                <Switch checked disabled aria-label={t("review.settings.inApp")} />
                <Typography.Text>{t("review.settings.inApp")}</Typography.Text>
              </Space>
              <Space>
                <Switch
                  aria-label={t("review.settings.email")}
                  checked={settings.data.email_enabled}
                  onChange={(enabled) =>
                    void save(
                      (cur) => ({ ...cur, email_enabled: enabled }),
                      (cur) => ({ ...cur, email_enabled: !enabled }),
                      () => setReviewEmail(enabled),
                    )
                  }
                />
                <Typography.Text>{t("review.settings.email")}</Typography.Text>
              </Space>
            </Space>
          </Card>
        )}
      </Space>
    </Page>
  );
}
