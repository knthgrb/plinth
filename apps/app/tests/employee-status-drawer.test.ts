import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { employeeFormSchema } from "../app/[organizationId]/employees/_components/employee-form-validation";

function readAppFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("employee status editing", () => {
  it.each([
    "../app/[organizationId]/employees/page.tsx",
    "../app/[organizationId]/employees/_components/create-employee-dialog.tsx",
  ])("offers explicit account-linking modes in %s", (path) => {
    const source = readAppFile(path);

    expect(source).toContain("Employee record only");
    expect(source).toContain("Link existing organization member");
    expect(source).toContain("Invite a new organization member");
    expect(source).toContain('accountMode !== "employee_only"');
  });

  it("exposes employee status in the details drawer edit form", () => {
    const drawerSource = readAppFile(
      "../app/[organizationId]/employees/_components/employee-detail-modal.tsx",
    );

    expect(drawerSource).toContain('name="status"');
    expect(drawerSource).toContain('htmlFor="edit-status"');
    expect(drawerSource).toContain("status: data.status,");
    expect(drawerSource).toContain('<SelectItem value="separated">');
    expect(drawerSource).toContain('name="separationType"');
  });

  it("keeps offboarding fields outside the employee details form contract", () => {
    const parsed = employeeFormSchema.parse({
      firstName: "Avery",
      lastName: "Santos",
      email: "avery@example.com",
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      status: "active",
      hireDate: "2025-01-01",
      basicSalary: "30000",
      salaryType: "monthly",
      separationDate: "2026-08-01",
      separationReason: "Resigned",
      finalPayStatus: "paid",
      clearanceStatus: "cleared",
    });

    expect(parsed).not.toHaveProperty("separationDate");
    expect(parsed).not.toHaveProperty("separationReason");
    expect(parsed).not.toHaveProperty("finalPayStatus");
    expect(parsed).not.toHaveProperty("clearanceStatus");
  });

  it("does not expose shortcut status actions in the employees table menu", () => {
    const tableSource = readAppFile(
      "../app/[organizationId]/employees/_components/employees-table.tsx",
    );

    expect(tableSource).not.toContain("Reactivate");
    expect(tableSource).not.toContain("Mark as Resigned");
    expect(tableSource).not.toContain("Mark as Terminated");
    expect(tableSource).not.toContain("Remove from Organization");
    expect(tableSource).not.toContain("Remove employee");
  });
});
