import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireActiveMembership } from "./access";
import { isOrgQueryAuthGraceError } from "./queryAuthGrace";
import { canUseEmployeeSelfService } from "@/utils/employee-lifecycle";
import { holidayAppliesToEmployee } from "@/lib/payroll-calculations";
import {
  calculateLate,
  calculateUndertime,
} from "@/utils/attendance-calculations";
import { getScheduleWithLunch } from "./shifts";
import {
  normalizeAttendanceDateMs,
  sameManilaCalendarDay,
} from "@/lib/manila-date";
import { markAttendanceConflictForDate } from "./leaveOccurrencePayroll";
import { getEffectiveAttendanceSettings } from "./organizationConfiguration";
import { findFinalizedPayrollRunForAttendance } from "./attendanceIntegrity";

type OrganizationRole = Doc<"userOrganizations">["role"];
type AttendanceAction = Doc<"attendanceAuditLogs">["action"];
type AttendanceSnapshot = Doc<"attendance"> | null;

interface AttendanceActor {
  _id: Id<"users">;
  role: OrganizationRole;
}

interface AttendanceWriteAuthorization {
  payrollRunId?: Id<"payrollRuns">;
  correctionReason?: string;
}

interface AttendanceImportReviewEntry {
  employeeId: Id<"employees">;
  date: number;
}

interface AttendanceImportReview {
  conflicts: Doc<"attendance">[];
  lockedEntries: AttendanceImportReviewEntry[];
  canCorrectWithReason: boolean;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const ATTENDANCE_QUERY_LIMIT = 10_000;
const ATTENDANCE_WRITE_BATCH_LIMIT = 100;
function getManilaDateParts(ts: number) {
  const d = new Date(ts + MANILA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
/** Returns the full matching holiday entry for a date, or null. */
function getMatchingHolidayEntryForDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
    applyToAll?: boolean;
    provinces?: string[];
  }[],
): (typeof holidays)[0] | null {
  const target = getManilaDateParts(dateTs);
  for (const h of holidays) {
    const effectiveTs = h.offsetDate ?? h.date;
    const parts = getManilaDateParts(
      typeof effectiveTs === "number"
        ? effectiveTs
        : new Date(effectiveTs).getTime(),
    );
    const match = h.isRecurring
      ? parts.m === target.m && parts.d === target.d
      : (h.year == null || h.year === target.y) &&
        parts.y === target.y &&
        parts.m === target.m &&
        parts.d === target.d;
    if (
      match &&
      (h.type === "regular" ||
        h.type === "special" ||
        h.type === "special_working")
    ) {
      return h;
    }
  }
  return null;
}

function isNoWorkAllowedForEmployeeDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
    applyToAll?: boolean;
    provinces?: string[];
  }[],
  employee: Doc<"employees">,
): boolean {
  const holidayEntry = getMatchingHolidayEntryForDate(dateTs, holidays);
  if (!holidayEntry) return false;
  if (
    holidayEntry.type !== "regular" &&
    holidayEntry.type !== "special"
  ) {
    return false;
  }
  return holidayAppliesToEmployee(holidayEntry, employee);
}

