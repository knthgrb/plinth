import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("payroll finalization guard", () => {
  it("passes the server finalize decision to the finalize dialog", () => {
    const convexSource = readSource("../convex/payroll.ts");
    const dialogSource = readSource(
      "../app/[organizationId]/payroll/_components/payroll-finalize-dialog.tsx",
    );

    expect(convexSource).toContain("finalizeBlockedReason");
    expect(convexSource).toContain(
      "assertDraftDependenciesFreshForFinalize",
    );
    expect(dialogSource).toContain("data?.canFinalize === true");
    expect(dialogSource).toContain("data.finalizeBlockedReason");
    expect(dialogSource).not.toContain('data?.runStatus === "draft"');
  });
});
