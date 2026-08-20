import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
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

async function setupSeparatedEmployee() {
  const t = convexTest(schema, modules);
  const email = "final-pay-owner@example.com";
  const separationDate = Date.UTC(2026, 7, 10);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Final Pay Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const ownerId = await ctx.db.insert("users", {
      email,
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
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Final",
        lastName: "Employee",
        email: "final.employee@example.com",
      },
      employment: {
        employeeId: "FINAL-001",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: Date.UTC(2024, 0, 1),
        separationDate,
        lastWorkingDay: separationDate,
        status: "resigned",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
      schedule,
      createdAt: 1,
      updatedAt: separationDate,
    });
    const separationEventId = await ctx.db.insert("employeeLifecycleEvents", {
      organizationId,
      employeeId,
      type: "resigned",
      effectiveAt: separationDate,
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      recordedBy: ownerId,
      createdAt: separationDate,
    });
    return { organizationId, ownerId, employeeId, separationEventId };
  });

  return { t, actor: t.withIdentity({ email }), separationDate, ...fixture };
}

describe("final settlement workflow", () => {
  it("prepares final settlement for a canonical separation event", async () => {
    const { t, actor, organizationId, employeeId, separationEventId } =
      await setupSeparatedEmployee();

    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture missing");
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee.employment,
          status: "separated",
          separationType: "job_abandonment",
        },
      });
      await ctx.db.patch(separationEventId, {
        type: "separated",
        separationType: "job_abandonment",
      });
    });

    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );

    await expect(
      t.run((ctx) => ctx.db.get(settlementId)),
    ).resolves.toMatchObject({
      separationEventId,
      separationType: "job_abandonment",
    });
  });

  it("creates a new settlement for a later separation after rehire", async () => {
    const { t, actor, organizationId, ownerId, employeeId, separationEventId } =
      await setupSeparatedEmployee();

    const firstSettlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    const firstSettlement = await t.run((ctx) => ctx.db.get(firstSettlementId));
    expect(firstSettlement).toMatchObject({
      separationEventId,
      separationKey: `${employeeId}:resignation:${Date.UTC(2026, 7, 10)}`,
    });

    const secondSeparationDate = Date.UTC(2027, 2, 5);
    const secondSeparationEventId = await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture missing");
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee.employment,
          hireDate: Date.UTC(2026, 10, 1),
          separationDate: secondSeparationDate,
          lastWorkingDay: secondSeparationDate,
          status: "terminated",
        },
        updatedAt: secondSeparationDate,
      });
      return ctx.db.insert("employeeLifecycleEvents", {
        organizationId,
        employeeId,
        type: "terminated",
        effectiveAt: secondSeparationDate,
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        recordedBy: ownerId,
        createdAt: secondSeparationDate,
      });
    });

    const secondSettlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    const secondSettlement = await t.run((ctx) =>
      ctx.db.get(secondSettlementId),
    );

    expect(secondSettlementId).not.toBe(firstSettlementId);
    expect(secondSettlement).toMatchObject({
      separationEventId: secondSeparationEventId,
      separationKey: `${employeeId}:termination:${secondSeparationDate}`,
    });
  });

  it("blocks edits after payroll generation", async () => {
    const { t, actor, organizationId, ownerId, employeeId, separationDate } =
      await setupSeparatedEmployee();
    const settlementId = await t.run((ctx) =>
      ctx.db.insert("finalSettlements", {
        organizationId,
        employeeId,
        status: "payroll_generated",
        separationType: "resigned",
        separationDate,
        clearanceItems: [
          {
            id: "hr",
            label: "HR Clearance",
            required: true,
            status: "completed",
          },
        ],
        loanPayoffs: [],
        customDeductions: [],
        bir2316: { status: "not_started" },
        finalTaxRelease: { status: "pending" },
        createdBy: ownerId,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      actor.mutation(api.finalSettlements.updateClearanceItem, {
        settlementId,
        itemId: "hr",
        status: "pending",
      }),
    ).rejects.toThrow("cannot be edited");
  });

  it("returns employee clearance to pending when a required item is reopened", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      const employee = await ctx.db.get(employeeId);
      if (!settlement || !employee) throw new Error("Fixture missing");
      await ctx.db.patch(settlementId, {
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
      await ctx.db.patch(employeeId, {
        employment: { ...employee.employment, clearanceStatus: "cleared" },
      });
    });

    const settlement = await t.run((ctx) => ctx.db.get(settlementId));
    if (!settlement) throw new Error("Settlement fixture missing");
    await actor.mutation(api.finalSettlements.updateClearanceItem, {
      settlementId,
      itemId: settlement.clearanceItems[0].id,
      status: "pending",
    });

    const employee = await t.run((ctx) => ctx.db.get(employeeId));
    expect(employee?.employment.clearanceStatus).toBe("pending");
  });

  it("links one final-pay draft and restores the settlement when the draft is deleted", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });

    const payrollRunId = await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 15),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: false,
    });
    const generated = await t.run((ctx) => ctx.db.get(settlementId));
    expect(generated).toMatchObject({
      status: "payroll_generated",
      payrollRunId,
      calculationVersion: 1,
      bir2316: { status: "not_started", calculationVersion: 1 },
      finalTaxRelease: { status: "pending", calculationVersion: 1 },
    });

    await expect(
      actor.mutation(api.payroll.createPayrollRun, {
        organizationId,
        cutoffStart: Date.UTC(2026, 7, 16),
        cutoffEnd: Date.UTC(2026, 7, 31),
        employeeIds: [employeeId],
        runType: "final_pay",
        deductionsEnabled: false,
      }),
    ).rejects.toThrow("must be ready for payroll");

    await expect(
      actor.mutation(api.payroll.updatePayrollRunStatus, {
        payrollRunId,
        status: "paid",
      }),
    ).rejects.toThrow("cannot transition from draft to paid");

    await actor.mutation(api.payroll.deletePayrollRun, { payrollRunId });
    const restored = await t.run((ctx) => ctx.db.get(settlementId));
    expect(restored).toMatchObject({ status: "ready_for_payroll" });
    expect(restored?.payrollRunId).toBeUndefined();
    expect(restored?.payslipId).toBeUndefined();
  });

  it("requires generated payroll before tax review", async () => {
    const { actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );

    await expect(
      actor.mutation(api.finalSettlements.markFinalTaxReviewed, {
        settlementId,
      }),
    ).rejects.toThrow("Generate the final-pay payroll draft");
    await expect(
      actor.mutation(api.finalSettlements.markBir2316DataReady, {
        settlementId,
      }),
    ).rejects.toThrow("Generate the final-pay payroll draft");
  });

  it("requires an audit reason when applied final tax overrides the annualized calculation", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });
    await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 10),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: false,
    });
    const generated = await t.run((ctx) => ctx.db.get(settlementId));
    if (!generated?.payslipId) throw new Error("Final payslip was not linked");

    await actor.mutation(api.payroll.updatePayslip, {
      payslipId: generated.payslipId,
      deductions: [
        { name: "Withholding Tax", amount: 100, type: "government" },
      ],
    });

    await expect(
      actor.mutation(api.finalSettlements.markFinalTaxReviewed, {
        settlementId,
      }),
    ).rejects.toThrow("override reason");

    await actor.mutation(api.finalSettlements.markFinalTaxReviewed, {
      settlementId,
      overrideReason: "Validated against the employee's prior BIR 2316.",
    });
    const reviewed = await t.run((ctx) => ctx.db.get(settlementId));
    expect(reviewed?.finalTaxRelease).toMatchObject({
      status: "reviewed",
      appliedAdjustment: 100,
      variance: 100,
      overrideReason: "Validated against the employee's prior BIR 2316.",
    });
  });

  it("annualizes prior compensation and applies the final withholding adjustment", async () => {
    const { t, actor, organizationId, ownerId, employeeId } =
      await setupSeparatedEmployee();
    await t.run(async (ctx) => {
      const regularRunId = await ctx.db.insert("payrollRuns", {
        organizationId,
        cutoffStart: Date.UTC(2026, 0, 1),
        cutoffEnd: Date.UTC(2026, 6, 31),
        period: "Jan 1 - Jul 31, 2026",
        runType: "regular",
        status: "finalized",
        processedBy: ownerId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("payslips", {
        organizationId,
        employeeId,
        payrollRunId: regularRunId,
        period: "Jan 1 - Jul 31, 2026",
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 6, 31),
        grossPay: 500_000,
        basicPay: 500_000,
        deductions: [
          { name: "SSS", amount: 10_000, type: "government" },
          { name: "PhilHealth", amount: 10_000, type: "government" },
          { name: "Pag-IBIG", amount: 10_000, type: "government" },
          { name: "Withholding Tax", amount: 30_000, type: "government" },
        ],
        netPay: 440_000,
        daysWorked: 100,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 1,
      });
    });
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });
    await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 10),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: true,
    });

    const result = await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      const payslip = settlement?.payslipId
        ? await ctx.db.get(settlement.payslipId)
        : null;
      return { settlement, payslip };
    });
    expect(
      result.settlement?.finalTaxRelease.annualTaxableIncome,
    ).toBeGreaterThan(470_000);
    expect(
      result.settlement?.finalTaxRelease.calculatedAdjustment,
    ).toBeGreaterThan(6_500);
    expect(result.payslip?.deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Withholding Tax",
          amount: result.settlement?.finalTaxRelease.calculatedAdjustment,
        }),
      ]),
    );
  });

  it("unlinks the settlement when a final-pay draft is cancelled", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });
    const payrollRunId = await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 15),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: false,
    });

    await actor.mutation(api.payroll.updatePayrollRunStatus, {
      payrollRunId,
      status: "cancelled",
    });

    const settlement = await t.run((ctx) => ctx.db.get(settlementId));
    expect(settlement).toMatchObject({ status: "ready_for_payroll" });
    expect(settlement?.payrollRunId).toBeUndefined();
    expect(settlement?.payslipId).toBeUndefined();
  });

  it("invalidates tax and BIR review when a final-pay draft is regenerated", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });
    const payrollRunId = await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 15),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: false,
    });
    await actor.mutation(api.finalSettlements.markBir2316DataReady, {
      settlementId,
    });
    await actor.mutation(api.finalSettlements.markFinalTaxReviewed, {
      settlementId,
    });

    await actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId,
      cutoffEnd: Date.UTC(2026, 7, 14),
      employeeIds: [employeeId],
      deductionsEnabled: false,
    });

    const state = await t.run(async (ctx) => ({
      settlement: await ctx.db.get(settlementId),
      payrollRun: await ctx.db.get(payrollRunId),
    }));
    expect(state.settlement).toMatchObject({
      calculationVersion: 2,
      bir2316: { status: "not_started", calculationVersion: 2 },
      finalTaxRelease: { status: "pending", calculationVersion: 2 },
    });
    expect(state.payrollRun?.period).toMatch(/^Final Pay /);

    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture missing");
      await ctx.db.patch(employeeId, {
        employment: { ...employee.employment, status: "active" },
      });
    });
    await expect(
      actor.mutation(api.payroll.updatePayrollRun, {
        payrollRunId,
        employeeIds: [employeeId],
      }),
    ).rejects.toThrow(
      "Final pay drafts can only contain resigned or terminated employees",
    );
  });

  it("recalculates final tax after preserving a taxable payslip addition", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupSeparatedEmployee();
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });
    const payrollRunId = await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart: Date.UTC(2026, 7, 1),
      cutoffEnd: Date.UTC(2026, 7, 15),
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: true,
    });
    const before = await t.run((ctx) => ctx.db.get(settlementId));
    if (!before?.payslipId) throw new Error("Final payslip fixture missing");

    await actor.mutation(api.payroll.updatePayslip, {
      payslipId: before.payslipId,
      incentives: [
        {
          name: "Taxable separation bonus",
          amount: 300_000,
          type: "incentive",
          taxable: true,
        },
      ],
    });
    await actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId,
      preserveExistingPayslipEdits: true,
    });

    const after = await t.run((ctx) => ctx.db.get(settlementId));
    expect(after?.finalTaxRelease.annualTaxableIncome).toBe(
      (before.finalTaxRelease.annualTaxableIncome ?? 0) + 300_000,
    );
    expect(after?.finalTaxRelease.calculatedAdjustment).toBeGreaterThan(0);
  });

  it("does not repay basic salary already covered by an overlapping regular run", async () => {
    const { t, actor, organizationId, ownerId, employeeId } =
      await setupSeparatedEmployee();
    const cutoffStart = Date.UTC(2026, 7, 1);
    const cutoffEnd = Date.UTC(2026, 7, 15);
    await t.run(async (ctx) => {
      const regularRunId = await ctx.db.insert("payrollRuns", {
        organizationId,
        cutoffStart,
        cutoffEnd,
        period: "08/01/2026 to 08/15/2026",
        runType: "regular",
        status: "finalized",
        processedBy: ownerId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("payslips", {
        organizationId,
        employeeId,
        payrollRunId: regularRunId,
        period: "08/01/2026 to 08/15/2026",
        periodStart: cutoffStart,
        periodEnd: cutoffEnd,
        grossPay: 9_000,
        basicPay: 9_000,
        deductions: [],
        netPay: 9_000,
        daysWorked: 6,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 1,
      });
    });
    const settlementId = await actor.mutation(
      api.finalSettlements.prepareFinalSettlement,
      { organizationId, employeeId },
    );
    await t.run(async (ctx) => {
      const settlement = await ctx.db.get(settlementId);
      if (!settlement) throw new Error("Settlement fixture missing");
      await ctx.db.patch(settlementId, {
        status: "ready_for_payroll",
        clearanceItems: settlement.clearanceItems.map((item) => ({
          ...item,
          status: "completed" as const,
        })),
      });
    });

    const finalRunId = await actor.mutation(api.payroll.createPayrollRun, {
      organizationId,
      cutoffStart,
      cutoffEnd,
      employeeIds: [employeeId],
      runType: "final_pay",
      deductionsEnabled: false,
    });
    const finalPayslip = await t.run((ctx) =>
      ctx.db
        .query("payslips")
        .withIndex("by_payroll_run", (query) =>
          query.eq("payrollRunId", finalRunId),
        )
        .unique(),
    );

    expect(finalPayslip?.basicPay).toBe(0);
    expect(finalPayslip?.absences).toBe(0);
    expect(finalPayslip?.deductions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "attendance" })]),
    );
    expect(finalPayslip?.incentives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "13th Month Accrual", amount: 750 }),
      ]),
    );
  });
});
