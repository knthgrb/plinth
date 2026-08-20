import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
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

const schedule: Doc<"employees">["schedule"] = {
  defaultSchedule: {
    monday: { in: "09:00", out: "18:00", isWorkday: true },
    tuesday: { in: "09:00", out: "18:00", isWorkday: true },
    wednesday: { in: "09:00", out: "18:00", isWorkday: true },
    thursday: { in: "09:00", out: "18:00", isWorkday: true },
    friday: { in: "09:00", out: "18:00", isWorkday: true },
    saturday: { in: "09:00", out: "18:00", isWorkday: false },
    sunday: { in: "09:00", out: "18:00", isWorkday: false },
  },
};

type Fixture = {
  organizationId: Id<"organizations">;
  ownerId: Id<"users">;
  employeeId: Id<"employees">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Special Payroll Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const ownerId = await ctx.db.insert("users", {
    email: "special-payroll-owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("userOrganizations", {
    organizationId,
    userId: ownerId,
    role: "owner",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Special",
      lastName: "Employee",
      email: "special-employee@example.com",
    },
    employment: {
      employeeId: "SPECIAL-001",
      position: "Analyst",
      department: "Finance",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 120_000, salaryType: "monthly" },
    schedule,
    createdAt: 1,
    updatedAt: 1,
  });
  return { organizationId, ownerId, employeeId };
}

async function insertRegularPayslip(
  ctx: MutationCtx,
  fixture: Fixture,
  status: "draft" | "finalized",
  basicPay: number,
) {
  const start = Date.parse("2026-01-01T00:00:00+08:00");
  const end = Date.parse("2026-01-15T23:59:59.999+08:00");
  const payrollRunId = await ctx.db.insert("payrollRuns", {
    organizationId: fixture.organizationId,
    cutoffStart: start,
    cutoffEnd: end,
    period: `Regular ${status}`,
    runType: "regular",
    status,
    processedBy: fixture.ownerId,
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("payslips", {
    organizationId: fixture.organizationId,
    employeeId: fixture.employeeId,
    payrollRunId,
    period: `Regular ${status}`,
    periodStart: start,
    periodEnd: end,
    grossPay: basicPay,
    basicPay,
    deductions: [],
    netPay: basicPay,
    daysWorked: 1,
    absences: 0,
    lateHours: 0,
    undertimeHours: 0,
    overtimeHours: 0,
    createdAt: 1,
  });
}

describe("special payroll runs", () => {
  it("computes 13th month pay from posted regular payroll only", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run(async (ctx) => {
      await insertRegularPayslip(ctx, fixture, "finalized", 120_000);
      await insertRegularPayslip(ctx, fixture, "draft", 120_000);
    });
    const owner = t.withIdentity({ email: "special-payroll-owner@example.com" });

    const amounts = await owner.query(api.payroll.compute13thMonthAmounts, {
      organizationId: fixture.organizationId,
      year: 2026,
      employeeIds: [fixture.employeeId],
    });

    expect(amounts).toHaveLength(1);
    expect(amounts?.[0]).toMatchObject({
      totalBasicPay: 120_000,
      thirteenthMonthAmount: 10_000,
    });
  });

  it("prevents a duplicate 13th month run for the same year", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run((ctx) => insertRegularPayslip(ctx, fixture, "finalized", 120_000));
    const owner = t.withIdentity({ email: "special-payroll-owner@example.com" });

    await owner.mutation(api.payroll.create13thMonthRun, {
      organizationId: fixture.organizationId,
      year: 2026,
      employeeIds: [fixture.employeeId],
    });

    const storedRun = await t.run((ctx) =>
      ctx.db
        .query("payrollRuns")
        .withIndex("by_organization_runType_year", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("runType", "13th_month")
            .eq("year", 2026),
        )
        .unique(),
    );
    expect(storedRun?.statutoryRuleVersion).toBe("ph-2025-01");

    await expect(
      owner.mutation(api.payroll.create13thMonthRun, {
        organizationId: fixture.organizationId,
        year: 2026,
        employeeIds: [fixture.employeeId],
      }),
    ).rejects.toThrow("already exists");
  });
});
