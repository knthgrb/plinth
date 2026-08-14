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

const workday = { in: "09:00", out: "18:00", isWorkday: true };

describe("canonical leave v2 schema", () => {
  it("stores policy, ledger, request occurrence, and event rows under their operational indexes", async () => {
    const t = convexTest(schema, modules);

    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Leave V2 Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Leave",
          lastName: "Employee",
          email: "leave.employee@example.com",
        },
        employment: {
          employeeId: "LEAVE-001",
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
      const policyId = await ctx.db.insert("leavePolicies", {
        organizationId,
        sourceKey: "private_sil",
        name: "Service Incentive Leave",
        category: "statutory",
        confidentiality: "standard",
        state: "active",
        complianceRole: "private_sil_minimum",
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
        organizationId,
        leavePolicyId: policyId,
        version: 1,
        effectiveStart: 1,
        accountBehavior: "shared_pool",
        poolKey: "company_leave",
        payTreatment: "company_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 5,
        eligibilityBasis: "hire_date",
        completedServiceMonths: 12,
        prorationMethod: "none",
        roundingIncrement: 0.25,
        carryoverMode: "unlimited",
        conversionAllowed: true,
        createdBy: userId,
        createdAt: 1,
        changeReason: "Initial statutory policy",
      });
      const balanceId = await ctx.db.insert("employeeLeaveBalances", {
        organizationId,
        employeeId,
        year: 2026,
        leaveTypeKey: "private_sil",
        total: 5,
        used: 0,
        balance: 5,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "matching",
        migrationVersion: 2,
        policyId,
        policyVersionId,
        poolKey: "company_leave",
        periodStart: 1,
        periodEnd: 2,
        granted: 5,
        reserved: 0,
        converted: 0,
        expired: 0,
        projectionVersion: 1,
        engineStatus: "open",
        createdAt: 1,
        updatedAt: 1,
      });
      const ledgerEntryId = await ctx.db.insert("leaveLedgerEntries", {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 1,
        kind: "opening_grant",
        amount: 5,
        unit: "day",
        referenceType: "migration",
        actorId: userId,
        reason: "Opening migration grant",
        idempotencyKey: "leave-v2-schema-opening-grant",
        createdAt: 1,
      });
      await ctx.db.patch(balanceId, { lastLedgerEntryId: ledgerEntryId });
      const requestId = await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "vacation",
        startDate: 1,
        endDate: 1,
        numberOfDays: 1,
        reason: "Planned leave",
        status: "pending",
        filedDate: 1,
        policyId,
        policyVersionId,
        requestedDurationMode: "day",
        chargeableDuration: 1,
        payTreatment: "company_paid",
        submittedBy: userId,
        engineVersion: 2,
        cutoverAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leaveRequestOccurrences", {
        leaveRequestId: requestId,
        organizationId,
        employeeId,
        localDate: "2026-08-14",
        scheduleSnapshot: { isWorkday: true, scheduledMinutes: 480 },
        holidaySnapshot: { isHoliday: false },
        scheduledMinutes: 480,
        leaveMinutes: 480,
        creditAmount: 1,
        payTreatment: "company_paid",
        lifecycleState: "reserved",
        attendanceConflictState: "none",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leaveRequestEvents", {
        leaveRequestId: requestId,
        organizationId,
        type: "submitted",
        actorId: userId,
        createdAt: 1,
      });

      return {
        ledger: await ctx.db
          .query("leaveLedgerEntries")
          .withIndex("by_balance_effective", (query) =>
            query.eq("balanceId", balanceId).eq("effectiveDate", 1),
          )
          .collect(),
        occurrences: await ctx.db
          .query("leaveRequestOccurrences")
          .withIndex("by_employee_local_date", (query) =>
            query.eq("employeeId", employeeId).eq("localDate", "2026-08-14"),
          )
          .collect(),
        events: await ctx.db
          .query("leaveRequestEvents")
          .withIndex("by_request_created", (query) =>
            query.eq("leaveRequestId", requestId).eq("createdAt", 1),
          )
          .collect(),
        idempotentLedger: await ctx.db
          .query("leaveLedgerEntries")
          .withIndex("by_organization_idempotency_key", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("idempotencyKey", "leave-v2-schema-opening-grant"),
          )
          .collect(),
        policyBalances: await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_policy_period", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("employeeId", employeeId)
              .eq("policyId", policyId)
              .eq("periodStart", 1)
              .eq("periodEnd", 2),
          )
          .collect(),
        poolBalances: await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_pool_period", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("employeeId", employeeId)
              .eq("poolKey", "company_leave")
              .eq("periodStart", 1)
              .eq("periodEnd", 2),
          )
          .collect(),
        pendingRequests: await ctx.db
          .query("leaveRequests")
          .withIndex("by_organization_status_created", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("status", "pending")
              .eq("createdAt", 1),
          )
          .collect(),
      };
    });

    expect(result.ledger).toHaveLength(1);
    expect(result.occurrences).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.idempotentLedger).toHaveLength(1);
    expect(result.policyBalances).toHaveLength(1);
    expect(result.poolBalances).toHaveLength(1);
    expect(result.pendingRequests).toHaveLength(1);
  });
});
