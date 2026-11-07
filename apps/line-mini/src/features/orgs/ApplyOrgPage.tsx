import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel, requireFields } from "../../components/FieldError";
import { useSubmit } from "../../hooks/useSubmit";
import { useT, type MessageKey } from "../../i18n";
import { api, call } from "../../services/api";
import { useSession } from "../../stores/session";
import { formatBangkokDateTime } from "../../utils/format";
import { reloadIdentity } from "../auth/session";
import type { OrgApplication } from "./orgData";
import { Button } from "../../components/ui/button";
import { Tag } from "../../components/ui/tag";

const STATUS: Record<string, MessageKey> = {
  pending: "app.pending",
  approved: "app.approved",
  rejected: "app.rejected",
};

function ApplicationRow({ app }: { app: OrgApplication }) {
  const t = useT();
  return (
    <div className="card-row">
      <div className="card-row__title">
        {app.name} <Tag tone={app.status === "rejected" ? "danger" : "primary"}>{t(STATUS[app.status]!)}</Tag>
      </div>
      <div className="card-row__meta">{formatBangkokDateTime(app.created_at)}</div>
      {app.reject_reason && (
        <div className="card-row__meta">{t("app.reason", { reason: app.reject_reason })}</div>
      )}
    </div>
  );
}

/** Apply to create an organization and follow the applications (FR-SYS-047). */
export function ApplyOrgPage() {
  const t = useT();
  const client = useQueryClient();
  const tenants = useSession((s) => s.tenants);
  const apps = useQuery({
    queryKey: ["my-org-applications"],
    queryFn: () => call(api.GET("/api/v1/me/organization-applications")),
  });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const refreshed = useRef(false);

  // An approved organization the session does not know yet: reload the tenants (047-04).
  useEffect(() => {
    const known = new Set(tenants.map((x) => x.tenant_id));
    const fresh = apps.data?.some((a) => a.status === "approved" && a.tenant_id && !known.has(a.tenant_id));
    if (fresh && !refreshed.current) {
      refreshed.current = true;
      reloadIdentity().catch((err) => setError(err));
    }
  }, [apps.data, tenants]);

  const submit = useSubmit(async () => {
    const missing = requireFields({ name, contact_phone: phone });
    setError(missing);
    if (missing) return;
    try {
      await call(
        api.POST("/api/v1/organization-applications", {
          body: { name, contact_phone: phone, address },
        }),
      );
      await client.invalidateQueries({ queryKey: ["my-org-applications"] });
    } catch (err) {
      setError(err);
    }
  });

  const pending = apps.data?.some((a) => a.status === "pending");
  return (
    <div className="page">
      <h1 className="page__title">{t("org.applyTitle")}</h1>
      {apps.data?.map((app) => <ApplicationRow key={app.id} app={app} />)}
      <ErrorText error={apps.error} />
      {apps.isSuccess && !pending && (
        <div className="form">
          <Field id="org-name" label={t("org.name")} value={name} onChange={setName} error={error} field="name" />
          <Field
            id="org-phone"
            label={t("org.phone")}
            value={phone}
            onChange={setPhone}
            error={error}
            field="contact_phone"
            type="tel"
          />
          <Field
            id="org-address"
            label={t("org.addressOptional")}
            value={address}
            onChange={setAddress}
            error={error}
            field="address"
          />
          <ErrorText error={formLevel(error)} />
          <Button block variant="primary" loading={submit.pending} onClick={() => void submit.run()}>
            {t("org.submitApplication")}
          </Button>
        </div>
      )}
    </div>
  );
}
