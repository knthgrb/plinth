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
  SCHEMA_REFERENCE_SOURCE_ROOTS,
  scanSchemaReferences,
} from "./helpers/schema-reference-scan";
import { summarizeSchemaReferences } from "./helpers/schema-reference-summary";

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

const legacyOverrides = FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
  legacyClassifications.includes(classification),
);

const referenceTiers = {
  enforceable: legacyOverrides.filter(({ field }) => field.includes(".")),
  discovery: legacyOverrides.filter(({ field }) => !field.includes(".")),
};

const scanTier = (root: string, tier: keyof typeof referenceTiers) =>
  scanSchemaReferences(
    root,
    referenceTiers[tier].map(({ field }) => field),
    DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS,
  );

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

  it("scans every reviewed production root and ignores non-production roots", () => {
    const root = createFixture();
    const productionRoots = [
      "actions",
      "app",
      "components",
      "convex",
      "helpers",
      "hooks",
      "lib",
      "services",
      "utils",
    ];
    const ignoredRoots = [
      "tests",
      "docs",
      "public",
      "config",
      "build",
      "node_modules",
    ];
    for (const sourceRoot of [...productionRoots, ...ignoredRoots]) {
      writeFixture(root, `${sourceRoot}/reference.ts`, "legacyField;\n");
    }

    expect(SCHEMA_REFERENCE_SOURCE_ROOTS).toEqual(productionRoots);
    expect(scanSchemaReferences(root, ["legacyField"], [])).toEqual(
      productionRoots.map((sourceRoot) => ({
        symbol: "legacyField",
        file: `${sourceRoot}/reference.ts`,
        line: 1,
      })),
    );
  });

  it("applies complete exclusions within intended source roots", () => {
    const root = createFixture();
    const excludedFiles = [
      "convex/schema.ts",
      "convex/schemaFieldManifest.ts",
      "convex/fullSchemaInventory.ts",
      "convex/fullSchemaCleanupRegistry.ts",
      "convex/schemaCleanupPolicy.ts",
      "convex/schema-policy-registry.ts",
      "convex/SCHEMA-POLICY.ts",
      "convex/_generated/api.ts",
      "app/generated/legacy.ts",
      "convex/databaseMigrationPlanner.ts",
      "convex/databaseMigrationTypes.ts",
      "convex/databaseMigrations.ts",
      "convex/dataMigrations.ts",
      "convex/payslipSecurityMigrations.ts",
      "convex/storageMigrations.ts",
      "convex/migrationHelpers.ts",
      "convex/migrationsHelpers.ts",
      "convex/MIGRATIONHelpers.ts",
      "convex/migrations/planner.ts",
      "utils/migrations/helpers.ts",
      "app/docs/legacy.ts",
      "components/tests/legacy.ts",
    ];
    for (const file of excludedFiles) {
      writeFixture(root, file, "legacyField;\n");
    }
    writeFixture(root, "convex/live.ts", "legacyField;\n");
    writeFixture(
      root,
      "components/leave-policy-calculations.ts",
      "legacyField;\n",
    );

    expect(
      scanSchemaReferences(
        root,
        ["legacyField"],
        DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS,
      ),
    ).toEqual([
      {
        symbol: "legacyField",
        file: "components/leave-policy-calculations.ts",
        line: 1,
      },
      { symbol: "legacyField", file: "convex/live.ts", line: 1 },
    ]);
  });

  it("keeps every undotted legacy symbol in informational discovery only", () => {
    const tieredOverrides = [
      ...referenceTiers.enforceable,
      ...referenceTiers.discovery,
    ];

    expect(tieredOverrides).toHaveLength(legacyOverrides.length);
    expect(new Set(tieredOverrides)).toEqual(new Set(legacyOverrides));
    expect(tieredOverrides.every(({ field }) => field.length > 0)).toBe(true);
    expect(
      referenceTiers.enforceable.every(({ field }) => field.includes(".")),
    ).toBe(true);
    expect(
      referenceTiers.discovery.every(({ field }) => !field.includes(".")),
    ).toBe(true);
  });

  it("summarizes redacted matches without line-number churn", () => {
    const summary = summarizeSchemaReferences([
      { symbol: "settings.token", file: "convex/settings.ts", line: 1 },
      { symbol: "settings.token", file: "convex/settings.ts", line: 4 },
      { symbol: "token", file: "lib/tokens.ts", line: 9 },
    ]);
    const movedLines = summarizeSchemaReferences([
      { symbol: "settings.token", file: "convex/settings.ts", line: 20 },
      { symbol: "settings.token", file: "convex/settings.ts", line: 40 },
      { symbol: "token", file: "lib/tokens.ts", line: 90 },
    ]);

    expect(summary).toMatchObject({
      totalMatches: 3,
      fileCount: 2,
      symbols: [
        { symbol: "settings.token", matches: 2, files: 1 },
        { symbol: "token", matches: 1, files: 1 },
      ],
    });
    expect(summary.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(summary.fingerprint).toBe(movedLines.fingerprint);
  });

  it("matches the reviewed Release 1B summary baseline", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const tiers = {
      enforceable: summarizeSchemaReferences(scanTier(root, "enforceable")),
      discovery: summarizeSchemaReferences(scanTier(root, "discovery")),
    };

    expect(tiers.enforceable.totalMatches).toBeGreaterThan(0);
    if (process.env.UPDATE_SCHEMA_REFERENCE_BASELINE === "1") {
      writeFileSync(
        fileURLToPath(
          new URL(
            "./fixtures/schema-contract-reference-baseline.json",
            import.meta.url,
          ),
        ),
        `${JSON.stringify({ version: 1, tiers }, null, 2)}\n`,
      );
      return;
    }
    expect({ version: 1, tiers }).toEqual(baseline);
  });
});
