import { describe, expect, it } from "vitest";
import { leaveDateRangesOverlap } from "@/utils/leave-request-conflicts";

describe("leave request conflicts", () => {
  it("treats touching leave ranges as overlapping because dates are inclusive", () => {
    expect(leaveDateRangesOverlap(100, 200, 200, 300)).toBe(true);
  });

  it("does not flag separated leave ranges", () => {
    expect(leaveDateRangesOverlap(100, 199, 200, 300)).toBe(false);
    expect(leaveDateRangesOverlap(301, 400, 200, 300)).toBe(false);
  });
});
