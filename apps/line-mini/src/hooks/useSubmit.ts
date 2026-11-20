import { useCallback, useRef, useState } from "react";

/** One request at a time for a button or form (FR-SYS-055-01): calls made while one is
 * pending are ignored and resolve to undefined. Errors are re-thrown to the caller. */
export function useSubmit<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): { run: (...args: A) => Promise<R | undefined>; pending: boolean } {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: A) => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      try {
        return await fn(...args);
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending };
}
