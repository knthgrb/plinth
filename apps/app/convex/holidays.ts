import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireActiveMembership } from "./access";
import {
  holidayAppliesToEmployee,
  holidayMatchesDate,
} from "@/lib/payroll-calculations";
import {
  isAttendancePayrollLocked,
  recordAttendanceSystemAudit,
} from "./attendanceIntegrity";
import { normalizeAttendanceDateMs } from "@/lib/manila-date";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr"
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  if (
    requiredRole &&
    userRole !== requiredRole &&
    userRole !== "admin" &&
    userRole !== "owner"
  ) {
    throw new Error("Not authorized");
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

type HolidayDocLike = {
  _id?: Id<"holidays">;
  organizationId: Id<"organizations">;
  date: number;
  offsetDate?: number;
  type: "regular" | "special" | "special_working";
  isRecurring?: boolean;
  applyToAll?: boolean;
  provinces?: string[];
  year?: number;
};

const holidaySyncTargetValidator = v.object({
  date: v.number(),
  offsetDate: v.optional(v.number()),
  type: v.union(
    v.literal("regular"),
    v.literal("special"),
    v.literal("special_working"),
  ),
  isRecurring: v.optional(v.boolean()),
  applyToAll: v.optional(v.boolean()),
  provinces: v.optional(v.array(v.string())),
  year: v.optional(v.number()),
});

function toHolidaySyncTarget(holiday: Doc<"holidays">): HolidayDocLike {
  return {
    organizationId: holiday.organizationId,
    date: holiday.date,
    offsetDate: holiday.offsetDate,
    type: holiday.type,
    isRecurring: holiday.isRecurring,
    applyToAll: holiday.applyToAll,
    provinces: holiday.provinces,
    year: holiday.year,
  };
}

async function scheduleHolidayAttendanceSync(
  ctx: MutationCtx,
  actor: {
    _id: Id<"users">;
    role: Doc<"userOrganizations">["role"];
  },
  organizationId: Id<"organizations">,
  target: HolidayDocLike,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.holidays.syncAttendanceForHolidayChangeBatch,
    {
      organizationId,
      actorUserId: actor._id,
      actorRole: actor.role,
      target: {
        date: target.date,
        offsetDate: target.offsetDate,
        type: target.type,
        isRecurring: target.isRecurring,
        applyToAll: target.applyToAll,
        provinces: target.provinces,
        year: target.year,
      },
    },
  );
}

function resolveAttendanceHolidayForEmployee(args: {
  attendanceDate: number;
  holidays: HolidayDocLike[];
  employee: Doc<"employees">;
}): { isHoliday: boolean; holidayType?: "regular" | "special" | "special_working" } {
  const match = args.holidays.find(
    (holiday) =>
      holidayMatchesDate(holiday, args.attendanceDate) &&
      holidayAppliesToEmployee(holiday, args.employee),
  );
  if (!match) return { isHoliday: false };
  return {
    isHoliday: true,
    holidayType: match.type,
  };
}

export const syncAttendanceForHolidayChangeBatch = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
    actorRole: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    target: holidaySyncTargetValidator,
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ processed: number }> => {
    const effectiveDate = args.target.offsetDate ?? args.target.date;
    const attendanceQuery = ctx.db.query("attendance");
    const page = args.target.isRecurring
      ? await attendanceQuery
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .paginate({ cursor: args.cursor ?? null, numItems: 50 })
      : await attendanceQuery
          .withIndex("by_organization_date", (query) => {
            const normalizedDate = normalizeAttendanceDateMs(effectiveDate);
            const rangeStart = normalizedDate - 8 * 60 * 60 * 1000;
            return query
              .eq("organizationId", args.organizationId)
              .gte("date", rangeStart)
              .lt("date", rangeStart + 24 * 60 * 60 * 1000);
          })
          .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    const holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();
    const now = Date.now();
    let processed = 0;

    for (const attendance of page.page) {
      if (!holidayMatchesDate(args.target, attendance.date)) continue;
      const employee = await ctx.db.get(attendance.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) continue;
      const nextHoliday = resolveAttendanceHolidayForEmployee({
        attendanceDate: attendance.date,
        holidays,
        employee,
      });
      if (
        attendance.isHoliday === nextHoliday.isHoliday &&
        attendance.holidayType === nextHoliday.holidayType
      ) {
        continue;
      }
      if (await isAttendancePayrollLocked(ctx, attendance)) continue;
      await ctx.db.patch(attendance._id, {
        isHoliday: nextHoliday.isHoliday,
        holidayType: nextHoliday.holidayType,
        updatedAt: now,
      });
      await recordAttendanceSystemAudit(ctx, {
        actor: { _id: args.actorUserId, role: args.actorRole },
        action: "holiday_sync",
        before: attendance,
        after: await ctx.db.get(attendance._id),
      });
      processed++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.holidays.syncAttendanceForHolidayChangeBatch,
        { ...args, cursor: page.continueCursor },
      );
    }
    return { processed };
  },
});

