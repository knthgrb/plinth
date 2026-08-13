import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("configurable settings hardening", () => {
  it("versions settings changes with an audit log", () => {
    const settingsSource = readSource("../convex/settings.ts");
    const schemaSource = readSource("../convex/schema.ts");
    const compatibilitySource = readSource("../convex/workflowCompatibility.ts");

    expect(schemaSource).toContain("organizationSettingsEvents");
    expect(schemaSource).toContain("version: v.number()");
    expect(schemaSource).toContain("changedBy: v.id(\"users\")");
    expect(settingsSource).toContain("appendOrganizationSettingsEvent");
    expect(compatibilitySource).toContain("changedBy: userId");
    expect(settingsSource).not.toContain("buildSettingsAuditPatch");
    expect(settingsSource).not.toContain("settingsChangeLog:");
  });

  it("prevents single holiday create and update duplicates", () => {
    const source = readSource("../convex/holidays.ts");

    expect(source).toContain("assertNoDuplicateHoliday");
    expect(source).toContain("excludeHolidayId");
    expect(source).toContain("A holiday already exists for this date, type, and scope.");
    expect(source).toContain("await assertNoDuplicateHoliday(ctx, {");
  });
});
