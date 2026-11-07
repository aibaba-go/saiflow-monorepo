import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { ApiError, errorMessage } from "../../services/errors";
import { useSession } from "../../stores/session";
import { formatBangkokDate } from "../../utils/format";
import { INVITE_KEY, JOIN_KEY, loadIdentity, startLogin } from "../auth/session";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";

export { INVITE_KEY } from "../auth/session";

function session(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function setSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // blocked storage: the join simply does not survive a redirect
  }
}

function Gone({ error }: { error: unknown }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="page page--center">
      <EmptyState status="error" title={errorMessage(error ?? new ApiError(410, "invitation_gone", []), t)} />
      <Button variant="primary" onClick={() => navigate("/")}>
        {t("common.home")}
      </Button>
    </div>
  );
}

/** Accept an invitation (FR-SYS-052): see the organization first; a guest logs in and
 * registers on the way and the join then finishes by itself. The token lives in
 * sessionStorage only (this visit). */
export function InvitePage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const { setTenant } = useCurrentTenant();
  const [token] = useState(() => session(INVITE_KEY));
  const [error, setError] = useState<unknown>(null);
  const registered = me?.kind === "user" && me.registered;

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => call(api.GET("/api/v1/invitations/preview", { params: { query: { token: token ?? "" } } })),
    enabled: token !== null,
    retry: false,
  });

  const accept = useSubmit(async () => {
    setError(null);
    try {
      const { tenant_id } = await call(api.POST("/api/v1/invitations/accept", { body: { token: token ?? "" } }));
      setSession(INVITE_KEY, null);
      setSession(JOIN_KEY, null);
      await loadIdentity();
      setTenant(tenant_id);
      navigate("/");
    } catch (err) {
      setSession(JOIN_KEY, null);
      setError(err);
    }
  });

  const join = async () => {
    if (registered) {
      await accept.run();
      return;
    }
    setSession(JOIN_KEY, token);
    if (me?.kind === "user") useSession.getState().set({ registerOpen: true });
    else await startLogin("/invite");
  };
  const joinOnce = useSubmit(join); // one request per tap (minor-fixes-ui)

  // Back from login and registration with Join pending on this very invitation: finish it.
  const previewed = preview.isSuccess;
  useEffect(() => {
    if (registered && previewed && token && session(JOIN_KEY) === token && !accept.pending && !error) {
      void accept.run();
    }
  }, [registered, previewed, token, accept, error]);

  if (token === null) return <Gone error={null} />;
  if (preview.isPending) return <BrandLoading label={t("common.loading")} />;
  if (preview.isError) return <Gone error={preview.error} />;
  if (error) return <Gone error={error} />;
  return (
    <div className="page page--center">
      <h1 className="page__title">{t("invite.title", { name: preview.data.organization_name })}</h1>
      <div className="card-row__meta">
        {t("invite.validUntil", { date: formatBangkokDate(preview.data.expires_at) })}
      </div>
      <Button variant="primary" loading={accept.pending} onClick={() => void joinOnce.run()}>
        {t("invite.join")}
      </Button>
    </div>
  );
}
