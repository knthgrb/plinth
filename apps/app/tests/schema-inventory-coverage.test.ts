import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_TABLE_POLICIES,
  resolveSchemaFieldPolicy,
  resolveSchemaIndexPolicy,
} from "../convex/fullSchemaInventory";
import reviewedSchemaInventory from "./fixtures/schema-inventory.reviewed.json";
import {
  parseSchemaSourceInventory,
  summarizeSchemaSourceInventory,
  type SchemaSourceInventoryReview,
} from "./helpers/schema-source-inventory";

const schemaPath = fileURLToPath(
  new URL("../convex/schema.ts", import.meta.url),
);
const schemaSource = readFileSync(schemaPath, "utf8");

const expectReviewedInventory = (review: SchemaSourceInventoryReview) => {
  expect(review).toEqual(reviewedSchemaInventory);
};

describe("schema source inventory", () => {
  it("collects nested field paths and chained indexes", () => {
    const source = `
      export default defineSchema({
        examples: defineTable({
          organizationId: v.id("organizations"),
          policy: v.optional(v.object({ enabled: v.boolean() })),
          reviewers: v.array(v.object({ userId: v.id("users") })),
          variants: v.union(v.string(), v.object({ legacy: v.string() })),
        }).index("by_organization", ["organizationId"]),
      });
    `;
    expect(parseSchemaSourceInventory(source)).toEqual({
      tables: [
        {
          name: "examples",
          fields: [
            "organizationId",
            "policy.enabled",
            "reviewers.userId",
            "variants",
            "variants.legacy",
          ],
          indexes: ["by_organization"],
        },
      ],
    });
  });

  it("finds all current Convex tables", () => {
    const inventory = parseSchemaSourceInventory(schemaSource);
    expect(inventory.tables).toHaveLength(72);
    expect(inventory.tables.map(({ name }) => name)).toContain("assets");
    expect(inventory.tables.map(({ name }) => name)).toContain(
      "payslipCredentials",
    );
    expect(inventory.tables.map(({ name }) => name)).toContain(
      "employeeLeaveBalances",
    );
    expect(inventory.tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "memoReactions",
        "memoAcknowledgements",
        "memoAudienceMembers",
        "conversationMembers",
        "messageReceipts",
        "userPinnedConversations",
        "documentAccessGrants",
        "storageObjectLinks",
      ]),
    );
  });

  it("matches the reviewed schema-item inventory exactly", () => {
    expectReviewedInventory(
      summarizeSchemaSourceInventory(parseSchemaSourceInventory(schemaSource)),
    );
  });

  it("rejects an unreviewed field and index", () => {
    const currentDeclaration = `
    updatedAt: v.number(),
  }).index("by_name", ["name"]),`;
    const changedDeclaration = `
    updatedAt: v.number(),
    unreviewedField: v.string(),
  })
    .index("by_name", ["name"])
    .index("by_unreviewed_field", ["unreviewedField"]),`;
    const changedSource = schemaSource.replace(
      currentDeclaration,
      changedDeclaration,
    );

    expect(changedSource).not.toBe(schemaSource);
    expect(() =>
      expectReviewedInventory(
        summarizeSchemaSourceInventory(
          parseSchemaSourceInventory(changedSource),
        ),
      ),
    ).toThrow();
  });

  it("classifies every reviewed table, field, and index", () => {
    const inventory = parseSchemaSourceInventory(schemaSource);

    expect(Object.keys(FULL_SCHEMA_TABLE_POLICIES).sort()).toEqual(
      inventory.tables.map(({ name }) => name).sort(),
    );

    for (const table of inventory.tables) {
      for (const field of table.fields) {
        expect(resolveSchemaFieldPolicy(table.name, field)).not.toBeNull();
      }
      for (const index of table.indexes) {
        expect(resolveSchemaIndexPolicy(table.name, index)).not.toBeNull();
      }
    }
  });

  it("overrides every known compatibility and historical path", () => {
    expect(
      resolveSchemaFieldPolicy("users", "organizationId")?.classification,
    ).toBe("compatibility_read");
    expect(resolveSchemaFieldPolicy("employees", "requirements")?.target).toBe(
      "employeeRequirements",
    );
    expect(resolveSchemaFieldPolicy("messages", "readBy")?.target).toBe(
      "messageReceipts",
    );
    expect(
      resolveSchemaFieldPolicy("payslips", "employeeSnapshot")?.classification,
    ).toBe("historical_snapshot");
    expect(resolveSchemaFieldPolicy("employees", "payslipPinHash")).toEqual({
      table: "employees",
      field: "payslipPinHash",
      classification: "compatibility_read",
      target: "payslipCredentials.credentialHash",
      releaseGate: "release_3b_credentials_contract",
    });
    expect(resolveSchemaFieldPolicy("invitations", "token")?.target).toBe(
      "invitations.tokenHash",
    );
  });

  it("fails closed for unknown tables", () => {
    expect(resolveSchemaFieldPolicy("unknown", "field")).toBeNull();
    expect(resolveSchemaIndexPolicy("unknown", "index")).toBeNull();
    expect(resolveSchemaFieldPolicy("constructor", "field")).toBeNull();
    expect(resolveSchemaIndexPolicy("constructor", "index")).toBeNull();
    expect(resolveSchemaFieldPolicy("toString", "field")).toBeNull();
    expect(resolveSchemaIndexPolicy("toString", "index")).toBeNull();
  });

  it("retains migration evidence fields through all contract releases", () => {
    expect(
      resolveSchemaFieldPolicy("migrationIssues", "redactedIssue"),
    ).toEqual({
      classification: "migration_only",
      releaseGate: "retain_until_all_contract_releases_complete",
    });
  });

  it("uses the longest matching field override", () => {
    expect(
      resolveSchemaFieldPolicy("settings", "payrollSettings.payrollTabPassword")
        ?.classification,
    ).toBe("removable");
  });
});
