import { Result, Spin } from "antd";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { useMe } from "./session";

/** The signed-in, registered area (FR-SYS-090, 091): no session → login, unregistered →
 * the register guide; both remember where the user was going. */
export function RequireUser() {
  const me = useMe();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  if (me.isPending) return <Spin size="large" style={{ display: "block", margin: "20vh auto" }} />;
  if (me.isError)
    return (
      <Result status="warning">
        <ErrorText error={me.error} />
      </Result>
    );
  if (!me.data) return <Navigate to={`/login?next=${next}`} replace />;
  if (!me.data.registered) return <Navigate to={`/register?next=${next}`} replace />;
  return <Outlet />;
}
