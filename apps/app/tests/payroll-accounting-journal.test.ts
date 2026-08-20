import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";

import { api } from "../convex/_generated/api";
import {
  buildPayrollAccrualJournal,
  buildPayrollJournalAdjustment,
  type PayrollJournalPayslip,
} from "@/lib/payroll-journal";
import type { MutationCtx } from "../convex/_generated/server";
import {
  postPayrollAccrualJournal,
  postPayrollPaymentJournal,
  reversePayrollJournalsForRun,
} from "../convex/payrollAccounting";
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

const basePayslip: PayrollJournalPayslip = {
  employeeId: "employee-1",
  netPay: 7_500,
  deductions: [
    { name: "SSS", type: "government", amount: 500 },
    { name: "PhilHealth", type: "government", amount: 250 },
    { name: "Pag-IBIG", type: "government", amount: 200 },
    { name: "Withholding Tax", type: "government", amount: 1_000 },
    { name: "Cash advance", type: "loan", amount: 500 },
    { name: "Absence", type: "attendance", amount: 50 },
  ],
  employerContributions: { sss: 1_010, philhealth: 250, pagibig: 200 },
};

describe("payroll accounting journals", () => {
  it("builds a balanced accrual with payroll and statutory liabilities", () => {
    const journal = buildPayrollAccrualJournal([basePayslip]);

    expect(journal.lines).toEqual([
      {
        accountCode: "6000",
        accountName: "Compensation Expense",
        debit: 9_950,
        credit: 0,
      },
      {
        accountCode: "6010",
        accountName: "Employer Statutory Contribution Expense",
        debit: 1_460,
        credit: 0,
      },
      {
        accountCode: "2100",
        accountName: "Payroll Payable",
        debit: 0,
        credit: 7_500,
      },
      {
        accountCode: "2110",
        accountName: "SSS Payable",
        debit: 0,
        credit: 1_510,
      },
      {
        accountCode: "2120",
        accountName: "PhilHealth Payable",
        debit: 0,
        credit: 500,
      },
      {
        accountCode: "2130",
        accountName: "Pag-IBIG Payable",
        debit: 0,
        credit: 400,
      },
      {
        accountCode: "2140",
        accountName: "Withholding Tax Payable",
        debit: 0,
        credit: 1_000,
      },
      {
        accountCode: "2150",
        accountName: "Other Payroll Deductions Payable",
        debit: 0,
        credit: 500,
      },
    ]);
    expect(journal.totalDebits).toBe(11_410);
    expect(journal.totalCredits).toBe(11_410);
  });

  it("creates a balanced delta journal without treating it as paid", () => {
    const nextPayslip: PayrollJournalPayslip = {
      ...basePayslip,
      netPay: 8_000,
      deductions: basePayslip.deductions.filter(
        (line) => line.name !== "Cash advance",
      ),
    };

    const adjustment = buildPayrollJournalAdjustment(
      buildPayrollAccrualJournal([basePayslip]),
      buildPayrollAccrualJournal([nextPayslip]),
    );

    expect(adjustment.lines).toEqual([
      {
        accountCode: "2100",
        accountName: "Payroll Payable",
        debit: 0,
        credit: 500,
      },
      {
        accountCode: "2150",
        accountName: "Other Payroll Deductions Payable",
        debit: 500,
        credit: 0,
      },
    ]);
    expect(adjustment.totalDebits).toBe(500);
    expect(adjustment.totalCredits).toBe(500);
  });

  it("posts accrual and payment once by stable source identity, then reverses", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx: MutationCtx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Journal Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const actorId = await ctx.db.insert("users", {
        email: "journal-owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        organizationId,
        userId: actorId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Journal",
          lastName: "Employee",
          email: "journal-employee@example.com",
        },
        employment: {
          employeeId: "JOURNAL-1",
          position: "Accountant",
          department: "Finance",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 10_000, salaryType: "monthly" },
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
      const payrollRunId = await ctx.db.insert("payrollRuns", {
        organizationId,
        cutoffStart: 1,
        cutoffEnd: 2,
        period: "Journal period",
        runType: "regular",
        status: "finalized",
        processedBy: actorId,
        createdAt: 1,
        updatedAt: 2,
      });
      await ctx.db.insert("payslips", {
        organizationId,
        employeeId,
        payrollRunId,
        period: "Journal period",
        periodStart: 1,
        periodEnd: 2,
        grossPay: 9_000,
        basicPay: 9_000,
        deductions: [
          { name: "SSS", type: "government", amount: 500 },
          { name: "Withholding Tax", type: "government", amount: 1_000 },
        ],
        employerContributions: { sss: 1_010 },
        netPay: 7_500,
        daysWorked: 10,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 2,
      });
      return { organizationId, actorId, payrollRunId };
    });

    await t.run(async (ctx) => {
      const first = await postPayrollAccrualJournal(
        ctx,
        fixture.payrollRunId,
        fixture.actorId,
      );
      const retry = await postPayrollAccrualJournal(
        ctx,
        fixture.payrollRunId,
        fixture.actorId,
      );
      expect(retry).toBe(first);
      await postPayrollPaymentJournal(
        ctx,
        fixture.payrollRunId,
        fixture.actorId,
      );
    });

    const beforeVoid = await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("accountingJournalEntries")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("sourceType", "payroll_run")
            .eq("sourceId", String(fixture.payrollRunId)),
        )
        .collect();
      const payment = entries.find(
        (entry) => entry.entryType === "payroll_payment",
      );
      const paymentLines = payment
        ? await ctx.db
            .query("accountingJournalLines")
            .withIndex("by_entry", (query) =>
              query.eq("journalEntryId", payment._id),
            )
            .collect()
        : [];
      return { entries, paymentLines };
    });
    expect(beforeVoid.entries).toHaveLength(2);
    expect(beforeVoid.paymentLines.map((line) => line.accountCode)).toEqual([
      "2100",
      "1000",
    ]);

    await t.run((ctx) =>
      ctx.db.patch(fixture.payrollRunId, { status: "paid", paidAt: 3 }),
    );
    const owner = t.withIdentity({ email: "journal-owner@example.com" });
    await owner.mutation(api.accounting.repairPayrollAccounting, {
      organizationId: fixture.organizationId,
      payrollRunId: fixture.payrollRunId,
    });
    const projections = await t.run((ctx) =>
      ctx.db
        .query("accountingCostItems")
        .withIndex("by_payroll_run", (query) =>
          query.eq("payrollRunId", fixture.payrollRunId),
        )
        .collect(),
    );
    expect(
      projections.find((item) => item.sourceKey?.endsWith(":payroll")),
    ).toMatchObject({ status: "paid", amountPaid: 7_500 });
    expect(
      projections.find((item) => item.sourceKey?.endsWith(":sss")),
    ).toMatchObject({ status: "pending", amountPaid: 0 });
    expect(
      projections.find((item) => item.sourceKey?.endsWith(":tax")),
    ).toMatchObject({ status: "pending", amountPaid: 0 });

    await t.run(async (ctx) => {
      const payrollProjection = projections.find((item) =>
        item.sourceKey?.endsWith(":payroll"),
      );
      if (!payrollProjection) throw new Error("Payroll projection missing");
      await ctx.db.patch(payrollProjection._id, {
        sourceUpdatedAt: 4,
        updatedAt: 4,
      });
      const payslip = await ctx.db
        .query("payslips")
        .withIndex("by_payroll_run", (query) =>
          query.eq("payrollRunId", fixture.payrollRunId),
        )
        .unique();
      if (!payslip) throw new Error("Payslip missing");
      await ctx.db.patch(payslip._id, { netPay: 8_000 });
    });
    await owner.mutation(api.accounting.repairPayrollAccounting, {
      organizationId: fixture.organizationId,
      payrollRunId: fixture.payrollRunId,
    });
    const correctedPayrollProjection = await t.run((ctx) =>
      ctx.db
        .query("accountingCostItems")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("sourceType", "payroll_run")
            .eq("sourceKey", `${fixture.payrollRunId}:payroll`),
        )
        .unique(),
    );
    expect(correctedPayrollProjection).toMatchObject({
      amount: 8_000,
      amountPaid: 7_500,
      status: "partial",
    });

    await t.run((ctx) =>
      reversePayrollJournalsForRun(
        ctx,
        fixture.payrollRunId,
        fixture.actorId,
        "Payroll voided in test",
      ),
    );
    const afterVoid = await t.run((ctx) =>
      ctx.db
        .query("accountingJournalEntries")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("sourceType", "payroll_run")
            .eq("sourceId", String(fixture.payrollRunId)),
        )
        .collect(),
    );
    expect(
      afterVoid.filter((entry) => entry.entryType === "payroll_reversal"),
    ).toHaveLength(2);
    expect(
      afterVoid
        .filter((entry) => entry.entryType !== "payroll_reversal")
        .every((entry) => entry.status === "reversed"),
    ).toBe(true);
  });
});
