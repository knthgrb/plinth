import { projectLeaveBalance } from "../lib/leave/policy-engine";
import type { LeaveLedgerKind } from "../lib/leave/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_REBUILD_ENTRIES = 1_000;

type LedgerMutationContext = Pick<MutationCtx, "db">;

type BalanceProjectionFields = Pick<
  Doc<"employeeLeaveBalances">,
  | "organizationId"
  | "employeeId"
  | "policyId"
  | "policyVersionId"
  | "poolKey"
  | "periodStart"
  | "periodEnd"
  | "year"
  | "leaveTypeKey"
  | "total"
  | "used"
  | "balance"
  | "source"
  | "annualSilOverride"
  | "overrideReason"
  | "updatedBy"
  | "approvedDays"
  | "reconciliationStatus"
  | "migrationVersion"
  | "createdAt"
  | "updatedAt"
>;

export type GetOrCreateBalanceProjectionArgs = BalanceProjectionFields;

export type LedgerEntryArgs = Omit<
  Doc<"leaveLedgerEntries">,
  "_id" | "_creationTime"
>;

type UnitsOperationArgs = Omit<
  LedgerEntryArgs,
  "kind" | "amount" | "reversalOfEntryId"
> & {
  units: number;
  reversalOfEntryId?: Id<"leaveLedgerEntries">;
};

export interface RebuildBalanceProjectionArgs {
  balanceId: Id<"employeeLeaveBalances">;
  periodStart: number;
  periodEnd: number;
  updatedAt: number;
}

interface BalanceTotals {
  granted: number;
  reserved: number;
  converted: number;
  expired: number;
  used: number;
  available: number;
}

export async function getOrCreateBalanceProjection(
  ctx: LedgerMutationContext,
  args: GetOrCreateBalanceProjectionArgs,
): Promise<Doc<"employeeLeaveBalances">> {
  if (args.periodStart === undefined || args.periodEnd === undefined) {
    throw new Error("Canonical leave balance period is required");
  }
  if (args.periodStart > args.periodEnd) {
    throw new Error("Leave balance period is invalid");
  }
  if (args.policyId === undefined || args.policyVersionId === undefined) {
    throw new Error("Canonical leave policy identity is required");
  }

  const [employee, policy, policyVersion] = await Promise.all([
    ctx.db.get(args.employeeId),
    ctx.db.get(args.policyId),
    ctx.db.get(args.policyVersionId),
  ]);
  if (!employee || employee.organizationId !== args.organizationId) {
    throw new Error("Employee organization mismatch");
  }
  if (!policy || policy.organizationId !== args.organizationId) {
    throw new Error("Leave policy organization mismatch");
  }
  if (
    !policyVersion ||
    policyVersion.organizationId !== args.organizationId ||
    policyVersion.leavePolicyId !== args.policyId
  ) {
    throw new Error("Leave policy version organization mismatch");
  }

  const usesSharedPool = policyVersion.accountBehavior === "shared_pool";
  if (usesSharedPool && (!args.poolKey || args.poolKey !== policyVersion.poolKey)) {
    throw new Error("Leave balance pool identity mismatch");
  }
  if (!usesSharedPool && args.poolKey !== undefined) {
    throw new Error("Individual leave balance cannot use a pool key");
  }

  const existing = usesSharedPool
    ? await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization_employee_pool_period", (query) =>
          query
            .eq("organizationId", args.organizationId)
            .eq("employeeId", args.employeeId)
            .eq("poolKey", args.poolKey)
            .eq("periodStart", args.periodStart)
            .eq("periodEnd", args.periodEnd),
        )
        .unique()
    : await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization_employee_policy_period", (query) =>
          query
            .eq("organizationId", args.organizationId)
            .eq("employeeId", args.employeeId)
            .eq("policyId", args.policyId)
            .eq("periodStart", args.periodStart)
            .eq("periodEnd", args.periodEnd),
        )
        .unique();

  if (existing !== null) {
    if (
      !usesSharedPool &&
      existing.policyId !== args.policyId
    ) {
      throw new Error("Leave balance policy identity mismatch");
    }
    return existing;
  }

  const balanceId = await ctx.db.insert("employeeLeaveBalances", {
    ...args,
    policyId: usesSharedPool ? undefined : args.policyId,
    policyVersionId: usesSharedPool ? undefined : args.policyVersionId,
    granted: 0,
    reserved: 0,
    converted: 0,
    expired: 0,
    projectionVersion: 1,
    engineStatus: "open",
  });
  const balance = await ctx.db.get(balanceId);
  if (balance === null) {
    throw new Error("Failed to create leave balance projection");
  }
  return balance;
}

