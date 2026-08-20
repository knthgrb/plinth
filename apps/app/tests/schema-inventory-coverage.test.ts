import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_TABLE_POLICIES,
  resolveSchemaFieldPolicy,
  resolveSchemaIndexPolicy,
} from "../convex/fullSchemaInventory";
import { LEAVE_FIELD_MANIFEST } from "../convex/schemaFieldManifest";
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
    expect(inventory.tables).toHaveLength(104);
    expect(inventory.tables.map(({ name }) => name)).toContain("assets");
    expect(inventory.tables.map(({ name }) => name)).toContain(
      "payslipCredentials",
    );
    expect(inventory.tables.map(({ name }) => name)).toContain(
      "employeeLeaveBalances",
    );
    expect(inventory.tables.map(({ name }) => name)).toContain(
      "employeeLifecycleEvents",
    );
    expect(inventory.tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "memoReactions",
        "memoAcknowledgements",
        "memoAudienceMembers",
        "conversationMembers",
        "messageReceipts",
        "messageReactions",
        "userPinnedConversations",
        "userConversationPreferences",
        "documentAccessGrants",
        "storageObjectLinks",
      ]),
    );
  });

  it("classifies canonical leave rows and maps legacy leave fields", () => {
    const canonicalLeaveTables = [
      "leavePolicies",
      "leavePolicyVersions",
      "leaveLedgerEntries",
      "leaveRequestOccurrences",
      "leaveRequestEvents",
      "employeeLeaveQualifications",
      "leaveBenefitEvents",
      "leaveBenefitPayrollReconciliations",
      "leaveBenefitPayrollAllocations",
      "leaveCompanyModelVersions",
      "leaveSensitiveAccessGrants",
      "leaveAdministrativeEvents",
      "leaveConversionRequests",
    ] as const;

    for (const table of canonicalLeaveTables) {
      expect(FULL_SCHEMA_TABLE_POLICIES[table]).toMatchObject({
        domain: "leave",
        disposition: "retain",
        defaultFieldClassification: "canonical_row",
      });
    }

    expect(LEAVE_FIELD_MANIFEST).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "employees",
          field: "leaveCredits",
          target: "employeeLeaveBalances",
        }),
        expect.objectContaining({
          table: "leaveTypes",
          field: "name",
          target: "leavePolicies.name",
        }),
        expect.objectContaining({
          table: "leaveRequests",
          field: "numberOfDays",
          target: "leaveRequests.chargeableDuration",
        }),
      ]),
    );

    for (const entry of LEAVE_FIELD_MANIFEST) {
      expect(resolveSchemaFieldPolicy(entry.table, entry.field)).toEqual(
        entry,
      );
    }
  });

  it("matches the reviewed schema-item inventory exactly", () => {
    const review = summarizeSchemaSourceInventory(
      parseSchemaSourceInventory(schemaSource),
    );
    if (process.env.UPDATE_SCHEMA_INVENTORY_BASELINE === "1") {
      writeFileSync(
        fileURLToPath(
          new URL("./fixtures/schema-inventory.reviewed.json", import.meta.url),
        ),
        `${JSON.stringify(review, null, 2)}\n`,
      );
      return;
    }
    expectReviewedInventory(review);
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
