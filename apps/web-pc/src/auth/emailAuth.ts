/** Email login and password reset for web-pc (FR-SYS-090, FR-SYS-155): the client-side
 * checks that run before a request, and the calls themselves. Every call owns its 401 so a
 * wrong password is never read as an expired session. */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";
import { forgetSession, ME_KEY, useSessionNotice, type Me } from "./session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The customer password rule (FR-SYS-152): 8–64 characters, a letter and a digit. */
export function passwordOk(password: string): boolean {
  return password.length >= 8 && password.length <= 64 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

/** A required or malformed email as a field error, or null. */
export function checkEmail(email: string): ApiError | null {
  if (!email.trim()) return new ApiError(400, "required", ["email"]);
  if (!EMAIL.test(email.trim())) return new ApiError(400, "validation_error", ["email"]);
  return null;
}

/** A new password that breaks the rule, or a confirmation that differs, as a field error. */
export function checkNewPassword(
  password: string,
  confirm: string,
  field = "password",
  confirmField = "password_confirm",
): ApiError | null {
  if (!password) return new ApiError(400, "required", [field]);
  if (!passwordOk(password)) return new ApiError(400, "validation_error", [field]);
  if (!confirm) return new ApiError(400, "required", [confirmField]);
  if (password !== confirm) return new ApiError(400, "password_mismatch", [confirmField]);
  return null;
}

export type CodePurpose = "login" | "reset";

export async function sendAuthCode(email: string, purpose: CodePurpose): Promise<void> {
  const bad = checkEmail(email);
  if (bad) throw bad;
  await call(api.POST("/api/v1/auth/email-code", { body: { email: email.trim(), purpose } }), { own401: true });
}

export const loginWithPassword = (email: string, password: string) =>
  call(api.POST("/api/v1/auth/password", { body: { email: email.trim(), password } }), { own401: true });

export const loginWithEmailCode = (email: string, code: string) =>
  call(api.POST("/api/v1/auth/email-login", { body: { email: email.trim(), code: code.trim() } }), {
    own401: true,
  });

export const resetPassword = (email: string, code: string, password: string) =>
  call(api.POST("/api/v1/auth/password-reset", { body: { email: email.trim(), code: code.trim(), password } }), {
    own401: true,
  });

/** After any login: a new user may be signing in on this browser, so nothing of the
 * previous one stays; then go on to `to` (AC-FR-SYS-090-01, 05). */
export function useSignedIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setExpired = useSessionNotice((s) => s.setExpired);
  return useCallback(
    async (signed: Me, to: string) => {
      // An earlier GET /me (no session yet) must not land after this and undo it.
      await queryClient.cancelQueries({ queryKey: ME_KEY, exact: true });
      forgetSession(queryClient); // each user's stored tenant stays (AC-090-04)
      queryClient.setQueryData(ME_KEY, signed.kind === "user" ? signed : null);
      setExpired(false);
      navigate(to, { replace: true });
    },
    [navigate, queryClient, setExpired],
  );
}