function normalizeHolidayScope(holiday: {
  applyToAll?: boolean;
  provinces?: string[];
}) {
  if (holiday.applyToAll !== false) return "all";
  return [...(holiday.provinces ?? [])]
    .map((province) => province.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

async function assertNoDuplicateHoliday(
  ctx: QueryCtx | MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    date: number;
    type: "regular" | "special" | "special_working";
    isRecurring: boolean;
    applyToAll?: boolean;
    provinces?: string[];
    excludeHolidayId?: Id<"holidays">;
  },
) {
  const existing = await ctx.db
    .query("holidays")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();
  const nextScope = normalizeHolidayScope(args);
  const duplicate = existing.find(
    (holiday) =>
      holiday._id !== args.excludeHolidayId &&
      holiday.date === args.date &&
      holiday.type === args.type &&
      holiday.isRecurring === args.isRecurring &&
      normalizeHolidayScope(holiday) === nextScope,
  );

  if (duplicate) {
    throw new ConvexError({
      code: "DUPLICATE_HOLIDAY",
      message: "A holiday already exists for this date, type, and scope.",
    });
  }
}

// Get holidays for organization
export const getHolidays = query({
  args: {
    organizationId: v.id("organizations"),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      await checkAuth(ctx, args.organizationId);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes("Not authenticated") ||
          error.message.includes("Unauthenticated"))
      ) {
        return [];
      }
      throw error;
    }

    let holidays = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by year if specified
    if (args.year) {
      holidays = holidays.filter((h) => {
        if (h.isRecurring) return true;

        // Exact year match when explicitly stored
        if (h.year != null) return h.year === args.year;

        // Backwards compatibility: derive year from date when year field is missing
        try {
          const d = new Date(h.date);
          const derivedYear = d.getFullYear();
          return derivedYear === args.year;
        } catch {
          return false;
        }
      });
    }

    // Sort by date
    holidays.sort((a, b) => a.date - b.date);

    return holidays;
  },
});

// Create holiday
export const createHoliday = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    date: v.number(),
    offsetDate: v.optional(v.number()),
    type: v.union(
      v.literal("regular"),
      v.literal("special"),
      v.literal("special_working")
    ),
    isRecurring: v.boolean(),
    year: v.optional(v.number()),
    applyToAll: v.optional(v.boolean()),
    provinces: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    await assertNoDuplicateHoliday(ctx, {
      organizationId: args.organizationId,
      date: args.date,
      type: args.type,
      isRecurring: args.isRecurring,
      applyToAll: args.applyToAll,
      provinces: args.provinces,
    });

    const now = Date.now();
    const dateObj = new Date(args.date);
    const effectiveYear =
      args.isRecurring || Number.isNaN(dateObj.getTime())
        ? undefined
        : dateObj.getFullYear();

    const doc: Omit<Doc<"holidays">, "_id" | "_creationTime"> = {
      organizationId: args.organizationId,
      name: args.name,
      date: args.date,
      type: args.type,
      isRecurring: args.isRecurring,
      year: effectiveYear,
      createdAt: now,
      updatedAt: now,
    };
    if (args.offsetDate !== undefined) doc.offsetDate = args.offsetDate;
    if (args.applyToAll !== undefined) doc.applyToAll = args.applyToAll;
    if (args.provinces !== undefined) doc.provinces = args.provinces;
    const holidayId = await ctx.db.insert("holidays", doc);

    return holidayId;
  },
});

