import { App, Alert, Card, Checkbox, Form, Radio, Space, Typography } from "antd";
import { useState } from "react";

import { ConfirmButton } from "./ConfirmButton";
import { ErrorText } from "./ErrorText";
import { fieldErrorText, formLevel } from "./FieldError";
import { RemoteMultiSelect, type Labeled } from "./RemoteSelect";
import { PLAN_NAMES } from "../format";
import { useT } from "../i18n";
import { ApiError } from "../services/errors";
import {
  GRANT_PLANS,
  grantSummary,
  isCode,
  templateKeys,
  templates,
  userLabel,
  type GrantBody,
  type PlanCode,
  type TemplateDetail,
} from "../services/templates";

/** The use grant of a system template (FR-TEMPLATE-009): exactly one mode — an exact set of
 * plans, or named users and organizations. A grant never gives edit rights and creates no
 * content version; it carries the template revision (FR-TEMPLATE-012). */
export function GrantsPanel({
  detail,
  onSaved,
  onConflict,
}: {
  detail: TemplateDetail;
  onSaved: (next: TemplateDetail) => void;
  onConflict: (error: unknown) => void;
}) {
  const t = useT();
  const { message } = App.useApp();
  const grant = detail.grant;
  const [mode, setMode] = useState<GrantBody["mode"]>(grant?.mode ?? "PLANS");
  const [plans, setPlans] = useState<PlanCode[]>(grant?.plans ?? []);
  const [users, setUsers] = useState<Labeled[]>(
    (grant?.users ?? []).map((u) => ({ value: u.id, label: userLabel(u) })),
  );
  const [orgs, setOrgs] = useState<Labeled[]>(
    (grant?.organizations ?? []).map((o) => ({ value: o.tenant_id, label: o.name })),
  );
  const [error, setError] = useState<unknown>(null);

  // Nothing to save while the choice equals the stored grant (a template without one can always save).
  const sameSet = (a: readonly (string | number)[], b: readonly (string | number)[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const unchanged =
    !!grant?.mode &&
    mode === grant.mode &&
    (mode === "PLANS"
      ? sameSet(plans, grant.plans)
      : sameSet(
          users.map((u) => u.value),
          grant.users.map((u) => u.id),
        ) &&
        sameSet(
          orgs.map((o) => o.value),
          grant.organizations.map((o) => o.tenant_id),
        ));
  async function save() {
    setError(null);
    if (mode === "PLANS" && plans.length === 0) return setError(new ApiError(400, "validation_error", ["plans"]));
    if (mode === "TARGETS" && users.length + orgs.length === 0) {
      return setError(new ApiError(400, "validation_error", ["user_ids"]));
    }
    const body: GrantBody =
      mode === "PLANS"
        ? { mode, plans: GRANT_PLANS.filter((p) => plans.includes(p)), user_ids: [], organization_tenant_ids: [] }
        : { mode, plans: [], user_ids: users.map((u) => u.value), organization_tenant_ids: orgs.map((o) => o.value) };
    try {
      onSaved(await templates.setGrants(detail.id, detail.revision, body));
      void message.success(t("tpl.grant.saved"));
    } catch (e) {
      if (isCode(e, "revision_conflict")) onConflict(e);
      else setError(e);
    }
  }

  const item = (...fields: string[]) => {
    const text = fields.map((f) => fieldErrorText(error, f, t)).find(Boolean);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };

  return (
    <Card title={t("tpl.grant.title")} data-testid="template-grants">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text>{t("tpl.grant.current", { summary: grantSummary(grant, t) })}</Typography.Text>
        {!grant?.mode && <Alert type="warning" showIcon message={t("tpl.grant.newHint")} />}
        <Alert type="info" showIcon message={t("tpl.grant.note")} />
        <Form layout="vertical">
          <Form.Item label={t("tpl.grant.mode")}>
            <Radio.Group
              aria-label={t("tpl.grant.mode")}
              value={mode}
              onChange={(e) => setMode(e.target.value as GrantBody["mode"])}
              options={[
                { value: "PLANS", label: t("tpl.grant.modePlans") },
                { value: "TARGETS", label: t("tpl.grant.modeTargets") },
              ]}
            />
          </Form.Item>
          {mode === "PLANS" ? (
            <Form.Item label={t("tpl.grant.plans")} extra={t("tpl.grant.plansHint")} {...item("plans")}>
              <Checkbox.Group
                aria-label={t("tpl.grant.plans")}
                value={plans}
                onChange={(v) => setPlans(v as PlanCode[])}
                options={GRANT_PLANS.map((p) => ({ value: p, label: PLAN_NAMES[p] ?? p }))}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                label={t("tpl.grant.users")}
                htmlFor="tpl-grant-users"
                extra={t("tpl.grant.usersHint")}
                {...item("user_ids")}
              >
                <RemoteMultiSelect
                  id="tpl-grant-users"
                  value={users}
                  onChange={setUsers}
                  placeholder={t("tpl.grant.searchPlaceholder")}
                  queryKey={templateKeys.users("")}
                  search={templates.grantUsers}
                  toOption={(u) => ({ value: u.id, label: userLabel(u) })}
                />
              </Form.Item>
              <Form.Item
                label={t("tpl.grant.orgs")}
                htmlFor="tpl-grant-orgs"
                extra={t("tpl.grant.orgsHint")}
                {...item("organization_tenant_ids")}
              >
                <RemoteMultiSelect
                  id="tpl-grant-orgs"
                  value={orgs}
                  onChange={setOrgs}
                  placeholder={t("tpl.grant.searchPlaceholder")}
                  queryKey={templateKeys.organizations("")}
                  search={templates.grantOrganizations}
                  toOption={(o) => ({ value: o.tenant_id, label: o.name })}
                />
              </Form.Item>
            </>
          )}
          <Space direction="vertical" style={{ width: "100%" }}>
            <ErrorText error={formLevel(error)} />
            <ConfirmButton
              type="primary"
              label={t("tpl.grant.save")}
              title={t("tpl.grant.confirmSave")}
              disabled={unchanged}
              onConfirm={save}
            />
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
