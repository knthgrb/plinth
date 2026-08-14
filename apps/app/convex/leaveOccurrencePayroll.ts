import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { restoreUsage } from "./leaveLedger";

const MANILA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const MAX_OCCURRENCES_PER_RANGE = 1_000;
const MAX_PAYSLIPS_PER_RUN = 1_000;

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

function localDateForTimestamp(timestamp: number): string {
  const date = new Date(timestamp + MANILA_OFFSET_MILLISECONDS);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export async function loadApprovedLeaveOccurrences(
  ctx: DatabaseContext,
  args: {
    employeeId: Id<"employees">;
    startLocalDate: string;
    endLocalDate: string;
  },
): Promise<Doc<"leaveRequestOccurrences">[]> {
  const rows = await ctx.db
    .query("leaveRequestOccurrences")
    .withIndex("by_employee_local_date", (query) =>
      query
        .eq("employeeId", args.employeeId)
        .gte("localDate", args.startLocalDate)
        .lte("localDate", args.endLocalDate),
    )
    .take(MAX_OCCURRENCES_PER_RANGE + 1);
  if (rows.length > MAX_OCCURRENCES_PER_RANGE) {
    throw new Error("Leave occurrence range exceeds the supported limit");
  }
  return rows.filter((row) => row.lifecycleState === "approved");
}

export async function markAttendanceConflictForDate(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    attendanceDate: number;
    hasActualWork: boolean;
    updatedAt: number;
  },
): Promise<number> {
  if (!args.hasActualWork) return 0;
  const localDate = localDateForTimestamp(args.attendanceDate);
  const occurrences = await ctx.db
    .query("leaveRequestOccurrences")
    .withIndex("by_employee_local_date", (query) =>
      query.eq("employeeId", args.employeeId).eq("localDate", localDate),
    )
    .take(11);
  if (occurrences.length > 10) {
    throw new Error("Leave occurrence conflict count exceeds the supported limit");
  }
  let updated = 0;
  for (const occurrence of occurrences) {
    if (
      occurrence.organizationId === args.organizationId &&
      occurrence.lifecycleState === "approved" &&
      occurrence.attendanceConflictState === "none"
    ) {
      await ctx.db.patch(occurrence._id, {
        attendanceConflictState: "detected",
        updatedAt: args.updatedAt,
      });
      updated += 1;
    }
  }
  return updated;
}

