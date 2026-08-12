import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  IDENTITY_CREDENTIALS_MIGRATION_KEY,
  IDENTITY_CREDENTIALS_MIGRATION_VERSION,
  planInvitationTokenHash,
  planLegacyUserMembership,
  planPayslipCredential,
} from "../convex/identityMigrationPlanner";
import { hashInvitationToken } from "../convex/invitationTokenHash";

const organizationId = "organization-1";
const employeeId = "employee-1";

describe("identity migration planner", () => {
  it("uses a versioned migration identity", () => {
    expect(IDENTITY_CREDENTIALS_MIGRATION_KEY).toBe(
      "full-schema-identity-credentials",
    );
    expect(IDENTITY_CREDENTIALS_MIGRATION_VERSION).toBe(1);
  });

  it("hashes invitation tokens deterministically with domain separation", () => {
    const token = "raw-token";
    const unscopedHash = bytesToHex(sha256(utf8ToBytes(token)));

    expect(hashInvitationToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
    expect(hashInvitationToken(token)).not.toBe(unscopedHash);
  });

  it("plans a membership from valid legacy user identity fields", () => {
    expect(
      planLegacyUserMembership({
        user: {
          organizationId,
          role: "employee",
          employeeId,
        },
        memberships: [],
        organizationExists: true,
        employee: {
          id: employeeId,
          organizationId,
          employmentStatus: "active",
        },
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({
      outcome: "create",
      value: {
        organizationId,
        role: "employee",
        employeeId,
        accessStatus: "active",
      },
    });
  });

  it.each([
    ["inactive", "suspended"],
    ["resigned", "alumni"],
    ["terminated", "disabled"],
  ] as const)(
    "creates %s employee membership with %s access",
    (employmentStatus, accessStatus) => {
      expect(
        planLegacyUserMembership({
          user: {
            organizationId,
            role: "employee",
            employeeId,
            isActive: false,
          },
          memberships: [],
          organizationExists: true,
          employee: {
            id: employeeId,
            organizationId,
            employmentStatus,
          },
          lastActiveOrganizationExists: true,
        }),
      ).toEqual({
        outcome: "create",
        value: { organizationId, role: "employee", employeeId, accessStatus },
      });
    },
  );

  it("rejects an access status that conflicts with employee lifecycle", () => {
    expect(
      planLegacyUserMembership({
        user: { organizationId, role: "employee", employeeId },
        memberships: [
          { organizationId, role: "employee", employeeId, accessStatus: "active" },
        ],
        organizationExists: true,
        employee: {
          id: employeeId,
          organizationId,
          employmentStatus: "resigned",
        },
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "MEMBERSHIP_ACCESS_STATUS_MISMATCH", field: "accessStatus" },
      ],
    });
  });

  it("leaves an identical existing membership unchanged", () => {
    expect(
      planLegacyUserMembership({
        user: { organizationId, role: "hr", employeeId },
        memberships: [
          { organizationId, role: "hr", employeeId, accessStatus: "active" },
        ],
        organizationExists: true,
        employee: { id: employeeId, organizationId },
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it("rejects duplicate or conflicting memberships without exposing values", () => {
    const duplicate = planLegacyUserMembership({
      user: { organizationId, role: "hr" },
      memberships: [
        { organizationId, role: "hr", accessStatus: "active" },
        { organizationId, role: "hr", accessStatus: "active" },
      ],
      organizationExists: true,
      employee: null,
      lastActiveOrganizationExists: true,
    });
    const mismatch = planLegacyUserMembership({
      user: { organizationId, role: "hr" },
      memberships: [
        { organizationId, role: "employee", accessStatus: "active" },
      ],
      organizationExists: true,
      employee: null,
      lastActiveOrganizationExists: true,
    });

    expect(duplicate).toEqual({
      outcome: "conflict",
      issues: [
        { code: "DUPLICATE_USER_MEMBERSHIP", field: "organizationId" },
      ],
    });
    expect(mismatch).toEqual({
      outcome: "conflict",
      issues: [{ code: "MEMBERSHIP_ROLE_MISMATCH", field: "role" }],
    });
    expect(JSON.stringify([duplicate, mismatch])).not.toContain("employee");
  });

  it("rejects an employee linked to another organization", () => {
    expect(
      planLegacyUserMembership({
        user: { organizationId, role: "employee", employeeId },
        memberships: [],
        organizationExists: true,
        employee: { id: employeeId, organizationId: "organization-2" },
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        {
          code: "EMPLOYEE_ORGANIZATION_MISMATCH",
          field: "employeeId",
        },
      ],
    });
  });

  it("skips users without a legacy organization", () => {
    expect(
      planLegacyUserMembership({
        user: { role: "employee" },
        memberships: [],
        organizationExists: false,
        employee: null,
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({ outcome: "skipped" });
  });

  it("does not infer membership status from a globally inactive user", () => {
    expect(
      planLegacyUserMembership({
        user: { organizationId, role: "employee", isActive: false },
        memberships: [],
        organizationExists: true,
        employee: null,
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "AMBIGUOUS_GLOBAL_INACTIVE_USER", field: "isActive" },
      ],
    });
  });

  it("preserves an unambiguous non-active membership for an inactive user", () => {
    expect(
      planLegacyUserMembership({
        user: { organizationId, role: "employee", isActive: false },
        memberships: [
          { organizationId, role: "employee", accessStatus: "alumni" },
        ],
        organizationExists: true,
        employee: null,
        lastActiveOrganizationExists: true,
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it.each([
    {
      name: "orphan organization",
      input: {
        user: { organizationId, role: "employee" as const },
        memberships: [],
        organizationExists: false,
        employee: null,
        lastActiveOrganizationExists: true,
      },
      issue: { code: "ORGANIZATION_NOT_FOUND", field: "organizationId" },
    },
    {
      name: "orphan employee",
      input: {
        user: { organizationId, role: "employee" as const, employeeId },
        memberships: [],
        organizationExists: true,
        employee: null,
        lastActiveOrganizationExists: true,
      },
      issue: { code: "EMPLOYEE_NOT_FOUND", field: "employeeId" },
    },
    {
      name: "orphan last active organization",
      input: {
        user: {
          organizationId,
          role: "employee" as const,
          lastActiveOrganizationId: "organization-2",
        },
        memberships: [],
        organizationExists: true,
        employee: null,
        lastActiveOrganizationExists: false,
      },
      issue: {
        code: "LAST_ACTIVE_ORGANIZATION_NOT_FOUND",
        field: "lastActiveOrganizationId",
      },
    },
  ])("reports an issue for an $name", ({ input, issue }) => {
    expect(planLegacyUserMembership(input)).toEqual({
      outcome: "conflict",
      issues: [issue],
    });
  });

  it("plans an exact copy of a non-empty legacy payslip credential", () => {
    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        legacyCredentialHash: "legacy-hash",
        destinations: [],
      }),
    ).toEqual({
      outcome: "create",
      value: {
        organizationId,
        employeeId,
        credentialHash: "legacy-hash",
        credentialVersion: 1,
        migrationVersion: 1,
      },
    });
  });

  it("leaves an equal payslip credential unchanged", () => {
    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        legacyCredentialHash: "legacy-hash",
        destinations: [
          { organizationId, employeeId, credentialHash: "legacy-hash" },
        ],
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it("rejects duplicate and unequal payslip credentials", () => {
    const destination = {
      organizationId,
      employeeId,
      credentialHash: "legacy-hash",
    };

    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        legacyCredentialHash: "legacy-hash",
        destinations: [destination, destination],
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "DUPLICATE_PAYSLIP_CREDENTIAL", field: "employeeId" },
      ],
    });
    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        legacyCredentialHash: "legacy-hash",
        destinations: [{ ...destination, credentialHash: "different-hash" }],
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "PAYSLIP_CREDENTIAL_MISMATCH", field: "credentialHash" },
      ],
    });
  });

  it("skips empty legacy credentials and flags destination-only rows", () => {
    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        legacyCredentialHash: "  ",
        destinations: [],
      }),
    ).toEqual({ outcome: "skipped" });
    expect(
      planPayslipCredential({
        organizationId,
        employeeId,
        destinations: [
          { organizationId, employeeId, credentialHash: "destination-hash" },
        ],
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "UNEXPECTED_PAYSLIP_CREDENTIAL", field: "employeeId" },
      ],
    });
  });

  it("plans a hash for an unhashed invitation", () => {
    expect(
      planInvitationTokenHash({
        token: "raw-token",
        tokenHash: undefined,
        hashedTokenMatchCount: 0,
      }),
    ).toEqual({
      outcome: "create",
      value: { tokenHash: hashInvitationToken("raw-token") },
    });
  });

  it("leaves a matching invitation hash unchanged", () => {
    const tokenHash = hashInvitationToken("raw-token");

    expect(
      planInvitationTokenHash({
        token: "raw-token",
        tokenHash,
        hashedTokenMatchCount: 1,
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it("rejects mismatched and duplicate invitation hashes", () => {
    expect(
      planInvitationTokenHash({
        token: "raw-token",
        tokenHash: "different-hash",
        hashedTokenMatchCount: 0,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "INVITATION_TOKEN_HASH_MISMATCH", field: "tokenHash" }],
    });
    expect(
      planInvitationTokenHash({
        token: "raw-token",
        tokenHash: undefined,
        hashedTokenMatchCount: 1,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        { code: "DUPLICATE_INVITATION_TOKEN_HASH", field: "tokenHash" },
      ],
    });
  });

  it("rejects missing invitation tokens without hashing an empty value", () => {
    expect(
      planInvitationTokenHash({
        token: " ",
        tokenHash: undefined,
        hashedTokenMatchCount: 0,
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "MISSING_INVITATION_TOKEN", field: "token" }],
    });
  });
});
