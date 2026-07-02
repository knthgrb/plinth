import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("alumni access workflow", () => {
  it("guards self payslip details and messages to finalized or paid runs", () => {
    const payrollSource = readSource("../convex/payroll.ts");

    expect(payrollSource).toContain("assertPayslipVisibleToViewer");
    expect(payrollSource).toContain("getVisiblePayslipRunStatusesForViewer");
    expect(payrollSource).toContain(
      "status !== \"finalized\" && status !== \"paid\"",
    );
  });

  it("separates active and past organizations in visible switchers", () => {
    const organizationSwitcherSource = readSource(
      "../components/organization-switcher.tsx",
    );
    const sidebarSource = readSource("../components/layout/sidebar.tsx");
    const employeeSidebarSource = readSource(
      "../components/layout/employee-sidebar.tsx",
    );

    expect(organizationSwitcherSource).toContain("Active organizations");
    expect(organizationSwitcherSource).toContain("Past organizations");
    expect(organizationSwitcherSource).toContain("Alumni");
    expect(sidebarSource).toContain("Past organizations");
    expect(employeeSidebarSource).toContain("Past organizations");
    expect(employeeSidebarSource).toContain("canAccessRoute");
  });

  it("uses the preferred active organization for app entry points", () => {
    const appHomeSource = readSource("../app/page.tsx");
    const organizationIndexSource = readSource(
      "../app/[organizationId]/page.tsx",
    );
    const organizationLayoutSource = readSource(
      "../app/[organizationId]/layout.tsx",
    );
    const organizationContextSource = readSource(
      "../hooks/organization-context.tsx",
    );

    expect(appHomeSource).toContain("selectPreferredOrganizationForEntry");
    expect(organizationIndexSource).toContain("accessStatus === \"alumni\"");
    expect(organizationLayoutSource).toContain(
      "user.accessStatus === \"alumni\"",
    );
    expect(organizationLayoutSource).toContain("/payslips");
    expect(organizationContextSource).toContain(
      "selectPreferredOrganizationForEntry",
    );
    expect(organizationContextSource).toContain("canAccessRoute");
  });
});
