import { hashInvitationToken } from "./invitationTokenHash";
import type {
  ExistingUserMembership,
  IdentityMigrationIssue,
  IdentityPlan,
  LegacyUserIdentity,
  PayslipCredentialDestination,
  PlannedInvitationTokenHash,
  PlannedPayslipCredential,
  PlannedUserMembership,
} from "./identityMigrationTypes";

export const IDENTITY_CREDENTIALS_MIGRATION_KEY =
  "full-schema-identity-credentials";
export const IDENTITY_CREDENTIALS_MIGRATION_VERSION = 1;

type EmployeeLifecycleStatus =
  | "active"
  | "inactive"
  | "separated"
  | "resigned"
  | "terminated";

function accessStatusForEmployee(
  status: EmployeeLifecycleStatus | undefined,
): PlannedUserMembership["accessStatus"] {
  if (status === "inactive") return "alumni";
  if (status === "separated") return "alumni";
  if (status === "resigned") return "alumni";
  if (status === "terminated") return "alumni";
  return "active";
}

function conflict<T>(
  code: IdentityMigrationIssue["code"],
  field: string,
): IdentityPlan<T> {
  return { outcome: "conflict", issues: [{ code, field }] };
}

export function planLegacyUserMembership(args: {
  user: LegacyUserIdentity;
  memberships: ExistingUserMembership[];
  organizationExists: boolean;
  employee: {
    id: string;
    organizationId: string;
    employmentStatus?: EmployeeLifecycleStatus;
  } | null;
  lastActiveOrganizationExists: boolean;
}): IdentityPlan<PlannedUserMembership> {
  const { user } = args;

  if (
    user.lastActiveOrganizationId !== undefined &&
    !args.lastActiveOrganizationExists
  ) {
    return conflict(
      "LAST_ACTIVE_ORGANIZATION_NOT_FOUND",
      "lastActiveOrganizationId",
    );
  }

  if (!user.organizationId) return { outcome: "skipped" };
  if (!args.organizationExists) {
    return conflict("ORGANIZATION_NOT_FOUND", "organizationId");
  }
  if (!user.role) return conflict("MISSING_LEGACY_ROLE", "role");
  if (user.employeeId && !args.employee) {
    return conflict("EMPLOYEE_NOT_FOUND", "employeeId");
  }
  if (
    args.employee &&
    (args.employee.id !== user.employeeId ||
      args.employee.organizationId !== user.organizationId)
  ) {
    return conflict("EMPLOYEE_ORGANIZATION_MISMATCH", "employeeId");
  }

  const matchingMemberships = args.memberships.filter(
    (membership) => membership.organizationId === user.organizationId,
  );
  if (matchingMemberships.length > 1) {
    return conflict("DUPLICATE_USER_MEMBERSHIP", "organizationId");
  }

  const existing = matchingMemberships[0];
  const expectedAccessStatus = accessStatusForEmployee(
    args.employee?.employmentStatus,
  );
  if (!existing) {
    if (user.isActive === false && expectedAccessStatus === "active") {
      return conflict("AMBIGUOUS_GLOBAL_INACTIVE_USER", "isActive");
    }
    return {
      outcome: "create",
      value: {
        organizationId: user.organizationId,
        role: user.role,
        ...(user.employeeId ? { employeeId: user.employeeId } : {}),
        accessStatus: expectedAccessStatus,
      },
    };
  }
  if (existing.role !== user.role) {
    return conflict("MEMBERSHIP_ROLE_MISMATCH", "role");
  }
  if (existing.employeeId !== user.employeeId) {
    return conflict("MEMBERSHIP_EMPLOYEE_MISMATCH", "employeeId");
  }
  if (
    args.employee?.employmentStatus &&
    (existing.accessStatus ?? "active") !== expectedAccessStatus
  ) {
    return conflict("MEMBERSHIP_ACCESS_STATUS_MISMATCH", "accessStatus");
  }
  if (user.isActive === false) {
    if (existing.accessStatus && existing.accessStatus !== "active") {
      return { outcome: "unchanged" };
    }
    return conflict("AMBIGUOUS_GLOBAL_INACTIVE_USER", "isActive");
  }
  return { outcome: "unchanged" };
}

export function planPayslipCredential(args: {
  organizationId: string;
  employeeId: string;
  legacyCredentialHash?: string;
  destinations: PayslipCredentialDestination[];
}): IdentityPlan<PlannedPayslipCredential> {
  if (args.destinations.length > 1) {
    return conflict("DUPLICATE_PAYSLIP_CREDENTIAL", "employeeId");
  }

  const legacyCredentialHash = args.legacyCredentialHash;
  if (!legacyCredentialHash?.trim()) {
    if (args.destinations.length === 1) {
      return conflict("UNEXPECTED_PAYSLIP_CREDENTIAL", "employeeId");
    }
    return { outcome: "skipped" };
  }

  const existing = args.destinations[0];
  if (!existing) {
    return {
      outcome: "create",
      value: {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        credentialHash: legacyCredentialHash,
        credentialVersion: 1,
        migrationVersion: IDENTITY_CREDENTIALS_MIGRATION_VERSION,
      },
    };
  }
  if (
    existing.organizationId !== args.organizationId ||
    existing.employeeId !== args.employeeId ||
    existing.credentialHash !== legacyCredentialHash
  ) {
    return conflict("PAYSLIP_CREDENTIAL_MISMATCH", "credentialHash");
  }
  return { outcome: "unchanged" };
}

export function planInvitationTokenHash(args: {
  token?: string;
  tokenHash?: string;
  hashedTokenMatchCount: number;
}): IdentityPlan<PlannedInvitationTokenHash> {
  if (!args.token?.trim()) {
    return conflict("MISSING_INVITATION_TOKEN", "token");
  }

  const plannedTokenHash = hashInvitationToken(args.token);
  if (
    args.hashedTokenMatchCount > (args.tokenHash === plannedTokenHash ? 1 : 0)
  ) {
    return conflict("DUPLICATE_INVITATION_TOKEN_HASH", "tokenHash");
  }
  if (args.tokenHash && args.tokenHash !== plannedTokenHash) {
    return conflict("INVITATION_TOKEN_HASH_MISMATCH", "tokenHash");
  }
  if (args.tokenHash === plannedTokenHash) return { outcome: "unchanged" };

  return { outcome: "create", value: { tokenHash: plannedTokenHash } };
}
