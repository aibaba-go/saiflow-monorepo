/** The customer password rule (FR-SYS-152), checked before submitting so the user sees the
 * rule at once; the backend checks it again. */

import { ApiError } from "../../services/errors";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function passwordOk(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

/** A client-side error for a new password and its confirmation, or null when both are
 * fine: the rule on `field`, a mismatch on `confirmField` (AC-FR-SYS-042-05). */
export function checkNewPassword(
  password: string,
  confirm: string,
  field = "password",
  confirmField = "password_confirm",
): ApiError | null {
  if (!passwordOk(password)) return new ApiError(400, "validation_error", [field]);
  if (password !== confirm) return new ApiError(400, "password_mismatch", [confirmField]);
  return null;
}

/** An empty or malformed email as a field error, or null. */
export function checkEmail(email: string): ApiError | null {
  if (!email.trim()) return new ApiError(400, "required", ["email"]);
  if (!EMAIL.test(email.trim())) return new ApiError(400, "validation_error", ["email"]);
  return null;
}
