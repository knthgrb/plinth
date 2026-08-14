import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Doc } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import {
  lockApprovedLeaveOccurrencesForPayrollRun,
  markAttendanceConflictForDate,
  reconcileOccurrenceAsNonChargeable,
} from "../convex/leaveOccurrencePayroll";
import schema from "../convex/schema";
import {
  isMigratedLegacyLeaveRequestForPayroll,
  resolveLeavePayrollDay,
} from "../lib/leave/payroll-integration";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const MANILA_OFFSET = 8 * 60 * 60 * 1_000;
const manilaDate = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day) - MANILA_OFFSET;

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const defaultSchedule: Doc<"employees">["schedule"]["defaultSchedule"] = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: { ...workday, isWorkday: false },
  sunday: { ...workday, isWorkday: false },
};

async function seedOccurrence(ctx: MutationCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Occurrence Integration",
    createdAt: 1,
    updatedAt: 1,
  });
  const userId = await ctx.db.insert("users", {
    email: "occurrence.hr@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Leave",
      lastName: "Integration",
      email: "occurrence.employee@example.com",
    },
    employment: {
      employeeId: "OCC-1",
      position: "Analyst",
      department: "People",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule: { defaultSchedule },
    createdAt: 1,
    updatedAt: 1,
  });
  const policyId = await ctx.db.insert("leavePolicies", {
    organizationId,
    sourceKey: "company_vacation",
    name: "Vacation Leave",
    category: "company",
    confidentiality: "standard",
    state: "active",
    createdBy: userId,
    createdAt: 1,
    updatedAt: 1,
  });
  const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
    organizationId,
    leavePolicyId: policyId,
    version: 1,
    effectiveStart: manilaDate(2026, 1, 1),
    accountBehavior: "individual_account",
    payTreatment: "company_paid",
    durationBasis: "scheduled_work",
    entitlementMethod: "annual",
    annualUnits: 5,
    eligibilityBasis: "hire_date",
    completedServiceMonths: 0,
    prorationMethod: "none",
    roundingIncrement: 1,
    carryoverMode: "none",
    conversionAllowed: false,
    createdBy: userId,
    createdAt: 1,
    changeReason: "Test",
  });
  const balanceId = await ctx.db.insert("employeeLeaveBalances", {
    organizationId,
    employeeId,
    policyId,
    policyVersionId,
    periodStart: manilaDate(2026, 1, 1),
    periodEnd: manilaDate(2026, 12, 31),
    granted: 5,
    used: 1,
    reserved: 0,
    converted: 0,
    expired: 0,
    balance: 4,
    total: 5,
    approvedDays: 1,
    projectionVersion: 1,
    year: 2026,
    leaveTypeKey: "company_vacation",
    source: "employee_credits",
    reconciliationStatus: "matching",
    migrationVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  });
  const leaveRequestId = await ctx.db.insert("leaveRequests", {
    organizationId,
    employeeId,
    leaveType: "vacation",
    startDate: manilaDate(2026, 12, 15),
    endDate: manilaDate(2026, 12, 15),
    numberOfDays: 1,
    reason: "Future leave",
    status: "approved",
    policyId,
    policyVersionId,
    chargeableDuration: 1,
    payTreatment: "company_paid",
    engineVersion: 2,
    filedDate: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("leaveLedgerEntries", {
    organizationId,
    employeeId,
    balanceId,
    policyVersionId,
    effectiveDate: manilaDate(2026, 12, 15),
    kind: "usage",
    amount: -1,
    unit: "day",
    referenceType: "request",
    leaveRequestId,
    reason: "Approved leave",
    idempotencyKey: `usage:${leaveRequestId}`,
    createdAt: 1,
  });
  const occurrenceId = await ctx.db.insert("leaveRequestOccurrences", {
    leaveRequestId,
    organizationId,
    employeeId,
    localDate: "2026-12-15",
    scheduleSnapshot: { isWorkday: true, scheduledMinutes: 480 },
    holidaySnapshot: { isHoliday: false },
    scheduledMinutes: 480,
    leaveMinutes: 480,
    creditAmount: 1,
    payTreatment: "company_paid",
    lifecycleState: "approved",
    attendanceConflictState: "none",
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    organizationId,
    userId,
    employeeId,
    balanceId,
    leaveRequestId,
    occurrenceId,
  };
}

describe("leave attendance and payroll integration", () => {
  it("uses legacy payroll fallback only for migrated requests without a V2 submitter", () => {
    expect(
      isMigratedLegacyLeaveRequestForPayroll({
        engineVersion: 2,
        cutoverAt: 1,
      }),
    ).toBe(true);
    expect(
      isMigratedLegacyLeaveRequestForPayroll({
        engineVersion: 2,
        cutoverAt: 1,
        submittedBy: "user-1",
      }),
    ).toBe(false);
    expect(isMigratedLegacyLeaveRequestForPayroll({ engineVersion: 1 })).toBe(
      false,
    );
  });

  it("resolves paid, unpaid partial, and statutory-supported occurrences", () => {
    expect(
      resolveLeavePayrollDay({
        scheduledMinutes: 480,
        leaveMinutes: 480,
        payTreatment: "company_paid",
      }),
    ).toEqual({ paidFraction: 1, unpaidFraction: 0 });
    expect(
      resolveLeavePayrollDay({
        scheduledMinutes: 480,
        leaveMinutes: 240,
        payTreatment: "unpaid",
      }),
    ).toEqual({ paidFraction: 0, unpaidFraction: 0.5 });
    expect(
      resolveLeavePayrollDay({
        scheduledMinutes: 480,
        leaveMinutes: 480,
        payTreatment: "statutory_benefit_supported",
      }),
    ).toEqual({
      paidFraction: 1,
      unpaidFraction: 0,
      requiresBenefitBreakdown: true,
    });
  });

  it("rejects invalid occurrence minutes", () => {
    expect(() =>
      resolveLeavePayrollDay({
        scheduledMinutes: 0,
        leaveMinutes: 1,
        payTreatment: "company_paid",
      }),
    ).toThrow("scheduled minutes");
    expect(() =>
      resolveLeavePayrollDay({
        scheduledMinutes: 480,
        leaveMinutes: 481,
        payTreatment: "unpaid",
      }),
    ).toThrow("cannot exceed");
  });

  it("marks actual work as a leave conflict and restores an unlocked future holiday charge", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const fixture = await seedOccurrence(ctx);
      await markAttendanceConflictForDate(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        attendanceDate: manilaDate(2026, 12, 15),
        hasActualWork: true,
        updatedAt: manilaDate(2026, 8, 15),
      });
      const conflicted = await ctx.db.get(fixture.occurrenceId);
      await reconcileOccurrenceAsNonChargeable(ctx, {
        occurrenceId: fixture.occurrenceId,
        actorId: fixture.userId,
        reason: "Holiday calendar added",
        updatedAt: manilaDate(2026, 8, 15),
      });
      return {
        conflicted,
        occurrence: await ctx.db.get(fixture.occurrenceId),
        balance: await ctx.db.get(fixture.balanceId),
        request: await ctx.db.get(fixture.leaveRequestId),
      };
    });

    expect(result.conflicted?.attendanceConflictState).toBe("detected");
    expect(result.occurrence).toMatchObject({
      creditAmount: 0,
      leaveMinutes: 0,
      lifecycleState: "corrected",
      attendanceConflictState: "resolved",
    });
    expect(result.balance).toMatchObject({ used: 0, balance: 5 });
    expect(result.request).toMatchObject({
      chargeableDuration: 0,
      numberOfDays: 0,
    });
  });

  it("locks approved occurrences to finalized payroll and rejects later silent reconciliation", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const fixture = await seedOccurrence(ctx);
      const payrollRunId = await ctx.db.insert("payrollRuns", {
        organizationId: fixture.organizationId,
        cutoffStart: manilaDate(2026, 12, 1),
        cutoffEnd: manilaDate(2026, 12, 31),
        period: "December 2026",
        status: "finalized",
        runType: "regular",
        processedBy: fixture.userId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("payslips", {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        payrollRunId,
        period: "December 2026",
        periodStart: manilaDate(2026, 12, 1),
        periodEnd: manilaDate(2026, 12, 31),
        basicPay: 1,
        grossPay: 1,
        deductions: [],
        netPay: 1,
        daysWorked: 1,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 1,
      });
      const locked = await lockApprovedLeaveOccurrencesForPayrollRun(
        ctx,
        payrollRunId,
        manilaDate(2027, 1, 1),
      );
      const occurrence = await ctx.db.get(fixture.occurrenceId);
      let rejection = "";
      try {
        await reconcileOccurrenceAsNonChargeable(ctx, {
          occurrenceId: fixture.occurrenceId,
          actorId: fixture.userId,
          reason: "Late holiday edit",
          updatedAt: manilaDate(2026, 8, 15),
        });
      } catch (error: unknown) {
        rejection = error instanceof Error ? error.message : "unknown";
      }
      return { locked, occurrence, rejection };
    });

    expect(result.locked).toBe(1);
    expect(result.occurrence?.payrollLockedAt).toBeDefined();
    expect(result.rejection).toContain("payroll-locked");
  });
});