/** HR-chosen statuses that must not be replaced by automatic holiday + no clock time → no_work. */
const STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME = new Set([
  "absent",
  "half-day",
  "leave",
  "leave_with_pay",
  "leave_without_pay",
  "no_work",
]);

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Owner has all admin privileges - treat owner the same as admin
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";

  if (requiredRole) {
    // Write operations (create/update/delete): hr, admin, owner only - no accounting
    if (
      userRole !== requiredRole &&
      !(requiredRole === "hr" && userRole === "manager") &&
      !isOwnerOrAdmin
    ) {
      throw new Error("Not authorized");
    }
  } else {
    // Read access: hr, admin, owner, employee, and accounting (for payroll/payslips)
    if (
      !isOwnerOrAdmin &&
      userRole !== "hr" &&
      userRole !== "manager" &&
      userRole !== "employee" &&
      userRole !== "accounting"
    ) {
      throw new Error("Not authorized");
    }
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

async function checkAuthForQuery(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  try {
    return await checkAuth(ctx, organizationId, requiredRole);
  } catch (e) {
    if (isOrgQueryAuthGraceError(e)) return null;
    throw e;
  }
}

async function authorizeAttendanceWrite(
  ctx: MutationCtx,
  actor: AttendanceActor,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
  date: number,
  correctionReason?: string,
): Promise<AttendanceWriteAuthorization> {
  const { attendanceSettings } = await getEffectiveAttendanceSettings(
    ctx,
    organizationId,
  );
  const policy = attendanceSettings?.payrollLockPolicy;
  if (policy?.lockAttendanceAfterPayrollFinalized === false) {
    return {};
  }

  const payrollRun = await findFinalizedPayrollRunForAttendance(
    ctx,
    organizationId,
    employeeId,
    date,
  );
  if (!payrollRun) {
    return {};
  }

  const trimmedReason = correctionReason?.trim();
  const canCorrect = actor.role === "owner" || actor.role === "admin";
  if (
    policy?.allowAdminCorrectionWithReason !== false &&
    canCorrect &&
    trimmedReason
  ) {
    return {
      payrollRunId: payrollRun._id,
      correctionReason: trimmedReason,
    };
  }

  if (
    policy?.allowAdminCorrectionWithReason !== false &&
    canCorrect &&
    !trimmedReason
  ) {
    throw new Error(
      "Attendance is inside a finalized payroll period. An owner or admin correction reason is required.",
    );
  }

  throw new Error(
    "Attendance is inside a finalized payroll period and can no longer be changed.",
  );
}

async function recordAttendanceAudit(
  ctx: MutationCtx,
  input: {
    actor: AttendanceActor;
    action: AttendanceAction;
    attendanceId: Id<"attendance">;
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    authorization?: AttendanceWriteAuthorization;
    before?: AttendanceSnapshot;
    after?: AttendanceSnapshot;
  },
): Promise<void> {
  await ctx.db.insert("attendanceAuditLogs", {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    attendanceId: input.attendanceId,
    actorUserId: input.actor._id,
    actorRole: input.actor.role,
    action: input.action,
    payrollRunId: input.authorization?.payrollRunId,
    correctionReason: input.authorization?.correctionReason,
    beforeJson:
      input.before === undefined ? undefined : JSON.stringify(input.before),
    afterJson:
      input.after === undefined ? undefined : JSON.stringify(input.after),
    createdAt: Date.now(),
  });
}

/** Resolves the employee id for the current user in this org (payslips / employee-view + punch). */
async function resolveSelfEmployeeIdForOrg(
  userRecord: { employeeId?: Id<"employees"> },
): Promise<Id<"employees"> | null> {
  return userRecord.employeeId ?? null;
}

function getManilaNowHHmm() {
  const d = new Date(Date.now() + MANILA_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getManilaTodayDateUtcMs() {
  const p = getManilaDateParts(Date.now());
  return Date.UTC(p.y, p.m, p.d, 0, 0, 0, 0);
}

async function findAttendanceOnManilaDay(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  employeeId: Id<"employees">,
  dateTs: number,
): Promise<Doc<"attendance">[]> {
  const normalizedDate = normalizeAttendanceDateMs(dateTs);
  const rangeStart = normalizedDate - MANILA_OFFSET_MS;
  const rangeEnd = rangeStart + 24 * 60 * 60 * 1000;
  const records = await ctx.db
    .query("attendance")
    .withIndex("by_employee_date", (query) =>
      query
        .eq("employeeId", employeeId)
        .gte("date", rangeStart)
        .lt("date", rangeEnd),
    )
    .collect();
  return records.filter((record) =>
    sameManilaCalendarDay(record.date, dateTs),
  );
}

async function deleteDuplicateAttendanceOnDay(
  ctx: Pick<MutationCtx, "db">,
  records: readonly Doc<"attendance">[],
  keepId: Id<"attendance">,
): Promise<Doc<"attendance">[]> {
  const deleted: Doc<"attendance">[] = [];
  for (const record of records) {
    if (record._id !== keepId) {
      await ctx.db.delete(record._id);
      deleted.push(record);
    }
  }
  return deleted;
}

// Get attendance for employee
export const getEmployeeAttendance = query({
  args: {
    employeeId: v.id("employees"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuthForQuery(ctx, employee.organizationId);
    if (!userRecord) return [];

    if (userRecord.role === "employee") {
      const selfId = await resolveSelfEmployeeIdForOrg(
        userRecord,
      );
      if (!selfId || selfId !== args.employeeId) {
        throw new Error("Not authorized");
      }
    }

    const attendanceQuery = ctx.db.query("attendance");
    const rangedQuery =
      args.startDate !== undefined && args.endDate !== undefined
        ? attendanceQuery.withIndex("by_employee_date", (query) =>
            query
              .eq("employeeId", args.employeeId)
              .gte("date", args.startDate!)
              .lte("date", args.endDate!),
          )
        : args.startDate !== undefined
          ? attendanceQuery.withIndex("by_employee_date", (query) =>
              query
                .eq("employeeId", args.employeeId)
                .gte("date", args.startDate!),
            )
          : args.endDate !== undefined
            ? attendanceQuery.withIndex("by_employee_date", (query) =>
                query
                  .eq("employeeId", args.employeeId)
                  .lte("date", args.endDate!),
              )
            : attendanceQuery.withIndex("by_employee_date", (query) =>
                query.eq("employeeId", args.employeeId),
              );

    return rangedQuery
      .order("desc")
      .take(ATTENDANCE_QUERY_LIMIT);
  },
});

// Get attendance for date range (all employees or specific)
export const getAttendance = query({
  args: {
    organizationId: v.id("organizations"),
    startDate: v.number(),
    endDate: v.number(),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) return [];

    if (args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        throw new Error("Employee does not belong to this organization");
      }
      return ctx.db
        .query("attendance")
        .withIndex("by_employee_date", (query) =>
          query
            .eq("employeeId", args.employeeId!)
            .gte("date", args.startDate)
            .lte("date", args.endDate),
        )
        .order("desc")
        .take(ATTENDANCE_QUERY_LIMIT);
    }

    return ctx.db
      .query("attendance")
      .withIndex("by_organization_date", (query) =>
        query
          .eq("organizationId", args.organizationId)
          .gte("date", args.startDate)
          .lte("date", args.endDate),
      )
      .order("desc")
      .take(ATTENDANCE_QUERY_LIMIT);
  },
});

export const getAttendancePage = query({
  args: {
    organizationId: v.id("organizations"),
    startDate: v.number(),
    endDate: v.number(),
    employeeId: v.optional(v.id("employees")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    if (args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        throw new Error("Employee does not belong to this organization");
      }
      return ctx.db
        .query("attendance")
        .withIndex("by_employee_date", (query) =>
          query
            .eq("employeeId", args.employeeId!)
            .gte("date", args.startDate)
            .lte("date", args.endDate),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return ctx.db
      .query("attendance")
      .withIndex("by_organization_date", (query) =>
        query
          .eq("organizationId", args.organizationId)
          .gte("date", args.startDate)
          .lte("date", args.endDate),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getAttendanceForEmployees = query({
  args: {
    organizationId: v.id("organizations"),
    employeeIds: v.array(v.id("employees")),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) return [];
    if (args.employeeIds.length > 50) {
      throw new Error("Attendance summaries are limited to 50 employees per page");
    }

    const employees = await Promise.all(
      args.employeeIds.map((employeeId) => ctx.db.get(employeeId)),
    );
    if (
      employees.some(
        (employee) =>
          !employee || employee.organizationId !== args.organizationId,
      )
    ) {
      throw new Error("Employee does not belong to this organization");
    }

    const attendanceByEmployee = await Promise.all(
      args.employeeIds.map((employeeId) =>
        ctx.db
          .query("attendance")
          .withIndex("by_employee_date", (query) =>
            query
              .eq("employeeId", employeeId)
              .gte("date", args.startDate)
              .lte("date", args.endDate),
          )
          .collect(),
      ),
    );
    return attendanceByEmployee.flat();
  },
});

export const getAttendanceImportReviewBatch = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    entries: v.array(
      v.object({
        employeeId: v.id("employees"),
        date: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<AttendanceImportReview> => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) throw new Error("Not authorized");
    if (args.entries.length > ATTENDANCE_WRITE_BATCH_LIMIT) {
      throw new Error("Attendance conflict batches are limited to 100 rows");
    }

    const employees = await Promise.all(
      args.entries.map((entry) => ctx.db.get(entry.employeeId)),
    );
    if (
      employees.some(
        (employee) =>
          !employee || employee.organizationId !== args.organizationId,
      )
    ) {
      throw new Error("Employee does not belong to this organization");
    }

    const { attendanceSettings } = await getEffectiveAttendanceSettings(
      ctx,
      args.organizationId,
    );
    const payrollLockPolicy = attendanceSettings?.payrollLockPolicy;
    const payrollLockEnabled =
      payrollLockPolicy?.lockAttendanceAfterPayrollFinalized !== false;
    const canCorrectWithReason =
      payrollLockPolicy?.allowAdminCorrectionWithReason !== false &&
      (userRecord.role === "owner" || userRecord.role === "admin");

    const reviewedEntries = await Promise.all(
      args.entries.map(async (entry) => {
        const normalizedDate = normalizeAttendanceDateMs(entry.date);
        const rangeStart = normalizedDate - MANILA_OFFSET_MS;
        const rangeEnd = rangeStart + 24 * 60 * 60 * 1000;
        const [conflict, payrollRun] = await Promise.all([
          ctx.db
            .query("attendance")
            .withIndex("by_employee_date", (query) =>
              query
                .eq("employeeId", entry.employeeId)
                .gte("date", rangeStart)
                .lt("date", rangeEnd),
            )
            .filter((query) =>
              query.eq(query.field("organizationId"), args.organizationId),
            )
            .first(),
          payrollLockEnabled
            ? findFinalizedPayrollRunForAttendance(
                ctx,
                args.organizationId,
                entry.employeeId,
                normalizedDate,
              )
            : Promise.resolve(null),
        ]);
        return {
          conflict,
          lockedEntry: payrollRun
            ? { employeeId: entry.employeeId, date: normalizedDate }
            : null,
        };
      }),
    );
    return {
      conflicts: reviewedEntries
        .map((entry) => entry.conflict)
        .filter((record): record is Doc<"attendance"> => !!record),
      lockedEntries: reviewedEntries
        .map((entry) => entry.lockedEntry)
        .filter(
          (entry): entry is AttendanceImportReviewEntry => entry !== null,
        ),
      canCorrectWithReason,
    };
  },
});

export const getAttendanceImportConflicts = action({
  args: {
    organizationId: v.id("organizations"),
    entries: v.array(
      v.object({
        employeeId: v.id("employees"),
        date: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Doc<"attendance">[]> => {
    if (args.entries.length > 10_000) {
      throw new Error("Attendance imports are limited to 10,000 rows");
    }

    const uniqueEntries = [
      ...new Map(
        args.entries.map((entry) => [
          `${entry.employeeId}:${normalizeAttendanceDateMs(entry.date)}`,
          entry,
        ]),
      ).values(),
    ];
    const results: Doc<"attendance">[] = [];
    for (
      let offset = 0;
      offset < uniqueEntries.length;
      offset += ATTENDANCE_WRITE_BATCH_LIMIT
    ) {
      const batch = await ctx.runQuery(
        internal.attendance.getAttendanceImportReviewBatch,
        {
          organizationId: args.organizationId,
          entries: uniqueEntries.slice(
            offset,
            offset + ATTENDANCE_WRITE_BATCH_LIMIT,
          ),
        },
      );
      results.push(...batch.conflicts);
    }
    return results;
  },
});

export const getAttendanceImportReview = action({
  args: {
    organizationId: v.id("organizations"),
    entries: v.array(
      v.object({
        employeeId: v.id("employees"),
        date: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<AttendanceImportReview> => {
    if (args.entries.length > 10_000) {
      throw new Error("Attendance imports are limited to 10,000 rows");
    }

    const uniqueEntries = [
      ...new Map(
        args.entries.map((entry) => [
          `${entry.employeeId}:${normalizeAttendanceDateMs(entry.date)}`,
          entry,
        ]),
      ).values(),
    ];
    const review: AttendanceImportReview = {
      conflicts: [],
      lockedEntries: [],
      canCorrectWithReason: false,
    };

    for (
      let offset = 0;
      offset < uniqueEntries.length;
      offset += ATTENDANCE_WRITE_BATCH_LIMIT
    ) {
      const batch = await ctx.runQuery(
        internal.attendance.getAttendanceImportReviewBatch,
        {
          organizationId: args.organizationId,
          entries: uniqueEntries.slice(
            offset,
            offset + ATTENDANCE_WRITE_BATCH_LIMIT,
          ),
        },
      );
      review.conflicts.push(...batch.conflicts);
      review.lockedEntries.push(...batch.lockedEntries);
      review.canCorrectWithReason = batch.canCorrectWithReason;
    }

    return review;
  },
});

export const getAttendanceAuditHistory = query({
  args: {
    organizationId: v.id("organizations"),
    attendanceId: v.optional(v.id("attendance")),
    employeeId: v.optional(v.id("employees")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) return [];

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500);
    if (args.attendanceId) {
      return ctx.db
        .query("attendanceAuditLogs")
        .withIndex("by_attendance_created", (query) =>
          query.eq("attendanceId", args.attendanceId!),
        )
        .filter((query) =>
          query.eq(query.field("organizationId"), args.organizationId),
        )
        .order("desc")
        .take(limit);
    }
    if (args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        throw new Error("Employee does not belong to this organization");
      }
      return ctx.db
        .query("attendanceAuditLogs")
        .withIndex("by_employee_created", (query) =>
          query.eq("employeeId", args.employeeId!),
        )
        .order("desc")
        .take(limit);
    }
    return ctx.db
      .query("attendanceAuditLogs")
      .withIndex("by_organization_created", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(limit);
  },
});

// Create attendance entry
export const createAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.number(),
    scheduleIn: v.string(),
    scheduleOut: v.string(),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()),
    late: v.optional(v.number()), // Manual override for late (minutes)
    undertime: v.optional(v.number()), // Manual override for undertime (hours)
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working"),
      ),
    ),
    remarks: v.optional(v.string()),
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half-day"),
      v.literal("leave"),
      v.literal("leave_with_pay"),
      v.literal("leave_without_pay"),
      v.literal("no_work"),
    ),
    overwriteAttendanceId: v.optional(v.id("attendance")),
    correctionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const normalizedDate = normalizeAttendanceDateMs(args.date);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      throw new Error("Employee does not belong to this organization");
    }
    const writeAuthorization = await authorizeAttendanceWrite(
      ctx,
      userRecord,
      args.organizationId,
      args.employeeId,
      normalizedDate,
      args.correctionReason,
    );
    const existingOnDay = await findAttendanceOnManilaDay(
      ctx,
      args.employeeId,
      normalizedDate,
    );

    if (args.overwriteAttendanceId) {
      const target = existingOnDay.find(
        (record) => record._id === args.overwriteAttendanceId,
      );
      if (!target) {
        throw new Error(
          "Attendance record to overwrite was not found for this date",
        );
      }
    } else if (existingOnDay.length > 0) {
      throw new Error(
        `ATTENDANCE_EXISTS:${existingOnDay[0]._id}`,
      );
    }

    // On regular/special holiday with no time in/out → no_work (no additional pay)
    let resolvedStatus = args.status;
    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();

    if (args.status === "no_work") {
      if (!isNoWorkAllowedForEmployeeDate(normalizedDate, holidays, employee)) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
    }
    if (
      !args.actualIn &&
      !args.actualOut &&
      !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(args.status)
    ) {
      const holidayEntry = getMatchingHolidayEntryForDate(
        normalizedDate,
        holidays,
      );
      if (
        holidayEntry &&
        (holidayEntry.type === "regular" || holidayEntry.type === "special") &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        resolvedStatus = "no_work";
      }
    }
    const scheduleWithLunch = await getScheduleWithLunch(
      ctx,
      employee,
      normalizedDate,
      args.organizationId,
    );

    const scheduleIn = scheduleWithLunch?.scheduleIn ?? args.scheduleIn;
    const scheduleOut = scheduleWithLunch?.scheduleOut ?? args.scheduleOut;
    const lunchStart = scheduleWithLunch?.lunchStart;
    const lunchEnd = scheduleWithLunch?.lunchEnd;
    const calculatedUndertime =
      args.undertime !== undefined
        ? args.undertime
        : resolvedStatus === "present" && args.actualIn && args.actualOut
          ? calculateUndertime(
              scheduleIn,
              scheduleOut,
              args.actualIn,
              args.actualOut,
            )
          : 0;

    const calculatedLate =
      args.late !== undefined
        ? args.late
        : resolvedStatus === "present" && args.actualIn
          ? calculateLate(scheduleIn, args.actualIn, lunchStart)
          : 0;

    const now = Date.now();
    let isHoliday = args.isHoliday;
    let holidayType = args.holidayType;
    if (isHoliday === undefined && holidayType === undefined) {
      const holidayEntry = getMatchingHolidayEntryForDate(
        normalizedDate,
        holidays,
      );
      if (
        holidayEntry &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        isHoliday = true;
        holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
    }
    const rowPayload: Omit<
      Doc<"attendance">,
      "_id" | "_creationTime" | "createdAt"
    > = {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      date: normalizedDate,
      scheduleIn,
      scheduleOut,
      actualIn: args.actualIn,
      actualOut: args.actualOut,
      overtime: args.overtime,
      late: calculatedLate > 0 ? calculatedLate : 0,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
      isHoliday,
      holidayType,
      remarks: args.remarks,
      status: resolvedStatus,
      updatedAt: now,
    };
    if (lunchStart != null) rowPayload.lunchStart = lunchStart;
    if (lunchEnd != null) rowPayload.lunchEnd = lunchEnd;

    if (args.overwriteAttendanceId) {
      const before = await ctx.db.get(args.overwriteAttendanceId);
      await ctx.db.patch(args.overwriteAttendanceId, rowPayload);
      const removedDuplicates = await deleteDuplicateAttendanceOnDay(
        ctx,
        existingOnDay,
        args.overwriteAttendanceId,
      );
      await markAttendanceConflictForDate(ctx, {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        attendanceDate: normalizedDate,
        hasActualWork: Boolean(args.actualIn || args.actualOut),
        updatedAt: now,
      });
      const after = await ctx.db.get(args.overwriteAttendanceId);
      await recordAttendanceAudit(ctx, {
        actor: userRecord,
        action: "update",
        attendanceId: args.overwriteAttendanceId,
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        authorization: writeAuthorization,
        before,
        after,
      });
      for (const duplicate of removedDuplicates) {
        await recordAttendanceAudit(ctx, {
          actor: userRecord,
          action: "duplicate_cleanup",
          attendanceId: duplicate._id,
          organizationId: duplicate.organizationId,
          employeeId: duplicate.employeeId,
          authorization: writeAuthorization,
          before: duplicate,
          after: null,
        });
      }
      return args.overwriteAttendanceId;
    }

    const attendanceId = await ctx.db.insert("attendance", {
      ...rowPayload,
      createdAt: now,
    });
    const after = await ctx.db.get(attendanceId);
    await recordAttendanceAudit(ctx, {
      actor: userRecord,
      action: "create",
      attendanceId,
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      authorization: writeAuthorization,
      after,
    });

    await markAttendanceConflictForDate(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      attendanceDate: normalizedDate,
      hasActualWork: Boolean(args.actualIn || args.actualOut),
      updatedAt: now,
    });

    return attendanceId;
  },
});

// Update attendance
export const updateAttendance = mutation({
  args: {
    attendanceId: v.id("attendance"),
    scheduleIn: v.optional(v.string()),
    scheduleOut: v.optional(v.string()),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()),
    late: v.optional(v.union(v.number(), v.null())), // Manual override (minutes), or null to recalculate
    undertime: v.optional(v.union(v.number(), v.null())), // Manual override (hours), or null to recalculate
    lateManualOverride: v.optional(v.boolean()), // true = use stored late (e.g. 0) instead of calculating from time in
    undertimeManualOverride: v.optional(v.boolean()), // true = use stored undertime (e.g. 0) instead of calculating from time out
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working"),
      ),
    ),
    remarks: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("present"),
        v.literal("absent"),
        v.literal("half-day"),
        v.literal("leave"),
        v.literal("leave_with_pay"),
        v.literal("leave_without_pay"),
        v.literal("no_work"),
      ),
    ),
    correctionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attendance = await ctx.db.get(args.attendanceId);
    if (!attendance) throw new Error("Attendance not found");

    const userRecord = await checkAuth(ctx, attendance.organizationId, "hr");
    const writeAuthorization = await authorizeAttendanceWrite(
      ctx,
      userRecord,
      attendance.organizationId,
      attendance.employeeId,
      attendance.date,
      args.correctionReason,
    );

    const employee = await ctx.db.get(attendance.employeeId);
    const scheduleWithLunch = employee
      ? await getScheduleWithLunch(
          ctx,
          employee,
          attendance.date,
          attendance.organizationId,
        )
      : null;

    // Effective schedule for late/undertime: explicit args (form), then snapshot on
    // the row, then current employee schedule for that date. Do not prefer live schedule
    // over the stored row (historical shift per day).
    const effectiveScheduleIn =
      args.scheduleIn !== undefined
        ? args.scheduleIn
        : attendance.scheduleIn ?? scheduleWithLunch?.scheduleIn ?? null;
    const effectiveScheduleOut =
      args.scheduleOut !== undefined
        ? args.scheduleOut
        : attendance.scheduleOut ?? scheduleWithLunch?.scheduleOut ?? null;

    const updatedAt = Date.now();
    const updates: Partial<Doc<"attendance">> = { updatedAt };
    if (args.scheduleIn !== undefined) updates.scheduleIn = args.scheduleIn;
    if (args.scheduleOut !== undefined) updates.scheduleOut = args.scheduleOut;
    if (args.actualIn !== undefined) updates.actualIn = args.actualIn;
    if (args.actualOut !== undefined) updates.actualOut = args.actualOut;
    if (args.overtime !== undefined) updates.overtime = args.overtime;
    if (args.isHoliday !== undefined) updates.isHoliday = args.isHoliday;
    if (args.holidayType !== undefined) updates.holidayType = args.holidayType;
    if (args.remarks !== undefined) updates.remarks = args.remarks;

    const scheduleInChangedFromForm =
      args.scheduleIn !== undefined && args.scheduleIn !== attendance.scheduleIn;
    const scheduleOutChangedFromForm =
      args.scheduleOut !== undefined &&
      args.scheduleOut !== attendance.scheduleOut;
    if (scheduleInChangedFromForm || scheduleOutChangedFromForm) {
      if (scheduleWithLunch?.lunchStart != null) {
        updates.lunchStart = scheduleWithLunch.lunchStart;
      }
      if (scheduleWithLunch?.lunchEnd != null) {
        updates.lunchEnd = scheduleWithLunch.lunchEnd;
      }
    }
    // Lunch for late/undertime: when the row's shift times are edited, line up with the
    // org template; otherwise use what is already on the record (per-day snapshot).
    const scheduleWasEditedInForm =
      scheduleInChangedFromForm || scheduleOutChangedFromForm;
    const lunchStartForCalc = scheduleWasEditedInForm
      ? (scheduleWithLunch?.lunchStart ?? attendance.lunchStart)
      : (attendance.lunchStart ?? scheduleWithLunch?.lunchStart);
    const lunchEndForCalc = scheduleWasEditedInForm
      ? (scheduleWithLunch?.lunchEnd ?? attendance.lunchEnd)
      : (attendance.lunchEnd ?? scheduleWithLunch?.lunchEnd);

    const currentActualIn = args.actualIn ?? attendance.actualIn;
    const currentActualOut = args.actualOut ?? attendance.actualOut;
    let currentStatus = args.status ?? attendance.status;

    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", attendance.organizationId),
      )
      .collect();

    if (args.status === "no_work" && employee) {
      if (
        !isNoWorkAllowedForEmployeeDate(attendance.date, holidays, employee)
      ) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
    }

    if (args.status === undefined) {
      if (
        !currentActualIn &&
        !currentActualOut &&
        employee &&
        !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(attendance.status as string)
      ) {
        const holidayEntry = getMatchingHolidayEntryForDate(attendance.date, holidays);
        if (
          holidayEntry &&
          (holidayEntry.type === "regular" || holidayEntry.type === "special") &&
          holidayAppliesToEmployee(holidayEntry, employee)
        ) {
          currentStatus = "no_work";
          updates.status = "no_work";
        }
      }
    }
    if (args.status !== undefined) updates.status = args.status;

    // Auto-set isHoliday and holidayType only when holiday applies to this employee's province
    if (args.isHoliday === undefined && args.holidayType === undefined) {
      const holidayEntry = getMatchingHolidayEntryForDate(attendance.date, holidays);
      if (
        holidayEntry &&
        employee &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        updates.isHoliday = true;
        updates.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
    }

    if (args.undertimeManualOverride === true) {
      updates.undertime = args.undertime ?? 0;
      updates.undertimeManualOverride = true;
    } else if (args.undertime === null) {
      const calculatedUndertime =
        currentStatus === "present" && currentActualIn && currentActualOut
          ? calculateUndertime(
              effectiveScheduleIn,
              effectiveScheduleOut,
              currentActualIn,
              currentActualOut,
              lunchStartForCalc,
              lunchEndForCalc,
            )
          : 0;
      updates.undertime =
        calculatedUndertime > 0 ? calculatedUndertime : 0;
      updates.undertimeManualOverride = false;
    } else if (args.undertime !== undefined && args.undertime !== null) {
      updates.undertime = args.undertime;
      updates.undertimeManualOverride = true;
    }

    if (args.lateManualOverride === true) {
      updates.late = args.late ?? 0;
      updates.lateManualOverride = true;
    } else if (args.late === null) {
      const calculatedLate =
        currentStatus === "present" && currentActualIn
          ? calculateLate(effectiveScheduleIn, currentActualIn, lunchStartForCalc)
          : 0;
      updates.late = calculatedLate > 0 ? calculatedLate : 0;
      updates.lateManualOverride = false;
    } else if (args.late !== undefined && args.late !== null) {
      updates.late = args.late;
      updates.lateManualOverride = true;
    }

    await ctx.db.patch(args.attendanceId, updates);
    await markAttendanceConflictForDate(ctx, {
      organizationId: attendance.organizationId,
      employeeId: attendance.employeeId,
      attendanceDate: attendance.date,
      hasActualWork: Boolean(currentActualIn || currentActualOut),
      updatedAt,
    });
    const after = await ctx.db.get(args.attendanceId);
    await recordAttendanceAudit(ctx, {
      actor: userRecord,
      action: "update",
      attendanceId: args.attendanceId,
      organizationId: attendance.organizationId,
      employeeId: attendance.employeeId,
      authorization: writeAuthorization,
      before: attendance,
      after,
    });
    return { success: true };
  },
});

