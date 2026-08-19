import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocumentTitleFromFileName } from "../lib/document-utils";

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

  it("keeps file upload single-file and management-only", () => {
    const pageSource = readSource("../app/[organizationId]/documents/page.tsx");

    expect(pageSource).toContain("Upload File");
    expect(pageSource).not.toContain("Upload Files");
    expect(pageSource).not.toContain("multiple");
    expect(pageSource).not.toContain("Document location");
    expect(pageSource).not.toContain("Employee access");
    expect(pageSource).not.toContain("Enter file title");
    expect(pageSource).toContain('visibilityScope: "admins_only"');
    expect(pageSource).toContain("canWriteDocuments");
    expect(pageSource).toContain("No documents are available.");
  });

  it("uses the complete filename as an uploaded document title", () => {
    expect(getDocumentTitleFromFileName("Garbo, Kenneth - Resume (1).pdf"))
      .toBe("Garbo, Kenneth - Resume (1).pdf");
  });
});
