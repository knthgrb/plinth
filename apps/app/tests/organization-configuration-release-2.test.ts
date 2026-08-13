import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  getEffectiveOrganization,
  getEffectiveSettings,
} from "../convex/organizationConfiguration";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

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
        cutoffDates: { firstCutoff: 12, secondCutoff: 27 },
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
      cutoffDates: { firstCutoff: 12, secondCutoff: 27 },
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

  it("does not read legacy configuration when normalized rows are absent", async () => {
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
      defaultRequirements: [],
      _normalizationSources: { payroll: "default", requirements: "normalized" },
    });
    expect(result.organization?.salaryPaymentFrequency).toBeUndefined();
    expect(result.organization?.firstPayDate).toBeUndefined();
    expect(result.organization?.secondPayDate).toBeUndefined();
    expect(result.settings).toMatchObject({
      departments: [],
      _normalizationSources: {
        payroll: "default",
        attendance: "default",
        departments: "normalized",
      },
    });
    expect(result.settings.payrollSettings).toBeUndefined();
    expect(result.settings.attendanceSettings).toBeUndefined();
  });

  it("keeps canonical child collections empty after an organization is normalized", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Canonical empty collections",
        defaultRequirements: [{ type: "Legacy requirement" }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        payrollSettings: { nightDiffPercent: 1.9 },
        departments: [{ name: "Legacy department", color: "#abcdef" }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
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
      defaultRequirements: [],
      _normalizationSources: { requirements: "normalized" },
    });
    expect(result.settings).toMatchObject({
      departments: [],
      _normalizationSources: {
        payroll: "normalized",
        departments: "normalized",
      },
    });
    expect(result.settings.payrollSettings).toBeUndefined();
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

  it("rejects duplicate normalized child keys", async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Duplicate canonical children",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const department = {
        organizationId,
        name: "Operations",
        normalizedName: "operations",
        color: "#123456",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      await ctx.db.insert("organizationDepartments", department);
      await ctx.db.insert("organizationDepartments", department);
      const requirement = {
        organizationId,
        type: "NBI Clearance",
        normalizedType: "nbi clearance",
        source: "organization" as const,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      await ctx.db.insert("organizationRequirementDefinitions", requirement);
      await ctx.db.insert("organizationRequirementDefinitions", requirement);
      return organizationId;
    });

    await expect(
      t.run((ctx) => getEffectiveSettings(ctx, organizationId)),
    ).rejects.toThrow("Duplicate normalized department rows");
    await expect(
      t.run((ctx) => getEffectiveOrganization(ctx, organizationId)),
    ).rejects.toThrow("Duplicate normalized requirement rows");
  });

  it("returns canonical configuration through existing authenticated queries", async () => {
    const t = convexTest(schema, modules);
    const email = "owner@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Query compatibility",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 5,
        secondPayDate: 20,
        defaultRequirements: [{ type: "Legacy requirement" }],
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
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
        payrollSettings: { nightDiffPercent: 1.2 },
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationAttendanceSettings", {
        organizationId,
        attendanceSettings: { graceMinutes: 10 },
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Canonical",
        normalizedName: "canonical",
        color: "#123456",
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationRequirementDefinitions", {
        organizationId,
        type: "Canonical requirement",
        normalizedType: "canonical requirement",
        source: "organization",
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return organizationId;
    });
    const authenticated = t.withIdentity({ email });

    const [organization, settings, requirements] = await Promise.all([
      authenticated.query(api.organizations.getOrganization, {
        organizationId,
      }),
      authenticated.query(api.settings.getSettings, { organizationId }),
      authenticated.query(api.organizations.getDefaultRequirements, {
        organizationId,
      }),
    ]);

    expect(organization).toMatchObject({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });
    expect(settings).toMatchObject({
      payrollSettings: { nightDiffPercent: 1.2 },
      attendanceSettings: { graceMinutes: 10 },
      departments: [{ name: "Canonical", color: "#123456" }],
    });
    expect(requirements).toEqual([{ type: "Canonical requirement" }]);
  });

  it("uses canonical requirements when creating an employee", async () => {
    const t = convexTest(schema, modules);
    const email = "hr@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Employee requirements",
        defaultRequirements: [{ type: "Legacy requirement" }],
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "hr",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationRequirementDefinitions", {
        organizationId,
        type: "Canonical requirement",
        normalizedType: "canonical requirement",
        isRequired: true,
        source: "organization",
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return organizationId;
    });
    const workday = { in: "09:00", out: "18:00", isWorkday: true };
    const restDay = { in: "09:00", out: "18:00", isWorkday: false };

    const employeeId = await t
      .withIdentity({ email })
      .mutation(api.employees.createEmployee, {
        organizationId,
        personalInfo: {
          firstName: "Canonical",
          lastName: "Employee",
          email: "employee@example.com",
        },
        employment: {
          employeeId: "TEMP",
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
            saturday: restDay,
            sunday: restDay,
          },
        },
      });
    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(employeeId),
      requirements: await ctx.db
        .query("employeeRequirements")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .filter((query) => query.eq(query.field("employeeId"), employeeId))
        .collect(),
    }));

    expect(state.employee?.requirements).toBeUndefined();
    expect(state.requirements).toEqual([
      expect.objectContaining({
        type: "Canonical requirement",
        isDefault: true,
      }),
    ]);
  });

  it("uses canonical pay cadence in payroll finalization recipients", async () => {
    const t = convexTest(schema, modules);
    const email = "payroll-owner@example.com";
    const payrollRunId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Canonical payroll recipients",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 5,
        secondPayDate: 20,
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return ctx.db.insert("payrollRuns", {
        organizationId,
        cutoffStart: 1,
        cutoffEnd: 2,
        period: "Test period",
        status: "finalized",
        processedBy: userId,
        createdAt: 2,
        updatedAt: 2,
      });
    });

    const result = await t
      .withIdentity({ email })
      .query(api.payroll.getPayrollFinalizePayslipRecipients, {
        payrollRunId,
      });

    expect(result?.paySchedule).toEqual({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });
  });

  it("writes payroll and attendance changes only to normalized rows", async () => {
    const t = convexTest(schema, modules);
    const email = "configuration-owner@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Dual write settings",
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        payrollSettings: { nightDiffPercent: 1.1 },
        attendanceSettings: { graceMinutes: 5 },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        payrollSettings: { nightDiffPercent: 1.1 },
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationAttendanceSettings", {
        organizationId,
        attendanceSettings: { graceMinutes: 5 },
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });
    const authenticated = t.withIdentity({ email });

    await authenticated.mutation(api.settings.updatePayrollSettings, {
      organizationId,
      payrollSettings: {
        nightDiffPercent: 1.3,
        dailyRateWorkingDaysPerYear: 260,
      },
    });
    await authenticated.mutation(api.organizations.updateOrganization, {
      organizationId,
      salaryPaymentFrequency: "monthly",
      firstPayDate: 28,
      secondPayDate: 28,
    });
    await authenticated.mutation(api.settings.updateAttendanceSettings, {
      organizationId,
      attendanceSettings: { graceMinutes: 9, roundingRule: "nearest_5" },
    });

    const result = await t.run(async (ctx) => ({
      organization: await ctx.db.get(organizationId),
      settings: await ctx.db
        .query("settings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique(),
      payroll: await ctx.db
        .query("organizationPayrollSettings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique(),
      attendance: await ctx.db
        .query("organizationAttendanceSettings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique(),
    }));
    expect(result.organization).toMatchObject({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });
    expect(result.payroll).toMatchObject({
      salaryPaymentFrequency: "monthly",
      firstPayDate: 28,
      secondPayDate: 28,
      payrollSettings: {
        nightDiffPercent: 1.3,
        dailyRateWorkingDaysPerYear: 260,
      },
      migrationVersion: 2,
    });
    expect(result.settings?.payrollSettings).toEqual({ nightDiffPercent: 1.1 });
    expect(result.attendance).toMatchObject({
      attendanceSettings: { graceMinutes: 9, roundingRule: "nearest_5" },
      migrationVersion: 2,
    });
    expect(result.settings?.attendanceSettings).toEqual({ graceMinutes: 5 });
  });

  it("reconciles department and requirement rows while preserving stable IDs", async () => {
    const t = convexTest(schema, modules);
    const email = "structure-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Stable configuration children",
        defaultRequirements: [{ type: "NBI Clearance", isRequired: true }],
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        departments: [{ name: "Operations", color: "#111111" }],
        createdAt: 1,
        updatedAt: 1,
      });
      const departmentId = await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Operations",
        normalizedName: "operations",
        color: "#111111",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
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
          createdAt: 1,
          updatedAt: 1,
        },
      );
      return { organizationId, departmentId, requirementId };
    });
    const authenticated = t.withIdentity({ email });

    await authenticated.mutation(api.settings.updateDepartments, {
      organizationId: fixture.organizationId,
      departments: [
        { name: "Operations", color: "#222222" },
        { name: "Finance", color: "#333333" },
      ],
    });
    await authenticated.mutation(api.organizations.updateDefaultRequirements, {
      organizationId: fixture.organizationId,
      requirements: [
        { type: "NBI Clearance", isRequired: false },
        { type: "Medical Certificate", isRequired: true },
      ],
    });

    const result = await t.run(async (ctx) => ({
      organization: await ctx.db.get(fixture.organizationId),
      settings: await ctx.db
        .query("settings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .unique(),
      departments: await ctx.db
        .query("organizationDepartments")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect(),
      requirements: await ctx.db
        .query("organizationRequirementDefinitions")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect(),
    }));
    expect(result.settings?.departments).toEqual([
      { name: "Operations", color: "#111111" },
    ]);
    expect(result.departments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: fixture.departmentId,
          normalizedName: "operations",
          color: "#222222",
          migrationVersion: 2,
        }),
        expect.objectContaining({
          normalizedName: "finance",
          migrationVersion: 2,
        }),
      ]),
    );
    expect(result.organization?.defaultRequirements).toEqual([
      { type: "NBI Clearance", isRequired: true },
    ]);
    expect(result.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: fixture.requirementId,
          normalizedType: "nbi clearance",
          isRequired: false,
          migrationVersion: 2,
        }),
        expect.objectContaining({
          normalizedType: "medical certificate",
          migrationVersion: 2,
        }),
      ]),
    );
  });

  it("creates normalized payroll defaults with a new organization", async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t
      .withIdentity({ email: "new-owner@example.com", name: "New Owner" })
      .mutation(api.organizations.createOrganization, {
        name: "New normalized organization",
      });

    const payroll = await t.run((ctx) =>
      ctx.db
        .query("organizationPayrollSettings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique(),
    );
    expect(payroll).toMatchObject({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
      migrationVersion: 2,
    });
  });

  it("rejects duplicate normalized department names before writing", async () => {
    const t = convexTest(schema, modules);
    const email = "duplicate-departments@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Department validation",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        departments: [{ name: "Existing", color: "#111111" }],
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    await expect(
      t.withIdentity({ email }).mutation(api.settings.updateDepartments, {
        organizationId,
        departments: [
          { name: "Operations", color: "#222222" },
          { name: " operations ", color: "#333333" },
        ],
      }),
    ).rejects.toThrow("Department names must be unique and non-empty");

    const settings = await t.run((ctx) =>
      ctx.db
        .query("settings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique(),
    );
    expect(settings?.departments).toEqual([
      { name: "Existing", color: "#111111" },
    ]);
  });

  it("rejects a department head without active membership in the organization", async () => {
    const t = convexTest(schema, modules);
    const email = "department-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Head validation",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other tenant",
        createdAt: 1,
        updatedAt: 1,
      });
      const ownerId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other-tenant-head@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: ownerId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        departments: [{ name: "Existing", color: "#111111" }],
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, otherUserId };
    });

    await expect(
      t.withIdentity({ email }).mutation(api.settings.updateDepartments, {
        organizationId: fixture.organizationId,
        departments: [
          {
            name: "Operations",
            color: "#222222",
            departmentHeadUserId: fixture.otherUserId,
          },
        ],
      }),
    ).rejects.toThrow("Department head must be an active organization member");
  });
});
