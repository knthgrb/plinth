import { describe, expect, it } from "vitest";
import { canUseFilledLeaveForm } from "@/utils/leave-review-actions";

describe("leave review actions", () => {
  it("allows PDF/document actions only for approved filled forms", () => {
    expect(canUseFilledLeaveForm("approved", "<p>filled</p>")).toBe(true);
    expect(canUseFilledLeaveForm("rejected", "<p>filled</p>")).toBe(false);
    expect(canUseFilledLeaveForm("pending", "<p>filled</p>")).toBe(false);
    expect(canUseFilledLeaveForm("approved", "")).toBe(false);
  });
});
