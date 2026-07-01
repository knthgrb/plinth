import { describe, expect, it } from "vitest";
import {
  canUseFullOrganizationAccess,
  deriveAccessStatusForEmploymentStatus,
  normalizeOrgMembershipAccessStatus,
} from "@/utils/org-membership-lifecycle";
import { canAccessRoute } from "@/utils/role-access";

describe("organization membership lifecycle", () => {
  it("maps employment status to org-scoped access status", () => {
    expect(deriveAccessStatusForEmploymentStatus("active")).toBe("active");
    expect(deriveAccessStatusForEmploymentStatus("inactive")).toBe("suspended");
    expect(deriveAccessStatusForEmploymentStatus("resigned")).toBe("alumni");
    expect(deriveAccessStatusForEmploymentStatus("terminated")).toBe("disabled");
  });

  it("treats missing access status as active for migrated memberships", () => {
    expect(normalizeOrgMembershipAccessStatus(undefined)).toBe("active");
    expect(canUseFullOrganizationAccess(undefined)).toBe(true);
  });

  it("limits alumni members to historical payslip access", () => {
    expect(canAccessRoute("/payslips", "employee", "alumni")).toBe(true);
    expect(canAccessRoute("/documents", "employee", "alumni")).toBe(false);
    expect(canAccessRoute("/chat", "employee", "alumni")).toBe(false);
    expect(canAccessRoute("/leave", "employee", "alumni")).toBe(false);
  });

  it("blocks suspended and disabled org memberships from route access", () => {
    expect(canAccessRoute("/dashboard", "owner", "suspended")).toBe(false);
    expect(canAccessRoute("/payroll", "admin", "disabled")).toBe(false);
  });
});