export async function appendLedgerEntry(
  ctx: LedgerMutationContext,
  args: LedgerEntryArgs,
): Promise<Doc<"leaveLedgerEntries">> {
  assertFiniteAmount(args.amount);
  assertLedgerKindSign(args.kind, args.amount);

  const existing = await ctx.db
    .query("leaveLedgerEntries")
    .withIndex("by_organization_idempotency_key", (query) =>
      query
        .eq("organizationId", args.organizationId)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing !== null) {
    assertIdempotentReplay(existing, args);
    return existing;
  }

  const balance = await ctx.db.get(args.balanceId);
  if (balance === null) throw new Error("Leave balance not found");
  await assertLedgerMatchesBalance(ctx, balance, args);

  const next = applyLedgerEntry(balance, args.kind, args.amount);
  assertValidProjection(next);

  const ledgerEntryId = await ctx.db.insert("leaveLedgerEntries", args);
  await ctx.db.patch(args.balanceId, {
    granted: next.granted,
    reserved: next.reserved,
    converted: next.converted,
    expired: next.expired,
    total: getLegacyTotal(next),
    used: next.used,
    approvedDays: next.used,
    balance: next.available,
    lastLedgerEntryId: ledgerEntryId,
    projectionVersion: (balance.projectionVersion ?? 0) + 1,
    updatedAt: args.createdAt,
  });
  const ledgerEntry = await ctx.db.get(ledgerEntryId);
  if (ledgerEntry === null) throw new Error("Failed to append leave ledger entry");
  return ledgerEntry;
}

export async function reserveUnits(
  ctx: LedgerMutationContext,
  args: UnitsOperationArgs,
): Promise<Doc<"leaveLedgerEntries">> {
  assertPositiveUnits(args.units);
  return appendLedgerEntry(ctx, {
    ...withoutUnits(args),
    kind: "reservation",
    amount: -args.units,
  });
}

export async function releaseReservation(
  ctx: LedgerMutationContext,
  args: UnitsOperationArgs,
): Promise<Doc<"leaveLedgerEntries">> {
  assertPositiveUnits(args.units);
  return appendLedgerEntry(ctx, {
    ...withoutUnits(args),
    kind: "reservation_release",
    amount: args.units,
  });
}

export async function consumeReservation(
  ctx: LedgerMutationContext,
  args: UnitsOperationArgs,
): Promise<{
  release: Doc<"leaveLedgerEntries">;
  usage: Doc<"leaveLedgerEntries">;
}> {
  assertPositiveUnits(args.units);
  const release = await releaseReservation(ctx, {
    ...args,
    idempotencyKey: `${args.idempotencyKey}:release`,
  });
  const usage = await appendLedgerEntry(ctx, {
    ...withoutUnits(args),
    kind: "usage",
    amount: -args.units,
    idempotencyKey: `${args.idempotencyKey}:usage`,
  });
  return { release, usage };
}

export async function restoreUsage(
  ctx: LedgerMutationContext,
  args: UnitsOperationArgs,
): Promise<Doc<"leaveLedgerEntries">> {
  assertPositiveUnits(args.units);
  return appendLedgerEntry(ctx, {
    ...withoutUnits(args),
    kind: "restoration",
    amount: args.units,
  });
}

export async function rebuildBalanceProjection(
  ctx: LedgerMutationContext,
  args: RebuildBalanceProjectionArgs,
): Promise<Doc<"employeeLeaveBalances">> {
  if (args.periodStart > args.periodEnd) {
    throw new Error("Leave balance period is invalid");
  }
  const balance = await ctx.db.get(args.balanceId);
  if (balance === null) throw new Error("Leave balance not found");
  if (
    balance.periodStart === undefined ||
    balance.periodEnd === undefined ||
    args.periodStart !== balance.periodStart ||
    args.periodEnd !== balance.periodEnd
  ) {
    throw new Error("Rebuild period must match the canonical period");
  }

  const entries = await ctx.db
    .query("leaveLedgerEntries")
    .withIndex("by_balance_effective", (query) =>
      query
        .eq("balanceId", args.balanceId)
        .gte("effectiveDate", args.periodStart)
        .lte("effectiveDate", args.periodEnd),
    )
    .take(MAX_REBUILD_ENTRIES + 1);
  if (entries.length > MAX_REBUILD_ENTRIES) {
    throw new Error("Leave ledger rebuild exceeds the bounded entry limit");
  }

  const projection = projectLeaveBalance(entries);
  assertValidProjection(projection);
  await ctx.db.patch(args.balanceId, {
    granted: projection.granted,
    reserved: projection.reserved,
    converted: projection.converted,
    expired: projection.expired,
    total: getLegacyTotal({
      ...projection,
      available: projection.available,
    }),
    used: projection.used,
    approvedDays: projection.used,
    balance: projection.available,
    lastLedgerEntryId: entries.at(-1)?._id,
    projectionVersion: (balance.projectionVersion ?? 0) + 1,
    updatedAt: args.updatedAt,
  });
  const rebuilt = await ctx.db.get(args.balanceId);
  if (rebuilt === null) throw new Error("Failed to rebuild leave balance projection");
  return rebuilt;
}