// Delete attendance record for a specific day
export const deleteAttendance = mutation({
  args: {
    attendanceId: v.id("attendance"),
    correctionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attendance = await ctx.db.get(args.attendanceId);
    if (!attendance) throw new Error("Attendance record not found");

    const userRecord = await checkAuth(
      ctx,
      attendance.organizationId,
      "hr",
    );
    const writeAuthorization = await authorizeAttendanceWrite(
      ctx,
      userRecord,
      attendance.organizationId,
      attendance.employeeId,
      attendance.date,
      args.correctionReason,
    );

    await ctx.db.delete(args.attendanceId);
    await recordAttendanceAudit(ctx, {
      actor: userRecord,
      action: "delete",
      attendanceId: args.attendanceId,
      organizationId: attendance.organizationId,
      employeeId: attendance.employeeId,
      authorization: writeAuthorization,
      before: attendance,
      after: null,
    });
    return { success: true };
  },
});

const SELF_PUNCH_IN_BLOCKED = new Set([
  "leave",
  "leave_with_pay",
  "leave_without_pay",
]);

/** Time in / time out for the signed-in user only (no HR role). */
export const punchSelfAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    action: v.union(v.literal("in"), v.literal("out")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    const employeeId = await resolveSelfEmployeeIdForOrg(
      userRecord,
    );
    if (!employeeId) {
      throw new Error(
        "No employee profile is linked to your account for this organization.",
      );
    }

    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new Error("Employee not found");
    if (!canUseEmployeeSelfService(employee.employment.status)) {
      throw new Error(
        "Separated or inactive employees cannot use self-service attendance.",
      );
    }

    const dateTs = getManilaTodayDateUtcMs();
    const timeStr = getManilaNowHHmm();
    const writeAuthorization = await authorizeAttendanceWrite(
      ctx,
      userRecord,
      args.organizationId,
      employeeId,
      dateTs,
    );

    const existingOnDay = await findAttendanceOnManilaDay(
      ctx,
      employeeId,
      dateTs,
    );
    const existing = existingOnDay[0] ?? null;

    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();

    if (args.action === "in") {
      if (existing?.actualIn && existing?.actualOut) {
        throw new Error(
          "You have already completed time in and time out for today.",
        );
      }
      if (existing?.actualIn && !existing?.actualOut) {
        throw new Error("You have already timed in. Please time out.");
      }
      if (
        existing &&
        !existing.actualIn &&
        SELF_PUNCH_IN_BLOCKED.has(existing.status as string)
      ) {
        throw new Error(
          "This day is already marked on your schedule. Contact HR to change it.",
        );
      }

      const scheduleWithLunch = await getScheduleWithLunch(
        ctx,
        employee,
        dateTs,
        args.organizationId,
      );
      const scheduleIn = scheduleWithLunch?.scheduleIn ?? "09:00";
      const scheduleOut = scheduleWithLunch?.scheduleOut ?? "18:00";
      const lunchStart = scheduleWithLunch?.lunchStart;
      const lunchEnd = scheduleWithLunch?.lunchEnd;
      const now = Date.now();

      if (!existing) {
        const holidayEntry = getMatchingHolidayEntryForDate(
          dateTs,
          holidays,
        );
        let isHoliday: boolean | undefined;
        let holidayType: "regular" | "special" | "special_working" | undefined;
        if (
          holidayEntry &&
          holidayAppliesToEmployee(holidayEntry, employee)
        ) {
          isHoliday = true;
          holidayType = holidayEntry.type as
            | "regular"
            | "special"
            | "special_working";
        }

        const calculatedLate = calculateLate(scheduleIn, timeStr, lunchStart);
        const insertPayload: Omit<
          Doc<"attendance">,
          "_id" | "_creationTime"
        > = {
          organizationId: args.organizationId,
          employeeId,
          date: dateTs,
          scheduleIn,
          scheduleOut,
          actualIn: timeStr,
          late: calculatedLate > 0 ? calculatedLate : 0,
          undertime: 0,
          status: "present" as const,
          createdAt: now,
          updatedAt: now,
        };
        if (isHoliday === true) insertPayload.isHoliday = true;
        if (holidayType != null) insertPayload.holidayType = holidayType;
        if (lunchStart != null) insertPayload.lunchStart = lunchStart;
        if (lunchEnd != null) insertPayload.lunchEnd = lunchEnd;

        const attendanceId = await ctx.db.insert("attendance", insertPayload);
        const after = await ctx.db.get(attendanceId);
        await recordAttendanceAudit(ctx, {
          actor: userRecord,
          action: "self_punch_in",
          attendanceId,
          organizationId: args.organizationId,
          employeeId,
          authorization: writeAuthorization,
          after,
        });
        return { success: true, action: "in" as const };
      }

      // Existing row, no time in yet: fill time in
      const lateRecalc = calculateLate(scheduleIn, timeStr, lunchStart);
      const updates: Partial<Doc<"attendance">> = {
        actualIn: timeStr,
        status: "present",
        late: lateRecalc > 0 ? lateRecalc : 0,
        lateManualOverride: false,
        updatedAt: now,
      };
      if (scheduleWithLunch?.scheduleIn != null) {
        updates.scheduleIn = scheduleWithLunch.scheduleIn;
      }
      if (scheduleWithLunch?.scheduleOut != null) {
        updates.scheduleOut = scheduleWithLunch.scheduleOut;
      }
      if (scheduleWithLunch?.lunchStart != null) {
        updates.lunchStart = scheduleWithLunch.lunchStart;
        updates.lunchEnd = scheduleWithLunch.lunchEnd;
      }
      await ctx.db.patch(existing._id, updates);
      const after = await ctx.db.get(existing._id);
      await recordAttendanceAudit(ctx, {
        actor: userRecord,
        action: "self_punch_in",
        attendanceId: existing._id,
        organizationId: args.organizationId,
        employeeId,
        authorization: writeAuthorization,
        before: existing,
        after,
      });
      return { success: true, action: "in" as const };
    }

    // action === "out"
    if (!existing) {
      throw new Error("Time in first before time out.");
    }
    if (!existing.actualIn) {
      throw new Error("Time in first before time out.");
    }
    if (existing.actualOut) {
      throw new Error("You have already timed out for today.");
    }

    const scheduleWithLunch = await getScheduleWithLunch(
      ctx,
      employee,
      dateTs,
      args.organizationId,
    );
    const resolvedScheduleInVal =
      scheduleWithLunch?.scheduleIn ?? existing.scheduleIn;
    const resolvedScheduleOutVal =
      scheduleWithLunch?.scheduleOut ?? existing.scheduleOut;
    const lunchStart =
      scheduleWithLunch?.lunchStart ?? existing.lunchStart;
    const lunchEnd = scheduleWithLunch?.lunchEnd ?? existing.lunchEnd;

    const currentStatus = existing.status;
    const calculatedUndertime =
      currentStatus === "present" || currentStatus === "half-day"
        ? calculateUndertime(
            resolvedScheduleInVal,
            resolvedScheduleOutVal,
            existing.actualIn,
            timeStr,
            lunchStart,
            lunchEnd,
          )
        : 0;
    const calculatedLate =
      currentStatus === "present" && existing.actualIn
        ? calculateLate(
            resolvedScheduleInVal,
            existing.actualIn,
            lunchStart,
          )
        : 0;

    await ctx.db.patch(existing._id, {
      actualOut: timeStr,
      late: calculatedLate > 0 ? calculatedLate : 0,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
      lateManualOverride: false,
      undertimeManualOverride: false,
      updatedAt: Date.now(),
    });
    const after = await ctx.db.get(existing._id);
    await recordAttendanceAudit(ctx, {
      actor: userRecord,
      action: "self_punch_out",
      attendanceId: existing._id,
      organizationId: args.organizationId,
      employeeId,
      authorization: writeAuthorization,
      before: existing,
      after,
    });
    return { success: true, action: "out" as const };
  },
});

