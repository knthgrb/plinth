import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("final settlement workspace", () => {
  it("stores settlement workflow state in Convex schema", () => {
    const schema = readSource("../convex/schema.ts");

    expect(schema).toContain("finalSettlements: defineTable");
    expect(schema).toContain("clearanceItems");
    expect(schema).toContain("loanPayoffs");
    expect(schema).toContain("customDeductions");
    expect(schema).toContain("bir2316");
    expect(schema).toContain("finalTaxRelease");
    expect(schema).toContain('v.literal("ready_for_payroll")');
    expect(schema).toContain('v.literal("payroll_generated")');
    expect(schema).toContain('v.literal("released")');
    expect(schema).toContain(".index(\"by_organization_status\"");
  });

  it("exposes settlement workflow mutations", () => {
    const settlements = readSource("../convex/finalSettlements.ts");

    expect(settlements).toContain("getFinalSettlements");
    expect(settlements).toContain("prepareFinalSettlement");
    expect(settlements).toContain("updateClearanceItem");
    expect(settlements).toContain("upsertLoanPayoff");
    expect(settlements).toContain("upsertCustomDeduction");
    expect(settlements).toContain("markFinalSettlementReadyForPayroll");
    expect(settlements).toContain("markBir2316Released");
    expect(settlements).toContain("markFinalTaxReviewed");
  });

  it("pulls approved final settlement deductions into final-pay payroll", () => {
    const payroll = readSource("../convex/payroll.ts");

    expect(payroll).toContain("loadFinalSettlementForPayroll");
    expect(payroll).toContain("mergeFinalSettlementDeductions");
    expect(payroll).toContain("assertFinalSettlementReadyForPayroll");
    expect(payroll).toContain("buildFinalSettlementPayrollDeductions");
    expect(payroll).toContain("Final settlement must be ready for payroll");
    expect(payroll).toContain("syncFinalSettlementStatusForRun");
  });

  it("adds a dedicated Final Settlements tab under Payroll", () => {
    const page = readSource("../app/[organizationId]/payroll/payroll-page-client.tsx");
    const tab = readSource(
      "../app/[organizationId]/payroll/_components/final-settlements-tab.tsx",
    );

    expect(page).toContain("FinalSettlementsTab");
    expect(page).toContain('"final_settlements"');
    expect(page).toContain('value="final_settlements"');
    expect(tab).toContain("api.finalSettlements");
    expect(tab).toContain("Prepare settlement");
    expect(tab).toContain("Clearance");
    expect(tab).toContain("Loan payoff");
    expect(tab).toContain("BIR 2316");
    expect(tab).toContain("Final tax");
  });
});
