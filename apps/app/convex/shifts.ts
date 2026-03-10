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

const dayNames = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function getScheduledTimesForDate(date: number, employeeSchedule: any): { scheduleIn: string | null; scheduleOut: string | null } {
  if (!employeeSchedule?.defaultSchedule) return { scheduleIn: null, scheduleOut: null };
  const dateObj = new Date(date);
  if (employeeSchedule.scheduleOverrides && Array.isArray(employeeSchedule.scheduleOverrides)) {
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) => new Date(o.date).toDateString() === dateObj.toDateString(),
    );
    if (override?.in && override?.out) return { scheduleIn: override.in, scheduleOut: override.out };
  }
  const dayName = dayNames[dateObj.getDay()];
  const daySchedule = employeeSchedule.defaultSchedule[dayName as keyof typeof employeeSchedule.defaultSchedule];
  if (!daySchedule?.in || !daySchedule?.out) return { scheduleIn: null, scheduleOut: null };
  return { scheduleIn: daySchedule.in, scheduleOut: daySchedule.out };
}

/** Get schedule + lunch for an employee on a date. If employee has shiftId, use shift; else use defaultSchedule + org default lunch. */
export async function getScheduleWithLunch(
  ctx: any,
  employee: { shiftId?: any; schedule?: any },
  date: number,
  organizationId: any,
): Promise<{ scheduleIn: string; scheduleOut: string; lunchStart: string; lunchEnd: string; lunchMinutes: number } | null> {
  let scheduleIn: string;
  let scheduleOut: string;
  let lunchStart: string;
  let lunchEnd: string;

  if (employee.shiftId) {
    const shift = await ctx.db.get(employee.shiftId);
    if (!shift || shift.organizationId !== organizationId)
      return null;
    scheduleIn = shift.scheduleIn;
    scheduleOut = shift.scheduleOut;
    lunchStart = shift.lunchStart;
    lunchEnd = shift.lunchEnd;
  } else {
    const fromSchedule = getScheduledTimesForDate(date, employee.schedule);
    if (!fromSchedule.scheduleIn || !fromSchedule.scheduleOut) return null;
    scheduleIn = fromSchedule.scheduleIn;
    scheduleOut = fromSchedule.scheduleOut;
    const settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) => q.eq("organizationId", organizationId))
      .first();
    const att = settings?.attendanceSettings;
    lunchStart = att?.defaultLunchStart ?? "12:00";
    lunchEnd = att?.defaultLunchEnd ?? "13:00";
    if (att?.defaultLunchBreakMinutes != null) {
      const [h, m] = lunchStart.split(":").map(Number);
      const startMins = h * 60 + m;
      const endMins = startMins + att.defaultLunchBreakMinutes;
      lunchEnd = `${Math.floor(endMins / 60)}:${String(endMins % 60).padStart(2, "0")}`;
    }
  }

  const [lsH, lsM] = lunchStart.split(":").map(Number);
  const [leH, leM] = lunchEnd.split(":").map(Number);
  const lunchMinutes = (leH * 60 + leM) - (lsH * 60 + lsM);
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
