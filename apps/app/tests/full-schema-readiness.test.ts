import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  type FullSchemaDomainReadiness,
} from "../convex/fullSchemaCleanupRegistry";
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

  it("reports every table and blocks unimplemented domains", async () => {
    const t = convexTest(schema, modules);

    const inventory = await t.query(getFullSchemaInventory, {});
    expect(inventory).toMatchObject({
      programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
      programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
      currentTableCount: 44,
    });
    expect(inventory.tables).toHaveLength(44);
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
    expect(readiness.domains).toContainEqual(
      expect.objectContaining({
        domain: "identity_credentials",
        status: "not_started",
        blockers: ["DOMAIN_IMPLEMENTATION_NOT_DEPLOYED"],
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
});
