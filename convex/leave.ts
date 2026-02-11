import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  calculateTotalLeaveEntitlement,
  getConvertibleLeaveDays,
} from "./leaveCalculations";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  // Use the same getUserRecord logic as organizations.ts for consistency
  let userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  // If user record doesn't exist, it means they haven't completed setup yet
  // This can happen right after signup before ensureUserRecord is called
  if (!userRecord) {
    throw new Error(
      "User record not found. Please complete your account setup."
    );
  }

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

// Helper to calculate working days (excluding weekends)
function calculateWorkingDays(startDate: number, endDate: number): number {
  let days = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Not Sunday (0) or Saturday (6)
      days++;
    }
  }

  return days;
}

// Get leave requests
export const getLeaveRequests = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Employees can only see their own requests
    // If employee role and employeeId is provided, it must match their own
    if (
      userRecord.role === "employee" &&
      args.employeeId &&
      args.employeeId !== userRecord.employeeId
    ) {
      throw new Error("Not authorized");
    }

    let requests = await (ctx.db.query("leaveRequests") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // If employee role and no employeeId specified, filter to their own requests
    if (userRecord.role === "employee" && !args.employeeId) {
      requests = requests.filter(
        (r: any) => r.employeeId === userRecord.employeeId
      );
    } else if (args.employeeId) {
      requests = requests.filter((r: any) => r.employeeId === args.employeeId);
    }

    if (args.status) {
      requests = requests.filter((r: any) => r.status === args.status);
    }

    requests.sort((a: any, b: any) => b.filedDate - a.filedDate);
    return requests;
  },
});

// Get single leave request
export const getLeaveRequest = query({
  args: {
    leaveRequestId: v.id("leaveRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");

    const userRecord = await checkAuth(ctx, request.organizationId);

    // Check authorization
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== request.employeeId
    ) {
      throw new Error("Not authorized");
    }

    if (request.organizationId !== userRecord.organizationId) {
      throw new Error("Not authorized");
    }

    return request;
  },
});

// Create leave request
export const createLeaveRequest = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveType: v.union(
      v.literal("vacation"),
      v.literal("sick"),
      v.literal("emergency"),
      v.literal("maternity"),
      v.literal("paternity"),
      v.literal("custom")
    ),
    customLeaveType: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    reason: v.string(),
    supportingDocuments: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Employees can only create requests for themselves
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    // Calculate number of working days
    const numberOfDays = calculateWorkingDays(args.startDate, args.endDate);

    // Check leave balance
    if (args.leaveType === "vacation") {
      if (employee.leaveCredits.vacation.balance < numberOfDays) {
        throw new Error("Insufficient vacation leave credits");
      }
    } else if (args.leaveType === "sick") {
      if (employee.leaveCredits.sick.balance < numberOfDays) {
        throw new Error("Insufficient sick leave credits");
      }
    }

    const now = Date.now();
    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      leaveType: args.leaveType,
      customLeaveType: args.customLeaveType,
      startDate: args.startDate,
      endDate: args.endDate,
      numberOfDays,
      reason: args.reason,
      status: "pending",
      supportingDocuments: args.supportingDocuments,
      filedDate: now,
      createdAt: now,
      updatedAt: now,
    });

    return leaveRequestId;
  },
});

