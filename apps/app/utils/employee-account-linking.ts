export type EmployeeAccountAccess =
  | { kind: "employee_only" }
  | { kind: "link_member"; userId: string }
  | { kind: "invite_member"; email: string };

export type EmployeeLinkMember = {
  _id: string;
  email?: string;
  name?: string;
  accessStatus?: string | null;
  employeeId?: string | null;
};

export function resolveEmployeeEmailField(
  accountAccess: EmployeeAccountAccess,
  values: {
    employeeEmail: string;
    selectedMemberEmail?: string;
  },
): { email: string; readOnly: boolean } {
  if (accountAccess.kind === "employee_only") {
    return { email: values.employeeEmail, readOnly: false };
  }
  if (accountAccess.kind === "link_member") {
    return { email: values.selectedMemberEmail ?? "", readOnly: true };
  }
  return { email: accountAccess.email, readOnly: true };
}

export function getAvailableEmployeeLinkMembers<T extends EmployeeLinkMember>(
  members: T[] | null | undefined,
): T[] {
  return (members ?? []).filter(
    (member) =>
      member.accessStatus === "active" &&
      !member.employeeId &&
      Boolean(member.email?.trim()),
  );
}
