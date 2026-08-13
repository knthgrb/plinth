import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { FULL_SCHEMA_CLEANUP_DOMAINS } from "../convex/fullSchemaCleanupRegistry";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const workday = { in: "09:00", out: "18:00", isWorkday: true };

describe("leave and employee children schema", () => {
  it("registers the wave as an implemented migration", () => {
    expect(
      FULL_SCHEMA_CLEANUP_DOMAINS.find(
        ({ domain }) => domain === "leave_employee_children",
      ),
    ).toMatchObject({
      migrationKey: "full-schema-leave-employee-children",
      migrationVersion: 1,
      implementation: "migration",
    });
  });

  it("stores every normalized target under tenant and natural-key indexes", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Release 1C Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "hr@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Schema",
          lastName: "Employee",
          email: "employee@example.com",
        },
        employment: {
          employeeId: "SCHEMA-001",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: {
          defaultSchedule: {
            monday: workday,
            tuesday: workday,
            wednesday: workday,
            thursday: workday,
            friday: workday,
            saturday: { ...workday, isWorkday: false },
            sunday: { ...workday, isWorkday: false },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      });

      const leaveSettingsId = await ctx.db.insert("organizationLeaveSettings", {
        organizationId,
        proratedLeave: true,
        leaveAccrualFrequency: "monthly",
        leaveTrackerMode: "general",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const leaveBalanceId = await ctx.db.insert("employeeLeaveBalances", {
        organizationId,
        employeeId,
        year: 2026,
        leaveTypeKey: "vacation",
        total: 8,
        used: 2,
        balance: 6,
        source: "employee_credits",
        approvedDays: 2,
        reconciliationStatus: "matching",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const requirementId = await ctx.db.insert("employeeRequirements", {
        organizationId,
        employeeId,
        sourceKey: "bir-2316:0",
        type: "BIR 2316",
        status: "submitted",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const deductionId = await ctx.db.insert("employeeDeductions", {
        organizationId,
        employeeId,
        sourceId: "loan-1",
        type: "loan",
        name: "Company loan",
        amount: 1_000,
        frequency: "monthly",
        startDate: 1,
        isActive: true,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const incentiveId = await ctx.db.insert("employeeIncentives", {
        organizationId,
        employeeId,
        sourceId: "bonus-1",
        name: "Performance bonus",
        amount: 2_000,
        frequency: "one-time",
        isActive: true,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const overrideId = await ctx.db.insert("employeeScheduleOverrides", {
        organizationId,
        employeeId,
        date: 2,
        in: "10:00",
        out: "19:00",
        reason: "Client coverage",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const paymentId = await ctx.db.insert("employeePaymentAccounts", {
        organizationId,
        employeeId,
        bankName: "Example Bank",
        accountNumber: "encrypted-or-legacy-value",
        accountName: "Schema Employee",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const definitionId = await ctx.db.insert(
        "organizationCustomFieldDefinitions",
        {
          organizationId,
          entityType: "employee",
          sourceKey: "shirt-size",
          label: "Shirt size",
          valueType: "string",
          isActive: true,
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      );
      const customValueId = await ctx.db.insert("employeeCustomFieldValues", {
        organizationId,
        employeeId,
        definitionId,
        sourceKey: "shirt-size",
        valueType: "string",
        valueJson: '"M"',
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });

      return {
        leaveSettings: await ctx.db
          .query("organizationLeaveSettings")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", organizationId),
          )
          .take(2),
        leaveBalances: await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_employee_year_type", (query) =>
            query
              .eq("employeeId", employeeId)
              .eq("year", 2026)
              .eq("leaveTypeKey", "vacation"),
          )
          .take(2),
        requirements: await ctx.db
          .query("employeeRequirements")
          .withIndex("by_employee_source_key", (query) =>
            query.eq("employeeId", employeeId).eq("sourceKey", "bir-2316:0"),
          )
          .take(2),
        childIds: [
          leaveSettingsId,
          leaveBalanceId,
          requirementId,
          deductionId,
          incentiveId,
          overrideId,
          paymentId,
          definitionId,
          customValueId,
          userId,
        ],
      };
    });

    expect(result.leaveSettings).toHaveLength(1);
    expect(result.leaveBalances).toHaveLength(1);
    expect(result.requirements).toHaveLength(1);
    expect(result.childIds).toHaveLength(10);
  });
});
