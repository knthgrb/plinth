import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { appendLedgerEntry, getOrCreateBalanceProjection } from "./leaveLedger";

const MANILA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const DEFAULT_ORGANIZATION_PAGE_SIZE = 10;
const DEFAULT_EMPLOYEE_PAGE_SIZE = 1;
const MAX_ORGANIZATION_PAGE_SIZE = 25;
const MAX_EMPLOYEE_PAGE_SIZE = 1;
const MAX_POLICIES_PER_ORGANIZATION = 100;
const MAX_POLICY_VERSIONS = 100;
const MAX_LIFECYCLE_EVENTS = 100;

type AccrualContext = Pick<MutationCtx, "db">;

export interface MaterializeEmployeeAccrualsArgs {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  asOf: number;
  policyId?: Id<"leavePolicies">;
}

export interface MaterializeEmployeeAccrualsResult {
  postedCount: number;
  replayedCount: number;
}

export interface CloseLeavePolicyPeriodArgs {
  balanceId: Id<"employeeLeaveBalances">;
  nextPeriodStart: number;
  nextPeriodEnd: number;
  closedAt: number;
}

interface ManilaCalendarDate {
  year: number;
  monthIndex: number;
  day: number;
}

interface ServiceWindow {
  start: number;
  end?: number;
}

type OrganizationBatchArgs = {
  cursor?: string | null;
  numItems?: number;
  employeePageSize?: number;
  asOf?: number;
};

type EmployeeBatchArgs = {
  organizationId: Id<"organizations">;
  cursor?: string | null;
  numItems?: number;
  asOf: number;
};

type EmployeePolicyBatchArgs = {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policyId: Id<"leavePolicies">;
  asOf: number;
};

type PeriodCloseBatchArgs = {
  organizationId: Id<"organizations">;
  cursor?: string | null;
  numItems?: number;
  asOf: number;
};

type BatchResult = {
  continueCursor: string;
  isDone: boolean;
  scheduledCount: number;
};

const organizationBatchReference = makeInternalMutationReference<
  OrganizationBatchArgs,
  BatchResult
>("leaveAccrual:materializeOrganizationAccrualBatch");

const employeeBatchReference = makeInternalMutationReference<
  EmployeeBatchArgs,
  BatchResult
>("leaveAccrual:materializeOrganizationEmployeeAccrualBatch");
const employeePolicyBatchReference = makeInternalMutationReference<
  EmployeePolicyBatchArgs,
  MaterializeEmployeeAccrualsResult
>("leaveAccrual:materializeEmployeePolicyAccrualBatch");
const periodCloseBatchReference = makeInternalMutationReference<
  PeriodCloseBatchArgs,
  BatchResult
>("leaveAccrual:closeOrganizationLeavePeriodsBatch");

