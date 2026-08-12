export const ORGANIZATION_ROLES = [
  "admin",
  "owner",
  "hr",
  "manager",
  "employee",
  "accounting",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export type IdentityMigrationIssueCode =
  | "AMBIGUOUS_GLOBAL_INACTIVE_USER"
  | "DUPLICATE_INVITATION_TOKEN_HASH"
  | "DUPLICATE_PAYSLIP_CREDENTIAL"
  | "DUPLICATE_USER_MEMBERSHIP"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_ORGANIZATION_MISMATCH"
  | "INVITATION_TOKEN_HASH_MISMATCH"
  | "LAST_ACTIVE_ORGANIZATION_NOT_FOUND"
  | "MEMBERSHIP_EMPLOYEE_MISMATCH"
  | "MEMBERSHIP_ROLE_MISMATCH"
  | "MISSING_INVITATION_TOKEN"
  | "MISSING_LEGACY_ROLE"
  | "ORGANIZATION_NOT_FOUND"
  | "PAYSLIP_CREDENTIAL_MISMATCH"
  | "UNEXPECTED_PAYSLIP_CREDENTIAL";

export type IdentityMigrationIssue = {
  code: IdentityMigrationIssueCode;
  field: string;
};

export type IdentityPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "skipped" }
  | { outcome: "conflict"; issues: IdentityMigrationIssue[] };

export type LegacyUserIdentity = {
  organizationId?: string;
  role?: OrganizationRole;
  employeeId?: string;
  isActive?: boolean;
  lastActiveOrganizationId?: string;
};

export type ExistingUserMembership = {
  organizationId: string;
  role: OrganizationRole;
  employeeId?: string;
  accessStatus?: "active" | "suspended" | "alumni" | "disabled" | "removed";
};

export type PlannedUserMembership = {
  organizationId: string;
  role: OrganizationRole;
  employeeId?: string;
  accessStatus: "active";
};

export type PayslipCredentialDestination = {
  organizationId: string;
  employeeId: string;
  credentialHash: string;
};

export type PlannedPayslipCredential = PayslipCredentialDestination & {
  credentialVersion: 1;
  migrationVersion: 1;
};

export type PlannedInvitationTokenHash = {
  tokenHash: string;
};
