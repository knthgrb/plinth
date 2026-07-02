import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("payroll regeneration override handling", () => {
  it("tracks delete-sensitive payroll dependencies and exposes stale reasons", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const payrollSource = readSource("../convex/payroll.ts");

    expect(schemaSource).toContain("attendanceRowCount");
    expect(payrollSource).toContain("attendanceRowCount");
    expect(payrollSource).toContain("getDraftDependencyChangeReasons");
    expect(payrollSource).toContain("draftOutdatedReasons");
  });

  it("stores explicit draft override intent in schema", () => {
    const schemaSource = readSource("../convex/schema.ts");

    expect(schemaSource).toContain("nonTaxableAllowanceOverrides");
    expect(schemaSource).toContain("payslipOverrides");
    expect(schemaSource).toContain("variableEarnings");
  });

  it("regeneration uses explicit overrides instead of copying existing payslip lines", () => {
    const payrollSource = readSource("../convex/payroll.ts");

    expect(payrollSource).toContain("syncDraftPayslipOverrides");
    expect(payrollSource).toContain("applyPayslipOverrideToGeneratedPayslip");
    expect(payrollSource).toContain("payslipOverridesByEmployee");
    expect(payrollSource).not.toContain("preservedDeductions = (p.deductions || []).filter");
  });

  it("shows regenerate summary details in the payroll UI", () => {
    const pageSource = readSource("../app/[organizationId]/payroll/payroll-page-client.tsx");

    expect(pageSource).toContain("regenerationSummary");
    expect(pageSource).toContain("manual override");
    expect(pageSource).toContain("stale reason");
  });

  it("requires review when manual overrides are auto reapplied", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const payrollSource = readSource("../convex/payroll.ts");
    const pageSource = readSource("../app/[organizationId]/payroll/payroll-page-client.tsx");
    const runsTableSource = readSource("../app/[organizationId]/payroll/_components/payroll-runs-table.tsx");
    const payslipsDialogSource = readSource("../app/[organizationId]/payroll/_components/view-payslips-dialog.tsx");

    expect(schemaSource).toContain("overrideReview");
    expect(payrollSource).toContain("buildOverrideReviewFromPayslipOverrides");
    expect(payrollSource).toContain("assertDraftOverrideReviewCompleteForFinalize");
    expect(payrollSource).toContain("markPayrollRunOverrideReviewComplete");
    expect(pageSource).toContain("markPayrollRunOverrideReviewComplete");
    expect(runsTableSource).toContain("Needs override review");
    expect(payslipsDialogSource).toContain("Auto reapplied");
    expect(payslipsDialogSource).toContain("Mark reviewed");
  });
});
