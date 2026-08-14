import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import {
  ensurePendingBenefitReconciliation,
  removeBenefitReconciliationPayrollAllocationsForRun,
  resolveBenefitReconciliationStatus,
  syncBenefitReconciliationPayrollAllocation,
  voidBenefitReconciliation,
} from "../convex/leaveBenefitPayroll";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const getBenefitReconciliationQueue = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  { hasSensitiveAccess: boolean; rows: unknown[] }
>("leaveBenefitPayroll:getBenefitReconciliationQueue");

describe("statutory leave benefit payroll reconciliation", () => {
  it("tracks employer advances through external reimbursement", () => {
    expect(
      resolveBenefitReconciliationStatus({
        employerAdvanceAmount: 0,
        externalBenefitAmount: 0,
        reimbursedAmount: 0,
        waived: false,
      }),
    ).toBe("pending");
    expect(
      resolveBenefitReconciliationStatus({
        employerAdvanceAmount: 50_000,
        externalBenefitAmount: 40_000,
        reimbursedAmount: 0,
        waived: false,
      }),
    ).toBe("advanced");
    expect(
      resolveBenefitReconciliationStatus({
        employerAdvanceAmount: 50_000,
        externalBenefitAmount: 40_000,
        reimbursedAmount: 20_000,
        waived: false,
      }),
    ).toBe("partially_reimbursed");
    expect(
      resolveBenefitReconciliationStatus({
        employerAdvanceAmount: 50_000,
        externalBenefitAmount: 40_000,
        reimbursedAmount: 40_000,
        waived: false,
      }),
    ).toBe("reconciled");
  });

  it("keeps an explicit waived state", () => {
    expect(
      resolveBenefitReconciliationStatus({
        employerAdvanceAmount: 0,
        externalBenefitAmount: 0,
        reimbursedAmount: 0,
        waived: true,
      }),
    ).toBe("waived");
  });

  it("derives the expected amount from a real payroll allocation and voids cancelled leave", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Benefit Payroll",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "benefit-payroll@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Benefit",
          lastName: "Employee",
          email: "benefit-employee@example.com",
        },
        employment: {
          employeeId: "BEN-1",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
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
      const leaveRequestId = await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "maternity",
        startDate: 1,
        endDate: 2,
        numberOfDays: 1,
        reason: "Protected leave",
        status: "approved",
        payTreatment: "statutory_benefit_supported",
        filedDate: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const request = await ctx.db.get(leaveRequestId);
      if (!request) throw new Error("Request missing");
      await ensurePendingBenefitReconciliation(ctx, request, userId, 1);
      const payrollRunId = await ctx.db.insert("payrollRuns", {
        organizationId,
        cutoffStart: 1,
        cutoffEnd: 2,
        period: "Test period",
        status: "draft",
        processedBy: userId,
        createdAt: 2,
        updatedAt: 2,
      });
      const payslipId = await ctx.db.insert("payslips", {
        organizationId,
        employeeId,
        payrollRunId,
        period: "Test period",
        grossPay: 12_000,
        deductions: [],
        netPay: 12_000,
        daysWorked: 10,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 2,
      });
      await syncBenefitReconciliationPayrollAllocation(ctx, {
        organizationId,
        employeeId,
        leaveRequestId,
        payrollRunId,
        payslipId,
        attributedPay: 1_500,
        actorId: userId,
        now: 2,
      });
      const linked = await ctx.db
        .query("leaveBenefitPayrollReconciliations")
        .withIndex("by_request", (builder) =>
          builder.eq("leaveRequestId", leaveRequestId),
        )
        .unique();
      const allocations = linked
        ? await ctx.db
            .query("leaveBenefitPayrollAllocations")
            .withIndex("by_reconciliation", (builder) =>
              builder.eq("reconciliationId", linked._id),
            )
            .collect()
        : [];
      await removeBenefitReconciliationPayrollAllocationsForRun(
        ctx,
        payrollRunId,
        userId,
        3,
      );
      const deallocated = linked ? await ctx.db.get(linked._id) : null;
      const remainingAllocations = await ctx.db
        .query("leaveBenefitPayrollAllocations")
        .withIndex("by_payroll_run", (builder) =>
          builder.eq("payrollRunId", payrollRunId),
        )
        .collect();
      await voidBenefitReconciliation(ctx, leaveRequestId, userId, 3);
      return {
        linked,
        allocations,
        deallocated,
        remainingAllocations,
        voided: linked ? await ctx.db.get(linked._id) : null,
      };
    });

    expect(result.linked).toMatchObject({
      expectedGrossBenefitAmount: 1_500,
    });
    expect(result.allocations).toEqual([
      expect.objectContaining({ attributedPay: 1_500 }),
    ]);
    expect(result.deallocated?.expectedGrossBenefitAmount).toBe(0);
    expect(result.remainingAllocations).toEqual([]);
    expect(result.voided?.status).toBe("voided");
  });

  it("does not let historical voided rows exhaust the active queue bound", async () => {
    const t = convexTest(schema, modules);
    const ownerEmail = "benefit-owner@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Benefit Queue",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: ownerEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Queue",
          lastName: "Employee",
          email: ownerEmail,
        },
        employment: {
          employeeId: "BEN-Q",
          position: "Owner",
          department: "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
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
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leaveSensitiveAccessGrants", {
        organizationId,
        membershipId,
        isActive: true,
        grantedBy: userId,
        grantedAt: 1,
      });
      const leaveRequestId = await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "maternity",
        startDate: 1,
        endDate: 1,
        numberOfDays: 1,
        reason: "Protected",
        status: "cancelled",
        payTreatment: "statutory_benefit_supported",
        filedDate: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert("leaveBenefitPayrollReconciliations", {
          organizationId,
          employeeId,
          leaveRequestId,
          expectedGrossBenefitAmount: 0,
          employerAdvanceAmount: 0,
          externalBenefitAmount: 0,
          salaryDifferentialAmount: 0,
          reimbursedAmount: 0,
          status: "voided",
          updatedBy: userId,
          createdAt: index,
          updatedAt: index,
        });
      }
      return organizationId;
    });
    const result = await t
      .withIdentity({ email: ownerEmail })
      .query(getBenefitReconciliationQueue, { organizationId });

    expect(result).toEqual({ hasSensitiveAccess: true, rows: [] });
  });
});
