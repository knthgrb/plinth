import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  type FullSchemaDomainReadiness,
} from "../convex/fullSchemaCleanupRegistry";
import { resolveFullSchemaCleanupReadinessMode } from "../convex/databaseMigrations";
import { FULL_SCHEMA_TABLE_POLICIES } from "../convex/fullSchemaInventory";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const getFullSchemaInventory = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    programKey: string;
    programVersion: number;
    currentTableCount: number;
    tables: Array<{ table: string; domain: string; disposition: string }>;
  }
>("databaseMigrations:getFullSchemaInventory");

const getFullSchemaCleanupReadiness = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    programKey: string;
    programVersion: number;
    readyForRelease3: boolean;
    domains: Array<{
      domain: string;
      status: string;
      migrationKey: string;
      migrationVersion: number;
      blockers: string[];
      auditId?: string;
      auditedAt?: number;
    }>;
  }
>("databaseMigrations:getFullSchemaCleanupReadiness");

describe("full schema cleanup readiness", () => {
  it("registers exactly six unique cleanup waves", () => {
    const domains = FULL_SCHEMA_CLEANUP_DOMAINS.map(({ domain }) => domain);

    expect(domains).toHaveLength(6);
    expect(new Set(domains)).toHaveLength(6);
  });

  it("uses a unique migration identity for every cleanup wave", () => {
    const migrationIdentities = FULL_SCHEMA_CLEANUP_DOMAINS.map(
      ({ migrationKey, migrationVersion }) =>
        `${migrationKey}:${migrationVersion}`,
    );

    expect(new Set(migrationIdentities)).toHaveLength(
      migrationIdentities.length,
    );
  });

  it("assigns every policy domain to exactly one cleanup wave", () => {
    const policyDomains = FULL_SCHEMA_CLEANUP_DOMAINS.flatMap(
      ({ policyDomains }) => policyDomains,
    );
    const tablePolicyDomains = Object.values(FULL_SCHEMA_TABLE_POLICIES).map(
      ({ domain }) => domain,
    );

    expect(new Set(policyDomains)).toEqual(new Set(tablePolicyDomains));
    expect(policyDomains).toHaveLength(new Set(policyDomains).size);
  });

  it("represents readiness for every cleanup wave", () => {
    const readiness = FULL_SCHEMA_CLEANUP_DOMAINS.map(
      ({ domain, migrationKey, migrationVersion }) => ({
        domain,
        status: "not_started" as const,
        migrationKey,
        migrationVersion,
        blockers: [],
      }),
    ) satisfies readonly FullSchemaDomainReadiness[];

    expect(readiness).toHaveLength(6);
  });

  it("uses a stable full-schema program identity", () => {
    expect(FULL_SCHEMA_CLEANUP_PROGRAM_KEY).toBe("convex-full-schema-cleanup");
    expect(FULL_SCHEMA_CLEANUP_PROGRAM_VERSION).toBe(1);
  });

  it("dispatches readiness by implementation before compatibility identity", () => {
    const organizationConfiguration = FULL_SCHEMA_CLEANUP_DOMAINS.find(
      ({ domain }) => domain === "organization_configuration",
    );
    const identityCredentials = FULL_SCHEMA_CLEANUP_DOMAINS.find(
      ({ domain }) => domain === "identity_credentials",
    );
    if (!organizationConfiguration || !identityCredentials) {
      throw new Error("Expected cleanup registrations were not found");
    }

    expect(
      resolveFullSchemaCleanupReadinessMode({
        ...organizationConfiguration,
        implementation: "not_started",
      }),
    ).toBe("not_started");
    expect(
      resolveFullSchemaCleanupReadinessMode({
        ...identityCredentials,
        implementation: "migration",
      }),
    ).toBe("identity_credentials");
    expect(
      resolveFullSchemaCleanupReadinessMode({
        ...identityCredentials,
        implementation: "compatibility",
      }),
    ).toBe("unsupported");
    expect(
      resolveFullSchemaCleanupReadinessMode(organizationConfiguration),
    ).toBe("organization_configuration");
  });

  it("reports every table and waits for the identity migration", async () => {
    const t = convexTest(schema, modules);

    const inventory = await t.query(getFullSchemaInventory, {});
    expect(inventory).toMatchObject({
      programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
      programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
      currentTableCount: 64,
    });
    expect(inventory.tables).toHaveLength(64);
    expect(inventory.tables).toContainEqual(
      expect.objectContaining({
        table: "organizations",
        domain: "organization_configuration",
        disposition: "contract_legacy",
      }),
    );

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness).toMatchObject({
      programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
      programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
      readyForRelease3: false,
    });
    expect(readiness.domains).toHaveLength(6);
    expect(
      readiness.domains.map(
        ({ domain, migrationKey, migrationVersion }) =>
          `${domain}:${migrationKey}:${migrationVersion}`,
      ),
    ).toEqual(
      FULL_SCHEMA_CLEANUP_DOMAINS.map(
        ({ domain, migrationKey, migrationVersion }) =>
          `${domain}:${migrationKey}:${migrationVersion}`,
      ),
    );
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "identity_credentials",
        status: "not_started",
        blockers: ["COMPLETED_WRITE_RUN_NOT_FOUND"],
      }),
    );
  });

  it("marks identity credentials ready from the newest clean write audit", async () => {
    const t = convexTest(schema, modules);
    const auditId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 3,
          changed: 3,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      return ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 3,
          matching: 3,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 3,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.readyForRelease3).toBe(false);
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "identity_credentials",
        status: "ready",
        blockers: [],
        auditId,
        auditedAt: 2,
      }),
    );
  });

  it("marks leave employee children ready from its newest clean write audit", async () => {
    const t = convexTest(schema, modules);
    const auditId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "full-schema-leave-employee-children",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "leave_balances",
        batchSize: 20,
        counters: {
          scanned: 4,
          changed: 12,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      return ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "completed",
        phase: "leave_balances",
        batchSize: 5,
        organizations: 1,
        destination: {
          expected: 12,
          matching: 12,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 12,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "leave_employee_children",
        status: "ready",
        blockers: [],
        auditId,
        auditedAt: 2,
      }),
    );

    await t.run(async (ctx) => {
      const audit = await ctx.db.get(auditId);
      if (!audit) throw new Error("Audit fixture was not found");
      await ctx.db.patch(auditId, {
        destination: { ...audit.destination, totalRows: 11 },
      });
    });
    const incompleteTargetScan = await t.query(
      getFullSchemaCleanupReadiness,
      {},
    );
    expect(incompleteTargetScan.domains).toContainEqual(
      expect.objectContaining({
        domain: "leave_employee_children",
        status: "blocked",
        blockers: expect.arrayContaining(["AUDIT_DESTINATION_DISCREPANCIES"]),
      }),
    );
  });

  it("marks workflow events ready from its newest clean write audit", async () => {
    const t = convexTest(schema, modules);
    const auditId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "full-schema-workflow-events",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "workflow_applicants",
        batchSize: 20,
        counters: {
          scanned: 3,
          changed: 11,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      return ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "completed",
        phase: "workflow_target_custom_values",
        batchSize: 5,
        organizations: 1,
        destination: {
          expected: 11,
          matching: 11,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 11,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "workflow_events",
        status: "ready",
        blockers: [],
        auditId,
        auditedAt: 2,
      }),
    );
    expect(readiness.readyForRelease3).toBe(false);
  });

  it("does not search past a newer unsafe identity write", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const cleanRunId = await ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      await ctx.db.insert("migrationAudits", {
        migrationRunId: cleanRunId,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 0,
          matching: 0,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 0,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
      await ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "running",
        phase: "identity_users",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 3,
        updatedAt: 3,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "identity_credentials",
        status: "running",
        blockers: ["MIGRATION_WRITE_NOT_COMPLETED"],
      }),
    );
  });

  it("marks organization configuration ready after a completed clean audit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      await ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "completed",
        phase: "requirements",
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 0,
          matching: 0,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 0,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.readyForRelease3).toBe(false);
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status: "ready",
        blockers: [],
        auditedAt: 2,
      }),
    );
  });

  it.each([
    {
      name: "queued write",
      writeStatus: "queued" as const,
      errors: 0,
      conflicts: 0,
      expectedStatus: "running",
      expectedBlocker: "MIGRATION_WRITE_NOT_COMPLETED",
    },
    {
      name: "running write",
      writeStatus: "running" as const,
      errors: 0,
      conflicts: 0,
      expectedStatus: "running",
      expectedBlocker: "MIGRATION_WRITE_NOT_COMPLETED",
    },
    {
      name: "failed write",
      writeStatus: "failed" as const,
      errors: 0,
      conflicts: 0,
      expectedStatus: "failed",
      expectedBlocker: "MIGRATION_WRITE_FAILED",
    },
    {
      name: "completed write with errors",
      writeStatus: "completed" as const,
      errors: 1,
      conflicts: 0,
      expectedStatus: "blocked",
      expectedBlocker: "MIGRATION_WRITE_ERRORS",
    },
    {
      name: "completed write with conflicts",
      writeStatus: "completed" as const,
      errors: 0,
      conflicts: 1,
      expectedStatus: "blocked",
      expectedBlocker: "MIGRATION_WRITE_CONFLICTS",
    },
  ])(
    "does not search past a newer $name",
    async ({
      writeStatus,
      errors,
      conflicts,
      expectedStatus,
      expectedBlocker,
    }) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const cleanRunId = await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: false,
          status: "completed",
          phase: "organizations",
          batchSize: 20,
          counters: {
            scanned: 0,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            conflicts: 0,
            errors: 0,
          },
          startedAt: 1,
          updatedAt: 1,
          completedAt: 1,
        });
        await ctx.db.insert("migrationAudits", {
          migrationRunId: cleanRunId,
          status: "completed",
          phase: "requirements",
          batchSize: 5,
          organizations: 0,
          destination: {
            expected: 0,
            matching: 0,
            missing: 0,
            duplicate: 0,
            mismatched: 0,
            unexpected: 0,
            totalRows: 0,
          },
          duplicateLegacySettings: 0,
          sourceConflicts: 0,
          auditTruncated: false,
          startedAt: 2,
          updatedAt: 2,
          completedAt: 2,
        });
        await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: false,
          status: writeStatus,
          phase: "organizations",
          batchSize: 20,
          counters: {
            scanned: 0,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            conflicts,
            errors,
          },
          startedAt: 3,
          updatedAt: 3,
          completedAt:
            writeStatus === "completed" || writeStatus === "failed"
              ? 3
              : undefined,
        });
      });

      const readiness = await t.query(getFullSchemaCleanupReadiness, {});
      const organization = readiness.domains.find(
        ({ domain }) => domain === "organization_configuration",
      );
      expect(organization).toMatchObject({
        status: expectedStatus,
        blockers: [expectedBlocker],
      });
      expect(organization?.auditId).toBeUndefined();
    },
  );

  it("ignores a newer dry run when resolving the latest write attempt", async () => {
    const t = convexTest(schema, modules);
    const cleanAuditId = await t.run(async (ctx) => {
      const cleanRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      const auditId = await ctx.db.insert("migrationAudits", {
        migrationRunId: cleanRunId,
        status: "completed",
        phase: "requirements",
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 0,
          matching: 0,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 0,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
      await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 3,
        updatedAt: 3,
      });
      return auditId;
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status: "ready",
        blockers: [],
        auditId: cleanAuditId,
      }),
    );
  });

  it("blocks readiness when the migration history lookback is exhausted", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let startedAt = 1; startedAt <= 101; startedAt += 1) {
        await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: true,
          status: "completed",
          phase: "organizations",
          batchSize: 20,
          counters: {
            scanned: 0,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            conflicts: 0,
            errors: 1,
          },
          startedAt,
          updatedAt: startedAt,
          completedAt: startedAt,
        });
      }
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status: "blocked",
        blockers: ["MIGRATION_RUN_HISTORY_TRUNCATED"],
      }),
    );
  });

  it("treats a clean run at the history sentinel as overflow evidence", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const cleanRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      await ctx.db.insert("migrationAudits", {
        migrationRunId: cleanRunId,
        status: "completed",
        phase: "requirements",
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 0,
          matching: 0,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 0,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      for (let startedAt = 2; startedAt <= 101; startedAt += 1) {
        await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: true,
          status: "completed",
          phase: "organizations",
          batchSize: 20,
          counters: {
            scanned: 0,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            conflicts: 0,
            errors: 1,
          },
          startedAt,
          updatedAt: startedAt,
          completedAt: startedAt,
        });
      }
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status: "blocked",
        blockers: ["MIGRATION_RUN_HISTORY_TRUNCATED"],
      }),
    );
  });

  it.each([
    {
      name: "stale migration version",
      version: 2,
      audit: undefined,
      status: "stale",
      blockers: ["MIGRATION_VERSION_STALE"],
    },
    {
      name: "missing audit",
      version: 1,
      audit: undefined,
      status: "not_started",
      blockers: ["AUDIT_NOT_FOUND"],
    },
    {
      name: "queued audit",
      version: 1,
      audit: { status: "queued" as const },
      status: "running",
      blockers: ["AUDIT_NOT_COMPLETED"],
    },
    {
      name: "running audit",
      version: 1,
      audit: { status: "running" as const },
      status: "running",
      blockers: ["AUDIT_NOT_COMPLETED"],
    },
    {
      name: "failed audit",
      version: 1,
      audit: { status: "failed" as const },
      status: "failed",
      blockers: ["AUDIT_FAILED"],
    },
    {
      name: "truncated audit",
      version: 1,
      audit: { auditTruncated: true },
      status: "blocked",
      blockers: ["AUDIT_TRUNCATED"],
    },
    {
      name: "source conflicts",
      version: 1,
      audit: { sourceConflicts: 1 },
      status: "blocked",
      blockers: ["AUDIT_SOURCE_CONFLICTS"],
    },
    {
      name: "missing destination rows",
      version: 1,
      audit: { destination: { missing: 1 } },
      status: "blocked",
      blockers: ["AUDIT_DESTINATION_DISCREPANCIES"],
    },
    {
      name: "duplicate destination rows",
      version: 1,
      audit: { destination: { duplicate: 1 } },
      status: "blocked",
      blockers: ["AUDIT_DESTINATION_DISCREPANCIES"],
    },
    {
      name: "mismatched destination rows",
      version: 1,
      audit: { destination: { mismatched: 1 } },
      status: "blocked",
      blockers: ["AUDIT_DESTINATION_DISCREPANCIES"],
    },
    {
      name: "unexpected destination rows",
      version: 1,
      audit: { destination: { unexpected: 1 } },
      status: "blocked",
      blockers: ["AUDIT_DESTINATION_DISCREPANCIES"],
    },
    {
      name: "destination matching count mismatch",
      version: 1,
      audit: { destination: { expected: 1, matching: 0 } },
      status: "blocked",
      blockers: ["AUDIT_DESTINATION_DISCREPANCIES"],
    },
  ])("fails closed for $name", async ({ version, audit, status, blockers }) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      if (audit) {
        await ctx.db.insert("migrationAudits", {
          migrationRunId: runId,
          status: audit.status ?? "completed",
          phase: "requirements",
          batchSize: 5,
          organizations: 0,
          destination: {
            expected: 0,
            matching: 0,
            missing: 0,
            duplicate: 0,
            mismatched: 0,
            unexpected: 0,
            totalRows: 0,
            ...audit.destination,
          },
          duplicateLegacySettings: 0,
          sourceConflicts: audit.sourceConflicts ?? 0,
          auditTruncated: audit.auditTruncated ?? false,
          startedAt: 2,
          updatedAt: 2,
          completedAt:
            audit.status === "queued" || audit.status === "running"
              ? undefined
              : 2,
        });
      }
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status,
        blockers,
      }),
    );
  });

  it("uses the newest audit instead of an older clean audit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      const commonAudit = {
        migrationRunId: runId,
        phase: "requirements" as const,
        batchSize: 5,
        organizations: 0,
        destination: {
          expected: 0,
          matching: 0,
          missing: 0,
          duplicate: 0,
          mismatched: 0,
          unexpected: 0,
          totalRows: 0,
        },
        duplicateLegacySettings: 0,
        sourceConflicts: 0,
        auditTruncated: false,
      };
      await ctx.db.insert("migrationAudits", {
        ...commonAudit,
        status: "completed",
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
      await ctx.db.insert("migrationAudits", {
        ...commonAudit,
        status: "failed",
        startedAt: 3,
        updatedAt: 3,
        completedAt: 3,
      });
    });

    const readiness = await t.query(getFullSchemaCleanupReadiness, {});
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "organization_configuration",
        status: "failed",
        blockers: ["AUDIT_FAILED"],
        auditedAt: 3,
      }),
    );
  });
});
