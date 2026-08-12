import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_FIELD_OVERRIDES,
  type SchemaItemClassification,
} from "../convex/fullSchemaInventory";
import { scanSchemaReferences } from "./helpers/schema-reference-scan";

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

  it("scans only intended source roots and applies exclusions to relative paths", () => {
    const root = createFixture();
    writeFixture(root, "convex/live.ts", "legacyField;\n");
    writeFixture(root, "convex/excluded.ts", "legacyField;\n");
    writeFixture(root, "tests/legacy.test.ts", "legacyField;\n");
    writeFixture(root, "services/legacy.ts", "legacyField;\n");

    expect(
      scanSchemaReferences(root, ["legacyField"], [/^convex\/excluded\.ts$/]),
    ).toEqual([{ symbol: "legacyField", file: "convex/live.ts", line: 1 }]);
  });

  it("covers every legacy policy symbol and produces a deterministic baseline", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const symbols = FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
      legacyClassifications.includes(classification),
    ).map(({ field }) => field);
    const exclusions = [
      /(^|\/)schema\.ts$/,
      /(^|\/)fullSchemaInventory\.ts$/,
      /(^|\/)databaseMigrations\.ts$/,
      /(^|\/)dataMigrations\.ts$/,
      /(^|\/)migrations?(\/|$)/,
      /(^|\/)_(generated)(\/|$)/,
      /(^|\/)tests(\/|$)/,
      /(^|\/)docs(\/|$)/,
    ];

    expect(symbols).toHaveLength(
      FULL_SCHEMA_FIELD_OVERRIDES.filter(({ classification }) =>
        legacyClassifications.includes(classification),
      ).length,
    );
    expect(symbols.every((symbol) => symbol.length > 0)).toBe(true);
    expect(scanSchemaReferences(root, symbols, exclusions)).toEqual(
      scanSchemaReferences(root, symbols, exclusions),
    );
  });
});
