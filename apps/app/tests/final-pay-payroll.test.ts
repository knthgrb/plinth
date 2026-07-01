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
});