export async function materializeEmployeeAccruals(
  ctx: AccrualContext,
  args: MaterializeEmployeeAccrualsArgs,
): Promise<MaterializeEmployeeAccrualsResult> {
  assertTimestamp(args.asOf, "Accrual date");
  const [employee, settings] = await Promise.all([
    ctx.db.get(args.employeeId),
    getLeaveSettings(ctx, args.organizationId),
  ]);
  if (!employee || employee.organizationId !== args.organizationId) {
    throw new Error("Employee not found in organization");
  }
  if (
    settings?.migrationState !== "active" ||
    settings.activePolicyEngineVersion !== 2
  ) {
    return { postedCount: 0, replayedCount: 0 };
  }

  const policies = args.policyId
    ? [await ctx.db.get(args.policyId)].filter(
        (policy): policy is Doc<"leavePolicies"> =>
          policy !== null &&
          policy.organizationId === args.organizationId &&
          policy.state === "active",
      )
    : await ctx.db
        .query("leavePolicies")
        .withIndex("by_organization_state", (query) =>
          query.eq("organizationId", args.organizationId).eq("state", "active"),
        )
        .take(MAX_POLICIES_PER_ORGANIZATION + 1);
  if (policies.length > MAX_POLICIES_PER_ORGANIZATION) {
    throw new Error("Leave accrual policy limit exceeded");
  }
  const lifecycleEvents = await ctx.db
    .query("employeeLifecycleEvents")
    .withIndex("by_employee_effective_at", (query) =>
      query.eq("employeeId", employee._id),
    )
    .order("asc")
    .take(MAX_LIFECYCLE_EVENTS + 1);
  if (lifecycleEvents.length > MAX_LIFECYCLE_EVENTS) {
    throw new Error("Employee lifecycle event limit exceeded");
  }
  const serviceWindows = buildServiceWindows(employee, lifecycleEvents);
  const asOfDate = getManilaCalendarDate(args.asOf);
  const accrualYear =
    asOfDate.monthIndex === 0 ? asOfDate.year - 1 : asOfDate.year;
  const periodStart = toManilaMidnight({
    year: accrualYear,
    monthIndex: 0,
    day: 1,
  });
  const periodEnd = toManilaMidnight({
    year: accrualYear,
    monthIndex: 11,
    day: 31,
  });
  let postedCount = 0;
  let replayedCount = 0;

  for (const policy of policies) {
    const versions = await ctx.db
      .query("leavePolicyVersions")
      .withIndex("by_policy_effective", (query) =>
        query.eq("leavePolicyId", policy._id),
      )
      .order("asc")
      .take(MAX_POLICY_VERSIONS + 1);
    if (versions.length > MAX_POLICY_VERSIONS) {
      throw new Error("Leave policy version limit exceeded");
    }
    const finalMonthIndex =
      accrualYear < asOfDate.year ? 11 : asOfDate.monthIndex;
    for (let monthIndex = 0; monthIndex <= finalMonthIndex; monthIndex += 1) {
      const earningStart = toManilaMidnight({
        year: accrualYear,
        monthIndex,
        day: 1,
      });
      const earningEnd = toManilaMidnight({
        year: accrualYear,
        monthIndex,
        day: daysInMonth(accrualYear, monthIndex),
      });
      const nextMonthStart = toManilaMidnight({
        year: monthIndex === 11 ? accrualYear + 1 : accrualYear,
        monthIndex: (monthIndex + 1) % 12,
        day: 1,
      });
      if (nextMonthStart > args.asOf) continue;
      const policyVersion = getEffectiveMonthlyVersion(
        versions,
        earningStart,
        earningEnd,
      );
      if (!policyVersion) continue;
      if (!isAccrualEligible(employee, policyVersion, serviceWindows, earningStart, earningEnd)) {
        continue;
      }
      const amount = getMonthlyAccrualAmount(policyVersion, monthIndex + 1);
      if (amount <= 0) continue;
      const balance = await getOrCreateBalanceProjection(ctx, {
        organizationId: args.organizationId,
        employeeId: employee._id,
        policyId: policy._id,
        policyVersionId: policyVersion._id,
        poolKey: policyVersion.poolKey,
        periodStart,
        periodEnd,
        year: accrualYear,
        leaveTypeKey: policyVersion.poolKey ?? policy.sourceKey,
        total: 0,
        used: 0,
        balance: 0,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "matching",
        migrationVersion: 2,
        createdAt: args.asOf,
        updatedAt: args.asOf,
      });
      const idempotencyKey = `accrual:${balance._id}:${earningStart}:${earningEnd}`;
      const existing = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (query) =>
          query
            .eq("organizationId", args.organizationId)
            .eq("idempotencyKey", idempotencyKey),
        )
        .unique();
      await appendLedgerEntry(ctx, {
        organizationId: args.organizationId,
        employeeId: employee._id,
        balanceId: balance._id,
        policyVersionId: policyVersion._id,
        effectiveDate: earningEnd,
        kind: "accrual",
        amount,
        unit: "day",
        reason: `Monthly accrual for ${policy.name}`,
        idempotencyKey,
        createdAt: args.asOf,
      });
      if (existing) replayedCount += 1;
      else postedCount += 1;
    }
  }

  return { postedCount, replayedCount };
}

