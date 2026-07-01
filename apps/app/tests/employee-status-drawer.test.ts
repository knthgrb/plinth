import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readAppFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("employee status editing", () => {
  it("exposes employee status in the details drawer edit form", () => {
    const drawerSource = readAppFile(
      "../app/[organizationId]/employees/_components/employee-detail-modal.tsx",
    );

    expect(drawerSource).toContain('name="status"');
    expect(drawerSource).toContain('htmlFor="edit-status"');
    expect(drawerSource).toContain('status: data.status as');
  });

  it("exposes offboarding fields in the details drawer edit form", () => {
    const drawerSource = readAppFile(
      "../app/[organizationId]/employees/_components/employee-detail-modal.tsx",
    );

    expect(drawerSource).toContain('name="separationDate"');
    expect(drawerSource).toContain('name="finalPayStatus"');
    expect(drawerSource).toContain('name="clearanceStatus"');
    expect(drawerSource).toContain("nextEmployment.separationDate");
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

  it("shows the lifecycle impact in the details drawer edit form", () => {
    const drawerSource = readAppFile(
      "../app/[organizationId]/employees/_components/employee-detail-modal.tsx",
    );

    expect(drawerSource).toContain("getEmployeeLifecycleImpact");
    expect(drawerSource).toContain("Lifecycle impact");
  });
});
