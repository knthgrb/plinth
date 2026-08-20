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

  it("discloses statutory regeneration behavior and safe lifecycle actions", () => {
    const pageSource = readSource(
      "../app/[organizationId]/payroll/payroll-page-client.tsx",
    );
    const tableSource = readSource(
      "../app/[organizationId]/payroll/_components/payroll-runs-table.tsx",
    );

    expect(pageSource).toContain("Manual payslip edits will be reapplied");
    expect(pageSource).toContain(
      "manually entered\n                          Withholding Tax amounts are not preserved",
    );
    expect(pageSource).toContain("setPayrollRunArchived");
    expect(pageSource).not.toContain("Cost records removed");
    expect(tableSource).toContain("Void payroll");
    expect(tableSource).not.toContain("Revert to Finalized");
    expect(tableSource).toContain('run.status === "draft"');
  });
});
