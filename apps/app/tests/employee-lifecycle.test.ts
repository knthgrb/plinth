import { describe, expect, it } from "vitest";
import {
  canRehireEmployee,
  canUseEmployeeSelfService,
  getEmployeeLifecycleImpact,
} from "@/utils/employee-lifecycle";
import {
  getSeparationTypeLabel,
  isEmployeeSeparated,
  normalizeEmploymentStatus,
  resolveSeparationType,
  type SeparationType,
} from "@/utils/employment-lifecycle";

describe("employee lifecycle", () => {
  it("normalizes canonical and legacy separation states", () => {
    expect(normalizeEmploymentStatus("active")).toBe("active");
    expect(normalizeEmploymentStatus("separated")).toBe("separated");
    expect(normalizeEmploymentStatus("resigned")).toBe("separated");
    expect(normalizeEmploymentStatus("terminated")).toBe("separated");
    expect(isEmployeeSeparated("resigned")).toBe(true);
    expect(isEmployeeSeparated("unexpected")).toBe(false);
  });

  it("derives separation categories for legacy records", () => {
    expect(resolveSeparationType("resigned")).toBe("resignation");
    expect(resolveSeparationType("terminated")).toBe("termination");
    expect(resolveSeparationType("separated", "job_abandonment")).toBe(
      "job_abandonment",
    );
    expect(resolveSeparationType("active", "retirement")).toBeNull();
  });

  it("labels every supported separation category", () => {
    const expected: Record<SeparationType, string> = {
      resignation: "Resignation",
      termination: "Termination",
      job_abandonment: "Job abandonment",
      end_of_contract: "End of contract",
      retirement: "Retirement",
      redundancy: "Redundancy",
      mutual_separation: "Mutual separation",
      death: "Death",
      transfer: "Transfer",
      other: "Other",
    };

    for (const [type, label] of Object.entries(expected)) {
      expect(getSeparationTypeLabel(type as SeparationType)).toBe(label);
    }
  });

  it("requires an explicit rehire flow for separated employees", () => {
    expect(canRehireEmployee("active")).toBe(false);
    expect(canRehireEmployee("separated")).toBe(true);
    expect(canRehireEmployee("resigned")).toBe(true);
    expect(canRehireEmployee("terminated")).toBe(true);
  });

  it("allows self-service only for active employees", () => {
    expect(canUseEmployeeSelfService("active")).toBe(true);
    expect(canUseEmployeeSelfService("separated")).toBe(false);
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
      finalPay:
        "Should be reviewed for final pay, clearance, and offboarding records.",
    });
  });
});
