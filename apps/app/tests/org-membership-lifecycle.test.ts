import { describe, expect, it } from "vitest";
import {
  canUseFullOrganizationAccess,
  deriveAccessStatusForEmploymentStatus,
  normalizeOrgMembershipAccessStatus,
  selectPreferredOrganizationForEntry,
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

  it("fails closed for an unrecognized membership access status", () => {
    expect(normalizeOrgMembershipAccessStatus("unexpected")).toBe("suspended");
    expect(canUseFullOrganizationAccess("unexpected")).toBe(false);
  });

  it("limits alumni members to historical payslip and document access", () => {
    expect(canAccessRoute("/payslips", "employee", "alumni")).toBe(true);
    expect(canAccessRoute("/documents", "employee", "alumni")).toBe(true);
    expect(canAccessRoute("/documents/new", "employee", "alumni")).toBe(false);
    expect(
      canAccessRoute("/org-id/documents/doc-id/edit", "employee", "alumni"),
    ).toBe(false);
    expect(canAccessRoute("/chat", "employee", "alumni")).toBe(false);
    expect(canAccessRoute("/leave", "employee", "alumni")).toBe(false);
  });

  it("prefers active organizations over alumni organizations for default entry", () => {
    const alumni = {
      _id: "past",
      role: "employee",
      accessStatus: "alumni",
    };
    const active = {
      _id: "active",
      role: "employee",
      accessStatus: "active",
    };

    expect(selectPreferredOrganizationForEntry([alumni, active])?._id).toBe(
      "active",
    );
    expect(selectPreferredOrganizationForEntry([alumni])?._id).toBe("past");
  });

  it("blocks suspended and disabled org memberships from route access", () => {
    expect(canAccessRoute("/dashboard", "owner", "suspended")).toBe(false);
    expect(canAccessRoute("/payroll", "admin", "disabled")).toBe(false);
  });
});
