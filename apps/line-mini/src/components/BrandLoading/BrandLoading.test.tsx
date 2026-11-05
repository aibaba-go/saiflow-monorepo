import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandLoading } from ".";

describe("BrandLoading", () => {
  it("shows its label", () => {
    render(<BrandLoading label="Connecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
  });

  it("drops the animation when reduced motion is requested", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...original(q), matches: q.includes("reduce") })) as typeof window.matchMedia;
    render(<BrandLoading label="Connecting" />);
    expect(screen.getByRole("status").dataset.animated).toBe("false");
    window.matchMedia = original;
  });
});
