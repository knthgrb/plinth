import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("payroll loading state", () => {
  it("uses a page skeleton instead of the clunky loading payroll card", () => {
    const source = readSource(
      "../app/[organizationId]/payroll/payroll-page-client.tsx",
    );

    expect(source).toContain("PayrollPageSkeleton");
    expect(source).not.toContain("Loading payroll");
  });
});
