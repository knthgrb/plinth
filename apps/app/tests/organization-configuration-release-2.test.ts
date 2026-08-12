import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import {
  getEffectiveOrganization,
  getEffectiveSettings,
} from "../convex/organizationConfiguration";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

describe("Release 2 organization configuration", () => {
  it("prefers normalized configuration over conflicting legacy values", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Canonical configuration",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 10,
        secondPayDate: 25,
        defaultRequirements: [{ type: "Legacy ID", isRequired: false }],
        createdAt: 1,
        updatedAt: 1,
      });
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        payrollSettings: { nightDiffPercent: 1.1 },
        attendanceSettings: { graceMinutes: 5 },
        departments: [{ name: "Legacy", color: "#000000" }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        payrollSettings: { nightDiffPercent: 1.25 },
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationAttendanceSettings", {
        organizationId,
        attendanceSettings: { graceMinutes: 12 },
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Operations",
        normalizedName: "operations",
        color: "#123456",
        parentDepartmentNormalizedName: "leadership",
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Leadership",
        normalizedName: "leadership",
        color: "#654321",
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 3,
        updatedAt: 3,
      });
      await ctx.db.insert("organizationRequirementDefinitions", {
        organizationId,
        type: "NBI Clearance",
        normalizedType: "nbi clearance",
        isRequired: true,
        source: "organization",
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });

      return {
        organization: await getEffectiveOrganization(ctx, organizationId),
        settings: await getEffectiveSettings(ctx, organizationId),
      };
    });

    expect(result.organization).toMatchObject({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
      defaultRequirements: [{ type: "NBI Clearance", isRequired: true }],
      _normalizationSources: {
        payroll: "normalized",
        requirements: "normalized",
      },
    });
    expect(result.settings).toMatchObject({
      payrollSettings: { nightDiffPercent: 1.25 },
      attendanceSettings: { graceMinutes: 12 },
      _normalizationSources: {
        payroll: "normalized",
        attendance: "normalized",
        departments: "normalized",
      },
    });
    expect(result.settings?.departments).toEqual([
      { name: "Leadership", color: "#654321" },
      {
        name: "Operations",
        color: "#123456",
        parentDepartmentName: "Leadership",
      },
    ]);
  });

  it("falls back to legacy configuration when normalized rows are absent", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Legacy fallback",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 8,
        secondPayDate: 24,
        defaultRequirements: [{ type: "Legacy requirement" }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        payrollSettings: { regularHolidayRate: 2.5 },
        attendanceSettings: { graceMinutes: 7 },
        departments: [{ name: "Legacy team", color: "#abcdef" }],
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        organization: await getEffectiveOrganization(ctx, organizationId),
        settings: await getEffectiveSettings(ctx, organizationId),
      };
    });

    expect(result.organization).toMatchObject({
      salaryPaymentFrequency: "monthly",
      firstPayDate: 8,
      secondPayDate: 24,
      defaultRequirements: [{ type: "Legacy requirement" }],
      _normalizationSources: { payroll: "legacy", requirements: "legacy" },
    });
    expect(result.settings).toMatchObject({
      payrollSettings: { regularHolidayRate: 2.5 },
      attendanceSettings: { graceMinutes: 7 },
      departments: [{ name: "Legacy team", color: "#abcdef" }],
      _normalizationSources: {
        payroll: "legacy",
        attendance: "legacy",
        departments: "legacy",
      },
    });
  });

  it("rejects duplicate normalized singleton rows", async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Duplicate canonical rows",
        createdAt: 1,
        updatedAt: 1,
      });
      const row = {
        organizationId,
        salaryPaymentFrequency: "bimonthly" as const,
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      await ctx.db.insert("organizationPayrollSettings", row);
      await ctx.db.insert("organizationPayrollSettings", row);
      return organizationId;
    });

    await expect(
      t.run((ctx) =>
        getEffectiveOrganization(ctx, organizationId as Id<"organizations">),
      ),
    ).rejects.toThrow("Duplicate normalized payroll settings");
  });
});
