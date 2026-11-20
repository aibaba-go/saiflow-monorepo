/** A task a guest pressed Confirm on: confirmed once after login (FR-SYS-129, as line-mini). */
const PREFIX = "saiflow.confirm-after-login.";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // storage blocked: nothing is remembered
  }
}

export const rememberConfirm = (jobId: string) => safe(() => sessionStorage.setItem(PREFIX + jobId, "1"), undefined);
export const wantsConfirm = (jobId: string) => safe(() => sessionStorage.getItem(PREFIX + jobId) !== null, false);
export const clearConfirm = (jobId: string) => safe(() => sessionStorage.removeItem(PREFIX + jobId), undefined);

/** Whether any task waits for its confirm (the claimed task is in the personal tenant). */
export function anyConfirmPending(): boolean {
  return safe(() => Object.keys(sessionStorage).some((k) => k.startsWith(PREFIX)), false);
}
