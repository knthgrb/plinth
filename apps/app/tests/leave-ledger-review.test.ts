import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  consumeReservation,
  getOrCreateBalanceProjection,
  rebuildBalanceProjection,
  reserveUnits,
} from "../convex/leaveLedger";
import type { LeaveLedgerKind } from "../lib/leave/types";
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

async function createFixture(options: {
  accountBehavior?: "individual_account" | "shared_pool";
  insertBalance?: boolean;
} = {}) {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Ledger Review Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const actorId = await ctx.db.insert("users", {
      email: "ledger-review@example.com",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Ledger",
        lastName: "Review",
        email: "ledger-review-employee@example.com",
      },
      employment: {
        employeeId: "LEDGER-REVIEW",
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
      sourceKey: "review_leave",
      name: "Review Leave",
      category: "company",
      confidentiality: "standard",
      state: "active",
      createdBy: actorId,
      createdAt: 1,
      updatedAt: 1,
    });
    const accountBehavior = options.accountBehavior ?? "individual_account";
    const poolKey = accountBehavior === "shared_pool" ? "company_leave" : undefined;
    const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId,
      leavePolicyId: policyId,
      version: 1,
      effectiveStart: 1,
      accountBehavior,
      poolKey,
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
      changeReason: "Review fixture",
    });
    const balanceArgs = {
      organizationId,
      employeeId,
      policyId,
      policyVersionId,
      poolKey,
      periodStart: 1,
      periodEnd: 366,
      year: 2026,
      leaveTypeKey: "review_leave",
      total: 0,
      used: 0,
      balance: 0,
      source: "employee_credits" as const,
      approvedDays: 0,
      reconciliationStatus: "matching" as const,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const balanceId = options.insertBalance === false
      ? undefined
      : await ctx.db.insert("employeeLeaveBalances", balanceArgs);
    return {
      actorId,
      organizationId,
      employeeId,
      policyId,
      policyVersionId,
      poolKey,
      balanceArgs,
      balanceId,
    };
  });
  return { t, ...fixture };
}