function withoutUnits(args: UnitsOperationArgs): Omit<LedgerEntryArgs, "kind" | "amount"> {
  const { units, ...entry } = args;
  void units;
  return entry;
}

function applyLedgerEntry(
  balance: Doc<"employeeLeaveBalances">,
  kind: LeaveLedgerKind,
  amount: number,
): BalanceTotals {
  const delta = projectLeaveBalance([{ kind, amount }]);
  return {
    granted: (balance.granted ?? balance.total) + delta.granted,
    reserved: (balance.reserved ?? 0) + delta.reserved,
    converted: (balance.converted ?? 0) + delta.converted,
    expired: (balance.expired ?? 0) + delta.expired,
    used: balance.used + delta.used,
    available: balance.balance + delta.available,
  };
}

async function assertLedgerMatchesBalance(
  ctx: LedgerMutationContext,
  balance: Doc<"employeeLeaveBalances">,
  entry: LedgerEntryArgs,
): Promise<void> {
  if (
    balance.organizationId !== entry.organizationId ||
    balance.employeeId !== entry.employeeId
  ) {
    throw new Error("Leave ledger entry does not match its balance projection");
  }
  const policyVersion = await ctx.db.get(entry.policyVersionId);
  if (!policyVersion || policyVersion.organizationId !== entry.organizationId) {
    throw new Error("Leave ledger policy version organization mismatch");
  }
  if (balance.poolKey !== undefined) {
    if (
      policyVersion.accountBehavior !== "shared_pool" ||
      policyVersion.poolKey !== balance.poolKey
    ) {
      throw new Error("Leave ledger entry does not match its balance pool");
    }
  } else if (balance.policyId !== policyVersion.leavePolicyId) {
    throw new Error("Leave ledger entry does not match its balance policy");
  }
}

function assertIdempotentReplay(
  existing: Doc<"leaveLedgerEntries">,
  requested: LedgerEntryArgs,
): void {
  if (
    existing.organizationId !== requested.organizationId ||
    existing.employeeId !== requested.employeeId ||
    existing.balanceId !== requested.balanceId ||
    existing.policyVersionId !== requested.policyVersionId ||
    existing.effectiveDate !== requested.effectiveDate ||
    existing.kind !== requested.kind ||
    existing.amount !== requested.amount ||
    existing.unit !== requested.unit ||
    existing.referenceType !== requested.referenceType ||
    existing.leaveRequestId !== requested.leaveRequestId ||
    existing.leaveConversionRequestId !== requested.leaveConversionRequestId ||
    existing.payrollRunId !== requested.payrollRunId ||
    existing.migrationRunId !== requested.migrationRunId ||
    existing.leaveMigrationRunId !== requested.leaveMigrationRunId ||
    existing.actorId !== requested.actorId ||
    existing.reason !== requested.reason ||
    existing.reversalOfEntryId !== requested.reversalOfEntryId
  ) {
    throw new Error("Leave ledger idempotency collision");
  }
}

function assertLedgerKindSign(kind: LeaveLedgerKind, amount: number): void {
  const positiveKinds: readonly LeaveLedgerKind[] = [
    "opening_grant",
    "grant",
    "accrual",
    "reservation_release",
    "restoration",
    "carryover",
  ];
  const negativeKinds: readonly LeaveLedgerKind[] = [
    "opening_usage",
    "reservation",
    "usage",
    "expiration",
    "conversion",
  ];
  if (
    amount === 0 ||
    (positiveKinds.includes(kind) && amount < 0) ||
    (negativeKinds.includes(kind) && amount > 0)
  ) {
    throw new Error(`Invalid amount sign for ${kind} leave ledger entry`);
  }
}

function getLegacyTotal(projection: BalanceTotals): number {
  return (
    projection.available +
    projection.used +
    projection.reserved +
    projection.converted +
    projection.expired
  );
}

function assertPositiveUnits(units: number): void {
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error("Leave units must be a positive number");
  }
}

function assertFiniteAmount(amount: number): void {
  if (!Number.isFinite(amount)) throw new Error("Leave amount must be finite");
}

function assertValidProjection(projection: BalanceTotals): void {
  if (
    !Number.isFinite(projection.granted) ||
    !Number.isFinite(projection.reserved) ||
    !Number.isFinite(projection.converted) ||
    !Number.isFinite(projection.expired) ||
    !Number.isFinite(projection.used) ||
    !Number.isFinite(projection.available)
  ) {
    throw new Error("Leave balance projection must contain finite values");
  }
  if (projection.available < 0) throw new Error("Insufficient leave balance");
  if (projection.reserved < 0) throw new Error("Leave reservation exceeds reserved balance");
  if (projection.used < 0) throw new Error("Leave restoration exceeds used balance");
  if (projection.converted < 0) throw new Error("Leave conversion exceeds converted balance");
  if (projection.expired < 0) throw new Error("Leave expiration exceeds expired balance");
}
