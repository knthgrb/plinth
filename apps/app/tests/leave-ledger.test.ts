import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  consumeReservation,
  getOrCreateBalanceProjection,
  reserveUnits,
  restoreUsage,
  rebuildBalanceProjection,
} from "../convex/leaveLedger";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

describe("leave ledger", () => {
  it("projects grants, reservations, usage, restoration, and idempotent replays", async () => {
    const t = convexTest(schema, modules);

    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Ledger Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const actorId = await ctx.db.insert("users", {
        email: "ledger.owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Ledger",
          lastName: "Employee",
          email: "ledger.employee@example.com",
        },
        employment: {
          employeeId: "LEDGER-001",
          position: "Analyst",
          department: "Operations",
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
        sourceKey: "company_leave",
        name: "Company Leave",
        category: "company",
        confidentiality: "standard",
        state: "active",
        createdBy: actorId,
        createdAt: 1,
        updatedAt: 1,
      });
      const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
        organizationId,
        leavePolicyId: policyId,
        version: 1,
        effectiveStart: 1,
        accountBehavior: "individual_account",
        payTreatment: "company_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 8,
        eligibilityBasis: "hire_date",
        completedServiceMonths: 0,
        prorationMethod: "none",
        roundingIncrement: 0.25,
        carryoverMode: "unlimited",
        conversionAllowed: false,
        createdBy: actorId,
        createdAt: 1,
        changeReason: "Initial policy",
      });
      const balanceId = await ctx.db.insert("employeeLeaveBalances", {
        organizationId,
        employeeId,
        policyId,
        policyVersionId,
        periodStart: 1,
        periodEnd: 366,
        year: 2026,
        leaveTypeKey: "company_leave",
        total: 0,
        used: 0,
        balance: 0,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "matching",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });

      const balance = await getOrCreateBalanceProjection(ctx, {
        organizationId,
        employeeId,
        policyId,
        policyVersionId,
        periodStart: 1,
        periodEnd: 366,
        year: 2026,
        leaveTypeKey: "company_leave",
        total: 0,
        used: 0,
        balance: 0,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "matching",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      expect(balance._id).toBe(balanceId);

      await appendLedgerEntry(ctx, {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 2,
        kind: "grant",
        amount: 8,
        unit: "day",
        idempotencyKey: "ledger:grant",
        createdAt: 2,
      });
      await reserveUnits(ctx, {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 3,
        units: 2,
        unit: "day",
        idempotencyKey: "ledger:request:reserve",
        createdAt: 3,
      });
      const reserved = await ctx.db.get(balanceId);

      await consumeReservation(ctx, {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 4,
        units: 2,
        unit: "day",
        idempotencyKey: "ledger:request:approve",
        createdAt: 4,
      });
      const consumed = await ctx.db.get(balanceId);

      await restoreUsage(ctx, {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 5,
        units: 2,
        unit: "day",
        idempotencyKey: "ledger:request:cancel",
        createdAt: 5,
      });
      await reserveUnits(ctx, {
        organizationId,
        employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 3,
        units: 2,
        unit: "day",
        idempotencyKey: "ledger:request:reserve",
        createdAt: 3,
      });
      const rebuilt = await rebuildBalanceProjection(ctx, {
        balanceId,
        periodStart: 1,
        periodEnd: 366,
        updatedAt: 6,
      });
      const ledger = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_balance_effective", (query) =>
          query.eq("balanceId", balanceId),
        )
        .collect();

      return { reserved, consumed, rebuilt, ledger };
    });

    expect(result.reserved).toMatchObject({ balance: 6, reserved: 2, used: 0 });
    expect(result.consumed).toMatchObject({ balance: 6, reserved: 0, used: 2 });
    expect(result.rebuilt).toMatchObject({ balance: 8, reserved: 0, used: 0 });
    expect(result.ledger).toHaveLength(5);
    expect(result.ledger.map((entry) => entry.kind)).toEqual([
      "grant",
      "reservation",
      "reservation_release",
      "usage",
      "restoration",
    ]);
  });

  it("rejects a reservation that exceeds the available balance", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run(async (ctx) => {
        const organizationId = await ctx.db.insert("organizations", {
          name: "Insufficient Ledger Org",
          createdAt: 1,
          updatedAt: 1,
        });
        const actorId = await ctx.db.insert("users", {
          email: "insufficient.owner@example.com",
          createdAt: 1,
          updatedAt: 1,
        });
        const employeeId = await ctx.db.insert("employees", {
          organizationId,
          personalInfo: {
            firstName: "Insufficient",
            lastName: "Employee",
            email: "insufficient.employee@example.com",
          },
          employment: {
            employeeId: "LEDGER-002",
            position: "Analyst",
            department: "Operations",
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
          sourceKey: "company_leave",
          name: "Company Leave",
          category: "company",
          confidentiality: "standard",
          state: "active",
          createdBy: actorId,
          createdAt: 1,
          updatedAt: 1,
        });
        const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
          organizationId,
          leavePolicyId: policyId,
          version: 1,
          effectiveStart: 1,
          accountBehavior: "individual_account",
          payTreatment: "company_paid",
          durationBasis: "scheduled_work",
          entitlementMethod: "annual",
          annualUnits: 8,
          eligibilityBasis: "hire_date",
          completedServiceMonths: 0,
          prorationMethod: "none",
          roundingIncrement: 0.25,
          carryoverMode: "unlimited",
          conversionAllowed: false,
          createdBy: actorId,
          createdAt: 1,
          changeReason: "Initial policy",
        });
        const balanceId = await ctx.db.insert("employeeLeaveBalances", {
          organizationId,
          employeeId,
          policyId,
          policyVersionId,
          periodStart: 1,
          periodEnd: 366,
          year: 2026,
          leaveTypeKey: "company_leave",
          total: 8,
          used: 0,
          balance: 8,
          source: "employee_credits",
          approvedDays: 0,
          reconciliationStatus: "matching",
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        });

        await reserveUnits(ctx, {
          organizationId,
          employeeId,
          balanceId,
          policyVersionId,
          effectiveDate: 2,
          units: 9,
          unit: "day",
          idempotencyKey: "ledger:overdraw",
          createdAt: 2,
        });
      }),
    ).rejects.toThrow("Insufficient leave balance");
  });
});
