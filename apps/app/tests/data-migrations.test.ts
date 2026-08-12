import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

describe("database migration schema", () => {
  it("stores normalized organization configuration and migration state", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Normalized organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        createdAt: 1,
        updatedAt: 1,
      });
      const payrollId = await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const attendanceId = await ctx.db.insert(
        "organizationAttendanceSettings",
        {
          organizationId,
          attendanceSettings: { graceMinutes: 5, roundingRule: "none" },
          sourceSettingsId: settingsId,
          migrationVersion: 1,
          createdAt: 2,
          updatedAt: 2,
        },
      );
      const departmentId = await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Operations",
        normalizedName: "operations",
        color: "#9CA3AF",
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const requirementId = await ctx.db.insert(
        "organizationRequirementDefinitions",
        {
          organizationId,
          type: "NBI Clearance",
          normalizedType: "nbi clearance",
          isRequired: true,
          source: "organization",
          migrationVersion: 1,
          createdAt: 2,
          updatedAt: 2,
        },
      );
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      });
      const issueId = await ctx.db.insert("migrationIssues", {
        runId,
        organizationId,
        entityType: "organization",
        entityId: organizationId,
        field: "salaryPaymentFrequency",
        code: "PAYROLL_FREQUENCY_CONFLICT",
        createdAt: 2,
      });

      const [payroll, attendance, department, requirement, run, issues] =
        await Promise.all([
          ctx.db
            .query("organizationPayrollSettings")
            .withIndex("by_organization", (q) =>
              q.eq("organizationId", organizationId),
            )
            .unique(),
          ctx.db
            .query("organizationAttendanceSettings")
            .withIndex("by_organization", (q) =>
              q.eq("organizationId", organizationId),
            )
            .unique(),
          ctx.db
            .query("organizationDepartments")
            .withIndex("by_organization_normalized_name", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("normalizedName", "operations"),
            )
            .unique(),
          ctx.db
            .query("organizationRequirementDefinitions")
            .withIndex("by_organization_normalized_type", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("normalizedType", "nbi clearance"),
            )
            .unique(),
          ctx.db
            .query("migrationRuns")
            .withIndex("by_key_status", (q) =>
              q
                .eq("key", "schema-normalization-release-1")
                .eq("status", "running"),
            )
            .unique(),
          ctx.db
            .query("migrationIssues")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
        ]);

      return {
        payrollId,
        attendanceId,
        departmentId,
        requirementId,
        runId,
        issueId,
        payroll,
        attendance,
        department,
        requirement,
        run,
        issues,
      };
    });

    expect(result.payroll?._id).toBe(result.payrollId);
    expect(result.attendance?._id).toBe(result.attendanceId);
    expect(result.department?._id).toBe(result.departmentId);
    expect(result.requirement?._id).toBe(result.requirementId);
    expect(result.run?._id).toBe(result.runId);
    expect(result.issues.map((issue) => issue._id)).toEqual([result.issueId]);
  });
});
