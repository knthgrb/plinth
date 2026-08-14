import { describe, expect, it } from "vitest";
import {
  getAvailableEmployeeLinkMembers,
  resolveEmployeeEmailField,
} from "@/utils/employee-account-linking";

describe("employee account linking", () => {
  it("allows email entry only for employee-only records", () => {
    expect(
      resolveEmployeeEmailField(
        { kind: "employee_only" },
        { employeeEmail: "employee@example.com" },
      ),
    ).toEqual({ email: "employee@example.com", readOnly: false });
  });

  it("inherits and locks an existing member account email", () => {
    expect(
      resolveEmployeeEmailField(
        { kind: "link_member", userId: "user-1" },
        {
          employeeEmail: "ignored@example.com",
          selectedMemberEmail: "Member@Example.com",
        },
      ),
    ).toEqual({ email: "Member@Example.com", readOnly: true });
  });

  it("inherits and locks the invitation email", () => {
    expect(
      resolveEmployeeEmailField(
        { kind: "invite_member", email: "invite@example.com" },
        { employeeEmail: "ignored@example.com" },
      ),
    ).toEqual({ email: "invite@example.com", readOnly: true });
  });

  it("offers only active members without an employee link", () => {
    const available = getAvailableEmployeeLinkMembers([
      {
        _id: "active-unlinked",
        email: "available@example.com",
        accessStatus: "active",
      },
      {
        _id: "active-linked",
        email: "linked@example.com",
        accessStatus: "active",
        employeeId: "employee-1",
      },
      {
        _id: "alumni-unlinked",
        email: "alumni@example.com",
        accessStatus: "alumni",
      },
    ]);

    expect(available.map((member) => member._id)).toEqual([
      "active-unlinked",
    ]);
  });
});
