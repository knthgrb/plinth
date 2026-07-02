import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readAppFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("final pay payroll workflow", () => {
  it("supports final pay as a payroll run type", () => {
    const schema = readAppFile("../convex/schema.ts");
    const payroll = readAppFile("../convex/payroll.ts");

    expect(schema).toContain('v.literal("final_pay")');
    expect(payroll).toContain('v.literal("final_pay")');
    expect(payroll).toContain('runType === "final_pay"');
  });

  it("requires separated employees for final pay runs", () => {
    const payroll = readAppFile("../convex/payroll.ts");

    expect(payroll).toContain("isFinalPayEligibleEmployee");
    expect(payroll).toContain("Select at least one separated employee.");
  });

  it("adds PH final pay components and clearance gate", () => {
    const payroll = readAppFile("../convex/payroll.ts");

    expect(payroll).toContain("assertFinalPayClearanceReadyForRelease");
    expect(payroll).toContain("assertFinalSettlementReadyForPayroll");
    expect(payroll).toContain("13th Month Accrual");
    expect(payroll).toContain("Unused Leave Conversion");
    expect(payroll).toContain("buildFinalSettlementPayrollDeductions");
  });

  it("stores monetary before and after summaries on payslip correction rows", () => {
    const payroll = readAppFile("../convex/payroll.ts");
    const schema = readAppFile("../convex/schema.ts");

    expect(schema).toContain("oldNetPay");
    expect(schema).toContain("newNetPay");
    expect(schema).toContain("deltaNetPay");
    expect(payroll).toContain("buildPayslipCorrectionAuditSummary");
  });
});
