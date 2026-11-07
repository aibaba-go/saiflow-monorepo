import { create } from "zustand";

/** Whether the verify page holds unsaved edits, so the tenant switcher can ask before
 * switching (final review 5); the router blocker covers in-app navigation. */
export const useUnsaved = create<{ dirty: boolean; setDirty: (dirty: boolean) => void }>((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
}));
