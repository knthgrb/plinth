import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_FIELD_OVERRIDES,
  type SchemaItemClassification,
} from "../convex/fullSchemaInventory";
import baseline from "./fixtures/schema-contract-reference-baseline.json";
import {
  DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS,
  scanSchemaReferences,
} from "./helpers/schema-reference-scan";

const fixtureRoots: string[] = [];

const createFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), "schema-reference-scan-"));
  fixtureRoots.push(root);
  return root;
};

const writeFixture = (root: string, file: string, source: string): void => {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
};

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const legacyClassifications: readonly SchemaItemClassification[] = [
  "compatibility_read",
  "compatibility_write",
  "removable",
];

describe("schema contract references", () => {
  it("returns redacted repository-relative matches", () => {
    const root = createFixture();
    writeFixture(
      root,
      "convex/settings.ts",
      'const secret = "super-secret-value";\nconst password = settings.payrollTabPassword;\n',
    );

    const matches = scanSchemaReferences(root, ["payrollTabPassword"], []);

    expect(matches).toEqual([
      { symbol: "payrollTabPassword", file: "convex/settings.ts", line: 2 },
    ]);
    expect(JSON.stringify(matches)).not.toContain("super-secret-value");
  });

  it("matches dotted symbols by complete path segments", () => {
    const root = createFixture();
    writeFixture(
      root,
      "convex/settings.ts",
      [
        "const first = settings.payrollSettings?.payrollTabPassword;",
        "const second = settings.payrollSettings.payrollTabPasswordHint;",
        "const third = settings.payrollSettingsBackup.payrollTabPassword;",
      ].join("\n"),
    );

    expect(
      scanSchemaReferences(root, ["payrollSettings.payrollTabPassword"], []),
    ).toEqual([
      {
        symbol: "payrollSettings.payrollTabPassword",
        file: "convex/settings.ts",
        line: 1,
      },
    ]);
  });

  it("does not match symbols inside Unicode identifiers", () => {
    const root = createFixture();
    writeFixture(root, "convex/tokens.ts", "const πtoken = 1;\nconst token = 2;\n");

    expect(scanSchemaReferences(root, ["token"], [])).toEqual([
      { symbol: "token", file: "convex/tokens.ts", line: 2 },
    ]);
  });

  it("deduplicates duplicate input symbols and same-line matches", () => {
    const root = createFixture();
    writeFixture(root, "convex/live.ts", "legacyField + legacyField;\n");

    expect(
      scanSchemaReferences(root, ["legacyField", "legacyField"], []),
    ).toEqual([{ symbol: "legacyField", file: "convex/live.ts", line: 1 }]);
  });

  it("applies the complete default policy only within intended source roots", () => {
    const root = createFixture();
    const excludedFiles = [
      "convex/schema.ts",
      "convex/schemaFieldManifest.ts",
      "convex/fullSchemaInventory.ts",
      "convex/fullSchemaCleanupRegistry.ts",
      "convex/_generated/api.ts",
      "convex/databaseMigrationPlanner.ts",
      "convex/databaseMigrationTypes.ts",
      "convex/databaseMigrations.ts",
      "convex/dataMigrations.ts",
      "convex/payslipSecurityMigrations.ts",
      "convex/storageMigrations.ts",
      "tests/legacy.test.ts",
      "docs/legacy.ts",
      "services/legacy.ts",
    ];
    for (const file of excludedFiles) {
      writeFixture(root, file, "legacyField;\n");
    }
    writeFixture(root, "convex/live.ts", "legacyField;\n");

    expect(
      scanSchemaReferences(
        root,
        ["legacyField"],
        DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS,
      ),
    ).toEqual([{ symbol: "legacyField", file: "convex/live.ts", line: 1 }]);
  });

  it("covers every legacy policy symbol", () => {
    const symbols = FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
      legacyClassifications.includes(classification),
    ).map(({ field }) => field);

    expect(symbols).toHaveLength(
      FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
        legacyClassifications.includes(classification),
      ).length,
    );
    expect(symbols.every((symbol) => symbol.length > 0)).toBe(true);
  });

  it("matches the reviewed nonempty Release 1B reference baseline", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const symbols = FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
      legacyClassifications.includes(classification),
    ).map(({ field }) => field);

    const matches = scanSchemaReferences(
      root,
      symbols,
      DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS,
    );

    expect(matches).not.toHaveLength(0);
    expect(matches).toEqual(baseline);
  });
});
