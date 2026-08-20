import { describe, expect, it } from "vitest";
import {
  LAST_OWNER_ROLE_CHANGE_MESSAGE,
  canRemoveOrganizationMember,
  canUpdateOrganizationMemberRole,
  getAssignableOrganizationRoleOptions,
  getDisplayOrganizationRole,
} from "@/utils/organization-roles";

describe("organization roles", () => {
  it("displays owner and admin as distinct roles", () => {
    expect(getDisplayOrganizationRole("owner")).toBe("Owner");
    expect(getDisplayOrganizationRole("admin")).toBe("Admin");
  });

  it("lets owners assign owner and admin roles", () => {
    expect(getAssignableOrganizationRoleOptions("owner")).toEqual([
      { value: "owner", label: "Owner" },
      { value: "admin", label: "Admin" },
      { value: "hr", label: "HR" },
      { value: "manager", label: "Manager" },
      { value: "accounting", label: "Accounting" },
      { value: "employee", label: "Employee" },
    ]);
  });

  it("does not let admins assign owner or admin roles", () => {
    const adminOptions = getAssignableOrganizationRoleOptions("admin");

    expect(adminOptions.map((option) => option.value)).toEqual([
      "hr",
      "manager",
      "accounting",
      "employee",
    ]);
  });

  it("limits HR to assigning manager and employee roles", () => {
    expect(
      getAssignableOrganizationRoleOptions("hr").map((option) => option.value),
    ).toEqual(["manager", "employee"]);

    expect(
      canUpdateOrganizationMemberRole({
        actorRole: "hr",
        targetRole: "employee",
        nextRole: "accounting",
        isSelf: false,
        ownerCount: 1,
      }),
    ).toEqual({
      allowed: false,
      reason: "Not authorized to update this role.",
    });
  });

  it("blocks an only owner from changing their own owner role", () => {
    expect(
      canUpdateOrganizationMemberRole({
        actorRole: "owner",
        targetRole: "owner",
        nextRole: "admin",
        isSelf: true,
        ownerCount: 1,
      }),
    ).toEqual({
      allowed: false,
      reason: LAST_OWNER_ROLE_CHANGE_MESSAGE,
    });
  });

  it("allows an owner to promote another member to owner", () => {
    expect(
      canUpdateOrganizationMemberRole({
        actorRole: "owner",
        targetRole: "employee",
        nextRole: "owner",
        isSelf: false,
        ownerCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  it("prevents admins from removing owners", () => {
    expect(
      canRemoveOrganizationMember({
        actorRole: "admin",
        targetRole: "owner",
        isSelf: false,
        ownerCount: 2,
      }),
    ).toEqual({
      allowed: false,
      reason: "Only owners can remove owners.",
    });
  });
});
