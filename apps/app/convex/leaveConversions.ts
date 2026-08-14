import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireActiveMembership } from "./access";
import { decryptEmployeeFromDb } from "./employeeCompensationCrypto";
import { appendLedgerEntry } from "./leaveLedger";

const REVIEWER_ROLES = new Set<Doc<"userOrganizations">["role"]>([
  "owner",
  "admin",
  "hr",
]);
const MAX_CONVERSION_ROWS = 500;
const DEFAULT_WORKING_DAYS_PER_YEAR = 261;

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
type ConversionStatus = Doc<"leaveConversionRequests">["status"];
type DecryptedEmployee = ReturnType<
  typeof decryptEmployeeFromDb<Doc<"employees">>
>;
type PayableConversionRequest = Doc<"leaveConversionRequests"> & {
  dailyRateSnapshot: number;
  payableAmount: number;
};

export type LeaveConversionQueueRow = Doc<"leaveConversionRequests"> & {
  employeeName: string;
  policyName: string;
};

export type ApprovedLeaveConversionAmount = {
  employeeId: Id<"employees">;
  employee: DecryptedEmployee;
  convertibleDays: number;
  dailyRate: number;
  leaveConversionAmount: number;
  requestIds: Id<"leaveConversionRequests">[];
};

async function loadLeaveSettings(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings">> {
  const settings = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .unique();
  if (
    !settings ||
    settings.migrationState !== "active" ||
    settings.activePolicyEngineVersion !== 2
  ) {
    throw new Error("Canonical leave conversion is not active");
  }
  return settings;
}

export async function isCanonicalLeaveEngineActive(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<boolean> {
  const settings = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .unique();
  return (
    settings?.migrationState === "active" &&
    settings.activePolicyEngineVersion === 2
  );
}

function assertReviewer(role: Doc<"userOrganizations">["role"]): void {
  if (!REVIEWER_ROLES.has(role)) {
    throw new Error("Only Owner, Admin, or HR can review leave conversions");
  }
}

function assertPositiveDays(days: number): void {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("Conversion days must be greater than zero");
  }
}

function assertIncrement(days: number, increment: number): void {
  const units = days / increment;
  if (Math.abs(units - Math.round(units)) > Number.EPSILON * 10) {
    throw new Error(`Conversion days must use ${increment}-day increments`);
  }
}

async function resolvePolicyVersion(
  ctx: DatabaseContext,
  args: {
    balance: Doc<"employeeLeaveBalances">;
    policyId?: Id<"leavePolicies">;
  },
): Promise<{
  policy: Doc<"leavePolicies">;
  version: Doc<"leavePolicyVersions">;
}> {
  const policyId = args.policyId ?? args.balance.policyId;
  if (!policyId) {
    throw new Error("Select the leave policy to convert from the shared pool");
  }
  const policy = await ctx.db.get(policyId);
  if (!policy || policy.organizationId !== args.balance.organizationId) {
    throw new Error("Leave conversion policy not found");
  }
  if (args.balance.policyId && args.balance.policyId !== policyId) {
    throw new Error("Leave conversion policy does not match the balance");
  }

  let version = args.balance.policyVersionId
    ? await ctx.db.get(args.balance.policyVersionId)
    : null;
  if (!version || version.leavePolicyId !== policyId) {
    const versions = await ctx.db
      .query("leavePolicyVersions")
      .withIndex("by_policy_effective", (builder) =>
        builder.eq("leavePolicyId", policyId),
      )
      .order("desc")
      .take(10);
    version =
      versions.find(
        (candidate) =>
          candidate.effectiveStart <= (args.balance.periodEnd ?? Date.now()) &&
          (candidate.effectiveEnd === undefined ||
            candidate.effectiveEnd >= (args.balance.periodStart ?? 0)),
      ) ?? null;
  }
  if (!version || version.organizationId !== args.balance.organizationId) {
    throw new Error("Leave conversion policy version not found");
  }
  if (
    args.balance.poolKey !== undefined &&
    (version.accountBehavior !== "shared_pool" ||
      version.poolKey !== args.balance.poolKey)
  ) {
    throw new Error("Leave conversion policy does not match the shared pool");
  }
  return { policy, version };
}

