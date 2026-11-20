import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { closeAllDialogs } from "../components/ui/dialogs";
import { clearToasts } from "../components/ui/toast";

// Responsive helpers read matchMedia; jsdom does not provide it.
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

// sonner measures toasts; jsdom has no ResizeObserver.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Radix dialogs use pointer capture; jsdom has none.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Dialogs and toasts render into document.body outside React Testing Library's container;
// close them between tests so one test's dialog never answers another's query.
afterEach(() => {
  closeAllDialogs();
  clearToasts();
  cleanup();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});
