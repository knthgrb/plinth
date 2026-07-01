import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("leave tracker audit", () => {
  it("requires a reason for manual leave tracker overrides", () => {
    const settingsSource = readSource("../convex/settings.ts");
    const trackerSource = readSource(
      "../app/[organizationId]/leave/_components/leave-tracker-tab.tsx",
    );
    const schemaSource = readSource("../convex/schema.ts");

    expect(settingsSource).toContain("overrideReason: v.string()");
    expect(settingsSource).toContain("args.overrideReason.trim()");
    expect(settingsSource).toContain("updatedBy: userRecord._id");
    expect(settingsSource).toContain("updatedAt: now");
    expect(schemaSource).toContain("overrideReason: v.optional(v.string())");
    expect(trackerSource).toContain("overrideReason");
    expect(trackerSource).toContain("Reason for manual override");
  });
});
