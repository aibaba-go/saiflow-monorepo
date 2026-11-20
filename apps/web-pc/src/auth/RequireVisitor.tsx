import { useQueryClient } from "@tanstack/react-query";
import { Result, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { startGuest, useIdentity, useSessionNotice } from "./session";

const spinner = <Spin size="large" style={{ display: "block", margin: "20vh auto" }} />;

/** The pages a guest may use (FR-SYS-090): Home, Upload and Verify. */
export function isGuestPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/upload" || pathname === "/verify" || pathname.startsWith("/verify/");
}

/** The whole app area (FR-SYS-090): a user as in RequireUser, a guest as is (RequireUser keeps
 * guests off the other pages); without a session a guest page starts a guest session, unless a
 * user's session just expired, and any other page asks to log in. */
export function RequireVisitor() {
  const identity = useIdentity();
  const expired = useSessionNotice((s) => s.expired);
  const queryClient = useQueryClient();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  const [error, setError] = useState<unknown>(null);
  const starting = useRef(false);
  const guestPage = isGuestPath(location.pathname);
  const none = identity.isSuccess && !identity.data && !expired && guestPage;

  useEffect(() => {
    if (!none || starting.current) return;
    starting.current = true;
    setError(null);
    startGuest(queryClient)
      .catch(setError)
      .finally(() => {
        starting.current = false;
      });
  }, [none, queryClient]);

  const failure = identity.error ?? error;
  if (failure)
    return (
      <Result status="warning">
        <ErrorText error={failure} />
      </Result>
    );
  if (identity.isPending) return spinner;
  const me = identity.data;
  if (!me) return expired || !guestPage ? <Navigate to={`/login?next=${next}`} replace /> : spinner;
  if (me.kind === "user" && !me.registered) return <Navigate to={`/register?next=${next}`} replace />;
  return <Outlet />;
}