export async function closeLeavePolicyPeriod(
  ctx: AccrualContext,
  args: CloseLeavePolicyPeriodArgs,
): Promise<{ closed: boolean; carried: number; expired: number; converted: number }> {
  assertTimestamp(args.closedAt, "Period close date");
  if (args.nextPeriodStart > args.nextPeriodEnd) {
    throw new Error("Next leave policy period is invalid");
  }
  const balance = await ctx.db.get(args.balanceId);
  if (!balance) throw new Error("Leave balance not found");
  if (balance.periodStart === undefined || balance.periodEnd === undefined) {
    throw new Error("Canonical leave balance period is required");
  }
  if (args.closedAt < nextManilaDay(balance.periodEnd)) {
    throw new Error("Leave policy period cannot close before period end");
  }
  if (balance.engineStatus === "closed") {
    return { closed: false, carried: 0, expired: 0, converted: 0 };
  }
  if ((balance.reserved ?? 0) > 0) {
    throw new Error("Leave policy period has outstanding reservations");
  }
  const { policy, policyVersion } = await resolveBalancePolicy(ctx, balance);

  const available = balance.balance;
  let carried = 0;
  let expired = 0;
  let converted = 0;
  if (available > 0 && policyVersion.conversionAllowed) {
    converted = Math.min(
      available,
      policyVersion.maxConvertibleUnits ?? available,
    );
    if (converted > 0) {
      await createConversionLiability(ctx, {
        balance,
        policy,
        policyVersion,
        amount: converted,
        closedAt: args.closedAt,
      });
    }
  }
  const remaining = available - converted;
  if (remaining > 0 && policyVersion.carryoverMode !== "none") {
    carried =
      policyVersion.carryoverMode === "capped"
        ? Math.min(remaining, policyVersion.carryoverCap ?? 0)
        : remaining;
    if (carried > 0) {
      await carryBalanceForward(ctx, {
        balance,
        policy,
        policyVersion,
        amount: carried,
        nextPeriodStart: args.nextPeriodStart,
        nextPeriodEnd: args.nextPeriodEnd,
        closedAt: args.closedAt,
      });
    }
    expired = remaining - carried;
    if (expired > 0) {
      await expireBalance(ctx, balance, policyVersion, expired, args.closedAt);
    }
  } else if (remaining > 0) {
    expired = remaining;
    await expireBalance(ctx, balance, policyVersion, expired, args.closedAt);
  }

  await ctx.db.patch(balance._id, {
    engineStatus: "closed",
    updatedAt: args.closedAt,
  });
  return { closed: true, carried, expired, converted };
}

export const materializeOrganizationAccrualBatch = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
    employeePageSize: v.optional(v.number()),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BatchResult> => {
    const asOf = args.asOf ?? Date.now();
    assertTimestamp(asOf, "Accrual date");
    const numItems = boundedPageSize(
      args.numItems,
      DEFAULT_ORGANIZATION_PAGE_SIZE,
      MAX_ORGANIZATION_PAGE_SIZE,
    );
    const employeePageSize = boundedPageSize(
      args.employeePageSize,
      DEFAULT_EMPLOYEE_PAGE_SIZE,
      MAX_EMPLOYEE_PAGE_SIZE,
    );
    const page = await ctx.db.query("organizationLeaveSettings").paginate({
      cursor: args.cursor ?? null,
      numItems,
    });
    let scheduledCount = 0;
    for (const settings of page.page) {
      const organization = await ctx.db.get(settings.organizationId);
      if (
        organization &&
        organization.status !== "archived" &&
        settings.migrationState === "active" &&
        settings.activePolicyEngineVersion === 2
      ) {
        await ctx.scheduler.runAfter(0, employeeBatchReference, {
          organizationId: settings.organizationId,
          cursor: null,
          numItems: employeePageSize,
          asOf,
        });
        await ctx.scheduler.runAfter(0, periodCloseBatchReference, {
          organizationId: settings.organizationId,
          cursor: null,
          numItems: 10,
          asOf,
        });
        scheduledCount += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, organizationBatchReference, {
        cursor: page.continueCursor,
        numItems,
        employeePageSize,
        asOf,
      });
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scheduledCount,
    };
  },
});

