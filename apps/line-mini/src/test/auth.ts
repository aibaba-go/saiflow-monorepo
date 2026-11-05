import { configureAuth } from "../features/auth/session";
import { fakeLiff, type FakeLiff } from "./fakeLiff";

/** Configure the auth flows for a component test (no router side effects). */
export function testAuth(liff: FakeLiff = fakeLiff({ loggedIn: true })): FakeLiff {
  configureAuth({
    liff,
    search: "",
    liffTimeoutMs: 50,
    logoutTimeoutMs: 50,
    navigate: () => {},
    currentPath: () => "/",
    onIdentityChange: () => {},
  });
  return liff;
}
