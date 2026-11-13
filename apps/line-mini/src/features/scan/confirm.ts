import { api, call } from "../../services/api";
import { ApiError } from "../../services/errors";
import { useSession } from "../../stores/session";
import { handleUnauthenticated, openLogin } from "../auth/session";
import { currentOrgId } from "../tenants/useCurrentTenant";
import type { ResultOut } from "./ResultPage";
import type { Json } from "./structured";

const CONFIRM_WAIT_MS = 10_000;

/** Bound both fetch and body decoding; aborting a write does not prove it was not committed. */
export async function boundedResultRequest<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApiError(0, "network", []));
        }, CONFIRM_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  const orgId = currentOrgId();
  const sameIdentity = () => {
    const current = useSession.getState().me;
    return current?.kind === "user" && current.user_id === me.user_id &&
      current.tenant_id === me.tenant_id && currentOrgId() === orgId;
  };
  try {
    const result = await boundedResultRequest((signal) => call(
      api.PATCH("/api/v1/ocr/jobs/{job_id}/result", {
        params: { path: { job_id: jobId } },
        body: { expected_version: version, structured, confirm: true },
        signal,
      }), { own401: true },
    ));
    if (sameIdentity()) clearConfirm(jobId);
    return { kind: "confirmed", result };
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError(0, "unknown", []);
    // A lost response or locked result can mean the first confirmation already committed.
    // Read only: never replay PATCH or confirm a conflicting version automatically.
    if (sameIdentity() && (error.code === "network" || error.code === "result_confirmed")) {
      try {
        const result = await boundedResultRequest((signal) => call(api.GET("/api/v1/ocr/jobs/{job_id}/result", {
          params: { path: { job_id: jobId } },
          signal,
        }), { own401: true }));
        if (sameIdentity() && result.confirmed) {
          clearConfirm(jobId);
          return { kind: "confirmed", result };
        }
      } catch (recoveryError) {
        if (sameIdentity() && recoveryError instanceof ApiError && recoveryError.status === 401) {
          void handleUnauthenticated();
        }
        // Recovery unavailable: keep the original error; do not claim success.
      }
    }
    if (!sameIdentity()) return { kind: "error", error };
    if (error.status === 401) void handleUnauthenticated();
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