describe("leave ledger review contracts", () => {
  it("uses canonical policy or pool identity and ignores a colliding legacy row", async () => {
    const fixture = await createFixture({ insertBalance: false });
    const result = await fixture.t.run(async (ctx) => {
      const legacyId = await ctx.db.insert("employeeLeaveBalances", {
        ...fixture.balanceArgs,
        policyId: undefined,
        policyVersionId: undefined,
        periodStart: undefined,
        periodEnd: undefined,
      });
      const first = await getOrCreateBalanceProjection(ctx, fixture.balanceArgs);
      const replay = await getOrCreateBalanceProjection(ctx, fixture.balanceArgs);
      const nextPeriod = await getOrCreateBalanceProjection(ctx, {
        ...fixture.balanceArgs,
        periodStart: 367,
        periodEnd: 731,
        year: 2027,
      });
      return { legacyId, first, replay, nextPeriod };
    });

    expect(result.first._id).not.toBe(result.legacyId);
    expect(result.replay._id).toBe(result.first._id);
    expect(result.nextPeriod._id).not.toBe(result.first._id);

    const pooled = await createFixture({
      accountBehavior: "shared_pool",
      insertBalance: false,
    });
    const pooledIds = await pooled.t.run(async (ctx) => {
      const first = await getOrCreateBalanceProjection(ctx, pooled.balanceArgs);
      const replay = await getOrCreateBalanceProjection(ctx, pooled.balanceArgs);
      return [first._id, replay._id];
    });
    expect(pooledIds[1]).toBe(pooledIds[0]);
  });

  it("rejects cross-organization projection identities", async () => {
    const fixture = await createFixture({ insertBalance: false });
    const otherEmployeeId = await fixture.t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Org",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("employees", {
        organizationId: otherOrganizationId,
        personalInfo: {
          firstName: "Other",
          lastName: "Employee",
          email: "other-ledger@example.com",
        },
        employment: {
          employeeId: "OTHER-LEDGER",
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
    });

    await expect(
      fixture.t.run((ctx) =>
        getOrCreateBalanceProjection(ctx, {
          ...fixture.balanceArgs,
          employeeId: otherEmployeeId,
        }),
      ),
    ).rejects.toThrow("organization mismatch");
  });

  it("reuses an individual balance across immutable versions of the same policy", async () => {
    const fixture = await createFixture();
    const balanceId = fixture.balanceId!;
    const policyVersionId = await fixture.t.run((ctx) =>
      ctx.db.insert("leavePolicyVersions", {
        organizationId: fixture.organizationId,
        leavePolicyId: fixture.policyId,
        version: 2,
        effectiveStart: 200,
        accountBehavior: "individual_account",
        payTreatment: "company_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 10,
        eligibilityBasis: "hire_date",
        completedServiceMonths: 0,
        prorationMethod: "none",
        roundingIncrement: 0.25,
        carryoverMode: "unlimited",
        conversionAllowed: false,
        createdBy: fixture.actorId,
        createdAt: 2,
        changeReason: "Policy update",
      }),
    );

    const result = await fixture.t.run(async (ctx) => {
      const balance = await getOrCreateBalanceProjection(ctx, {
        ...fixture.balanceArgs,
        policyVersionId,
      });
      const entry = await appendLedgerEntry(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        balanceId,
        policyVersionId,
        effectiveDate: 200,
        kind: "grant",
        amount: 1,
        unit: "day",
        idempotencyKey: "version-2:grant",
        createdAt: 200,
      });
      return { balance, entry };
    });

    expect(result.balance._id).toBe(balanceId);
    expect(result.entry.policyVersionId).toBe(policyVersionId);
  });

  it("rejects semantic idempotency collisions and rolls back paired consumption", async () => {
    const fixture = await createFixture();
    const balanceId = fixture.balanceId!;
    const grantArgs = {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      balanceId,
      policyVersionId: fixture.policyVersionId,
      effectiveDate: 2,
      kind: "grant" as const,
      amount: 8,
      unit: "day" as const,
      idempotencyKey: "review:grant",
      createdAt: 2,
    };
    const replay = await fixture.t.run(async (ctx) => {
      const first = await appendLedgerEntry(ctx, grantArgs);
      const second = await appendLedgerEntry(ctx, { ...grantArgs, createdAt: 99 });
      return [first._id, second._id];
    });
    expect(replay[1]).toBe(replay[0]);
    await expect(
      fixture.t.run((ctx) =>
        appendLedgerEntry(ctx, { ...grantArgs, amount: 7 }),
      ),
    ).rejects.toThrow("idempotency collision");

    await fixture.t.run(async (ctx) => {
      await reserveUnits(ctx, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        balanceId,
        policyVersionId: fixture.policyVersionId,
        effectiveDate: 3,
        units: 2,
        unit: "day",
        idempotencyKey: "review:reserve",
        createdAt: 3,
      });
      await appendLedgerEntry(ctx, {
        ...grantArgs,
        effectiveDate: 4,
        kind: "usage",
        amount: -1,
        idempotencyKey: "review:approve:usage",
        createdAt: 4,
      });
    });
    const before = await fixture.t.run((ctx) => ctx.db.get(balanceId));
    await expect(
      fixture.t.run((ctx) =>
        consumeReservation(ctx, {
          organizationId: fixture.organizationId,
          employeeId: fixture.employeeId,
          balanceId,
          policyVersionId: fixture.policyVersionId,
          effectiveDate: 4,
          units: 2,
          unit: "day",
          idempotencyKey: "review:approve",
          createdAt: 4,
        }),
      ),
    ).rejects.toThrow("idempotency collision");
    const after = await fixture.t.run(async (ctx) => ({
      balance: await ctx.db.get(balanceId),
      release: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("idempotencyKey", "review:approve:release"),
        )
        .first(),
    }));
    expect(after.balance).toEqual(before);
    expect(after.release).toBeNull();
  });

  it.each([
    ["grant", -1],
    ["reservation", 1],
    ["reservation_release", -1],
    ["usage", 1],
    ["restoration", -1],
    ["conversion", 1],
    ["expiration", 1],
  ] as const)("rejects an invalid %s sign", async (kind, amount) => {
    const fixture = await createFixture();
    await expect(
      fixture.t.run((ctx) =>
        appendLedgerEntry(ctx, {
          organizationId: fixture.organizationId,
          employeeId: fixture.employeeId,
          balanceId: fixture.balanceId!,
          policyVersionId: fixture.policyVersionId,
          effectiveDate: 2,
          kind: kind as LeaveLedgerKind,
          amount,
          unit: "day",
          idempotencyKey: `invalid:${kind}`,
          createdAt: 2,
        }),
      ),
    ).rejects.toThrow("sign");
  });

  it("keeps legacy totals aligned with carryover, adjustments, and reconciliation", async () => {
    const fixture = await createFixture();
    const balanceId = fixture.balanceId!;
    const projection = await fixture.t.run(async (ctx) => {
      for (const [index, kind, amount] of [
        [1, "grant", 8],
        [2, "carryover", 2],
        [3, "adjustment", -1],
        [4, "migration_reconciliation", 0.5],
      ] as const) {
        await appendLedgerEntry(ctx, {
          organizationId: fixture.organizationId,
          employeeId: fixture.employeeId,
          balanceId,
          policyVersionId: fixture.policyVersionId,
          effectiveDate: index,
          kind,
          amount,
          unit: "day",
          idempotencyKey: `total:${kind}`,
          createdAt: index,
        });
      }
      return rebuildBalanceProjection(ctx, {
        balanceId,
        periodStart: 1,
        periodEnd: 366,
        updatedAt: 6,
      });
    });
    expect(projection).toMatchObject({
      total: 9.5,
      used: 0,
      approvedDays: 0,
      balance: 9.5,
    });
  });

  it("rejects a partial-period rebuild without changing the projection", async () => {
    const fixture = await createFixture();
    const before = await fixture.t.run((ctx) => ctx.db.get(fixture.balanceId!));
    await expect(
      fixture.t.run((ctx) =>
        rebuildBalanceProjection(ctx, {
          balanceId: fixture.balanceId!,
          periodStart: 2,
          periodEnd: 366,
          updatedAt: 9,
        }),
      ),
    ).rejects.toThrow("canonical period");
    const after = await fixture.t.run((ctx) => ctx.db.get(fixture.balanceId!));
    expect(after).toEqual(before);
  });

  it("rebuilds 1,000 equal-date entries deterministically and rejects 1,001 without patching", async () => {
    const fixture = await createFixture();
    const balanceId = fixture.balanceId!;
    const lastLedgerEntryId = await fixture.t.run(async (ctx) => {
      let lastId = await ctx.db.insert("leaveLedgerEntries", {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        balanceId,
        policyVersionId: fixture.policyVersionId,
        effectiveDate: 2,
        kind: "grant",
        amount: 0.001,
        unit: "day",
        idempotencyKey: "bounded:0",
        createdAt: 2,
      });
      for (let index = 1; index < 1_000; index += 1) {
        lastId = await ctx.db.insert("leaveLedgerEntries", {
          organizationId: fixture.organizationId,
          employeeId: fixture.employeeId,
          balanceId,
          policyVersionId: fixture.policyVersionId,
          effectiveDate: 2,
          kind: "grant",
          amount: 0.001,
          unit: "day",
          idempotencyKey: `bounded:${index}`,
          createdAt: 2,
        });
      }
      return lastId;
    });

    const rebuilt = await fixture.t.run((ctx) =>
      rebuildBalanceProjection(ctx, {
        balanceId,
        periodStart: 1,
        periodEnd: 366,
        updatedAt: 10,
      }),
    );
    expect(rebuilt.lastLedgerEntryId).toBe(lastLedgerEntryId);
    expect(rebuilt.total).toBeCloseTo(1);
    const beforeFailure = rebuilt;

    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("leaveLedgerEntries", {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        balanceId,
        policyVersionId: fixture.policyVersionId,
        effectiveDate: 2,
        kind: "grant",
        amount: 0.001,
        unit: "day",
        idempotencyKey: "bounded:1000",
        createdAt: 2,
      });
    });
    await expect(
      fixture.t.run((ctx) =>
        rebuildBalanceProjection(ctx, {
          balanceId,
          periodStart: 1,
          periodEnd: 366,
          updatedAt: 11,
        }),
      ),
    ).rejects.toThrow("bounded entry limit");
    const afterFailure = await fixture.t.run((ctx) => ctx.db.get(balanceId));
    expect(afterFailure).toEqual(beforeFailure);
  });
});
