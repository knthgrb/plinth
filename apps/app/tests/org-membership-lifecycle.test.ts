import { describe, expect, it } from "vitest";
import {
  canUseFullOrganizationAccess,
  deriveAccessStatusForEmployeeArchive,
  deriveAccessStatusForEmploymentStatus,
  normalizeOrgMembershipAccessStatus,
  resolveMembershipAccessStatusForEmployeeSync,
  selectPreferredOrganizationForEntry,
} from "@/utils/org-membership-lifecycle";
import { canAccessRoute } from "@/utils/role-access";

describe("organization membership lifecycle", () => {
  it("maps employment status to org-scoped access status", () => {
    expect(deriveAccessStatusForEmploymentStatus("active")).toBe("active");
    expect(deriveAccessStatusForEmploymentStatus("separated")).toBe("alumni");
    expect(deriveAccessStatusForEmploymentStatus("resigned")).toBe("alumni");
    expect(deriveAccessStatusForEmploymentStatus("terminated")).toBe("alumni");
  });

  it("preserves alumni history when separated employee records are archived", () => {
    expect(deriveAccessStatusForEmployeeArchive("resigned")).toBe("alumni");
    expect(deriveAccessStatusForEmployeeArchive("terminated")).toBe("alumni");
    expect(deriveAccessStatusForEmployeeArchive("separated")).toBe("alumni");
    expect(deriveAccessStatusForEmployeeArchive("active")).toBe("suspended");
  });

  it("normalizes legacy disabled memberships to suspended", () => {
    expect(normalizeOrgMembershipAccessStatus("disabled")).toBe("suspended");
    expect(
      resolveMembershipAccessStatusForEmployeeSync("disabled", "active"),
    ).toBe("suspended");
  });

  it("keeps suspension while employment is active but becomes alumni on separation", () => {
    expect(
      resolveMembershipAccessStatusForEmployeeSync("suspended", "active"),
    ).toBe("suspended");
    expect(
      resolveMembershipAccessStatusForEmployeeSync("suspended", "alumni"),
    ).toBe("alumni");
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