// Approve leave request
export const approveLeaveRequest = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    remarks: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");

    const userRecord = await checkAuth(ctx, request.organizationId, "hr");

    if (request.status !== "pending") {
      throw new Error("Leave request is not pending");
    }

    // Check and update leave credits
    const employee = await ctx.db.get(request.employeeId);
    if (!employee) throw new Error("Employee not found");

    const leaveCredits = { ...employee.leaveCredits };

    // Validate sufficient credits before approving
    if (request.leaveType === "vacation") {
      if (leaveCredits.vacation.balance < request.numberOfDays) {
        throw new Error(
          `Insufficient vacation leave credits. Available: ${leaveCredits.vacation.balance} days, Requested: ${request.numberOfDays} days`
        );
      }
      leaveCredits.vacation.used += request.numberOfDays;
      leaveCredits.vacation.balance -= request.numberOfDays;
    } else if (request.leaveType === "sick") {
      if (leaveCredits.sick.balance < request.numberOfDays) {
        throw new Error(
          `Insufficient sick leave credits. Available: ${leaveCredits.sick.balance} days, Requested: ${request.numberOfDays} days`
        );
      }
      leaveCredits.sick.used += request.numberOfDays;
      leaveCredits.sick.balance -= request.numberOfDays;
    }

    await ctx.db.patch(request.employeeId, { leaveCredits });

    // Update leave request
    await ctx.db.patch(args.leaveRequestId, {
      status: "approved",
      reviewedBy: userRecord._id,
      reviewedDate: Date.now(),
      remarks: args.remarks,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Reject leave request
export const rejectLeaveRequest = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    remarks: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");

    const userRecord = await checkAuth(ctx, request.organizationId, "hr");

    if (request.status !== "pending") {
      throw new Error("Leave request is not pending");
    }

    await ctx.db.patch(args.leaveRequestId, {
      status: "rejected",
      reviewedBy: userRecord._id,
      reviewedDate: Date.now(),
      remarks: args.remarks,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Cancel leave request (employee can cancel their own)
export const cancelLeaveRequest = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");

    const userRecord = await checkAuth(ctx, request.organizationId);

    // Employees can only cancel their own pending requests
    if (
      userRecord.role === "employee" &&
      (userRecord.employeeId !== request.employeeId ||
        request.status !== "pending")
    ) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.leaveRequestId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Get leave types
export const getLeaveTypes = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    return leaveTypes;
  },
});

// Create leave type
export const createLeaveType = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    maxDays: v.optional(v.number()),
    requiresApproval: v.boolean(),
    isPaid: v.boolean(),
    accrualRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const leaveTypeId = await ctx.db.insert("leaveTypes", {
      organizationId: args.organizationId,
      name: args.name,
      maxDays: args.maxDays,
      requiresApproval: args.requiresApproval,
      isPaid: args.isPaid,
      accrualRate: args.accrualRate,
      createdAt: now,
      updatedAt: now,
    });

    return leaveTypeId;
  },
});

// Get employee leave credits
export const getEmployeeLeaveCredits = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Employees can only see their own credits
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    // Default annual leave entitlement (can be configured per organization)
    const annualLeaveEntitlement = 8; // Default 8 days per year

    // Calculate prorated and anniversary leave
    const entitlement = calculateTotalLeaveEntitlement(
      annualLeaveEntitlement,
      employee.employment.hireDate,
      employee.employment.regularizationDate,
      Date.now()
    );

    // Get current leave credits
    const leaveCredits = { ...employee.leaveCredits };

    // Calculate convertible leave days (first 5 are convertible)
    const vacationConvertible = getConvertibleLeaveDays(
      leaveCredits.vacation.balance
    );
    const sickConvertible = getConvertibleLeaveDays(leaveCredits.sick.balance);

    // Return enhanced leave credits with calculations
    return {
      ...leaveCredits,
      // Add calculated entitlements
      calculations: {
        proratedLeave: entitlement.proratedLeave,
        anniversaryLeave: entitlement.anniversaryLeave,
        totalEntitlement: entitlement.totalEntitlement,
        annualLeaveEntitlement,
      },
      // Add convertible leave information
      convertible: {
        vacation: {
          convertible: vacationConvertible,
          nonConvertible: Math.max(
            0,
            leaveCredits.vacation.balance - vacationConvertible
          ),
        },
        sick: {
          convertible: sickConvertible,
          nonConvertible: Math.max(
            0,
            leaveCredits.sick.balance - sickConvertible
          ),
        },
      },
    };
  },
});

