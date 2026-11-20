import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { BackendHealth } from "@saiflow/api-client";

import { fetchBackendHealth } from "../services/health";
import { HealthPage } from "./HealthPage";

vi.mock("../services/health", () => ({ fetchBackendHealth: vi.fn() }));

function mockHealth(health: BackendHealth) {
  vi.mocked(fetchBackendHealth).mockResolvedValue(health);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it("shows OK with version", async () => {
  // AC-FR-PLAT-004-02
  mockHealth({ state: "ok", version: "abc" });
  render(<HealthPage />, { wrapper });
  expect(await screen.findByText("Backend: OK (abc)")).toBeInTheDocument();
});

it("shows DEGRADED", async () => {
  // AC-FR-PLAT-004-03
  mockHealth({ state: "degraded", version: "abc" });
  render(<HealthPage />, { wrapper });
  expect(await screen.findByText("Backend: DEGRADED (abc)")).toBeInTheDocument();
});

it("shows UNREACHABLE", async () => {
  // AC-FR-PLAT-004-03
  mockHealth({ state: "unreachable" });
  render(<HealthPage />, { wrapper });
  expect(await screen.findByText("Backend: UNREACHABLE")).toBeInTheDocument();
  expect(screen.queryByText(/Backend: OK/)).toBeNull();
});

it("shows checking while loading", () => {
  vi.mocked(fetchBackendHealth).mockReturnValue(new Promise(() => {}));
  render(<HealthPage />, { wrapper });
  expect(screen.getByText("Backend: checking…")).toBeInTheDocument();
});

it("shows the page title", async () => {
  mockHealth({ state: "ok", version: "abc" });
  render(<HealthPage />, { wrapper });
  expect(await screen.findByText("SaiFlow Admin")).toBeInTheDocument();
});
