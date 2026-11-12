import { api, call } from "../../services/api";
import { ApiError } from "../../services/errors";
import { useSession } from "../../stores/session";
import { openLogin } from "../auth/session";
import type { ResultOut } from "./ResultPage";
import type { Json } from "./structured";

/** A confirm that waits for LINE login and registration (AC-FR-SYS-106-01): the draft is
 * already saved, so after login the result page finds the flag and confirms. */
const FLAG = "saiflow.confirm-after-login.";

export function wantsConfirm(jobId: string): boolean {
  try {
    return sessionStorage.getItem(FLAG + jobId) === "1";
  } catch {
    return false;
  }
}

export function clearConfirm(jobId: string): void {
  try {
    sessionStorage.removeItem(FLAG + jobId);
  } catch {
    // nothing kept
  }
}

function rememberConfirm(jobId: string): void {
  try {
    sessionStorage.setItem(FLAG + jobId, "1");
  } catch {
    // storage blocked: the user taps Confirm again after login
  }
}

export type ConfirmOutcome =
  | { kind: "confirmed"; result: ResultOut }
  | { kind: "login" }
  | { kind: "missing"; paths: string[] }
  | { kind: "error"; error: ApiError };

/** Confirm the current version (FR-VERIFY-009): a guest or an unregistered user is sent to
 * login or registration first; 422 names the missing fields as `structured.<path>`. */
export async function confirmResult(jobId: string, version: number, structured: Json): Promise<ConfirmOutcome> {
  const { me, set } = useSession.getState();
  if (!(me?.kind === "user" && me.registered)) {
    rememberConfirm(jobId);
    if (me?.kind === "user") set({ registerOpen: true });
    else openLogin(`/scan/jobs/${jobId}/result`);
    return { kind: "login" };
  }
  try {
    const result = await call(
      api.PATCH("/api/v1/ocr/jobs/{job_id}/result", {
        params: { path: { job_id: jobId } },
        body: { expected_version: version, structured, confirm: true },
      }),
    );
    clearConfirm(jobId);
    return { kind: "confirmed", result };
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError(0, "unknown", []);
    if (error.code === "required_missing") {
      clearConfirm(jobId);
      return { kind: "missing", paths: error.fields.map((f) => f.replace(/^structured\./, "")) };
    }
    if (error.code !== "registration_required" && error.code !== "unauthenticated") clearConfirm(jobId);
    return { kind: "error", error };
  }
}

/** Scroll the first marked field into view (AC-FR-SYS-106-02). */
export function scrollToField(path: string): void {
  const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
