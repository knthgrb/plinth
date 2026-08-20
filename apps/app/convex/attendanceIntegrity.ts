import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getEffectiveAttendanceSettings } from "./organizationConfiguration";
import { decryptDraftConfigFromDb } from "./payrollRunCrypto";
import { appendOperationalEvent } from "./operationalEvents";
import { encryptAttendanceAuditSnapshot } from "./attendanceAuditCrypto";

type AttendanceDbCtx = Pick<QueryCtx | MutationCtx, "db">;
type AttendanceAuditActor = {
  _id: Id<"users">;
  role: Doc<"userOrganizations">["role"];
};

const LOCKED_PAYROLL_STATUSES = new Set<Doc<"payrollRuns">["status"]>([
  "finalized",
  "paid",
  "archived",
]);

const payrollRunCache = new WeakMap<
  object,
  Map<string, Promise<Doc<"payrollRuns">[]>>
>();
const payrollRunEmployeeCache = new WeakMap<
  object,
  Map<string, Promise<boolean>>
>();

function getTransactionCache<T>(
  cache: WeakMap<object, Map<string, Promise<T>>>,
  ctx: AttendanceDbCtx,
): Map<string, Promise<T>> {
  const cacheKey = ctx as object;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const created = new Map<string, Promise<T>>();
  cache.set(cacheKey, created);
  return created;
}

async function loadLockedRegularPayrollRuns(
  ctx: AttendanceDbCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"payrollRuns">[]> {
  const cache = getTransactionCache(payrollRunCache, ctx);
  const key = String(organizationId);
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = Promise.all(
    [...LOCKED_PAYROLL_STATUSES].flatMap((status) =>
      ([undefined, "regular"] as const).map((runType) =>
        ctx.db
          .query("payrollRuns")
          .withIndex(
            "by_organization_status_run_type_cutoff_end",
            (query) =>
              query
                .eq("organizationId", organizationId)
                .eq("status", status)
                .eq("runType", runType),
          )
          .collect(),
      ),
    ),
  ).then((groups) =>
    groups.flat().sort((left, right) => right.cutoffStart - left.cutoffStart),
  );
  cache.set(key, pending);
  return pending;
}

async function payrollRunIncludesEmployee(
  ctx: AttendanceDbCtx,
  run: Doc<"payrollRuns">,
  employeeId: Id<"employees">,
): Promise<boolean> {
  const cache = getTransactionCache(payrollRunEmployeeCache, ctx);
  const key = `${run._id}:${employeeId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    let draftConfig: ReturnType<typeof decryptDraftConfigFromDb>;
    try {
      draftConfig = decryptDraftConfigFromDb(run.draftConfig);
    } catch {
      draftConfig = undefined;
    }
    if (draftConfig?.employeeIds) {
      return draftConfig.employeeIds.includes(employeeId);
    }

    const employeePayslip = await ctx.db
      .query("payslips")
      .withIndex("by_payroll_run_employee", (query) =>
        query.eq("payrollRunId", run._id).eq("employeeId", employeeId),
      )
      .first();
    if (employeePayslip) return true;

    const runHasPayslips = await ctx.db
      .query("payslips")
      .withIndex("by_payroll_run", (query) =>
        query.eq("payrollRunId", run._id),
      )
      .first();
    return !runHasPayslips;
  })();
  cache.set(key, pending);
  return pending;
}

export async function findFinalizedPayrollRunForAttendance(
  ctx: AttendanceDbCtx,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
  date: number,
): Promise<Doc<"payrollRuns"> | null> {
  const candidates = await loadLockedRegularPayrollRuns(ctx, organizationId);

  for (const run of candidates) {
    if (
      (run.runType ?? "regular") !== "regular" ||
      run.cutoffStart > date ||
      run.cutoffEnd < date
    ) {
      continue;
    }

    if (await payrollRunIncludesEmployee(ctx, run, employeeId)) return run;
  }

  return null;
}

export async function isAttendancePayrollLocked(
  ctx: MutationCtx,
  attendance: Doc<"attendance">,
): Promise<boolean> {
  const { attendanceSettings } = await getEffectiveAttendanceSettings(
    ctx,
    attendance.organizationId,
  );
  if (
    attendanceSettings?.payrollLockPolicy
      ?.lockAttendanceAfterPayrollFinalized === false
  ) {
    return false;
  }
  return Boolean(
    await findFinalizedPayrollRunForAttendance(
      ctx,
      attendance.organizationId,
      attendance.employeeId,
      attendance.date,
    ),
  );
}

export async function recordAttendanceSystemAudit(
  ctx: MutationCtx,
  input: {
    actor: AttendanceAuditActor;
    action: "holiday_sync" | "payroll_sync";
    before: Doc<"attendance">;
    after: Doc<"attendance"> | null;
  },
): Promise<void> {
  await ctx.db.insert("attendanceAuditLogs", {
    organizationId: input.before.organizationId,
    employeeId: input.before.employeeId,
    attendanceId: input.before._id,
    actorUserId: input.actor._id,
    actorRole: input.actor.role,
    action: input.action,
    beforeJson: encryptAttendanceAuditSnapshot(input.before),
    afterJson: input.after
      ? encryptAttendanceAuditSnapshot(input.after)
      : undefined,
    createdAt: Date.now(),
  });
  await appendOperationalEvent(ctx, {
    organizationId: input.before.organizationId,
    eventType: `attendance.${input.action}`,
    aggregateType: "attendance",
    aggregateId: String(input.before._id),
    actor: {
      type: "user",
      userId: input.actor._id,
      role: input.actor.role,
    },
    changedFields: ["holidayMetadata"],
    payload: {
      employeeId: input.before.employeeId,
      before: input.before,
      after: input.after,
    },
  });
}
