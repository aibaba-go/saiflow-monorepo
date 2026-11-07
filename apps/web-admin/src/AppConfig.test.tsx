import { render, screen } from "@testing-library/react";
import { theme } from "antd";

import { AppConfig } from "./AppConfig";

function Probe() {
  const { token } = theme.useToken();
  return <p>{[token.colorPrimary, token.controlHeight, token.borderRadius, token.fontFamily].join("|")}</p>;
}

it("antd follows STD-008 (FR-SYS-135 admin)", () => {
  render(
    <AppConfig lang="en">
      <Probe />
    </AppConfig>,
  );
  const [primary, height, radius, font] = screen.getByText(/\|/).textContent!.split("|");
  expect(primary?.toLowerCase()).toBe("#4a66f7");
  expect(height).toBe("32"); // antd default: admin keeps its density
  expect(radius).toBe("8");
  expect(font).toContain("IBM Plex Sans");
});
