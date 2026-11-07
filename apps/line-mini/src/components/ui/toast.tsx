import { toast, Toaster } from "sonner";

import { useT } from "../../i18n";

/** Short notices at the top of the screen (antd-mobile `Toast`). Mount once in App. */
export function AppToaster() {
  const t = useT();
  return (
    <Toaster
      // sonner's default region name is "Notifications", which is the bell's name (FR-SYS-054)
      containerAriaLabel={t("common.messages")}
      position="top-center"
      duration={2000}
      toastOptions={{
        unstyled: true,
        className:
          "flex items-center justify-center rounded-control bg-text px-3.5 py-2 text-base text-surface shadow-pop font-sans",
      }}
    />
  );
}

export function showToast(content: string): void {
  toast(content);
}

export function clearToasts(): void {
  toast.dismiss();
}