async function loadPendingRequestedDays(
  ctx: DatabaseContext,
  args: {
    employeeId: Id<"employees">;
    balanceId: Id<"employeeLeaveBalances">;
    policyId: Id<"leavePolicies">;
  },
): Promise<number> {
  const pending = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_employee_status", (builder) =>
      builder.eq("employeeId", args.employeeId).eq("status", "pending"),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (pending.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion request limit exceeded");
  }
  return pending
    .filter(
      (request) =>
        request.balanceId === args.balanceId && request.policyId === args.policyId,
    )
    .reduce((total, request) => total + request.requestedDays, 0);
}

async function loadCommittedRequestedDays(
  ctx: DatabaseContext,
  args: {
    employeeId: Id<"employees">;
    balanceId: Id<"employeeLeaveBalances">;
    policyId: Id<"leavePolicies">;
  },
): Promise<number> {
  const rows = (
    await Promise.all(
      (["approved", "paid"] as const).map((status) =>
        ctx.db
          .query("leaveConversionRequests")
          .withIndex("by_employee_status", (builder) =>
            builder.eq("employeeId", args.employeeId).eq("status", status),
          )
          .take(MAX_CONVERSION_ROWS + 1),
      ),
    )
  ).flat();
  if (rows.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion request limit exceeded");
  }
  return rows
    .filter(
      (request) =>
        request.balanceId === args.balanceId && request.policyId === args.policyId,
    )
    .reduce((total, request) => total + request.requestedDays, 0);
}

