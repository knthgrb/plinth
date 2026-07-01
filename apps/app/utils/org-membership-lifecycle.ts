export type EmploymentLifecycleStatus =
  | "active"
  | "inactive"
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
    : "active";
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

export function deriveAccessStatusForEmploymentStatus(
  status: EmploymentLifecycleStatus,
): OrgMembershipAccessStatus {
  if (status === "active") return "active";
  if (status === "inactive") return "suspended";
  if (status === "resigned") return "alumni";
  return "disabled";
}
