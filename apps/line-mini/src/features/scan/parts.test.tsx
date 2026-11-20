import { render, screen } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../../stores/language";
import { JobListItem } from "./components/JobListItem";
import { PageHeader } from "./components/PageHeader";
import { StatusChip } from "./components/StatusChip";
import type { JobOut } from "./jobs";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const job: JobOut = {
  id: "j1",
  file_id: "f1",
  file_name: "invoice.pdf",
  page_count: 3,
  status: "SUCCEEDED",
  stage: "VERIFYING",
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-06T01:05:00Z",
  confirmed_at: null,
  returned: false,
};

beforeEach(() => useLanguage.getState().setLang("en"));

describe("shared scan parts (main's components)", () => {
  it("status chip colours per stage", () => {
    const tone = (stage: string) => {
      const { container, unmount } = render(<StatusChip stage={stage} />);
      const cls = (container.firstChild as HTMLElement).className;
      unmount();
      return cls;
    };
    expect(tone("OCR_PROCESSING")).toMatch(/processing/);
    expect(tone("TEMPLATE_MATCHING")).toMatch(/processing/);
    expect(tone("OCR_FAILED")).toMatch(/failed/);
    expect(tone("VERIFYING")).toMatch(/verifying/);
    expect(tone("CONFIRMED")).toMatch(/completed/);
    render(<StatusChip stage="VERIFYING" />);
    expect(screen.getByText("Verifying")).toBeInTheDocument();
  });

  it("status chip uses the STD-008 review colour and shows returned (FR-SYS-133)", () => {
    const { unmount } = render(<StatusChip stage="PENDING_REVIEW" level={2} />);
    expect(screen.getByText("Waiting for level-2 review").className).toMatch(/review/);
    unmount();
    render(<StatusChip stage="VERIFYING" returned />);
    expect(screen.getByText("Verifying").className).toMatch(/verifying/);
    expect(screen.getByText("Returned").className).toMatch(/failed/);
  });

  it("job list item shows name, pages, template and Bangkok time", async () => {
    const open = vi.fn();
    render(<JobListItem job={job} onOpen={open} />);
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText("3 pages")).toBeInTheDocument();
    expect(screen.getByText("08:05")).toBeInTheDocument();
    expect(screen.getByText("Tax Invoice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(open).toHaveBeenCalledWith(job);
  });

  it("page header back", async () => {
    const back = vi.fn();
    render(<PageHeader title="Final result" onBack={back} />);
    expect(screen.getByRole("heading", { name: "Final result" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalled();
  });
});