export const materializeOrganizationEmployeeAccrualBatch = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
    asOf: v.number(),
  },
  handler: async (ctx, args): Promise<BatchResult> => {
    assertTimestamp(args.asOf, "Accrual date");
    const numItems = boundedPageSize(
      args.numItems,
      DEFAULT_EMPLOYEE_PAGE_SIZE,
      MAX_EMPLOYEE_PAGE_SIZE,
    );
    const page = await ctx.db
      .query("employees")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems });
    let scheduledCount = 0;
    const policies = await ctx.db
      .query("leavePolicies")
      .withIndex("by_organization_state", (query) =>
        query.eq("organizationId", args.organizationId).eq("state", "active"),
      )
      .take(MAX_POLICIES_PER_ORGANIZATION + 1);
    if (policies.length > MAX_POLICIES_PER_ORGANIZATION) {
      throw new Error("Leave accrual policy limit exceeded");
    }
    for (const employee of page.page) {
      for (const policy of policies) {
        await ctx.scheduler.runAfter(0, employeePolicyBatchReference, {
          organizationId: args.organizationId,
          employeeId: employee._id,
          policyId: policy._id,
          asOf: args.asOf,
        });
        scheduledCount += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, employeeBatchReference, {
        organizationId: args.organizationId,
        cursor: page.continueCursor,
        numItems,
        asOf: args.asOf,
      });
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scheduledCount,
    };
  },
});

export const materializeEmployeePolicyAccrualBatch = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    policyId: v.id("leavePolicies"),
    asOf: v.number(),
  },
  handler: async (ctx, args): Promise<MaterializeEmployeeAccrualsResult> =>
    materializeEmployeeAccruals(ctx, args),
});

export const closeOrganizationLeavePeriodsBatch = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
    asOf: v.number(),
  },
  handler: async (ctx, args): Promise<BatchResult> => {
    assertTimestamp(args.asOf, "Period close date");
    const numItems = boundedPageSize(args.numItems, 1, 1);
    const page = await ctx.db
      .query("employeeLeaveBalances")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems });
    let scheduledCount = 0;
    for (const balance of page.page) {
      if (
        balance.periodEnd === undefined ||
        balance.engineStatus === "closed" ||
        nextManilaDay(balance.periodEnd) > args.asOf
      ) {
        continue;
      }
      const period = getManilaCalendarDate(balance.periodEnd);
      const { policy } = await resolveBalancePolicy(ctx, balance);
      if (policy.state === "active") {
        await materializeEmployeeAccruals(ctx, {
          organizationId: args.organizationId,
          employeeId: balance.employeeId,
          policyId: policy._id,
          asOf: args.asOf,
        });
      }
      await closeLeavePolicyPeriod(ctx, {
        balanceId: balance._id,
        nextPeriodStart: toManilaMidnight({
          year: period.year + 1,
          monthIndex: 0,
          day: 1,
        }),
        nextPeriodEnd: toManilaMidnight({
          year: period.year + 1,
          monthIndex: 11,
          day: 31,
        }),
        closedAt: args.asOf,
      });
      scheduledCount += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, periodCloseBatchReference, {
        organizationId: args.organizationId,
        cursor: page.continueCursor,
        numItems,
        asOf: args.asOf,
      });
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scheduledCount,
    };
  },
});

async function getLeaveSettings(
  ctx: AccrualContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings"> | null> {
  const settings = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (settings.length > 1) {
    throw new Error("Duplicate organization leave settings");
  }
  return settings[0] ?? null;
}

