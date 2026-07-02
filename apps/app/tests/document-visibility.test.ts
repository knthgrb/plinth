import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("document visibility scopes", () => {
  it("models scoped document visibility in schema and backend access checks", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const documentsSource = readSource("../convex/documents.ts");

    expect(schemaSource).toContain("visibilityScope: v.optional(");
    expect(schemaSource).toContain('v.literal("admins_only")');
    expect(schemaSource).toContain('v.literal("all_employees")');
    expect(schemaSource).toContain('v.literal("department")');
    expect(schemaSource).toContain('v.literal("specific_employee")');
    expect(schemaSource).toContain('v.literal("alumni_visible")');
    expect(schemaSource).toContain('v.literal("payroll_visible")');
    expect(documentsSource).toContain("canViewDocument");
    expect(documentsSource).toContain("doc.visibilityScope ??");
    expect(documentsSource).toContain("canUseAlumniPayslipAccess");
    expect(documentsSource).toContain("assertDocumentWriteAccess");
    expect(
      documentsSource.match(/assertDocumentWriteAccess\(userRecord\)/g) ?? [],
    ).toHaveLength(3);
    expect(
      documentsSource.indexOf(
        "!canUseFullOrganizationAccess(userRecord.accessStatus)",
      ),
    ).toBeLessThan(
      documentsSource.indexOf("canViewAllDocumentsInOrg(userRecord.role)"),
    );
  });

  it("lets uploaded documents choose a visibility scope", () => {
    const pageSource = readSource("../app/[organizationId]/documents/page.tsx");

    expect(pageSource).toContain("visibilityScope");
    expect(pageSource).toContain("Visibility");
    expect(pageSource).toContain("Admins only");
    expect(pageSource).toContain("All employees");
    expect(pageSource).toContain("Payroll-visible");
    expect(pageSource).toContain("Alumni-visible");
    expect(pageSource).toContain("canWriteDocuments");
  });
});
