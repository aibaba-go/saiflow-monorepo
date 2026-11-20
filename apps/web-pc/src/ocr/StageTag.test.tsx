import { render, screen } from "@testing-library/react";

import { ReturnedTag, StageTag } from "./StageTag";

describe("stage colours (FR-SYS-133)", () => {
  it.each([
    ["OCR_PROCESSING", "warning", "Recognising"],
    ["TEMPLATE_MATCHING", "warning", "Matching template"],
    ["OCR_FAILED", "danger", "Recognition failed"],
    ["VERIFYING", "info", "To verify"],
    ["PENDING_REVIEW", "review", "To review"],
    ["CONFIRMED", "success", "Confirmed"],
  ])("%s is %s", (stage, tone, text) => {
    render(<StageTag stage={stage} />);
    const tag = screen.getByText(text);
    expect(tag).toHaveClass("stage-tag", `stage-tag--${tone}`);
  });

  it("returned is danger", () => {
    render(<ReturnedTag />);
    expect(screen.getByText("Returned")).toHaveClass("stage-tag", "stage-tag--danger");
  });
});