async function calculateDailyRateSnapshot(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<number> {
  const decrypted = decryptEmployeeFromDb(employee);
  const payrollSettings = await ctx.db
    .query("organizationPayrollSettings")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", employee.organizationId),
    )
    .unique();
  const basicSalary = Number(decrypted.compensation.basicSalary);
  const allowance = Number(decrypted.compensation.allowance ?? 0);
  if (!Number.isFinite(basicSalary) || !Number.isFinite(allowance)) {
    throw new Error("Employee compensation is invalid");
  }
  const settings = payrollSettings?.payrollSettings;
  const workingDays =
    settings?.dailyRateWorkingDaysPerYear ?? DEFAULT_WORKING_DAYS_PER_YEAR;
  if (!Number.isFinite(workingDays) || workingDays <= 0) {
    throw new Error("Payroll working days per year must be greater than zero");
  }

  let dailyRate: number;
  if (decrypted.compensation.salaryType === "daily") {
    dailyRate = basicSalary;
  } else if (decrypted.compensation.salaryType === "hourly") {
    dailyRate = basicSalary * 8;
  } else {
    const base =
      basicSalary +
      (settings?.dailyRateIncludesAllowance === false ? 0 : allowance);
    dailyRate = (base * 12) / workingDays;
  }
  return roundCurrency(dailyRate);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function findFinalSettlement(
  ctx: DatabaseContext,
  employeeId: Id<"employees">,
): Promise<Doc<"finalSettlements"> | null> {
  const settlements = await ctx.db
    .query("finalSettlements")
    .withIndex("by_employee", (builder) => builder.eq("employeeId", employeeId))
    .take(2);
  if (settlements.length > 1) {
    throw new Error("Employee has duplicate final settlements");
  }
  return settlements[0] ?? null;
}

export const requestLeaveConversion = mutation({
  args: {
    organizationId: v.id("organizations"),
    balanceId: v.id("employeeLeaveBalances"),
    policyId: v.optional(v.id("leavePolicies")),
    requestedDays: v.number(),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    await loadLeaveSettings(ctx, args.organizationId);
    assertPositiveDays(args.requestedDays);
    const balance = await ctx.db.get(args.balanceId);
    if (!balance || balance.organizationId !== args.organizationId) {
      throw new Error("Leave balance not found");
    }
    const canRequestForEmployee = REVIEWER_ROLES.has(membership.role);
    if (
      membership.employeeId !== balance.employeeId &&
      !canRequestForEmployee
    ) {
      throw new Error("Not authorized to request this leave conversion");
    }
    const employee = await ctx.db.get(balance.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      throw new Error("Employee not found");
    }
    if (employee.employment.status === "active" && balance.engineStatus === "closed") {
      throw new Error("Closed leave balances cannot be converted");
    }
    if (args.requestedDays > balance.balance) {
      throw new Error("Insufficient leave balance for conversion");
    }

    const { policy, version } = await resolvePolicyVersion(ctx, {
      balance,
      policyId: args.policyId,
    });
    if (!version.conversionAllowed) {
      throw new Error("This leave policy does not allow conversion");
    }
    assertIncrement(args.requestedDays, version.roundingIncrement);
    const requestIdentity = {
      employeeId: balance.employeeId,
      balanceId: balance._id,
      policyId: policy._id,
    };
    const [pendingRequestedDays, committedRequestedDays] = await Promise.all([
      loadPendingRequestedDays(ctx, requestIdentity),
      loadCommittedRequestedDays(ctx, requestIdentity),
    ]);
    if (
      version.maxConvertibleUnits !== undefined &&
      committedRequestedDays + pendingRequestedDays + args.requestedDays >
        version.maxConvertibleUnits
    ) {
      throw new Error("Requested days exceed the policy conversion cap");
    }

    const now = Date.now();
    return await ctx.db.insert("leaveConversionRequests", {
      organizationId: args.organizationId,
      employeeId: balance.employeeId,
      balanceId: balance._id,
      policyId: policy._id,
      policyVersionId: version._id,
      requestedDays: args.requestedDays,
      status: "pending",
      requestedBy: user._id,
      paymentStatus: "not_ready",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const approveLeaveConversion = mutation({
  args: {
    organizationId: v.id("organizations"),
    conversionRequestId: v.id("leaveConversionRequests"),
    decisionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    assertReviewer(membership.role);
    await loadLeaveSettings(ctx, args.organizationId);
    const request = await ctx.db.get(args.conversionRequestId);
    if (!request || request.organizationId !== args.organizationId) {
      throw new Error("Leave conversion request not found");
    }
    if (request.status !== "pending") {
      throw new Error("Only pending leave conversions can be approved");
    }
    const [balance, policy, version, employee] = await Promise.all([
      ctx.db.get(request.balanceId),
      ctx.db.get(request.policyId),
      ctx.db.get(request.policyVersionId),
      ctx.db.get(request.employeeId),
    ]);
    if (
      !balance ||
      !policy ||
      !version ||
      !employee ||
      balance.organizationId !== args.organizationId ||
      policy.organizationId !== args.organizationId ||
      version.organizationId !== args.organizationId ||
      employee.organizationId !== args.organizationId
    ) {
      throw new Error("Leave conversion references are invalid");
    }
    if (!version.conversionAllowed) {
      throw new Error("This leave policy no longer allows conversion");
    }
    if (request.requestedDays > balance.balance) {
      throw new Error("Insufficient leave balance for conversion");
    }

    const finalSettlement =
      employee.employment.status === "active"
        ? null
        : await findFinalSettlement(ctx, employee._id);
    if (
      employee.employment.status !== "active" &&
      (!finalSettlement ||
        finalSettlement.status === "void" ||
        finalSettlement.status === "released")
    ) {
      throw new Error(
        "Prepare an open final settlement before approving this conversion",
      );
    }

    const dailyRateSnapshot = await calculateDailyRateSnapshot(ctx, employee);
    const payableAmount = roundCurrency(
      dailyRateSnapshot * request.requestedDays,
    );
    const now = Date.now();
    const ledger = await appendLedgerEntry(ctx, {
      organizationId: args.organizationId,
      employeeId: request.employeeId,
      balanceId: request.balanceId,
      policyVersionId: request.policyVersionId,
      effectiveDate: now,
      kind: "conversion",
      amount: -request.requestedDays,
      unit: "day",
      referenceType: "conversion",
      leaveConversionRequestId: request._id,
      actorId: user._id,
      reason: args.decisionReason?.trim() || "Leave conversion approved",
      idempotencyKey: `leave-conversion:${request._id}:approval`,
      createdAt: now,
    });
    await ctx.db.patch(request._id, {
      status: "approved",
      decidedBy: user._id,
      decidedAt: now,
      decisionReason: args.decisionReason?.trim() || undefined,
      ledgerEntryId: ledger._id,
      dailyRateSnapshot,
      payableAmount,
      finalSettlementId: finalSettlement?._id,
      paymentStatus: "ready",
      updatedAt: now,
    });
    return { approved: true as const };
  },
});

export const cancelLeaveConversion = mutation({
  args: {
    organizationId: v.id("organizations"),
    conversionRequestId: v.id("leaveConversionRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const request = await ctx.db.get(args.conversionRequestId);
    if (!request || request.organizationId !== args.organizationId) {
      throw new Error("Leave conversion request not found");
    }
    if (
      request.requestedBy !== user._id &&
      !REVIEWER_ROLES.has(membership.role)
    ) {
      throw new Error("Not authorized to cancel this leave conversion");
    }
    const reason = args.reason.trim();
    if (!reason) throw new Error("Cancellation reason is required");
    if (request.status === "paid" || request.paymentStatus === "paid") {
      throw new Error("Paid leave conversions cannot be cancelled");
    }
    if (request.status !== "pending" && request.status !== "approved") {
      throw new Error("Leave conversion cannot be cancelled in its current state");
    }
    if (request.payrollRunId) {
      const payrollRun = await ctx.db.get(request.payrollRunId);
      if (
        payrollRun &&
        ["finalized", "paid", "archived"].includes(payrollRun.status)
      ) {
        throw new Error("Leave conversion is locked by finalized payroll");
      }
    }

    const now = Date.now();
    if (request.status === "approved") {
      if (!request.ledgerEntryId) {
        throw new Error("Approved leave conversion is missing its ledger entry");
      }
      await appendLedgerEntry(ctx, {
        organizationId: args.organizationId,
        employeeId: request.employeeId,
        balanceId: request.balanceId,
        policyVersionId: request.policyVersionId,
        effectiveDate: now,
        kind: "adjustment",
        amount: request.requestedDays,
        unit: "day",
        referenceType: "correction",
        leaveConversionRequestId: request._id,
        actorId: user._id,
        reason,
        idempotencyKey: `leave-conversion:${request._id}:cancellation`,
        reversalOfEntryId: request.ledgerEntryId,
        createdAt: now,
      });
    }
    await ctx.db.patch(request._id, {
      status: "cancelled",
      decisionReason: reason,
      paymentStatus: "cancelled",
      updatedAt: now,
    });
    return { cancelled: true as const };
  },
});

export const getLeaveConversionQueue = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"))),
  },
  handler: async (ctx, args): Promise<LeaveConversionQueueRow[]> => {
    const { membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    assertReviewer(membership.role);
    const rows = args.status
      ? await ctx.db
          .query("leaveConversionRequests")
          .withIndex("by_organization_status", (builder) =>
            builder
              .eq("organizationId", args.organizationId)
              .eq("status", args.status as ConversionStatus),
          )
          .take(MAX_CONVERSION_ROWS)
      : await ctx.db
          .query("leaveConversionRequests")
          .withIndex("by_organization_status", (builder) =>
            builder.eq("organizationId", args.organizationId),
          )
          .take(MAX_CONVERSION_ROWS);
    return await Promise.all(
      rows.map(async (row) => {
        const [employee, policy] = await Promise.all([
          ctx.db.get(row.employeeId),
          ctx.db.get(row.policyId),
        ]);
        return {
          ...row,
          employeeName: employee
            ? [
                employee.personalInfo.firstName,
                employee.personalInfo.lastName,
              ]
                .filter(Boolean)
                .join(" ")
                .trim()
            : "Employee",
          policyName: policy?.name ?? "Leave policy",
        };
      }),
    );
  },
});

export async function getApprovedLeaveConversionAmountsForPayroll(
  ctx: DatabaseContext,
  args: {
    organizationId: Id<"organizations">;
    employeeIds: Id<"employees">[];
    includeFinalSettlement: boolean;
    year?: number;
  },
): Promise<ApprovedLeaveConversionAmount[]> {
  await loadLeaveSettings(ctx, args.organizationId);
  const selected = new Set(args.employeeIds.map(String));
  const requests = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_organization_status", (builder) =>
      builder.eq("organizationId", args.organizationId).eq("status", "approved"),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (requests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion payroll batch exceeds the row limit");
  }
  const eligible: PayableConversionRequest[] = [];
  for (const request of requests) {
    if (
      !selected.has(String(request.employeeId)) ||
      request.paymentStatus !== "ready" ||
      request.payableAmount === undefined ||
      request.dailyRateSnapshot === undefined ||
      (args.includeFinalSettlement
        ? request.finalSettlementId === undefined
        : request.finalSettlementId !== undefined)
    ) {
      continue;
    }
    if (args.year !== undefined) {
      const balance = await ctx.db.get(request.balanceId);
      if (!balance || balance.year !== args.year) continue;
    }
    eligible.push({
      ...request,
      dailyRateSnapshot: request.dailyRateSnapshot,
      payableAmount: request.payableAmount,
    });
  }
  const byEmployee = new Map<
    string,
    Omit<ApprovedLeaveConversionAmount, "employee">
  >();
  for (const request of eligible) {
    const key = String(request.employeeId);
    const current = byEmployee.get(key);
    byEmployee.set(key, {
      employeeId: request.employeeId,
      convertibleDays:
        (current?.convertibleDays ?? 0) + request.requestedDays,
      dailyRate: request.dailyRateSnapshot,
      leaveConversionAmount: roundCurrency(
        (current?.leaveConversionAmount ?? 0) + request.payableAmount,
      ),
      requestIds: [...(current?.requestIds ?? []), request._id],
    });
  }
  const result: ApprovedLeaveConversionAmount[] = [];
  for (const amount of byEmployee.values()) {
    const employee = await ctx.db.get(amount.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) continue;
    result.push({ ...amount, employee: decryptEmployeeFromDb(employee) });
  }
  return result;
}

export async function getFinalSettlementLeaveConversionAmount(
  ctx: DatabaseContext,
  employeeId: Id<"employees">,
): Promise<number> {
  const approved = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_employee_status", (builder) =>
      builder.eq("employeeId", employeeId).eq("status", "approved"),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (approved.length > MAX_CONVERSION_ROWS) {
    throw new Error("Final settlement leave conversion limit exceeded");
  }
  return roundCurrency(
    approved
      .filter(
        (request) =>
          request.finalSettlementId !== undefined &&
          (request.paymentStatus === "ready" ||
            request.paymentStatus === "processing"),
      )
      .reduce((total, request) => total + (request.payableAmount ?? 0), 0),
  );
}

export async function linkApprovedLeaveConversionsToPayrollRun(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    payrollRunId: Id<"payrollRuns">;
    employeeIds: Id<"employees">[];
  },
): Promise<void> {
  const run = await ctx.db.get(args.payrollRunId);
  if (
    !run ||
    run.organizationId !== args.organizationId ||
    run.runType !== "leave_conversion" ||
    run.status !== "draft"
  ) {
    throw new Error("Draft leave conversion payroll run not found");
  }
  const selected = new Set(args.employeeIds.map(String));
  const requests = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_organization_status", (builder) =>
      builder.eq("organizationId", args.organizationId).eq("status", "approved"),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (requests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion payroll batch exceeds the row limit");
  }
  const now = Date.now();
  for (const request of requests) {
    if (
      selected.has(String(request.employeeId)) &&
      request.finalSettlementId === undefined &&
      request.paymentStatus === "ready"
    ) {
      await ctx.db.patch(request._id, {
        payrollRunId: args.payrollRunId,
        paymentStatus: "processing",
        updatedAt: now,
      });
    }
  }
}

export async function linkFinalSettlementLeaveConversionsToPayrollRun(
  ctx: MutationCtx,
  args: {
    finalSettlementId: Id<"finalSettlements">;
    payrollRunId: Id<"payrollRuns">;
  },
): Promise<void> {
  const requests = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_final_settlement", (builder) =>
      builder.eq("finalSettlementId", args.finalSettlementId),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (requests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Final settlement leave conversion limit exceeded");
  }
  const now = Date.now();
  for (const request of requests) {
    if (request.status === "approved" && request.paymentStatus === "ready") {
      await ctx.db.patch(request._id, {
        payrollRunId: args.payrollRunId,
        paymentStatus: "processing",
        updatedAt: now,
      });
    }
  }
}

export async function assertLeaveConversionPayrollReadyForFinalize(
  ctx: DatabaseContext,
  payrollRunId: Id<"payrollRuns">,
): Promise<void> {
  const payrollRun = await ctx.db.get(payrollRunId);
  if (!payrollRun) throw new Error("Payroll run not found");
  const requests = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_payroll_run", (builder) =>
      builder.eq("payrollRunId", payrollRunId),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (requests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion payroll batch exceeds the row limit");
  }
  if (
    requests.some(
      (request) =>
        request.status !== "approved" || request.paymentStatus !== "processing",
    )
  ) {
    throw new Error(
      "Leave conversion payroll contains cancelled or invalid conversion rows",
    );
  }
  if (payrollRun.runType !== "final_pay") return;

  const payslips = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (builder) =>
      builder.eq("payrollRunId", payrollRunId),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (payslips.length > MAX_CONVERSION_ROWS) {
    throw new Error("Final-pay employee batch exceeds the row limit");
  }
  for (const payslip of payslips) {
    const approved = await ctx.db
      .query("leaveConversionRequests")
      .withIndex("by_employee_status", (builder) =>
        builder.eq("employeeId", payslip.employeeId).eq("status", "approved"),
      )
      .take(MAX_CONVERSION_ROWS + 1);
    if (approved.length > MAX_CONVERSION_ROWS) {
      throw new Error("Final settlement leave conversion limit exceeded");
    }
    if (
      approved.some(
        (request) =>
          request.finalSettlementId !== undefined &&
          request.paymentStatus === "ready",
      )
    ) {
      throw new Error(
        "Final pay has new approved leave conversions; regenerate the draft before finalizing",
      );
    }
  }
}

export async function syncLeaveConversionsForPayrollStatus(
  ctx: MutationCtx,
  payrollRun: Doc<"payrollRuns">,
  status: Doc<"payrollRuns">["status"],
): Promise<void> {
  if (payrollRun.runType !== "leave_conversion" && payrollRun.runType !== "final_pay") {
    return;
  }
  const requests = await ctx.db
    .query("leaveConversionRequests")
    .withIndex("by_payroll_run", (builder) =>
      builder.eq("payrollRunId", payrollRun._id),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (requests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Leave conversion payroll batch exceeds the row limit");
  }
  const now = Date.now();
  for (const request of requests) {
    if (status === "paid" && request.status === "approved") {
      await ctx.db.patch(request._id, {
        status: "paid",
        paymentStatus: "paid",
        updatedAt: now,
      });
    } else if (status === "cancelled" && request.status === "approved") {
      await ctx.db.patch(request._id, {
        payrollRunId: undefined,
        paymentStatus: "ready",
        updatedAt: now,
      });
    }
  }
}

export async function prepareEmployeeLeaveForFinalSettlement(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    separationDate: number;
    actorId: Id<"users">;
  },
): Promise<void> {
  const balances = await ctx.db
    .query("employeeLeaveBalances")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", args.organizationId),
    )
    .filter((builder) => builder.eq(builder.field("employeeId"), args.employeeId))
    .take(MAX_CONVERSION_ROWS + 1);
  if (balances.length > MAX_CONVERSION_ROWS) {
    throw new Error("Employee leave balance limit exceeded");
  }
  const now = Date.now();
  for (const balance of balances) {
    if (balance.engineStatus !== "closed") {
      await ctx.db.patch(balance._id, {
        engineStatus: "closed",
        updatedAt: now,
      });
    }
  }

  const futureRequests = await ctx.db
    .query("leaveRequests")
    .withIndex("by_employee_status_endDate", (builder) =>
      builder
        .eq("employeeId", args.employeeId)
        .eq("status", "approved")
        .gt("endDate", args.separationDate),
    )
    .take(MAX_CONVERSION_ROWS + 1);
  if (futureRequests.length > MAX_CONVERSION_ROWS) {
    throw new Error("Future leave request limit exceeded");
  }
  for (const request of futureRequests) {
    if (request.startDate <= args.separationDate) continue;
    const occurrences = await ctx.db
      .query("leaveRequestOccurrences")
      .withIndex("by_request_local_date", (builder) =>
        builder.eq("leaveRequestId", request._id),
      )
      .take(100);
    let payrollLocked = false;
    for (const occurrence of occurrences) {
      if (!occurrence.payrollRunId) continue;
      const payrollRun = await ctx.db.get(occurrence.payrollRunId);
      if (
        payrollRun &&
        ["finalized", "paid", "archived"].includes(payrollRun.status)
      ) {
        payrollLocked = true;
        break;
      }
    }
    if (payrollLocked) continue;
    await ctx.db.patch(request._id, {
      status: "cancellation_requested",
      cancellationRequestedBy: args.actorId,
      cancellationRequestedAt: now,
      cancellationReason: "Employment separation",
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: args.organizationId,
      type: "cancellation_requested",
      actorId: args.actorId,
      reason: "Employment separation",
      detailsJson: JSON.stringify({ separationDate: args.separationDate }),
      createdAt: now,
    });
  }
}