function getEffectiveMonthlyVersion(
  versions: readonly Doc<"leavePolicyVersions">[],
  earningStart: number,
  earningEnd: number,
): Doc<"leavePolicyVersions"> | undefined {
  return versions.findLast(
    (version) =>
      version.entitlementMethod === "monthly" &&
      version.accountBehavior !== "non_credit" &&
      version.effectiveStart <= earningStart &&
      (version.effectiveEnd === undefined || version.effectiveEnd >= earningEnd),
  );
}

function getMonthlyAccrualAmount(
  version: Doc<"leavePolicyVersions">,
  completedMonth: number,
): number {
  const annualUnits =
    version.annualUnits ??
    (version.accrualRate === undefined ? 0 : version.accrualRate * 12);
  const cumulative = roundUnits(
    (annualUnits * completedMonth) / 12,
    version.roundingIncrement,
  );
  const prior = roundUnits(
    (annualUnits * (completedMonth - 1)) / 12,
    version.roundingIncrement,
  );
  return cumulative - prior;
}

function isAccrualEligible(
  employee: Doc<"employees">,
  version: Doc<"leavePolicyVersions">,
  windows: readonly ServiceWindow[],
  earningStart: number,
  earningEnd: number,
): boolean {
  const serviceWindow = windows.find(
    (window) =>
      window.start <= earningStart &&
      (window.end === undefined || window.end >= earningEnd),
  );
  if (!serviceWindow) return false;
  const eligibilityBase =
    version.eligibilityBasis === "regularization_date"
      ? employee.employment.regularizationDate ?? undefined
      : version.eligibilityBasis === "hire_date"
        ? serviceWindow.start
        : undefined;
  if (eligibilityBase === undefined) return false;
  return (
    addManilaCalendarMonths(eligibilityBase, version.completedServiceMonths) <=
    earningStart
  );
}

function buildServiceWindows(
  employee: Doc<"employees">,
  events: readonly Doc<"employeeLifecycleEvents">[],
): ServiceWindow[] {
  if (events.length === 0) {
    return [
      {
        start: employee.employment.hireDate,
        ...(employee.employment.status === "active"
          ? {}
          : {
              end:
                employee.employment.separationDate ??
                employee.employment.lastWorkingDay ??
                employee.updatedAt,
            }),
      },
    ];
  }
  const windows: ServiceWindow[] = [];
  let activeStart: number | undefined;
  for (const event of events) {
    if (event.type === "hired" || event.type === "rehired") {
      activeStart = event.effectiveAt;
      continue;
    }
    if (activeStart !== undefined) {
      windows.push({ start: activeStart, end: event.effectiveAt });
      activeStart = undefined;
    }
  }
  if (activeStart !== undefined) windows.push({ start: activeStart });
  return windows;
}

async function carryBalanceForward(
  ctx: AccrualContext,
  args: {
    balance: Doc<"employeeLeaveBalances">;
    policy: Doc<"leavePolicies">;
    policyVersion: Doc<"leavePolicyVersions">;
    amount: number;
    nextPeriodStart: number;
    nextPeriodEnd: number;
    closedAt: number;
  },
): Promise<number> {
  const nextVersion = await getEffectiveVersionAt(
    ctx,
    args.policy._id,
    args.nextPeriodStart,
  );
  const nextBalance = await getOrCreateBalanceProjection(ctx, {
    organizationId: args.balance.organizationId,
    employeeId: args.balance.employeeId,
    policyId: args.policy._id,
    policyVersionId: nextVersion._id,
    poolKey: nextVersion.poolKey,
    periodStart: args.nextPeriodStart,
    periodEnd: args.nextPeriodEnd,
    year: getManilaCalendarDate(args.nextPeriodStart).year,
    leaveTypeKey: nextVersion.poolKey ?? args.policy.sourceKey,
    total: 0,
    used: 0,
    balance: 0,
    source: "employee_credits",
    approvedDays: 0,
    reconciliationStatus: "matching",
    migrationVersion: 2,
    createdAt: args.closedAt,
    updatedAt: args.closedAt,
  });
  await appendLedgerEntry(ctx, {
    organizationId: args.balance.organizationId,
    employeeId: args.balance.employeeId,
    balanceId: nextBalance._id,
    policyVersionId: nextVersion._id,
    effectiveDate: args.nextPeriodStart,
    kind: "carryover",
    amount: args.amount,
    unit: "day",
    reason: `Carryover from ${args.policy.name}`,
    idempotencyKey: `carryover:${args.balance._id}:${args.nextPeriodStart}:${args.nextPeriodEnd}`,
    createdAt: args.closedAt,
  });
  return args.amount;
}

