import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import {
  assertPayrollLifecyclePermission,
  assertPayrollLifecycleTransition,
} from "@/lib/payroll-lifecycle";
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

async function seed(ctx: MutationCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Payroll Lifecycle Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const ownerId = await ctx.db.insert("users", {
    email: "payroll-lifecycle-owner@example.com",
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
  const payrollRunId = await ctx.db.insert("payrollRuns", {
    organizationId,
    cutoffStart: 100,
    cutoffEnd: 200,
    period: "Lifecycle run",
    runType: "regular",
    status: "finalized",
    processedBy: ownerId,
    finalizedBy: ownerId,
    finalizedAt: 300,
    createdAt: 1,
    updatedAt: 300,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Lifecycle",
      lastName: "Employee",
      email: "lifecycle-employee@example.com",
    },
    employment: {
      employeeId: "LIFE-001",
      position: "Accountant",
      department: "Finance",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 1_000, salaryType: "monthly" },
    schedule: {
      defaultSchedule: {
        monday: { in: "09:00", out: "18:00", isWorkday: true },
        tuesday: { in: "09:00", out: "18:00", isWorkday: true },
        wednesday: { in: "09:00", out: "18:00", isWorkday: true },
        thursday: { in: "09:00", out: "18:00", isWorkday: true },
        friday: { in: "09:00", out: "18:00", isWorkday: true },
        saturday: { in: "09:00", out: "18:00", isWorkday: false },
        sunday: { in: "09:00", out: "18:00", isWorkday: false },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const payslipId = await ctx.db.insert("payslips", {
    organizationId,
    employeeId,
    payrollRunId,
    period: "Lifecycle run",
    grossPay: 1_000,
    basicPay: 1_000,
    deductions: [],
    netPay: 1_000,
    daysWorked: 10,
    absences: 0,
    lateHours: 0,
    undertimeHours: 0,
    overtimeHours: 0,
    concernSummary: { messageCount: 0 },
    createdAt: 1,
  });
  const costItemId = await ctx.db.insert("accountingCostItems", {
    organizationId,
    payrollRunId,
    sourceType: "payroll_run",
    sourceKey: `${payrollRunId}:payroll`,
    name: "Payroll",
    amount: 1_000,
    amountPaid: 0,
    frequency: "one-time",
    status: "pending",
    createdAt: 300,
    updatedAt: 300,
  });
  return { organizationId, ownerId, payrollRunId, costItemId, payslipId };
}

describe("payroll lifecycle policy", () => {
  it("enforces maker-checker roles and irreversible financial progression", () => {
    expect(() => assertPayrollLifecyclePermission("hr", "finalize")).toThrow(
      "owner or admin",
    );
    expect(() =>
      assertPayrollLifecyclePermission("accounting", "record_payment"),
    ).not.toThrow();
    expect(() => assertPayrollLifecycleTransition("paid", "finalized")).toThrow(
      "cannot transition",
    );
    expect(() =>
      assertPayrollLifecycleTransition("paid", "voided"),
    ).not.toThrow();
  });

  it("archives independently without deleting posted accounting", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    const owner = t.withIdentity({
      email: "payroll-lifecycle-owner@example.com",
    });

    await owner.mutation(api.payroll.setPayrollRunArchived, {
      payrollRunId: fixture.payrollRunId,
      archived: true,
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(fixture.payrollRunId),
      cost: await ctx.db.get(fixture.costItemId),
    }));
    expect(state.run).toMatchObject({ status: "finalized" });
    expect(state.run?.archivedAt).toBeTypeOf("number");
    expect(state.cost).not.toBeNull();
  });

  it("retains cancelled runs and requires a reason to void posted runs", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    const owner = t.withIdentity({
      email: "payroll-lifecycle-owner@example.com",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.payrollRunId, { status: "paid" });
    });

    await expect(
      owner.mutation(api.payroll.updatePayrollRunStatus, {
        payrollRunId: fixture.payrollRunId,
        status: "voided",
      }),
    ).rejects.toThrow("Void reason is required");

    await t.run((ctx) =>
      ctx.db.patch(fixture.payrollRunId, { status: "cancelled" }),
    );
    await expect(
      owner.mutation(api.payroll.deletePayrollRun, {
        payrollRunId: fixture.payrollRunId,
      }),
    ).rejects.toThrow("Only draft payroll runs can be discarded");
    expect(
      await t.run((ctx) => ctx.db.get(fixture.payrollRunId)),
    ).not.toBeNull();
  });

  it("prevents accounting cost projections from bypassing payroll payment", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    const owner = t.withIdentity({
      email: "payroll-lifecycle-owner@example.com",
    });

    await expect(
      owner.mutation(api.accounting.updateCostItem, {
        itemId: fixture.costItemId,
        amountPaid: 1_000,
        status: "paid",
      }),
    ).rejects.toThrow("Payroll-generated financial fields are read-only");

    const run = await t.run((ctx) => ctx.db.get(fixture.payrollRunId));
    expect(run?.status).toBe("finalized");
  });

  it("blocks payslip edits after a run is cancelled or voided", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    const owner = t.withIdentity({
      email: "payroll-lifecycle-owner@example.com",
    });

    for (const status of ["cancelled", "voided"] as const) {
      await t.run((ctx) => ctx.db.patch(fixture.payrollRunId, { status }));
      await expect(
        owner.mutation(api.payroll.updatePayslip, {
          payslipId: fixture.payslipId,
          deductions: [],
        }),
      ).rejects.toThrow("only be edited while payroll is a draft");
    }
  });
});
