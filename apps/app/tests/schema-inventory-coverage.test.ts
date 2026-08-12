import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSchemaSourceInventory } from "./helpers/schema-source-inventory";

describe("schema source inventory", () => {
  it("collects nested field paths and chained indexes", () => {
    const source = `
      export default defineSchema({
        examples: defineTable({
          organizationId: v.id("organizations"),
          policy: v.optional(v.object({ enabled: v.boolean() })),
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
            "variants",
            "variants.legacy",
          ],
          indexes: ["by_organization"],
        },
      ],
    });
  });

  it("finds all current Convex tables", () => {
    const schemaPath = fileURLToPath(
      new URL("../convex/schema.ts", import.meta.url),
    );
    const inventory = parseSchemaSourceInventory(
      readFileSync(schemaPath, "utf8"),
    );
    expect(inventory.tables).toHaveLength(44);
    expect(inventory.tables.map(({ name }) => name)).toContain("assets");
  });
});
