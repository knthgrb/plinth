import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
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

const workday = { in: "09:00", out: "18:00", isWorkday: true };

async function setup() {
  const t = convexTest(schema, modules);
  const email = "compatibility-hr@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Compatibility Organization",
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
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Normalized",
        lastName: "Employee",
        email: "employee@example.com",
      },
      employment: {
        employeeId: "EMP-001",
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
    await ctx.db.insert("employeeDeductions", {
      organizationId,
      employeeId,
      sourceId: "normalized",
      type: "other",
      name: "Normalized deduction",
      amount: 200,
      frequency: "monthly",
      startDate: 2,
      isActive: true,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { organizationId, employeeId };
  });
  return { t, actor: t.withIdentity({ email }), ...fixture };
}

describe("leave and employee child compatibility", () => {
  it("loads employee deductions from normalized rows", async () => {
    const { actor, employeeId } = await setup();

    const employee = await actor.query(api.employees.getEmployee, {
      employeeId,
    });

    expect(employee?.deductions).toEqual([
      expect.objectContaining({
        id: "normalized",
        name: "Normalized deduction",
        amount: 200,
      }),
    ]);
  });

  it("writes a new deduction only to the normalized table", async () => {
    const { t, actor, employeeId } = await setup();

    await actor.mutation(api.employees.addDeduction, {
      employeeId,
      deduction: {
        id: "new-deduction",
        type: "loan",
        name: "Employee loan",
        amount: 500,
        frequency: "per-cutoff",
        startDate: 3,
        isActive: true,
      },
    });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(employeeId),
      deductions: await ctx.db
        .query("employeeDeductions")
        .withIndex("by_employee_source_id", (q) =>
          q.eq("employeeId", employeeId).eq("sourceId", "new-deduction"),
        )
        .collect(),
    }));
    expect(state.employee).not.toHaveProperty("deductions");
    expect(state.deductions).toHaveLength(1);
    expect(state.deductions[0]).toMatchObject({
      sourceId: "new-deduction",
      name: "Employee loan",
      amount: 500,
    });
  });

  it("updates default requirements from the normalized employee projection", async () => {
    const { t, actor, organizationId, employeeId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("employeeRequirements", {
        organizationId,
        employeeId,
        sourceKey: "normalized-custom:0",
        type: "Normalized custom",
        isRequired: true,
        status: "pending",
        isCustom: true,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await actor.mutation(api.organizations.updateDefaultRequirements, {
      organizationId,
      requirements: [{ type: "Government ID", isRequired: true }],
    });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(employeeId),
      requirements: await ctx.db
        .query("employeeRequirements")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organizationId),
        )
        .filter((q) => q.eq(q.field("employeeId"), employeeId))
        .collect(),
    }));
    expect(state.employee).not.toHaveProperty("requirements");
    expect(state.requirements.map((row) => row.type).sort()).toEqual(
      ["Government ID", "Normalized custom"].sort(),
    );
  });
});
