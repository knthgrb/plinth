import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("payroll password guard removal", () => {
  it("does not render payroll password settings", () => {
    const source = readSource("../components/settings/payroll-settings-content.tsx");

    expect(source).not.toContain("Payroll access");
    expect(source).not.toContain("Payroll tab password");
    expect(source).not.toContain("payrollTabPassword");
  });

  it("does not render or run the payroll unlock guard", () => {
    const source = readSource(
      "../app/[organizationId]/payroll/payroll-page-client.tsx",
    );

    expect(source).not.toContain("Unlock Payroll");
    expect(source).not.toContain("payroll-password");
    expect(source).not.toContain("isPayrollUnlocked");
    expect(source).not.toContain("sessionStorage");
  });
});
