import { render, screen } from "@testing-library/react";
import { theme } from "antd";

import { AppConfig } from "./AppConfig";

function Probe() {
  const { token } = theme.useToken();
  return <p>{[token.colorPrimary, token.controlHeight, token.borderRadius, token.fontFamily].join("|")}</p>;
}

it("antd follows the brand PC theme (FR-SYS-132, AC-FR-SYS-135-02 admin)", () => {
  render(
    <AppConfig lang="en">
      <Probe />
    </AppConfig>,
  );
  const [primary, height, radius, font] = screen.getByText(/\|/).textContent!.split("|");
  expect(primary?.toLowerCase()).toBe("#1a6fe8");
  expect(height).toBe("36"); // owner 2026-11-09: admin takes the PC brand density (STD-008 §11.4)
  expect(radius).toBe("8");
  expect(font).toContain("IBM Plex Sans");
});