export async function reconcileOccurrenceAsNonChargeable(
  ctx: Pick<MutationCtx, "db">,
  args: {
    occurrenceId: Id<"leaveRequestOccurrences">;
    actorId: Id<"users">;
    reason: string;
    updatedAt: number;
  },
): Promise<{ restoredUnits: number }> {
  const reason = args.reason.trim();
  if (!reason) throw new Error("Leave occurrence reconciliation reason is required");
  const occurrence = await ctx.db.get(args.occurrenceId);
  if (!occurrence) throw new Error("Leave occurrence not found");
  if (occurrence.payrollLockedAt !== undefined || occurrence.payrollRunId !== undefined) {
    throw new Error("A payroll-locked leave occurrence requires a correction workflow");
  }
  if (occurrence.lifecycleState !== "approved") {
    throw new Error("Only approved leave occurrences can be reconciled");
  }
  const occurrenceDate = Date.parse(`${occurrence.localDate}T00:00:00+08:00`);
  if (occurrenceDate <= args.updatedAt) {
    throw new Error("Only future leave occurrences can be reconciled automatically");
  }
  const request = await ctx.db.get(occurrence.leaveRequestId);
  if (!request || !request.policyVersionId) {
    throw new Error("Canonical leave request not found");
  }
  const restoredUnits = occurrence.creditAmount;
  if (restoredUnits > 0) {
    const ledgerRows = await ctx.db
      .query("leaveLedgerEntries")
      .withIndex("by_request", (query) =>
        query.eq("leaveRequestId", occurrence.leaveRequestId),
      )
      .take(101);
    if (ledgerRows.length > 100) {
      throw new Error("Leave request ledger exceeds the supported limit");
    }
    const usage = ledgerRows.find(
      (entry) => entry.kind === "usage" && entry.balanceId !== undefined,
    );
    if (usage?.balanceId) {
      await restoreUsage(ctx, {
        organizationId: occurrence.organizationId,
        employeeId: occurrence.employeeId,
        balanceId: usage.balanceId,
        policyVersionId: request.policyVersionId,
        effectiveDate: occurrenceDate,
        unit: "day",
        referenceType: "request",
        leaveRequestId: request._id,
        actorId: args.actorId,
        reason,
        idempotencyKey: `occurrence:${occurrence._id}:calendar-restoration`,
        createdAt: args.updatedAt,
        units: restoredUnits,
      });
    }
  }
  const nextDuration = Math.max(
    0,
    (request.chargeableDuration ?? request.numberOfDays) - restoredUnits,
  );
  await ctx.db.patch(occurrence._id, {
    creditAmount: 0,
    leaveMinutes: 0,
    holidaySnapshot: { isHoliday: true },
    lifecycleState: "corrected",
    attendanceConflictState: "resolved",
    updatedAt: args.updatedAt,
  });
  await ctx.db.patch(request._id, {
    chargeableDuration: nextDuration,
    numberOfDays: nextDuration,
    updatedAt: args.updatedAt,
  });
  await ctx.db.insert("leaveRequestEvents", {
    leaveRequestId: request._id,
    organizationId: request.organizationId,
    type: "corrected",
    actorId: args.actorId,
    reason,
    detailsJson: JSON.stringify({ occurrenceId: occurrence._id, restoredUnits }),
    createdAt: args.updatedAt,
  });
  return { restoredUnits };
}

export async function lockApprovedLeaveOccurrencesForPayrollRun(
  ctx: Pick<MutationCtx, "db">,
  payrollRunId: Id<"payrollRuns">,
  lockedAt: number,
): Promise<number> {
  const payrollRun = await ctx.db.get(payrollRunId);
  if (!payrollRun) throw new Error("Payroll run not found");
  const payslips = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (query) => query.eq("payrollRunId", payrollRunId))
    .take(MAX_PAYSLIPS_PER_RUN + 1);
  if (payslips.length > MAX_PAYSLIPS_PER_RUN) {
    throw new Error("Payroll occurrence lock exceeds the supported employee limit");
  }
  const employeeIds = new Set(payslips.map((payslip) => payslip.employeeId));
  const startLocalDate = localDateForTimestamp(payrollRun.cutoffStart);
  const endLocalDate = localDateForTimestamp(payrollRun.cutoffEnd);
  const occurrences = await ctx.db
    .query("leaveRequestOccurrences")
    .withIndex("by_organization_local_date", (query) =>
      query
        .eq("organizationId", payrollRun.organizationId)
        .gte("localDate", startLocalDate)
        .lte("localDate", endLocalDate),
    )
    .take(MAX_OCCURRENCES_PER_RANGE + 1);
  if (occurrences.length > MAX_OCCURRENCES_PER_RANGE) {
    throw new Error("Payroll leave occurrence range exceeds the supported limit");
  }
  let locked = 0;
  for (const occurrence of occurrences) {
    if (
      !employeeIds.has(occurrence.employeeId) ||
      occurrence.lifecycleState !== "approved"
    ) continue;
    if (
      occurrence.payrollRunId !== undefined &&
      occurrence.payrollRunId !== payrollRunId
    ) {
      throw new Error("Leave occurrence is already locked to another payroll run");
    }
    await ctx.db.patch(occurrence._id, {
      payrollRunId,
      payrollLockedAt: lockedAt,
      payrollReference: `payroll:${payrollRunId}`,
      updatedAt: lockedAt,
    });
    locked += 1;
  }
  return locked;
}