// Bulk create attendance
export const bulkCreateAttendance = mutation({
  args: {
    correctionReason: v.optional(v.string()),
    entries: v.array(
      v.object({
        organizationId: v.id("organizations"),
        employeeId: v.id("employees"),
        date: v.number(),
        scheduleIn: v.string(),
        scheduleOut: v.string(),
        actualIn: v.optional(v.string()),
        actualOut: v.optional(v.string()),
        overtime: v.optional(v.number()),
        late: v.optional(v.number()), // Manual override for late (minutes)
        undertime: v.optional(v.number()), // Manual override for undertime (hours)
        isHoliday: v.optional(v.boolean()),
        holidayType: v.optional(
          v.union(
            v.literal("regular"),
            v.literal("special"),
            v.literal("special_working"),
          ),
        ),
        remarks: v.optional(v.string()),
        importKey: v.optional(v.string()),
        status: v.union(
          v.literal("present"),
          v.literal("absent"),
          v.literal("half-day"),
          v.literal("leave"),
          v.literal("leave_with_pay"),
          v.literal("leave_without_pay"),
          v.literal("no_work"),
        ),
        overwriteAttendanceId: v.optional(v.id("attendance")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.entries.length === 0) {
      throw new Error("Attendance batch cannot be empty");
    }
    if (args.entries.length > ATTENDANCE_WRITE_BATCH_LIMIT) {
      throw new Error(
        `Attendance batches are limited to ${ATTENDANCE_WRITE_BATCH_LIMIT} rows`,
      );
    }

    const now = Date.now();
    const results = [];

    const organizationId = args.entries[0].organizationId;

    if (
      args.entries.some((entry) => entry.organizationId !== organizationId)
    ) {
      throw new Error("All attendance entries must belong to the same organization");
    }

    const userRecord = await checkAuth(ctx, organizationId, "hr");

    const importKeys = args.entries
      .map((entry) => entry.importKey)
      .filter((key): key is string => key !== undefined);
    if (new Set(importKeys).size !== importKeys.length) {
      throw new Error("Attendance import keys must be unique within a batch");
    }

    const idempotentAttendance = await Promise.all(
      args.entries.map(async (entry) => {
        if (!entry.importKey) return null;
        const existing = await ctx.db
          .query("attendance")
          .withIndex("by_organization_import_key", (query) =>
            query
              .eq("organizationId", organizationId)
              .eq("importKey", entry.importKey),
          )
          .unique();
        if (
          existing &&
          (existing.employeeId !== entry.employeeId ||
            !sameManilaCalendarDay(existing.date, entry.date))
        ) {
          throw new Error("Attendance import key was already used for another row");
        }
        return existing;
      }),
    );

    const employeesById = new Map<Id<"employees">, Doc<"employees">>();

    for (const entry of args.entries) {
      if (employeesById.has(entry.employeeId)) {
        continue;
      }

      const employee = await ctx.db.get(entry.employeeId);

      if (!employee || employee.organizationId !== organizationId) {
        throw new Error("Employee does not belong to the attendance organization");
      }

      employeesById.set(employee._id, employee);
    }

    const normalizedDates = args.entries.map((entry) =>
      normalizeAttendanceDateMs(entry.date),
    );
    const writeAuthorizations = await Promise.all(
      normalizedDates.map((date, index) =>
        idempotentAttendance[index]
          ? Promise.resolve({})
          : authorizeAttendanceWrite(
              ctx,
              userRecord,
              organizationId,
              args.entries[index].employeeId,
              date,
              args.correctionReason,
            ),
      ),
    );
    const batchSeen = new Set<string>();

    for (const [index, entry] of args.entries.entries()) {
      const normalizedDate = normalizedDates[index];
      const batchKey = `${entry.employeeId}:${normalizedDate}`;

      if (batchSeen.has(batchKey)) {
        throw new Error(
          "Duplicate dates in this batch. Resolve conflicts before submitting.",
        );
      }

      batchSeen.add(batchKey);

      if (!entry.overwriteAttendanceId) {
        continue;
      }

      const approvedAttendance = await ctx.db.get(entry.overwriteAttendanceId);

      if (
        !approvedAttendance ||
        approvedAttendance.organizationId !== organizationId ||
        approvedAttendance.employeeId !== entry.employeeId ||
        !sameManilaCalendarDay(approvedAttendance.date, normalizedDate)
      ) {
        throw new Error(
          "Attendance overwrite approval is stale. Review conflicts again.",
        );
      }
    }

    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();

    for (const [index, entry] of args.entries.entries()) {
      const normalizedDate = normalizedDates[index];
      const alreadyImported = idempotentAttendance[index];
      if (alreadyImported) {
        results.push({ id: alreadyImported._id, action: "unchanged" });
        continue;
      }

      const existingOnDay = (await findAttendanceOnManilaDay(
        ctx,
        entry.employeeId,
        normalizedDate,
      )).filter((record) => record.organizationId === organizationId);
      const existing = entry.overwriteAttendanceId
        ? existingOnDay.find(
            (record) => record._id === entry.overwriteAttendanceId,
          ) ?? null
        : null;

      if (entry.overwriteAttendanceId && !existing) {
        throw new Error(
          "Attendance overwrite approval is stale. Review conflicts again.",
        );
      }

      if (existingOnDay.length > 0 && !entry.overwriteAttendanceId) {
        throw new Error(
          "Attendance already exists for one or more dates. Review conflicts before submitting.",
        );
      }

      const employee = employeesById.get(entry.employeeId);
      const currentActualIn = entry.actualIn ?? existing?.actualIn;
      const currentActualOut = entry.actualOut ?? existing?.actualOut;
      const canUseNoWork = employee
        ? isNoWorkAllowedForEmployeeDate(entry.date, holidays, employee)
        : false;
      const shouldAutoHolidayNoWork =
        !currentActualIn &&
        !currentActualOut &&
        canUseNoWork &&
        !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(entry.status);
      const resolvedStatus = shouldAutoHolidayNoWork
        ? "no_work"
        : entry.status;
      if (resolvedStatus === "no_work" && !canUseNoWork) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
      const scheduleWithLunch = employee
        ? await getScheduleWithLunch(
            ctx,
            employee,
            normalizedDate,
            entry.organizationId,
          )
        : null;
      const scheduleIn = scheduleWithLunch?.scheduleIn ?? entry.scheduleIn;
      const scheduleOut = scheduleWithLunch?.scheduleOut ?? entry.scheduleOut;
      const lunchStart = scheduleWithLunch?.lunchStart;
      const lunchEnd = scheduleWithLunch?.lunchEnd;
      if (existing) {
        const before = existing;
        const updates: Partial<
          Pick<
            Doc<"attendance">,
            | "actualIn"
            | "actualOut"
            | "overtime"
            | "isHoliday"
            | "holidayType"
            | "remarks"
            | "status"
            | "scheduleIn"
            | "scheduleOut"
            | "lunchStart"
            | "lunchEnd"
            | "undertime"
            | "late"
            | "date"
            | "importKey"
          >
        > & { updatedAt: number } = { updatedAt: now };
        if (entry.actualIn !== undefined) updates.actualIn = entry.actualIn;
        if (entry.actualOut !== undefined) updates.actualOut = entry.actualOut;
        if (entry.overtime !== undefined) updates.overtime = entry.overtime;
        if (entry.isHoliday !== undefined) updates.isHoliday = entry.isHoliday;
        if (entry.holidayType !== undefined)
          updates.holidayType = entry.holidayType;
        if (entry.isHoliday === undefined && entry.holidayType === undefined) {
          const holidayEntry = getMatchingHolidayEntryForDate(entry.date, holidays);
          if (
            holidayEntry &&
            employee &&
            holidayAppliesToEmployee(holidayEntry, employee)
          ) {
            updates.isHoliday = true;
            updates.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
          }
        }
        if (entry.remarks !== undefined) updates.remarks = entry.remarks;
        if (entry.importKey !== undefined) updates.importKey = entry.importKey;
        updates.status = resolvedStatus;
        if (scheduleWithLunch) {
          updates.scheduleIn = scheduleIn;
          updates.scheduleOut = scheduleOut;
          updates.lunchStart = lunchStart;
          updates.lunchEnd = lunchEnd;
        }

        const currentActualIn = entry.actualIn ?? existing.actualIn;
        const currentActualOut = entry.actualOut ?? existing.actualOut;
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : resolvedStatus === "present" &&
                currentActualIn &&
                currentActualOut
              ? calculateUndertime(
                  scheduleIn,
                  scheduleOut,
                  currentActualIn,
                  currentActualOut,
                  lunchStart,
                  lunchEnd,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : resolvedStatus === "present" && currentActualIn
              ? calculateLate(scheduleIn, currentActualIn, lunchStart)
              : 0;

        updates.undertime =
          calculatedUndertime > 0 ? calculatedUndertime : 0;
        updates.late = calculatedLate > 0 ? calculatedLate : 0;

        updates.date = normalizedDate;
        await ctx.db.patch(existing._id, updates);
        const removedDuplicates = await deleteDuplicateAttendanceOnDay(
          ctx,
          existingOnDay,
          existing._id,
        );
        const after = await ctx.db.get(existing._id);
        await recordAttendanceAudit(ctx, {
          actor: userRecord,
          action: "bulk_update",
          attendanceId: existing._id,
          organizationId,
          employeeId: entry.employeeId,
          authorization: writeAuthorizations[index],
          before,
          after,
        });
        for (const duplicate of removedDuplicates) {
          await recordAttendanceAudit(ctx, {
            actor: userRecord,
            action: "duplicate_cleanup",
            attendanceId: duplicate._id,
            organizationId: duplicate.organizationId,
            employeeId: duplicate.employeeId,
            authorization: writeAuthorizations[index],
            before: duplicate,
            after: null,
          });
        }
        results.push({ id: existing._id, action: "updated" });
      } else {
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : resolvedStatus === "present" && entry.actualIn && entry.actualOut
              ? calculateUndertime(
                  scheduleIn,
                  scheduleOut,
                  entry.actualIn,
                  entry.actualOut,
                  lunchStart,
                  lunchEnd,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : resolvedStatus === "present" && entry.actualIn
              ? calculateLate(scheduleIn, entry.actualIn, lunchStart)
              : 0;

        let isHoliday = entry.isHoliday;
        let holidayType = entry.holidayType;
        if (isHoliday === undefined && holidayType === undefined) {
          const holidayEntry = getMatchingHolidayEntryForDate(entry.date, holidays);
          if (
            holidayEntry &&
            employee &&
            holidayAppliesToEmployee(holidayEntry, employee)
          ) {
            isHoliday = true;
            holidayType = holidayEntry.type as "regular" | "special" | "special_working";
          }
        }
        const insertPayload: Omit<
          Doc<"attendance">,
          "_id" | "_creationTime"
        > = {
          organizationId: entry.organizationId,
          employeeId: entry.employeeId,
          date: normalizedDate,
          scheduleIn,
          scheduleOut,
          actualIn: entry.actualIn,
          actualOut: entry.actualOut,
          overtime: entry.overtime,
          status: resolvedStatus,
          late: calculatedLate > 0 ? calculatedLate : 0,
          undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
          isHoliday,
          holidayType,
          remarks: entry.remarks,
          importKey: entry.importKey,
          createdAt: now,
          updatedAt: now,
        };
        if (lunchStart != null) insertPayload.lunchStart = lunchStart;
        if (lunchEnd != null) insertPayload.lunchEnd = lunchEnd;
        const attendanceId = await ctx.db.insert("attendance", insertPayload);
        const after = await ctx.db.get(attendanceId);
        await recordAttendanceAudit(ctx, {
          actor: userRecord,
          action: "bulk_create",
          attendanceId,
          organizationId,
          employeeId: entry.employeeId,
          authorization: writeAuthorizations[index],
          after,
        });
        results.push({ id: attendanceId, action: "created" });
      }
      await markAttendanceConflictForDate(ctx, {
        organizationId: entry.organizationId,
        employeeId: entry.employeeId,
        attendanceDate: normalizedDate,
        hasActualWork: Boolean(currentActualIn || currentActualOut),
        updatedAt: now,
      });
    }

    return results;
  },
});

// Recalculate late/undertime for an employee in a date range. Snapshotted
// scheduleIn/scheduleOut on each row are kept; we only backfill when missing.
export const recalculateEmployeeAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    correctionReason: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // HR/admin/owner only
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    if (employee.organizationId !== args.organizationId) {
      throw new Error("Employee does not belong to this organization");
    }

    const minDate = args.startDate ?? getManilaTodayDateUtcMs();
    const attendanceQuery = ctx.db.query("attendance");
    const rangedQuery =
      args.endDate !== undefined
        ? attendanceQuery.withIndex("by_employee_date", (query) =>
            query
              .eq("employeeId", args.employeeId)
              .gte("date", minDate)
              .lte("date", args.endDate!),
          )
        : attendanceQuery.withIndex("by_employee_date", (query) =>
            query.eq("employeeId", args.employeeId).gte("date", minDate),
          );
    const attendancePage = await rangedQuery.paginate({
      cursor: args.cursor ?? null,
      numItems: ATTENDANCE_WRITE_BATCH_LIMIT,
    });
    const records = attendancePage.page;

    if (records.length === 0) {
      return {
        updated: 0,
        isDone: attendancePage.isDone,
        continueCursor: attendancePage.continueCursor,
      };
    }

    const writeAuthorizations = await Promise.all(
      records.map((record) =>
        authorizeAttendanceWrite(
          ctx,
          userRecord,
          args.organizationId,
          args.employeeId,
          record.date,
          args.correctionReason,
        ),
      ),
    );

    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();

    const now = Date.now();
    let updatedCount = 0;

    for (const [index, record] of records.entries()) {
      const scheduleWithLunch = await getScheduleWithLunch(
        ctx,
        employee,
        record.date,
        args.organizationId,
      );

      // Prefer shift snapshot on the row; only backfill from current employee schedule
      // when the record never had times (legacy). Never overwrite per-day stored shift
      // with the employee's latest schedule.
      const scheduleIn = record.scheduleIn ?? scheduleWithLunch?.scheduleIn;
      const scheduleOut = record.scheduleOut ?? scheduleWithLunch?.scheduleOut;
      const lunchStart = record.lunchStart ?? scheduleWithLunch?.lunchStart;
      const lunchEnd = record.lunchEnd ?? scheduleWithLunch?.lunchEnd;

      if (!scheduleIn || !scheduleOut) continue;

      const actualIn = record.actualIn as string | undefined;
      const actualOut = record.actualOut as string | undefined;
      const status = record.status as
        | "present"
        | "absent"
        | "half-day"
        | "leave"
        | "leave_with_pay"
        | "leave_without_pay"
        | "no_work";

      let newUndertime: number | undefined;
      let newLate: number | undefined;

      if (status === "present" && actualIn && actualOut) {
        const undertime = calculateUndertime(
          scheduleIn,
          scheduleOut,
          actualIn,
          actualOut,
          lunchStart,
          lunchEnd,
        );
        newUndertime = undertime > 0 ? undertime : 0;

        const late = calculateLate(scheduleIn, actualIn, lunchStart);
        newLate = late > 0 ? late : 0;
      } else {
        newUndertime = 0;
        newLate = 0;
      }

      const patchPayload: Partial<Doc<"attendance">> = {
        undertime: newUndertime,
        late: newLate,
        updatedAt: now,
      };
      if (record.scheduleIn == null && scheduleIn != null) {
        patchPayload.scheduleIn = scheduleIn;
      }
      if (record.scheduleOut == null && scheduleOut != null) {
        patchPayload.scheduleOut = scheduleOut;
      }
      const holidayEntry = getMatchingHolidayEntryForDate(record.date, holidays);
      if (
        holidayEntry &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        patchPayload.isHoliday = true;
        patchPayload.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
      if (record.lunchStart == null && scheduleWithLunch?.lunchStart != null) {
        patchPayload.lunchStart = scheduleWithLunch.lunchStart;
      }
      if (record.lunchEnd == null && scheduleWithLunch?.lunchEnd != null) {
        patchPayload.lunchEnd = scheduleWithLunch.lunchEnd;
      }
      await ctx.db.patch(record._id, patchPayload);
      const after = await ctx.db.get(record._id);
      await recordAttendanceAudit(ctx, {
        actor: userRecord,
        action: "recalculate",
        attendanceId: record._id,
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        authorization: writeAuthorizations[index],
        before: record,
        after,
      });
      updatedCount++;
    }

    return {
      updated: updatedCount,
      isDone: attendancePage.isDone,
      continueCursor: attendancePage.continueCursor,
    };
  },
});
