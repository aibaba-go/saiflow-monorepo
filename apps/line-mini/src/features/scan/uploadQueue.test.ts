import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { json, mockApi } from "../../test/mockApi";
import { useUploadQueue } from "./uploadQueue";

const file = (id: string) => ({
  id,
  original_name: "a.png",
  page_count: 1,
  status: "READY",
  mime_type: "image/png",
  size_bytes: 1,
  reject_reason: null,
  expires_at: null,
  created_at: "2026-11-07T00:00:00Z",
});

describe("upload queue (minor-fixes-ui)", () => {
  it("cancel after complete deletes the file", async () => {
    let cancel: () => void = () => {};
    const api = mockApi({
      "POST /api/v1/uploads": () => json(201, { ...file("u1"), status: "UPLOADING" }),
      "PUT /api/v1/uploads/u1/content": () => json(204, null),
      "POST /api/v1/uploads/u1/complete": () => {
        cancel(); // the user taps Cancel while the last step finishes
        return json(200, file("u1"));
      },
      "DELETE /api/v1/files/u1": () => json(204, null),
    });
    const { result } = renderHook(() => useUploadQueue(() => {}));
    act(() => result.current.start([new File(["x"], "a.png", { type: "image/png" })]));
    cancel = () => result.current.cancel(result.current.items[0]!.key);
    await waitFor(() => expect(api.count("DELETE /api/v1/files/u1")).toBe(1));
  });
});
