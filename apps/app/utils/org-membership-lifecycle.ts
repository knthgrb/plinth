export type EmploymentLifecycleStatus =
  | "active"
  | "resigned"
  | "terminated";

export type OrgMembershipAccessStatus =
  | "active"
  | "suspended"
  | "alumni"
  | "disabled"
  | "removed";

const ACCESS_STATUSES: OrgMembershipAccessStatus[] = [
  "active",
  "suspended",
  "alumni",
  "disabled",
  "removed",
];

export function normalizeOrgMembershipAccessStatus(
  status: string | null | undefined,
): OrgMembershipAccessStatus {
  if (!status) return "active";
  const normalized = status.toLowerCase();
  return ACCESS_STATUSES.includes(normalized as OrgMembershipAccessStatus)
    ? (normalized as OrgMembershipAccessStatus)
    : "suspended";
}

export function canUseFullOrganizationAccess(
  status: string | null | undefined,
): boolean {
  return normalizeOrgMembershipAccessStatus(status) === "active";
}

export function canUseAlumniPayslipAccess(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeOrgMembershipAccessStatus(status);
  return normalized === "active" || normalized === "alumni";
}

export function hasActiveOrganizationAccess(
  status: string | null | undefined,
): boolean {
  return normalizeOrgMembershipAccessStatus(status) === "active";
}

export function hasAlumniOrganizationAccess(
  status: string | null | undefined,
): boolean {
  return normalizeOrgMembershipAccessStatus(status) === "alumni";
}

export function selectPreferredOrganizationForEntry<
  T extends { accessStatus?: string | null },
>(organizations: T[] | null | undefined): T | null {
  if (!organizations || organizations.length === 0) return null;
  return (
    organizations.find((org) => hasActiveOrganizationAccess(org.accessStatus)) ??
    organizations.find((org) => hasAlumniOrganizationAccess(org.accessStatus)) ??
    organizations[0]
  );
}

export function deriveAccessStatusForEmploymentStatus(
  status: EmploymentLifecycleStatus,
): OrgMembershipAccessStatus {
  if (status === "active") return "active";
  return "alumni";
}

export function deriveAccessStatusForEmployeeArchive(
  status: EmploymentLifecycleStatus,
): OrgMembershipAccessStatus {
  return status === "active" ? "disabled" : "alumni";
}

export function resolveMembershipAccessStatusForEmployeeSync(
  currentStatus: string | null | undefined,
  derivedStatus: OrgMembershipAccessStatus,
): OrgMembershipAccessStatus {
  const currentAccessStatus = normalizeOrgMembershipAccessStatus(currentStatus);
  return currentAccessStatus === "removed" || currentAccessStatus === "disabled"
    ? currentAccessStatus
    : derivedStatus;
}
