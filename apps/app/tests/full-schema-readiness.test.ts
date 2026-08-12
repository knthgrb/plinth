import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  type FullSchemaDomainReadiness,
} from "../convex/fullSchemaCleanupRegistry";
import { FULL_SCHEMA_TABLE_POLICIES } from "../convex/fullSchemaInventory";

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
});
