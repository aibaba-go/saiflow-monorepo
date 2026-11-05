import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

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

// The whole console renders in each page test; its first render (antd cold start) can take
// over the 1 s default when every package's tests run at once (`pnpm -r test`).
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
