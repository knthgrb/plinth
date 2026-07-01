import { describe, expect, it } from "vitest";
import {
  canUseEmployeeSelfService,
  getEmployeeLifecycleImpact,
} from "@/utils/employee-lifecycle";

describe("employee lifecycle", () => {
  it("allows self-service only for active employees", () => {
    expect(canUseEmployeeSelfService("active")).toBe(true);
    expect(canUseEmployeeSelfService("inactive")).toBe(false);
    expect(canUseEmployeeSelfService("resigned")).toBe(false);
    expect(canUseEmployeeSelfService("terminated")).toBe(false);
  });

  it("explains what each employee lifecycle status changes", () => {
    expect(getEmployeeLifecycleImpact("active")).toMatchObject({
      accessLabel: "Full access",
      login: "Can sign in and use the organization normally.",
      leave: "Can file and approve leave according to role permissions.",
      payslips: "Can view current and historical payslips.",
    });

    expect(getEmployeeLifecycleImpact("inactive")).toMatchObject({
      label: "Suspended",
      accessLabel: "Access suspended",
      login: "Cannot access this organization until reactivated.",
      payroll: "Can remain in payroll history; include in new runs only when selected by payroll policy.",
    });

    expect(getEmployeeLifecycleImpact("resigned")).toMatchObject({
      accessLabel: "Alumni read-only",
      chat: "Chat access is disabled for this organization.",
      payslips: "Can keep read-only access to historical payslips.",
      finalPay: "Should be reviewed for final pay and clearance.",
    });

    expect(getEmployeeLifecycleImpact("terminated")).toMatchObject({
      accessLabel: "Org access disabled",
      login: "Cannot access this organization.",
      payslips: "Historical payroll data is preserved for admins.",
      finalPay: "Should be reviewed for final pay, clearance, and offboarding records.",
    });
  });
});
