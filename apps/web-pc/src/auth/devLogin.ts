/** Restricted local dev login (NFR-DEV-002): the reserved token goes as the authorization
 * code to the same POST /api/v1/auth/line as the LINE callback. The backend maps it to its
 * one fixed dev identity only with APP_ENV=development, DEV_LOGIN_ENABLED and a loopback
 * client; anywhere else it is an invalid LINE code. */
import { redirectUri } from "../config";

export const DEV_LOGIN_TOKEN = "saiflow-local-development";

export function devLoginBody(): { code: string; redirect_uri: string } {
  return { code: DEV_LOGIN_TOKEN, redirect_uri: redirectUri() };
}
