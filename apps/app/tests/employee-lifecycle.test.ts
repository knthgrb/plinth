import { describe, expect, it } from "vitest";
import {
  canRehireEmployee,
  canUseEmployeeSelfService,
  getEmployeeLifecycleImpact,
} from "@/utils/employee-lifecycle";

describe("employee lifecycle", () => {
  it("requires an explicit rehire flow for separated employees", () => {
    expect(canRehireEmployee("active")).toBe(false);
    expect(canRehireEmployee("resigned")).toBe(true);
    expect(canRehireEmployee("terminated")).toBe(true);
  });

  it("allows self-service only for active employees", () => {
    expect(canUseEmployeeSelfService("active")).toBe(true);
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

    expect(getEmployeeLifecycleImpact("resigned")).toMatchObject({
      accessLabel: "Alumni read-only",
      chat: "Chat access is disabled for this organization.",
      payslips: "Can keep read-only access to historical payslips.",
      finalPay: "Should be reviewed for final pay and clearance.",
    });

    expect(getEmployeeLifecycleImpact("terminated")).toMatchObject({
      accessLabel: "Alumni read-only",
      login: "Can only access alumni-allowed history for this organization.",
      payslips: "Can keep read-only access to historical payslips.",
      finalPay: "Should be reviewed for final pay, clearance, and offboarding records.",
    });
  });
});
