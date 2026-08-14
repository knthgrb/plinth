import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import crons from "../convex/crons";
import {
  closeLeavePolicyPeriod,
  materializeEmployeeAccruals,
} from "../convex/leaveAccrual";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const MANILA_OFFSET = 8 * 60 * 60 * 1_000;

function manilaDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - MANILA_OFFSET;
}

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule: Doc<"employees">["schedule"]["defaultSchedule"] = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

type AccrualFixture = {
  organizationId: Id<"organizations">;
  actorId: Id<"users">;
  employeeId: Id<"employees">;
};

type BatchResult = {
  continueCursor: string;
  isDone: boolean;
  scheduledCount: number;
};

const closeOrganizationLeavePeriodsBatch = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    cursor?: string | null;
    numItems?: number;
    asOf: number;
  },
  BatchResult
>("leaveAccrual:closeOrganizationLeavePeriodsBatch");

async function seedAccrualFixture(
  ctx: MutationCtx,
  options: {
    employeeStatus?: "active" | "resigned" | "terminated";
    hireDate?: number;
  } = {},
): Promise<AccrualFixture> {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Accrual Test Organization",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  });
  const actorId = await ctx.db.insert("users", {
    email: "accrual.owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("organizationLeaveSettings", {
    organizationId,
    employmentSector: "private",
    policyYearBasis: "calendar_year",
    migrationState: "active",
    activePolicyEngineVersion: 2,
    migrationVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Accrual",
      lastName: "Employee",
      email: "accrual.employee@example.com",
    },
    employment: {
      employeeId: "ACC-001",
      position: "Analyst",
      department: "People",
      employmentType: "regular",
      hireDate: options.hireDate ?? manilaDate(2026, 1, 1),
      status: options.employeeStatus ?? "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule: { defaultSchedule },
    createdAt: 1,
    updatedAt: 1,
  });
  return { organizationId, actorId, employeeId };
}

async function seedPolicy(
  ctx: MutationCtx,
  fixture: AccrualFixture,
  args: {
    sourceKey: string;
    accountBehavior?: "individual_account" | "shared_pool" | "non_credit";
    poolKey?: string;
    entitlementMethod?: "monthly" | "annual";
    accrualRate?: number;
    annualUnits?: number;
    carryoverMode?: "none" | "capped" | "unlimited";
    carryoverCap?: number;
    conversionAllowed?: boolean;
    maxConvertibleUnits?: number;
    complianceRole?: string;
  },
) {
  const policyId = await ctx.db.insert("leavePolicies", {
    organizationId: fixture.organizationId,
    sourceKey: args.sourceKey,
    name: args.sourceKey,
    category: "statutory",
    confidentiality: "standard",
    state: "active",
    complianceRole: args.complianceRole,
    createdBy: fixture.actorId,
    createdAt: 1,
    updatedAt: 1,
  });
  const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
    organizationId: fixture.organizationId,
    leavePolicyId: policyId,
    version: 1,
    effectiveStart: manilaDate(2026, 1, 1),
    accountBehavior: args.accountBehavior ?? "individual_account",
    poolKey: args.poolKey,
    payTreatment: "company_paid",
    durationBasis: "scheduled_work",
    entitlementMethod: args.entitlementMethod ?? "monthly",
    annualUnits: args.annualUnits ?? 12,
    accrualRate: args.accrualRate,
    eligibilityBasis: "hire_date",
    completedServiceMonths: 0,
    prorationMethod: "none",
    roundingIncrement: 0.25,
    carryoverMode: args.carryoverMode ?? "none",
    carryoverCap: args.carryoverCap,
    conversionAllowed: args.conversionAllowed ?? false,
    maxConvertibleUnits: args.maxConvertibleUnits,
    createdBy: fixture.actorId,
    createdAt: 1,
    changeReason: "Test policy",
  });
  return { policyId, policyVersionId };
}

