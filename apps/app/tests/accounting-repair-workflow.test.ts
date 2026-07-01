import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("accounting repair workflow", () => {
  it("stores source metadata for generated accounting records", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const payrollSource = readSource("../convex/payroll.ts");

    expect(schemaSource).toContain("sourceType");
    expect(schemaSource).toContain("sourceKey");
    expect(schemaSource).toContain("sourceUpdatedAt");
    expect(payrollSource).toContain('sourceType: "payroll_run"');
    expect(payrollSource).toContain("sourceKey");
  });

  it("exposes an idempotent payroll accounting repair path", () => {
    const accountingSource = readSource("../convex/accounting.ts");
    const actionsSource = readSource("../actions/accounting.ts");
    const serviceSource = readSource("../services/accounting-service.ts");
    const pageSource = readSource("../app/[organizationId]/accounting/page.tsx");

    expect(accountingSource).toContain("repairPayrollAccounting");
    expect(accountingSource).toContain("findPayrollAccountingDrift");
    expect(accountingSource).toContain("sourceKey");
    expect(actionsSource).toContain("repairPayrollAccounting");
    expect(serviceSource).toContain("repairPayrollAccounting");
    expect(pageSource).toContain("Repair payroll accounting");
  });
});