// Update holiday
export const updateHoliday = mutation({
  args: {
    holidayId: v.id("holidays"),
    name: v.optional(v.string()),
    date: v.optional(v.number()),
    offsetDate: v.optional(v.number()),
    clearOffsetDate: v.optional(v.boolean()),
    type: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working")
      )
    ),
    isRecurring: v.optional(v.boolean()),
    year: v.optional(v.number()),
    applyToAll: v.optional(v.boolean()),
    provinces: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    try {
      const holiday = await ctx.db.get(args.holidayId);
      if (!holiday) throw new ConvexError({ code: "NOT_FOUND", message: "Holiday not found" });

      // Authorize within the holiday's organization
      const actor = await checkAuth(ctx, holiday.organizationId, "hr");

      // Validate: when applyToAll is false, provinces must be a non-empty array
      if (args.applyToAll === false) {
        const provinces = args.provinces ?? [];
        if (!Array.isArray(provinces) || provinces.length === 0) {
          throw new ConvexError({
            code: "VALIDATION",
            message: "Please select at least one province when using 'Specific provinces'.",
          });
        }
      }

      // Determine effective values after update for year/isRecurring/date consistency
      const nextDate = args.date ?? holiday.date;
      const nextType = args.type ?? holiday.type;
      const nextIsRecurring =
        args.isRecurring !== undefined ? args.isRecurring : holiday.isRecurring;
      const nextApplyToAll =
        args.applyToAll !== undefined ? args.applyToAll : holiday.applyToAll;
      const nextProvinces =
        args.provinces !== undefined ? args.provinces : holiday.provinces;

      await assertNoDuplicateHoliday(ctx, {
        organizationId: holiday.organizationId,
        date: nextDate,
        type: nextType,
        isRecurring: nextIsRecurring,
        applyToAll: nextApplyToAll,
        provinces: nextProvinces,
        excludeHolidayId: args.holidayId,
      });

      const dateObj = new Date(nextDate);
      const nextYear =
        nextIsRecurring || Number.isNaN(dateObj.getTime())
          ? undefined
          : dateObj.getFullYear();

      const updates: Partial<Doc<"holidays">> = { updatedAt: Date.now() };
      if (args.name !== undefined) updates.name = args.name;
      if (args.date !== undefined) updates.date = args.date;
      if (args.clearOffsetDate) {
        updates.offsetDate = undefined;
      } else if (args.offsetDate !== undefined) {
        updates.offsetDate = args.offsetDate;
      }
      if (args.type !== undefined) updates.type = args.type;
      if (args.isRecurring !== undefined) updates.isRecurring = args.isRecurring;
      if (args.applyToAll !== undefined) updates.applyToAll = args.applyToAll;
      if (args.provinces !== undefined) updates.provinces = args.provinces;
      // Always keep year in sync with date/isRecurring, ignoring any manual year arg
      updates.year = nextYear;

      await ctx.db.patch(args.holidayId, updates);

      if (
        args.type !== undefined ||
        args.date !== undefined ||
        args.offsetDate !== undefined ||
        args.clearOffsetDate === true ||
        args.isRecurring !== undefined ||
        args.applyToAll !== undefined ||
        args.provinces !== undefined
      ) {
        const updatedHoliday = await ctx.db.get(args.holidayId);
        if (updatedHoliday) {
          await scheduleHolidayAttendanceSync(
            ctx,
            actor,
            holiday.organizationId,
            toHolidaySyncTarget(holiday),
          );
          await scheduleHolidayAttendanceSync(
            ctx,
            actor,
            updatedHoliday.organizationId,
            toHolidaySyncTarget(updatedHoliday),
          );
        }
      }

      return { success: true };
    } catch (err) {
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: "UPDATE_FAILED",
        message: err instanceof Error ? err.message : "Failed to update holiday",
      });
    }
  },
});

// Delete holiday
export const deleteHoliday = mutation({
  args: {
    holidayId: v.id("holidays"),
  },
  handler: async (ctx, args) => {
    const holiday = await ctx.db.get(args.holidayId);
    if (!holiday) throw new Error("Holiday not found");

    // Authorize within the holiday's organization
    const actor = await checkAuth(ctx, holiday.organizationId, "hr");

    await ctx.db.delete(args.holidayId);
    await scheduleHolidayAttendanceSync(
      ctx,
      actor,
      holiday.organizationId,
      toHolidaySyncTarget(holiday),
    );
    return { success: true };
  },
});

