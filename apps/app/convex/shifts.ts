import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

async function checkAuth(ctx: any, organizationId: any, requiredRole?: "owner" | "admin" | "hr") {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");
  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();
  if (!userRecord) throw new Error("User not found");
  if (!organizationId) throw new Error("Organization ID is required");
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId),
    )
    .first();
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);
  if (!hasAccess) throw new Error("User is not a member of this organization");
  const userRole = userOrg?.role ?? (userRecord.organizationId === organizationId ? userRecord.role : undefined);
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";
  if (requiredRole && userRole !== requiredRole && !isOwnerOrAdmin) throw new Error("Not authorized");
  return { ...userRecord, role: userRole, organizationId };
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const dayNames = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function getManilaDateParts(ts: number) {
  const d = new Date(ts + MANILA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/** Get employee's scheduled in/out for a date. Uses Manila timezone so the correct per-day schedule is used. */
function getScheduledTimesForDate(date: number, employeeSchedule: any): { scheduleIn: string | null; scheduleOut: string | null } {
  if (!employeeSchedule?.defaultSchedule) return { scheduleIn: null, scheduleOut: null };
  const manilaParts = getManilaDateParts(date);
  if (employeeSchedule.scheduleOverrides && Array.isArray(employeeSchedule.scheduleOverrides)) {
    const override = employeeSchedule.scheduleOverrides.find((o: any) => {
      if (o.date == null) return false;
      const oTs = typeof o.date === "number" ? o.date : new Date(o.date).getTime();
      const oParts = getManilaDateParts(oTs);
      return oParts.y === manilaParts.y && oParts.m === manilaParts.m && oParts.d === manilaParts.d;
    });
    if (override?.in && override?.out) return { scheduleIn: override.in, scheduleOut: override.out };
  }
  const manilaDay = new Date(date + MANILA_OFFSET_MS).getUTCDay();
  const dayName = dayNames[manilaDay];
  const daySchedule = employeeSchedule.defaultSchedule[dayName as keyof typeof employeeSchedule.defaultSchedule];
  if (!daySchedule?.in || !daySchedule?.out) return { scheduleIn: null, scheduleOut: null };
  return { scheduleIn: daySchedule.in, scheduleOut: daySchedule.out };
}

/** Pre-fetched per payroll run to avoid N× org-wide shift reads in getScheduleWithLunch. */
export type ScheduleLunchContext = {
  orgShifts: any[];
  defaultLunchStart: string;
  defaultLunchEnd: string;
  scheduleHistoryByEmployeeId?: Record<string, any[]>;
};

function resolveEffectiveScheduleHistory(
  date: number,
  historyRows: any[] | undefined,
): { schedule: any; shiftId: any } | null {
  if (!historyRows || historyRows.length === 0) return null;
  let best: any | null = null;
  for (const row of historyRows) {
    if (typeof row.effectiveFrom !== "number") continue;
    if (row.effectiveFrom > date) continue;
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  if (!best?.schedule) return null;
  return { schedule: best.schedule, shiftId: best.shiftId ?? null };
}

/** Get schedule + lunch for an employee on a date.
 * When the employee has both a shift and a per-day schedule (defaultSchedule/scheduleOverrides),
 * the per-day schedule for this date is used first so late/undertime match the actual day (e.g. Mon 2–11 vs Tue 1–10).
 * For lunch when using per-day schedule: auto-match an org shift whose scheduleIn/scheduleOut equal this day's in/out
 * and use that shift's lunch; else fall back to the employee's tied shift lunch, then org default.
 * Only when there is no per-day schedule for the date do we fall back to the shift (e.g. UK 2–11).
 *
 * Pass `cache` when processing many days (e.g. payroll) to read org shifts and defaults once.
 */
export async function getScheduleWithLunch(
  ctx: any,
  employee: { _id?: any; shiftId?: any; schedule?: any },
  date: number,
  organizationId: any,
  cache?: ScheduleLunchContext,
): Promise<{ scheduleIn: string; scheduleOut: string; lunchStart: string; lunchEnd: string; lunchMinutes: number } | null> {
  let scheduleIn: string;
  let scheduleOut: string;
  let lunchStart: string;
  let lunchEnd: string;

  const defaultLunch = () => ({
    start: cache?.defaultLunchStart ?? "12:00",
    end: cache?.defaultLunchEnd ?? "13:00",
  });

  let effectiveSchedule = employee.schedule ?? null;
  let effectiveShiftId = employee.shiftId ?? null;

  if (employee._id) {
    const employeeIdKey = String(employee._id);
    const cachedHistoryRows =
      cache?.scheduleHistoryByEmployeeId?.[employeeIdKey];
    let historyRows: any[];
    if (cachedHistoryRows) {
      historyRows = cachedHistoryRows;
    } else {
      historyRows = await (ctx.db.query("employeeScheduleHistory") as any)
        .withIndex("by_employee", (q: any) => q.eq("employeeId", employee._id))
        .collect();
      if (cache) {
        if (!cache.scheduleHistoryByEmployeeId) {
          cache.scheduleHistoryByEmployeeId = {};
        }
        cache.scheduleHistoryByEmployeeId[employeeIdKey] = historyRows;
      }
    }
    const effectiveFromHistory = resolveEffectiveScheduleHistory(date, historyRows);
    if (effectiveFromHistory) {
      effectiveSchedule = effectiveFromHistory.schedule;
      effectiveShiftId = effectiveFromHistory.shiftId;
    }
  }

  const fromPerDay =
    effectiveSchedule != null
      ? getScheduledTimesForDate(date, effectiveSchedule)
      : null;

  if (fromPerDay?.scheduleIn && fromPerDay?.scheduleOut) {
    scheduleIn = fromPerDay.scheduleIn;
    scheduleOut = fromPerDay.scheduleOut;
    // Resolve lunch for this day: match org shift by schedule times so each day gets correct lunch (late/undertime).
    const orgShifts =
      cache?.orgShifts ??
      (await (ctx.db.query("shifts") as any)
        .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
        .collect());
    const matchingShift = orgShifts.find(
      (s: any) =>
        s.scheduleIn === scheduleIn && s.scheduleOut === scheduleOut,
    );
    if (matchingShift) {
      lunchStart = matchingShift.lunchStart;
      lunchEnd = matchingShift.lunchEnd;
    } else if (effectiveShiftId) {
      const fallbackShift = await ctx.db.get(effectiveShiftId);
      if (fallbackShift && fallbackShift.organizationId === organizationId) {
        lunchStart = fallbackShift.lunchStart;
        lunchEnd = fallbackShift.lunchEnd;
      } else {
        if (cache) {
          const d = defaultLunch();
          lunchStart = d.start;
          lunchEnd = d.end;
        } else {
          const settings = await (ctx.db.query("settings") as any)
            .withIndex("by_organization", (q: any) =>
              q.eq("organizationId", organizationId),
            )
            .first();
          const att = settings?.attendanceSettings;
          lunchStart = att?.defaultLunchStart ?? "12:00";
          lunchEnd = att?.defaultLunchEnd ?? "13:00";
        }
      }
    } else {
      if (cache) {
        const d = defaultLunch();
        lunchStart = d.start;
        lunchEnd = d.end;
      } else {
        const settings = await (ctx.db.query("settings") as any)
          .withIndex("by_organization", (q: any) =>
            q.eq("organizationId", organizationId),
          )
          .first();
        const att = settings?.attendanceSettings;
        lunchStart = att?.defaultLunchStart ?? "12:00";
        lunchEnd = att?.defaultLunchEnd ?? "13:00";
      }
    }
  } else if (effectiveShiftId) {
    const shift = await ctx.db.get(effectiveShiftId);
    if (!shift || shift.organizationId !== organizationId)
      return null;
    scheduleIn = shift.scheduleIn;
    scheduleOut = shift.scheduleOut;
    lunchStart = shift.lunchStart;
    lunchEnd = shift.lunchEnd;
  } else {
    return null;
  }

  const [lsH, lsM] = lunchStart.split(":").map(Number);
  const [leH, leM] = lunchEnd.split(":").map(Number);
  const startM = (lsH ?? 0) * 60 + (lsM ?? 0);
  const endM = (leH ?? 0) * 60 + (leM ?? 0);
  let lunchMinutes = endM - startM;
  if (lunchMinutes < 0) lunchMinutes += 24 * 60; // lunch crosses midnight (e.g. 23:00–00:00)
  return { scheduleIn, scheduleOut, lunchStart, lunchEnd, lunchMinutes: Math.max(0, lunchMinutes) };
}

export const listShifts = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);
    const shifts = await (ctx.db.query("shifts") as any)
      .withIndex("by_organization", (q: any) => q.eq("organizationId", args.organizationId))
      .collect();
    return shifts.sort((a: any, b: any) => a.name.localeCompare(b.name));
  },
});

