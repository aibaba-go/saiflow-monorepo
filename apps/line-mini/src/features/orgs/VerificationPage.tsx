import { useState } from "react";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel, requireFields } from "../../components/FieldError";
import { useSubmit } from "../../hooks/useSubmit";
import { useT, type MessageKey } from "../../i18n";
import { api, call } from "../../services/api";
import type { CurrentTenant } from "../../stores/session";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { orgPath, useRefreshOrg, useVerification } from "./orgData";
import { Button } from "../../components/ui/button";
import { Tag } from "../../components/ui/tag";

const STATUS: Record<string, MessageKey> = {
  none: "verify.none",
  pending: "app.pending",
  verified: "verify.verified",
  rejected: "app.rejected",
};

function VerificationContent({ tenant }: { tenant: CurrentTenant }) {
  const t = useT();
  const orgId = tenant.tenant_id;
  const verification = useVerification(orgId);
  const refresh = useRefreshOrg(orgId);
  const [legal, setLegal] = useState("");
  const [tax, setTax] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const submit = useSubmit(async () => {
    const missing = requireFields({ legal_name: legal, tax_id: tax, registered_address: address });
    setError(missing);
    if (missing) return;
    try {
      await call(
        api.POST("/api/v1/organizations/{tenant_id}/verification", {
          ...orgPath(orgId),
          body: { legal_name: legal, tax_id: tax, registered_address: address },
        }),
      );
      await refresh();
    } catch (err) {
      setError(err);
    }
  });

  if (verification.isPending) return <BrandLoading label={t("common.loading")} />;
  if (verification.isError) return <ErrorText error={verification.error} />;
  const { status, reject_reason } = verification.data;
  const open = (status === "none" || status === "rejected") && can(tenant, "verification_apply");
  return (
    <div className="page">
      <h1 className="page__title">{t("org.verification")}</h1>
      <div>
        <Tag tone={status === "rejected" ? "danger" : "primary"}>{t(STATUS[status]!)}</Tag>
      </div>
      {reject_reason && <div className="card-row__meta">{t("app.reason", { reason: reject_reason })}</div>}
      {open && (
        <div className="form">
          <Field id="ver-legal" label={t("verify.legalName")} value={legal} onChange={setLegal} error={error} field="legal_name" />
          <Field id="ver-tax" label={t("verify.taxId")} value={tax} onChange={setTax} error={error} field="tax_id" />
          <Field
            id="ver-address"
            label={t("verify.address")}
            value={address}
            onChange={setAddress}
            error={error}
            field="registered_address"
          />
          <ErrorText error={formLevel(error)} />
          <Button variant="primary" loading={submit.pending} onClick={() => void submit.run()}>
            {t("common.submit")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Enterprise verification of the current organization (FR-SYS-051). */
export function VerificationPage() {
  const t = useT();
  const { tenant } = useCurrentTenant();
  if (!tenant || tenant.kind !== "organization") return <div className="page">{t("org.none")}</div>;
  return <VerificationContent key={tenant.tenant_id} tenant={tenant} />;
}
