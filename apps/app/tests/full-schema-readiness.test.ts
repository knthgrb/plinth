import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
} from "../convex/fullSchemaCleanupRegistry";
import { FULL_SCHEMA_TABLE_POLICIES } from "../convex/fullSchemaInventory";

describe("full schema cleanup readiness", () => {
  it("assigns every table to a registered cleanup domain", () => {
    const registered = new Set(
      FULL_SCHEMA_CLEANUP_DOMAINS.map(({ domain }) => domain),
    );

    for (const policy of Object.values(FULL_SCHEMA_TABLE_POLICIES)) {
      expect(registered.has(policy.domain)).toBe(true);
    }
  });

  it("uses a stable full-schema program identity", () => {
    expect(FULL_SCHEMA_CLEANUP_PROGRAM_KEY).toBe("convex-full-schema-cleanup");
    expect(FULL_SCHEMA_CLEANUP_PROGRAM_VERSION).toBe(1);
  });
});