export const createShift = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    scheduleIn: v.string(),
    scheduleOut: v.string(),
    lunchStart: v.string(),
    lunchEnd: v.string(),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    return await ctx.db.insert("shifts", {
      organizationId: args.organizationId,
      name: args.name,
      scheduleIn: args.scheduleIn,
      scheduleOut: args.scheduleOut,
      lunchStart: args.lunchStart,
      lunchEnd: args.lunchEnd,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateShift = mutation({
  args: {
    shiftId: v.id("shifts"),
    name: v.optional(v.string()),
    scheduleIn: v.optional(v.string()),
    scheduleOut: v.optional(v.string()),
    lunchStart: v.optional(v.string()),
    lunchEnd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    await checkAuth(ctx, shift.organizationId, "hr");
    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.scheduleIn !== undefined) updates.scheduleIn = args.scheduleIn;
    if (args.scheduleOut !== undefined) updates.scheduleOut = args.scheduleOut;
    if (args.lunchStart !== undefined) updates.lunchStart = args.lunchStart;
    if (args.lunchEnd !== undefined) updates.lunchEnd = args.lunchEnd;
    await ctx.db.patch(args.shiftId, updates);
    return args.shiftId;
  },
});

export const deleteShift = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    await checkAuth(ctx, shift.organizationId, "hr");
    await ctx.db.delete(args.shiftId);
    return { success: true };
  },
});