// Bulk create holidays
export const bulkCreateHolidays = mutation({
  args: {
    organizationId: v.id("organizations"),
    holidays: v.array(
      v.object({
        name: v.string(),
        date: v.number(),
        offsetDate: v.optional(v.number()),
        type: v.union(
          v.literal("regular"),
          v.literal("special"),
          v.literal("special_working")
        ),
        isRecurring: v.boolean(),
        year: v.optional(v.number()),
        applyToAll: v.optional(v.boolean()),
        provinces: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const results = [];
    const existing = await ctx.db
      .query("holidays")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const existingKeys = new Map(
      existing.map((holiday) => [
        `${holiday.date}:${holiday.name.toLowerCase()}`,
        holiday._id,
      ]),
    );

    for (const holiday of args.holidays) {
      const key = `${holiday.date}:${holiday.name.toLowerCase()}`;
      const duplicateId = existingKeys.get(key);

      if (!duplicateId) {
        const doc: Omit<Doc<"holidays">, "_id" | "_creationTime"> = {
          organizationId: args.organizationId,
          name: holiday.name,
          date: holiday.date,
          type: holiday.type,
          isRecurring: holiday.isRecurring,
          year: holiday.year,
          createdAt: now,
          updatedAt: now,
        };
        if (holiday.offsetDate !== undefined) doc.offsetDate = holiday.offsetDate;
        if (holiday.applyToAll !== undefined) doc.applyToAll = holiday.applyToAll;
        if (holiday.provinces !== undefined) doc.provinces = holiday.provinces;
        const holidayId = await ctx.db.insert("holidays", doc);
        existingKeys.set(key, holidayId);
        results.push({ id: holidayId, name: holiday.name, action: "created" });
      } else {
        results.push({
          id: duplicateId,
          name: holiday.name,
          action: "skipped",
          reason: "Already exists",
        });
      }
    }

    return {
      success: true,
      created: results.filter((r) => r.action === "created").length,
      skipped: results.filter((r) => r.action === "skipped").length,
      results,
    };
  },
});

// Initialize Philippine holidays for 2025-2030
export const initializePhilippineHolidays = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const holidays = [];

    // Regular holidays (fixed dates, recurring)
    const regularHolidays = [
      { name: "New Year's Day", month: 0, day: 1 },
      { name: "Araw ng Kagitingan", month: 3, day: 9 },
      { name: "Labor Day", month: 4, day: 1 },
      { name: "Independence Day", month: 5, day: 12 },
      { name: "National Heroes Day", month: 7, day: 25 }, // Last Monday of August
      { name: "Bonifacio Day", month: 10, day: 30 },
      { name: "Rizal Day", month: 11, day: 30 },
    ];

    // Special non-working holidays
    const specialHolidays = [
      { name: "Chinese New Year", month: 0, day: 29 }, // Varies, using approximate
      { name: "EDSA People Power Revolution Anniversary", month: 1, day: 25 },
      { name: "Black Saturday", month: 2, day: 19 }, // Varies, using approximate
      { name: "Ninoy Aquino Day", month: 7, day: 21 },
      { name: "All Saints' Day", month: 10, day: 1 },
      { name: "All Souls' Day", month: 10, day: 2 },
      { name: "Feast of the Immaculate Conception", month: 11, day: 8 },
      { name: "Christmas Eve", month: 11, day: 24 },
      { name: "New Year's Eve", month: 11, day: 31 },
    ];

    // Add regular holidays (recurring)
    for (const holiday of regularHolidays) {
      for (let year = 2025; year <= 2030; year++) {
        const date = new Date(year, holiday.month, holiday.day);
        holidays.push({
          organizationId: args.organizationId,
          name: holiday.name,
          date: date.getTime(),
          type: "regular" as const,
          isRecurring: true,
          year,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Add special holidays (non-recurring, year-specific)
    for (const holiday of specialHolidays) {
      for (let year = 2025; year <= 2030; year++) {
        const date = new Date(year, holiday.month, holiday.day);
        holidays.push({
          organizationId: args.organizationId,
          name: holiday.name,
          date: date.getTime(),
          type: "special" as const,
          isRecurring: false,
          year,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Insert all holidays
    for (const holiday of holidays) {
      await ctx.db.insert("holidays", holiday);
    }

    return { count: holidays.length };
  },
});
