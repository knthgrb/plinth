import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("configurable settings hardening", () => {
  it("versions settings changes with an audit log", () => {
    const settingsSource = readSource("../convex/settings.ts");
    const schemaSource = readSource("../convex/schema.ts");

    expect(schemaSource).toContain("settingsVersion: v.optional(v.number())");
    expect(schemaSource).toContain("settingsChangeLog: v.optional(");
    expect(settingsSource).toContain("buildSettingsAuditPatch");
    expect(settingsSource).toContain("settingsVersion: nextSettingsVersion");
    expect(settingsSource).toContain("changedBy: userRecord._id");
    expect(settingsSource).toContain("...buildSettingsAuditPatch(settings, \"payroll\", userRecord, now)");
    expect(settingsSource).toContain("...buildSettingsAuditPatch(settings, \"leave\", userRecord, now)");
  });

  it("prevents single holiday create and update duplicates", () => {
    const source = readSource("../convex/holidays.ts");

    expect(source).toContain("assertNoDuplicateHoliday");
    expect(source).toContain("excludeHolidayId");
    expect(source).toContain("A holiday already exists for this date, type, and scope.");
    expect(source).toContain("await assertNoDuplicateHoliday(ctx, {");
  });
});
