import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canUseFilledLeaveForm } from "@/utils/leave-review-actions";

function readAppFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("leave review actions", () => {
  it("allows PDF/document actions only for approved filled forms", () => {
    expect(canUseFilledLeaveForm("approved", "<p>filled</p>")).toBe(true);
    expect(canUseFilledLeaveForm("rejected", "<p>filled</p>")).toBe(false);
    expect(canUseFilledLeaveForm("pending", "<p>filled</p>")).toBe(false);
    expect(canUseFilledLeaveForm("approved", "")).toBe(false);
  });

  it("keeps approval disabled until eligibility checks have loaded", () => {
    const source = readAppFile(
      "../app/[organizationId]/leave/_components/review-leave-dialog.tsx",
    );

    expect(source).toContain("const approvalInfoReady = approvalInfo !== undefined");
    expect(source).toContain("disabled={!approvalInfoReady || !canApprove || !approvalFormComplete}");
  });

  it("precomputes approved leave date conflicts before enabling approval", () => {
    const source = readAppFile("../convex/leave.ts");

    expect(
      source.match(/const overlappingApprovedRequest = await findOverlappingLeaveRequest/g)
        ?.length,
    ).toBe(2);
  });
});
