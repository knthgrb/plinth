import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "admin" | "hr"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  // Check user's role in the specific organization
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
    )
    .first();

  // Fallback to legacy organizationId/role fields for backward compatibility
  let userRole: string | undefined = userOrg?.role;
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);

  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }

  // Use legacy role if userOrg doesn't exist
  if (!userRole && userRecord.organizationId === organizationId) {
    userRole = userRecord.role;
  }

  if (requiredRole && userRole !== requiredRole && userRole !== "admin") {
    throw new Error("Not authorized");
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Get holidays for organization
export const getHolidays = query({
  args: {
    organizationId: v.id("organizations"),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    let holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by year if specified
    if (args.year) {
      holidays = holidays.filter(
        (h: any) => h.isRecurring || h.year === args.year
      );
    }

    // Sort by date
    holidays.sort((a: any, b: any) => a.date - b.date);

    return holidays;
  },
});

// Create holiday
export const createHoliday = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    date: v.number(),
    type: v.union(v.literal("regular"), v.literal("special")),
    isRecurring: v.boolean(),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const holidayId = await ctx.db.insert("holidays", {
      organizationId: args.organizationId,
      name: args.name,
      date: args.date,
      type: args.type,
      isRecurring: args.isRecurring,
      year: args.year,
      createdAt: now,
      updatedAt: now,
    });

    return holidayId;
  },
});

// Update holiday
export const updateHoliday = mutation({
  args: {
    holidayId: v.id("holidays"),
    name: v.optional(v.string()),
    date: v.optional(v.number()),
    type: v.optional(v.union(v.literal("regular"), v.literal("special"))),
    isRecurring: v.optional(v.boolean()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, "hr");

    const holiday = await ctx.db.get(args.holidayId);
    if (!holiday) throw new Error("Holiday not found");

    if (holiday.organizationId !== userRecord.organizationId) {
      throw new Error("Not authorized");
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.date !== undefined) updates.date = args.date;
    if (args.type !== undefined) updates.type = args.type;
    if (args.isRecurring !== undefined) updates.isRecurring = args.isRecurring;
    if (args.year !== undefined) updates.year = args.year;

    await ctx.db.patch(args.holidayId, updates);
    return { success: true };
  },
});

// Delete holiday
export const deleteHoliday = mutation({
  args: {
    holidayId: v.id("holidays"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, "hr");

    const holiday = await ctx.db.get(args.holidayId);
    if (!holiday) throw new Error("Holiday not found");

    if (holiday.organizationId !== userRecord.organizationId) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.holidayId);
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
        type: v.union(v.literal("regular"), v.literal("special")),
        isRecurring: v.boolean(),
        year: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const results = [];

    for (const holiday of args.holidays) {
      // Check if holiday already exists for this date
      const existing = await (ctx.db.query("holidays") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId)
        )
        .collect();

      const duplicate = existing.find(
        (h: any) =>
          h.date === holiday.date &&
          h.name.toLowerCase() === holiday.name.toLowerCase()
      );

      if (!duplicate) {
        const holidayId = await ctx.db.insert("holidays", {
          organizationId: args.organizationId,
          name: holiday.name,
          date: holiday.date,
          type: holiday.type,
          isRecurring: holiday.isRecurring,
          year: holiday.year,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ id: holidayId, name: holiday.name, action: "created" });
      } else {
        results.push({
          id: duplicate._id,
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
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

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
