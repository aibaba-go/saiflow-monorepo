import "@testing-library/jest-dom/vitest";

// Ant Design reads matchMedia for responsive behaviour; jsdom does not provide it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// antd-mobile dialogs and toasts render into document.body outside React Testing Library's
// container; close them between tests so one test's dialog never answers another's query.
import { cleanup } from "@testing-library/react";
import { Dialog, Toast } from "antd-mobile";
import { afterEach } from "vitest";

afterEach(() => {
  Dialog.clear();
  Toast.clear();
  cleanup();
});
