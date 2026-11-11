import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useSyncExternalStore } from "react";

import { Button } from "./button";

/**
 * Promise-style confirm and alert dialogs (antd-mobile `Dialog.confirm` / `Dialog.alert`).
 * Requests wait in a queue; <DialogHost /> shows the first one. A request is taken off the
 * queue before it resolves, so a double tap resolves it once (Review Focus 3).
 */
interface Request {
  id: number;
  kind: "confirm" | "alert";
  title?: string;
  content?: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  resolve(ok: boolean): void;
}

let queue: Request[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function enqueue(r: Omit<Request, "id">) {
  queue = [...queue, { ...r, id: ++seq }];
  emit();
}
function settle(id: number, ok: boolean) {
  const r = queue.find((q) => q.id === id);
  if (!r) return;
  queue = queue.filter((q) => q.id !== id);
  emit();
  r.resolve(ok);
}

export function confirmDialog(o: {
  title: string;
  content?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => enqueue({ ...o, kind: "confirm", resolve }));
}

export function alertDialog(o: { content: string; confirmText: string }): Promise<void> {
  return new Promise((resolve) => enqueue({ ...o, kind: "alert", resolve: () => resolve() }));
}

/** Close every open or waiting dialog as cancelled (between tests). */
export function closeAllDialogs(): void {
  const all = queue;
  queue = [];
  emit();
  for (const r of all) r.resolve(false);
}

export function DialogHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  return (
    <AlertDialog.Root open={current !== null} onOpenChange={(open) => !open && current && settle(current.id, false)}>
      <AlertDialog.Portal>
        {/* The overlay and the panel are portaled separately, and the overlay may be appended
            after the panel: the panel's higher z-index keeps it above the mask (FR-SYS-043). */}
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        {current && (
          <AlertDialog.Content
            key={current.id}
            {...(current.kind === "confirm" && current.content ? {} : { "aria-describedby": undefined })}
            className="fixed top-1/2 left-1/2 z-[51] flex w-[min(340px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-card bg-surface p-5 shadow-pop focus:outline-none"
          >
            {current.kind === "alert" ? (
              <AlertDialog.Title className="m-0 text-body text-text">{current.content}</AlertDialog.Title>
            ) : (
              <>
                <AlertDialog.Title className="m-0 text-title-sm font-semibold text-text">{current.title}</AlertDialog.Title>
                {current.content && (
                  <AlertDialog.Description className="m-0 text-body text-text-secondary">
                    {current.content}
                  </AlertDialog.Description>
                )}
              </>
            )}
            <div className="flex gap-2">
              {current.kind === "confirm" && (
                <Button className="flex-1" onClick={() => settle(current.id, false)}>
                  {current.cancelText}
                </Button>
              )}
              <Button
                className="flex-1"
                variant={current.danger ? "danger" : "primary"}
                onClick={() => settle(current.id, true)}
              >
                {current.confirmText}
              </Button>
            </div>
          </AlertDialog.Content>
        )}
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
