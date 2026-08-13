import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FULL_SCHEMA_CLEANUP_DOMAINS } from "../convex/fullSchemaCleanupRegistry";
import { FULL_SCHEMA_TABLE_POLICIES } from "../convex/fullSchemaInventory";
import { parseSchemaSourceInventory } from "./helpers/schema-source-inventory";

const schemaSource = readFileSync(
  fileURLToPath(new URL("../convex/schema.ts", import.meta.url)),
  "utf8",
);

const targets = [
  "organizationUiSettings",
  "organizationSettingsEvents",
  "evaluationReviewers",
  "evaluationEvents",
  "applicantStageEvents",
  "applicantNotes",
  "applicantInterviews",
  "applicantScorecards",
  "applicantOfferEvents",
  "applicantCustomFieldValues",
] as const;

describe("workflow events schema", () => {
  it("registers workflow events as an implemented migration", () => {
    expect(
      FULL_SCHEMA_CLEANUP_DOMAINS.find(
        ({ domain }) => domain === "workflow_events",
      ),
    ).toMatchObject({
      migrationKey: "full-schema-workflow-events",
      migrationVersion: 1,
      implementation: "migration",
    });
  });

  it("declares and classifies every normalized workflow target", () => {
    const tables = new Set(
      parseSchemaSourceInventory(schemaSource).tables.map(({ name }) => name),
    );
    for (const target of targets) {
      expect(tables.has(target), target).toBe(true);
      expect(FULL_SCHEMA_TABLE_POLICIES[target]).toMatchObject({
        disposition: "retain",
        defaultFieldClassification: "normalized_target",
      });
    }
  });
});
