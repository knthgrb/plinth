import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("asset custody workflow", () => {
  it("stores assignment, custody, condition, return, and maintenance metadata", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const assetsSource = readSource("../convex/assets.ts");

    expect(schemaSource).toContain("assignedEmployeeId");
    expect(schemaSource).toContain("custodyAcknowledgedAt");
    expect(schemaSource).toContain("returnDueDate");
    expect(schemaSource).toContain("maintenanceHistory");
    expect(schemaSource).toContain('v.literal("good")');
    expect(schemaSource).toContain('v.literal("needs_repair")');
    expect(assetsSource).toContain("assignedEmployeeId: v.optional(");
    expect(assetsSource).toContain("maintenanceHistory: maintenanceHistoryValidator");
  });

  it("lets admins configure custody details in the asset dialog", () => {
    const pageSource = readSource("../app/[organizationId]/assets/page.tsx");

    expect(pageSource).toContain("assignedEmployeeId");
    expect(pageSource).toContain("Assigned Employee");
    expect(pageSource).toContain("Condition");
    expect(pageSource).toContain("Return Due Date");
    expect(pageSource).toContain("Custody acknowledged");
    expect(pageSource).toContain("Maintenance History");
  });
});
