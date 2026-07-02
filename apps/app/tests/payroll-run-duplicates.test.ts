import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("payroll run duplicate period guard", () => {
  it("blocks active duplicate payroll runs for the same org, type, and cutoff", () => {
    const source = readSource("../convex/payroll.ts");

    expect(source).toContain("assertNoDuplicatePayrollRunForPeriod");
    expect(source).toContain("existingRun.cutoffStart === args.cutoffStart");
    expect(source).toContain("existingRun.cutoffEnd === args.cutoffEnd");
    expect(source).toContain("(existingRun.runType ?? \"regular\") === runType");
    expect(source).toContain("existingRun._id !== args.excludePayrollRunId");
    expect(source).toContain("existingRun.status !== \"cancelled\"");
    expect(source).toContain("existingRun.status !== \"archived\"");
    expect(source).toContain("excludePayrollRunId: args.payrollRunId");
    expect(source).toContain(
      "A payroll run already exists for this cutoff period.",
    );
  });

  it("does not run the duplicate guard when regenerating an unchanged draft run", () => {
    const source = readSource("../convex/payroll.ts");

    expect(source).toContain("const cutoffChanged =");
    expect(source).toContain("nextCutoffStart !== payrollRun.cutoffStart");
    expect(source).toContain("nextCutoffEnd !== payrollRun.cutoffEnd");
    expect(source).toMatch(
      /if\s*\(\s*cutoffChanged\s*\)\s*{\s*await assertNoDuplicatePayrollRunForPeriod/,
    );
  });
});
