import {
  normalizeOrganizationRole,
  type OrganizationRole,
} from "@/utils/organization-roles";

const ATTENDANCE_IMPORT_ROLES = new Set<OrganizationRole>([
  "owner",
  "admin",
  "hr",
  "manager",
]);

export function canTransformAttendanceImport(user: {
  role?: string;
  accessStatus?: string;
} | null): boolean {
  const role = normalizeOrganizationRole(user?.role);

  return Boolean(
    user &&
      user.accessStatus === "active" &&
      role &&
      ATTENDANCE_IMPORT_ROLES.has(role),
  );
}
