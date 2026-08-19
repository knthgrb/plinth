import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("leave migration query regression", () => {
  it("does not constrain the same Convex index field twice", () => {
    const source = readSource("../convex/leaveMigration.ts");

    expect(source).not.toMatch(
      /\.eq\("year",\s*(?:balance|snapshot)\.year\)\s*\.eq\("year"/,
    );
    expect(source).not.toMatch(
      /\.eq\("poolKey",\s*snapshot\.poolKey\)\s*\.eq\("poolKey"/,
    );
  });

  it("uses the shared spinner for leave policy loading", () => {
    const source = readSource(
      "../components/settings/leave-types-settings-content.tsx",
    );

    expect(source).toContain('from "@/components/ui/spinner"');
    expect(source).toContain('<Spinner size="lg"');
    expect(source).not.toContain("Loading leave policy settings");
  });
});
