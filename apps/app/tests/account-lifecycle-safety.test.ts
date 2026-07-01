import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readAppFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("account lifecycle safety", () => {
  it("does not globally deactivate a user when employment status changes", () => {
    const source = readAppFile("../convex/employees.ts");

    expect(source).not.toContain("ctx.db.patch(linkedUser._id");
    expect(source).not.toContain("isActive,");
  });

  it("does not delete global user accounts or all memberships from employee removal", () => {
    const source = readAppFile("../convex/employees.ts");

    expect(source).not.toContain("await ctx.db.delete(linkedUser._id)");
    expect(source).not.toContain(
      "for (const uo of userOrgs) await ctx.db.delete(uo._id);",
    );
    expect(source).not.toContain("await ctx.db.delete(args.employeeId);");
  });

  it("does not delete employee history when removing org membership", () => {
    const source = readAppFile("../convex/organizations.ts");

    expect(source).not.toContain("await ctx.db.delete(employeeId);");
  });
});
