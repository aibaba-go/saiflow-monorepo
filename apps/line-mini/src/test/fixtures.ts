import { useSession, type Me, type UsableTenant } from "../stores/session";

export const USER: Me = {
  kind: "user",
  user_id: 7,
  tenant_id: 70,
  display_name: "Somchai",
  email: "somchai@example.com",
  email_suggestion: null,
  phone: "0812345678",
  avatar_url: null,
  registered: true,
};
export const UNREGISTERED: Me = {
  ...USER,
  display_name: "New User",
  email: null,
  email_suggestion: "line@example.com",
  phone: null,
  registered: false,
};
export const GUEST: Me = {
  ...USER,
  kind: "guest",
  user_id: null,
  tenant_id: 90,
  display_name: null,
  email: null,
  registered: false,
};
export const PERSONAL: UsableTenant = {
  tenant_id: 70,
  kind: "personal",
  name: null,
  is_owner: true,
  role: null,
  permissions: [],
};
export const ORG: UsableTenant = {
  tenant_id: 5,
  kind: "organization",
  name: "Siam Tools",
  is_owner: false,
  role: { id: 11, name: "Member" },
  permissions: ["upload_ocr", "verify_own", "export"],
};

/** A ready session as if boot had finished. */
export function signedIn(me: Me = USER, tenants: UsableTenant[] = [PERSONAL]): void {
  useSession.setState({
    me,
    tenants,
    status: "ready",
    registerOpen: false,
    loginError: null,
    notice: null,
  });
}