async function expireBalance(
  ctx: AccrualContext,
  balance: Doc<"employeeLeaveBalances">,
  policyVersion: Doc<"leavePolicyVersions">,
  amount: number,
  closedAt: number,
): Promise<void> {
  await appendLedgerEntry(ctx, {
    organizationId: balance.organizationId,
    employeeId: balance.employeeId,
    balanceId: balance._id,
    policyVersionId: policyVersion._id,
    effectiveDate: closedAt,
    kind: "expiration",
    amount: -amount,
    unit: "day",
    reason: "Leave policy period expiration",
    idempotencyKey: `expiration:${balance._id}:${balance.periodEnd}`,
    createdAt: closedAt,
  });
}

async function createConversionLiability(
  ctx: AccrualContext,
  args: {
    balance: Doc<"employeeLeaveBalances">;
    policy: Doc<"leavePolicies">;
    policyVersion: Doc<"leavePolicyVersions">;
    amount: number;
    closedAt: number;
  },
): Promise<void> {
  const idempotencyKey = `conversion-liability:${args.balance._id}:${args.balance.periodEnd}`;
  const existing = await ctx.db
    .query("leaveLedgerEntries")
    .withIndex("by_organization_idempotency_key", (query) =>
      query
        .eq("organizationId", args.balance.organizationId)
        .eq("idempotencyKey", idempotencyKey),
    )
    .unique();
  if (existing) return;
  const conversionRequestId = await ctx.db.insert("leaveConversionRequests", {
    organizationId: args.balance.organizationId,
    employeeId: args.balance.employeeId,
    balanceId: args.balance._id,
    policyId: args.policy._id,
    policyVersionId: args.policyVersion._id,
    requestedDays: args.amount,
    status: "approved",
    requestedBy: args.policyVersion.createdBy,
    decidedBy: args.policyVersion.createdBy,
    decidedAt: args.closedAt,
    decisionReason: "Protected SIL year-end conversion liability",
    paymentStatus: "ready",
    createdAt: args.closedAt,
    updatedAt: args.closedAt,
  });
  const ledgerEntry = await appendLedgerEntry(ctx, {
    organizationId: args.balance.organizationId,
    employeeId: args.balance.employeeId,
    balanceId: args.balance._id,
    policyVersionId: args.policyVersion._id,
    effectiveDate: args.closedAt,
    kind: "conversion",
    amount: -args.amount,
    unit: "day",
    referenceType: "conversion",
    leaveConversionRequestId: conversionRequestId,
    actorId: args.policyVersion.createdBy,
    reason: "Protected SIL year-end conversion liability",
    idempotencyKey,
    createdAt: args.closedAt,
  });
  await ctx.db.patch(conversionRequestId, { ledgerEntryId: ledgerEntry._id });
}

async function getEffectiveVersionAt(
  ctx: AccrualContext,
  policyId: Id<"leavePolicies">,
  effectiveDate: number,
): Promise<Doc<"leavePolicyVersions">> {
  const versions = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_effective", (query) =>
      query.eq("leavePolicyId", policyId).lte("effectiveStart", effectiveDate),
    )
    .order("desc")
    .take(2);
  const version = versions.find(
    (candidate) =>
      candidate.effectiveEnd === undefined || candidate.effectiveEnd >= effectiveDate,
  );
  if (!version) throw new Error("No leave policy version covers the next period");
  return version;
}