// Update employee leave credits (admin/hr only)
export const updateEmployeeLeaveCredits = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveType: v.union(
      v.literal("vacation"),
      v.literal("sick"),
      v.literal("custom")
    ),
    customType: v.optional(v.string()),
    total: v.optional(v.number()),
    used: v.optional(v.number()),
    balance: v.optional(v.number()),
    adjustment: v.optional(v.number()), // Positive to add, negative to subtract
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const leaveCredits = { ...employee.leaveCredits };

    if (args.leaveType === "vacation") {
      if (args.total !== undefined) {
        leaveCredits.vacation.total = args.total;
        leaveCredits.vacation.balance = args.total - leaveCredits.vacation.used;
      } else if (args.used !== undefined) {
        leaveCredits.vacation.used = args.used;
        leaveCredits.vacation.balance = leaveCredits.vacation.total - args.used;
      } else if (args.balance !== undefined) {
        leaveCredits.vacation.balance = args.balance;
        leaveCredits.vacation.total = args.balance + leaveCredits.vacation.used;
      } else if (args.adjustment !== undefined) {
        leaveCredits.vacation.balance += args.adjustment;
        leaveCredits.vacation.total += args.adjustment;
      }
    } else if (args.leaveType === "sick") {
      if (args.total !== undefined) {
        leaveCredits.sick.total = args.total;
        leaveCredits.sick.balance = args.total - leaveCredits.sick.used;
      } else if (args.used !== undefined) {
        leaveCredits.sick.used = args.used;
        leaveCredits.sick.balance = leaveCredits.sick.total - args.used;
      } else if (args.balance !== undefined) {
        leaveCredits.sick.balance = args.balance;
        leaveCredits.sick.total = args.balance + leaveCredits.sick.used;
      } else if (args.adjustment !== undefined) {
        leaveCredits.sick.balance += args.adjustment;
        leaveCredits.sick.total += args.adjustment;
      }
    } else if (args.leaveType === "custom" && args.customType) {
      if (!leaveCredits.custom) {
        leaveCredits.custom = [];
      }
      const customIndex = leaveCredits.custom.findIndex(
        (c: any) => c.type === args.customType
      );
      if (customIndex >= 0) {
        const custom = { ...leaveCredits.custom[customIndex] };
        if (args.total !== undefined) {
          custom.total = args.total;
          custom.balance = args.total - custom.used;
        } else if (args.used !== undefined) {
          custom.used = args.used;
          custom.balance = custom.total - args.used;
        } else if (args.balance !== undefined) {
          custom.balance = args.balance;
          custom.total = args.balance + custom.used;
        } else if (args.adjustment !== undefined) {
          custom.balance += args.adjustment;
          custom.total += args.adjustment;
        }
        leaveCredits.custom[customIndex] = custom;
      } else {
        // Create new custom leave type
        const newCustom = {
          type: args.customType,
          total: args.total || args.balance || args.adjustment || 0,
          used: args.used || 0,
          balance: args.balance || args.total || args.adjustment || 0,
        };
        if (args.adjustment !== undefined && args.total === undefined) {
          newCustom.total = args.adjustment;
          newCustom.balance = args.adjustment;
        }
        leaveCredits.custom.push(newCustom);
      }
    }

    await ctx.db.patch(args.employeeId, { leaveCredits });

    return { success: true, leaveCredits };
  },
});

// Convert leave to cash (first 5 leaves are convertible)
export const convertLeaveToCash = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveType: v.union(v.literal("vacation"), v.literal("sick")),
    daysToConvert: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const leaveCredits = { ...employee.leaveCredits };
    const targetLeave = leaveCredits[args.leaveType];

    // Check if employee has enough balance
    if (targetLeave.balance < args.daysToConvert) {
      throw new Error(
        `Insufficient ${args.leaveType} leave balance. Available: ${targetLeave.balance} days`
      );
    }

    // Check if the days to convert are within the convertible limit (first 5)
    const convertibleDays = getConvertibleLeaveDays(targetLeave.balance);
    if (args.daysToConvert > convertibleDays) {
      throw new Error(
        `Only the first 5 leave days are convertible to cash. Convertible: ${convertibleDays} days`
      );
    }

    // Deduct the converted leave
    targetLeave.balance -= args.daysToConvert;
    targetLeave.used += args.daysToConvert;
    // Note: We're treating converted leave as "used" for accounting purposes
    // The total remains the same since it was already granted

    await ctx.db.patch(args.employeeId, { leaveCredits });

    // In a real system, you would also create a payroll entry or cash conversion record here
    // For now, we just update the leave credits

    return {
      success: true,
      leaveCredits,
      convertedDays: args.daysToConvert,
      leaveType: args.leaveType,
    };
  },
});
