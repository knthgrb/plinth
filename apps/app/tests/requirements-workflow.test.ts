import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("requirements workflow hardening", () => {
  it("stores default policy metadata and employee verification audit metadata", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const organizationsSource = readSource("../convex/organizations.ts");
    const employeesSource = readSource("../convex/employees.ts");

    expect(schemaSource).toContain("appliesToDepartments");
    expect(schemaSource).toContain("appliesToEmploymentTypes");
    expect(schemaSource).toContain("reminderDaysBeforeDue");
    expect(schemaSource).toContain("requiresVerification");
    expect(schemaSource).toContain("expiryDaysAfterSubmission");
    expect(schemaSource).toContain("verifiedAt");
    expect(schemaSource).toContain("verifiedBy");
    expect(schemaSource).toContain("verificationNotes");
    expect(schemaSource).toContain("rejectedAt");
    expect(schemaSource).toContain("rejectionReason");
    expect(schemaSource).toContain("reminderSentAt");
    expect(organizationsSource).toContain("buildEmployeeRequirementFromDefault");
    expect(employeesSource).toContain("verifiedAt = now");
    expect(employeesSource).toContain("verificationNotes");
  });

  it("lets admins configure applicability and reminder rules in default requirements", () => {
    const dialogSource = readSource(
      "../app/[organizationId]/requirements/_components/default-requirements-dialog.tsx",
    );

    expect(dialogSource).toContain("Required");
    expect(dialogSource).toContain("Verification required");
    expect(dialogSource).toContain("Applies to departments");
    expect(dialogSource).toContain("Applies to employment types");
    expect(dialogSource).toContain("Reminder days before due");
    expect(dialogSource).toContain("Expiry days after submission");
  });
});