async function resolveBalancePolicy(
  ctx: AccrualContext,
  balance: Doc<"employeeLeaveBalances">,
): Promise<{
  policy: Doc<"leavePolicies">;
  policyVersion: Doc<"leavePolicyVersions">;
}> {
  if (balance.policyVersionId !== undefined) {
    const policyVersion = await ctx.db.get(balance.policyVersionId);
    if (!policyVersion || policyVersion.organizationId !== balance.organizationId) {
      throw new Error("Leave policy version not found");
    }
    const policy = await ctx.db.get(policyVersion.leavePolicyId);
    if (!policy || policy.organizationId !== balance.organizationId) {
      throw new Error("Leave policy not found");
    }
    return { policy, policyVersion };
  }
  if (balance.poolKey === undefined || balance.periodEnd === undefined) {
    throw new Error("Leave balance policy identity is required for period close");
  }
  const periodEnd = balance.periodEnd;
  const policies = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", balance.organizationId),
    )
    .take(MAX_POLICIES_PER_ORGANIZATION + 1);
  if (policies.length > MAX_POLICIES_PER_ORGANIZATION) {
    throw new Error("Leave period close policy limit exceeded");
  }
  const matches: Array<{
    policy: Doc<"leavePolicies">;
    policyVersion: Doc<"leavePolicyVersions">;
  }> = [];
  for (const policy of policies) {
    const versions = await ctx.db
      .query("leavePolicyVersions")
      .withIndex("by_policy_effective", (query) =>
        query.eq("leavePolicyId", policy._id).lte("effectiveStart", periodEnd),
      )
      .order("desc")
      .take(2);
    const policyVersion = versions.find(
      (version) =>
        version.accountBehavior === "shared_pool" &&
        version.poolKey === balance.poolKey &&
        (version.effectiveEnd === undefined || version.effectiveEnd >= periodEnd),
    );
    if (policyVersion && policyVersion.entitlementMethod !== "none") {
      matches.push({ policy, policyVersion });
    }
  }
  const protectedSil = matches.find(
    ({ policy }) => policy.complianceRole === "private_sil_minimum",
  );
  if (protectedSil) return protectedSil;
  if (matches.length !== 1) {
    throw new Error("Shared leave pool must have one governing entitlement policy");
  }
  return matches[0];
}

function boundedPageSize(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Leave accrual page size must be a positive integer");
  }
  return Math.min(value, maximum);
}

function roundUnits(amount: number, increment: number): number {
  return Math.round((amount + Number.EPSILON) / increment) * increment;
}

function addManilaCalendarMonths(timestamp: number, months: number): number {
  const date = getManilaCalendarDate(timestamp);
  const monthOffset = date.monthIndex + months;
  const year = date.year + Math.floor(monthOffset / 12);
  const monthIndex = monthOffset % 12;
  return toManilaMidnight({
    year,
    monthIndex,
    day: Math.min(date.day, daysInMonth(year, monthIndex)),
  });
}

function nextManilaDay(timestamp: number): number {
  const date = getManilaCalendarDate(timestamp);
  return toManilaMidnight({
    year: date.year,
    monthIndex: date.monthIndex,
    day: date.day + 1,
  });
}

function getManilaCalendarDate(timestamp: number): ManilaCalendarDate {
  const shifted = new Date(timestamp + MANILA_OFFSET_MILLISECONDS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function toManilaMidnight(date: ManilaCalendarDate): number {
  return Date.UTC(date.year, date.monthIndex, date.day) - MANILA_OFFSET_MILLISECONDS;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a valid timestamp`);
  }
}

function makeInternalMutationReference<
  Args extends Record<string, unknown>,
  Result,
>(name: string): FunctionReference<"mutation", "internal", Args, Result> {
  return makeFunctionReference<"mutation", Args, Result>(name) as unknown as FunctionReference<
    "mutation",
    "internal",
    Args,
    Result
  >;
}