async function seedClosingBalance(
  ctx: MutationCtx,
  fixture: AccrualFixture,
  policy: Awaited<ReturnType<typeof seedPolicy>>,
  sourceKey: string,
  balance: number,
  poolKey?: string,
) {
  return ctx.db.insert("employeeLeaveBalances", {
    organizationId: fixture.organizationId,
    employeeId: fixture.employeeId,
    policyId: poolKey === undefined ? policy.policyId : undefined,
    policyVersionId: poolKey === undefined ? policy.policyVersionId : undefined,
    poolKey,
    periodStart: manilaDate(2026, 1, 1),
    periodEnd: manilaDate(2026, 12, 31),
    year: 2026,
    leaveTypeKey: sourceKey,
    total: balance,
    used: 0,
    balance,
    source: "employee_credits",
    approvedDays: 0,
    reconciliationStatus: "matching",
    migrationVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("leave accrual", () => {
  it("posts private monthly and government 1.25-day accounts once per completed month", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const fixture = await seedAccrualFixture(ctx);
      await seedPolicy(ctx, fixture, {
        sourceKey: "private_company_vacation",
        accrualRate: 1,
      });
      await seedPolicy(ctx, fixture, {
        sourceKey: "government_vacation",
        accrualRate: 1.25,
        annualUnits: 15,
      });
      await seedPolicy(ctx, fixture, {
        sourceKey: "government_sick",
        accrualRate: 1.25,
        annualUnits: 15,
      });

      const asOf = manilaDate(2026, 4, 1);
      const first = await materializeEmployeeAccruals(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        asOf,
      });
      const second = await materializeEmployeeAccruals(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        asOf,
      });
      const ledger = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect();
      const balances = await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect();
      return { first, second, ledger, balances };
    });

    expect(result.first).toMatchObject({ postedCount: 9, replayedCount: 0 });
    expect(result.second).toMatchObject({ postedCount: 0, replayedCount: 9 });
    expect(result.ledger).toHaveLength(9);
    expect(result.ledger.map((entry) => entry.idempotencyKey)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^accrual:.+:1767196800000:1769788800000$/),
        expect.stringMatching(/^accrual:.+:1769875200000:1772208000000$/),
        expect.stringMatching(/^accrual:.+:1772294400000:1774886400000$/),
      ]),
    );
    expect(
      result.balances
        .map(({ leaveTypeKey, balance }) => [leaveTypeKey, balance] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual([
      ["government_sick", 3.75],
      ["government_vacation", 3.75],
      ["private_company_vacation", 3],
    ]);
  });

  it("uses lifecycle service windows so separation stops and rehire resumes accrual", async () => {
    const t = convexTest(schema, modules);
    const ledger = await t.run(async (ctx) => {
      const fixture = await seedAccrualFixture(ctx, {
        hireDate: manilaDate(2026, 4, 1),
      });
      await seedPolicy(ctx, fixture, {
        sourceKey: "company_monthly",
        accrualRate: 1,
      });
      for (const event of [
        { type: "hired" as const, effectiveAt: manilaDate(2026, 1, 1) },
        { type: "resigned" as const, effectiveAt: manilaDate(2026, 2, 15) },
        { type: "rehired" as const, effectiveAt: manilaDate(2026, 4, 1) },
      ]) {
        await ctx.db.insert("employeeLifecycleEvents", {
          organizationId: fixture.organizationId,
          employeeId: fixture.employeeId,
          ...event,
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          recordedBy: fixture.actorId,
          createdAt: event.effectiveAt,
        });
      }

      await materializeEmployeeAccruals(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        asOf: manilaDate(2026, 6, 1),
      });
      return ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect();
    });

    expect(ledger).toHaveLength(3);
    expect(ledger.map((entry) => entry.effectiveDate)).toEqual([
      manilaDate(2026, 1, 31),
      manilaDate(2026, 4, 30),
      manilaDate(2026, 5, 31),
    ]);
  });

  it("waits for month completion and posts a five-day annual grant without rounding above the cap", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const fixture = await seedAccrualFixture(ctx);
      await seedPolicy(ctx, fixture, {
        sourceKey: "company_five_day_monthly",
        annualUnits: 5,
      });
      const beforeMonthEnd = await materializeEmployeeAccruals(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        asOf: manilaDate(2026, 1, 31),
      });
      const afterYear = await materializeEmployeeAccruals(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        asOf: manilaDate(2027, 1, 1),
      });
      const entries = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect();
      return { beforeMonthEnd, afterYear, entries };
    });

    expect(result.beforeMonthEnd.postedCount).toBe(0);
    expect(result.afterYear.postedCount).toBe(12);
    expect(result.entries.reduce((total, entry) => total + entry.amount, 0)).toBe(5);
  });

  it("closes capped, protected SIL, and noncumulative periods explicitly", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const fixture = await seedAccrualFixture(ctx);
      const capped = await seedPolicy(ctx, fixture, {
        sourceKey: "company_capped",
        entitlementMethod: "annual",
        carryoverMode: "capped",
        carryoverCap: 4,
      });
      const sil = await seedPolicy(ctx, fixture, {
        sourceKey: "private_sil",
        accountBehavior: "shared_pool",
        poolKey: "company_leave",
        entitlementMethod: "annual",
        carryoverMode: "unlimited",
        conversionAllowed: true,
        complianceRole: "private_sil_minimum",
      });
      const soloParent = await seedPolicy(ctx, fixture, {
        sourceKey: "private_solo_parent",
        accountBehavior: "non_credit",
        entitlementMethod: "annual",
        carryoverMode: "none",
      });
      const cappedBalanceId = await seedClosingBalance(
        ctx,
        fixture,
        capped,
        "company_capped",
        7,
      );
      const silBalanceId = await seedClosingBalance(
        ctx,
        fixture,
        sil,
        "private_sil",
        3,
        "company_leave",
      );
      const soloParentBalanceId = await seedClosingBalance(
        ctx,
        fixture,
        soloParent,
        "private_solo_parent",
        4,
      );
      const closeArgs = {
        nextPeriodStart: manilaDate(2027, 1, 1),
        nextPeriodEnd: manilaDate(2027, 12, 31),
        closedAt: manilaDate(2027, 1, 1),
      };
      await closeLeavePolicyPeriod(ctx, {
        balanceId: cappedBalanceId,
        ...closeArgs,
      });
      await closeLeavePolicyPeriod(ctx, {
        balanceId: silBalanceId,
        ...closeArgs,
      });
      await closeLeavePolicyPeriod(ctx, {
        balanceId: soloParentBalanceId,
        ...closeArgs,
      });
      await closeLeavePolicyPeriod(ctx, {
        balanceId: silBalanceId,
        ...closeArgs,
      });

      const balances = await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect();
      const ledger = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect();
      const conversions = await ctx.db
        .query("leaveConversionRequests")
        .withIndex("by_employee_status", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect();
      return { balances, ledger, conversions };
    });

    const nextCapped = result.balances.find(
      (balance) =>
        balance.leaveTypeKey === "company_capped" && balance.year === 2027,
    );
    const closedSoloParent = result.balances.find(
      (balance) =>
        balance.leaveTypeKey === "private_solo_parent" && balance.year === 2026,
    );
    expect(nextCapped).toMatchObject({ balance: 4, total: 4 });
    expect(closedSoloParent).toMatchObject({ balance: 0, expired: 4 });
    expect(result.ledger.map(({ kind, amount }) => ({ kind, amount }))).toEqual(
      expect.arrayContaining([
        { kind: "carryover", amount: 4 },
        { kind: "expiration", amount: -3 },
        { kind: "conversion", amount: -3 },
        { kind: "expiration", amount: -4 },
      ]),
    );
    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0]).toMatchObject({
      requestedDays: 3,
      status: "approved",
      paymentStatus: "ready",
    });
  });

  it("honors company conversion rules and closes expired periods through the production batch", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const seeded = await seedAccrualFixture(ctx);
      const policy = await seedPolicy(ctx, seeded, {
        sourceKey: "company_convertible",
        entitlementMethod: "annual",
        conversionAllowed: true,
        maxConvertibleUnits: 2,
      });
      await seedClosingBalance(ctx, seeded, policy, "company_convertible", 5);
      return seeded;
    });

    const batch = await t.mutation(closeOrganizationLeavePeriodsBatch, {
      organizationId: fixture.organizationId,
      asOf: manilaDate(2027, 1, 1),
    });
    const result = await t.run(async (ctx) => ({
      balance: await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .filter((query) => query.eq(query.field("year"), 2026))
        .unique(),
      conversions: await ctx.db
        .query("leaveConversionRequests")
        .withIndex("by_employee_status", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect(),
    }));

    expect(batch.scheduledCount).toBe(1);
    expect(result.balance).toMatchObject({
      engineStatus: "closed",
      balance: 0,
      converted: 2,
      expired: 3,
    });
    expect(result.conversions[0]).toMatchObject({
      requestedDays: 2,
      paymentStatus: "ready",
    });
  });

  it("registers a bounded internal daily accrual batch", () => {
    const cronExport = crons as typeof crons & { export(): string };
    const exported = JSON.parse(cronExport.export()) as Record<
      string,
      { name: string; schedule: { type: string; hourUTC: number; minuteUTC: number } }
    >;
    expect(exported["materialize daily leave accruals"]).toMatchObject({
      name: "leaveAccrual:materializeOrganizationAccrualBatch",
      schedule: { type: "daily", hourUTC: 16, minuteUTC: 15 },
    });
  });
});
