export type OrganizationRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "accounting"
  | "employee";

export type OrganizationRoleOption = {
  value: OrganizationRole;
  label: string;
};

export type RoleDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export const LAST_OWNER_ROLE_CHANGE_MESSAGE =
  "There should be another owner of this organization before you can change your role.";

const OWNER_REMOVAL_MESSAGE =
  "There should be another owner of this organization before this owner can be removed.";

const ROLE_OPTIONS: OrganizationRoleOption[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "hr", label: "HR" },
  { value: "manager", label: "Manager" },
  { value: "accounting", label: "Accounting" },
  { value: "employee", label: "Employee" },
];

const ADMIN_ASSIGNABLE_ROLES: OrganizationRole[] = [
  "hr",
  "manager",
  "accounting",
  "employee",
];

const HR_ASSIGNABLE_ROLES: OrganizationRole[] = [
  "hr",
  "manager",
  "accounting",
  "employee",
];

export function normalizeOrganizationRole(
  role: string | null | undefined,
): OrganizationRole | null {
  if (!role) return null;
  const normalized = role.toLowerCase();
  return ROLE_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as OrganizationRole)
    : null;
}

export function getDisplayOrganizationRole(
  role: string | null | undefined,
): string {
  const normalized = normalizeOrganizationRole(role);
  return (
    ROLE_OPTIONS.find((option) => option.value === normalized)?.label ?? "User"
  );
}

export function getAssignableOrganizationRoleOptions(
  actorRole: string | null | undefined,
): OrganizationRoleOption[] {
  const normalized = normalizeOrganizationRole(actorRole);
  if (normalized === "owner") return ROLE_OPTIONS;
  if (normalized === "admin") {
    return ROLE_OPTIONS.filter((option) =>
      ADMIN_ASSIGNABLE_ROLES.includes(option.value),
    );
  }
  if (normalized === "hr") {
    return ROLE_OPTIONS.filter((option) =>
      HR_ASSIGNABLE_ROLES.includes(option.value),
    );
  }
  return [];
}

export function canUpdateOrganizationMemberRole({
  actorRole,
  targetRole,
  nextRole,
  isSelf,
  ownerCount,
}: {
  actorRole: string | null | undefined;
  targetRole: string | null | undefined;
  nextRole: string | null | undefined;
  isSelf: boolean;
  ownerCount: number;
}): RoleDecision {
  const actor = normalizeOrganizationRole(actorRole);
  const target = normalizeOrganizationRole(targetRole);
  const next = normalizeOrganizationRole(nextRole);

  if (!actor || !target || !next) {
    return { allowed: false, reason: "Invalid organization role." };
  }

  if (isSelf && actor !== "owner") {
    return { allowed: false, reason: "You cannot change your own role." };
  }

  if (target === "owner" && next !== "owner" && ownerCount <= 1) {
    return { allowed: false, reason: LAST_OWNER_ROLE_CHANGE_MESSAGE };
  }

  if (actor === "owner") return { allowed: true };

  if (target === "owner" || next === "owner") {
    return { allowed: false, reason: "Only owners can manage owner roles." };
  }

  if (next === "admin") {
    return { allowed: false, reason: "Only owners can assign admin roles." };
  }

  const assignableRoles =
    actor === "admin"
      ? ADMIN_ASSIGNABLE_ROLES
      : actor === "hr"
        ? HR_ASSIGNABLE_ROLES
        : [];

  if (!assignableRoles.includes(next)) {
    return { allowed: false, reason: "Not authorized to update this role." };
  }

  return { allowed: true };
}

export function canRemoveOrganizationMember({
  actorRole,
  targetRole,
  isSelf,
  ownerCount,
}: {
  actorRole: string | null | undefined;
  targetRole: string | null | undefined;
  isSelf: boolean;
  ownerCount: number;
}): RoleDecision {
  const actor = normalizeOrganizationRole(actorRole);
  const target = normalizeOrganizationRole(targetRole);

  if (!actor || !target) {
    return { allowed: false, reason: "Invalid organization role." };
  }

  if (isSelf) {
    return { allowed: false, reason: "Cannot remove yourself from organization." };
  }

  if (target === "owner" && ownerCount <= 1) {
    return { allowed: false, reason: OWNER_REMOVAL_MESSAGE };
  }

  if (actor === "owner") return { allowed: true };

  if (target === "owner") {
    return { allowed: false, reason: "Only owners can remove owners." };
  }

  if (target === "admin") {
    return { allowed: false, reason: "Only owners can remove admins." };
  }

  if (actor === "admin") return { allowed: true };

  return { allowed: false, reason: "Not authorized to remove this member." };
}
