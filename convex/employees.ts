import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  calculateTotalLeaveEntitlement,
  calculateProratedLeave,
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

  // HR routes: no access for accounting role (employees list is HR-only)
  if (userRole === "accounting") {
    throw new Error("Not authorized - HR routes are not available for accounting role");
  }

  // Owner has all admin privileges - treat owner the same as admin
  const isOwnerOrAdmin = userRole === "admin" || userRole === "owner";

  if (requiredRole) {
    if (userRole !== requiredRole && !isOwnerOrAdmin) {
      throw new Error("Not authorized");
    }
  } else {
    // Read access: hr, admin, owner, employee (not accounting)
    if (
      !isOwnerOrAdmin &&
      userRole !== "hr" &&
      userRole !== "employee"
    ) {
      throw new Error("Not authorized");
    }
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Get all employees for organization
export const getEmployees = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(v.string()),
    department: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let userRecord;
    try {
      userRecord = await checkAuth(ctx, args.organizationId);
    } catch (error: any) {
      // Handle auth errors gracefully by returning empty array instead of throwing
      // This prevents errors during initial page load when there's a race condition:
      // - Next.js middleware checks cookies (server-side) → sees authenticated → allows access
      // - Convex queries use JWT tokens (client-side) → token might not be ready yet → throws "Not authenticated"
      // By returning empty array, the query succeeds and will retry once auth token is ready
      if (
        error.message?.includes("Not authenticated") ||
        error.message?.includes("Unauthenticated") ||
        error.message?.includes("Not authorized") ||
        error.message?.includes("User is not a member")
      ) {
        return [];
      }
      throw error;
    }

    let employees = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by status
    if (args.status) {
      employees = employees.filter(
        (e: any) => e.employment.status === args.status
      );
    }

    // Filter by department
    if (args.department) {
      employees = employees.filter(
        (e: any) => e.employment.department === args.department
      );
    }

    // Search filter
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      employees = employees.filter(
        (e: any) =>
          e.personalInfo.firstName.toLowerCase().includes(searchLower) ||
          e.personalInfo.lastName.toLowerCase().includes(searchLower) ||
          e.personalInfo.email.toLowerCase().includes(searchLower) ||
          e.employment.employeeId.toLowerCase().includes(searchLower)
      );
    }

    return employees;
  },
});

// Get single employee
export const getEmployee = query({
  args: {
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId);

    // Check authorization - employees can only view their own record unless admin/hr
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    return employee;
  },
});

// Get stored payslip PIN hash (for verification in action only; auth required)
export const getPayslipPinHash = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    const userRecord = await checkAuth(ctx, employee.organizationId);
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", employee.organizationId)
      )
      .first();
    const currentEmployeeId = userOrg?.employeeId ?? userRecord.employeeId;
    if (
      userRecord.role === "employee" &&
      currentEmployeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }
    const hash = (employee as any).payslipPinHash ?? null;
    return { hash };
  },
});

// Set payslip PIN hash (called from action after hashing; auth required)
export const setPayslipPinHash = mutation({
  args: {
    employeeId: v.id("employees"),
    hashedPin: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    const userRecord = await checkAuth(ctx, employee.organizationId);
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", employee.organizationId)
      )
      .first();
    const isSameEmployee =
      userOrg?.employeeId === args.employeeId ||
      userRecord.employeeId === args.employeeId;
    const isHrOrAdmin =
      userOrg?.role === "hr" ||
      userOrg?.role === "admin" ||
      userOrg?.role === "owner";
    if (!isSameEmployee && !isHrOrAdmin) {
      throw new Error("Not authorized to set PIN for this employee");
    }
    await ctx.db.patch(args.employeeId, {
      payslipPinHash: args.hashedPin,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Check if employee has a user account
export const employeeHasUserAccount = query({
  args: {
    employeeId: v.id("employees"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    // Check if there's a user linked to this employee via userOrganizations
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .filter((q: any) => q.eq(q.field("employeeId"), args.employeeId))
      .first();

    if (userOrg) {
      return { hasAccount: true, userId: userOrg.userId };
    }

    // Also check if there's a user with this employee's email (regardless of organization)
    const employee = await ctx.db.get(args.employeeId);
    if (employee) {
      const user = await (ctx.db.query("users") as any)
        .withIndex("by_email", (q: any) =>
          q.eq("email", employee.personalInfo.email)
        )
        .first();

      if (user) {
        // If a user exists with this email, they have an account (regardless of organization)
        return { hasAccount: true, userId: user._id };
      }
    }

    return { hasAccount: false, userId: null };
  },
});

// Batch check which employees have user accounts
export const checkEmployeesUserAccounts = query({
  args: {
    employeeIds: v.array(v.id("employees")),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    // Get all userOrganizations for these employees in this organization
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter to only those with matching employeeIds
    const employeeUserMap = new Map<string, string>();
    userOrgs.forEach((userOrg: any) => {
      if (userOrg.employeeId && args.employeeIds.includes(userOrg.employeeId)) {
        employeeUserMap.set(userOrg.employeeId, userOrg.userId);
      }
    });

    // Also check by email for employees that don't have userOrg entries
    const employeesWithoutUserOrg = args.employeeIds.filter(
      (id) => !employeeUserMap.has(id)
    );

    const employees = await Promise.all(
      employeesWithoutUserOrg.map((id) => ctx.db.get(id))
    );

    const emailToEmployeeMap = new Map<string, string>();
    employees.forEach((emp: any) => {
      if (emp) {
        emailToEmployeeMap.set(emp.personalInfo.email, emp._id);
      }
    });

    // Check for users with matching emails
    if (emailToEmployeeMap.size > 0) {
      const emails = Array.from(emailToEmployeeMap.keys());
      for (const email of emails) {
        const user = await (ctx.db.query("users") as any)
          .withIndex("by_email", (q: any) => q.eq("email", email))
          .first();
        if (user) {
          const employeeId = emailToEmployeeMap.get(email);
          if (employeeId && !employeeUserMap.has(employeeId)) {
            employeeUserMap.set(employeeId, user._id);
          }
        }
      }
    }

    // Build result map
    const result: Record<string, boolean> = {};
    args.employeeIds.forEach((id) => {
      result[id] = employeeUserMap.has(id);
    });

    return result;
  },
});

// Create employee
export const createEmployee = mutation({
  args: {
    organizationId: v.id("organizations"),
    personalInfo: v.object({
      firstName: v.string(),
      lastName: v.string(),
      middleName: v.optional(v.string()),
      email: v.string(),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      dateOfBirth: v.optional(v.number()),
      civilStatus: v.optional(v.string()),
      emergencyContact: v.optional(
        v.object({
          name: v.string(),
          relationship: v.string(),
          phone: v.string(),
        })
      ),
    }),
    employment: v.object({
      employeeId: v.string(),
      position: v.string(),
      department: v.string(),
      employmentType: v.union(
        v.literal("regular"),
        v.literal("probationary"),
        v.literal("contractual"),
        v.literal("part-time")
      ),
      hireDate: v.number(),
      regularizationDate: v.optional(v.number()),
      status: v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("resigned"),
        v.literal("terminated")
      ),
    }),
    compensation: v.object({
      basicSalary: v.number(),
      allowance: v.optional(v.number()),
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly")
      ),
      bankDetails: v.optional(
        v.object({
          bankName: v.string(),
          accountNumber: v.string(),
          accountName: v.string(),
        })
      ),
      regularHolidayRate: v.optional(v.number()),
      specialHolidayRate: v.optional(v.number()),
      nightDiffPercent: v.optional(v.number()),
      overtimeRegularRate: v.optional(v.number()),
      overtimeRestDayRate: v.optional(v.number()),
      regularHolidayOtRate: v.optional(v.number()),
      specialHolidayOtRate: v.optional(v.number()),
    }),
    schedule: v.object({
      defaultSchedule: v.object({
        monday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        tuesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        wednesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        thursday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        friday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        saturday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        sunday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
      }),
      scheduleOverrides: v.optional(
        v.array(
          v.object({
            date: v.number(),
            in: v.string(),
            out: v.string(),
            reason: v.string(),
          })
        )
      ),
    }),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    // Get organization default requirements
    const organization = await ctx.db.get(args.organizationId);
    const defaultRequirements =
      organization?.defaultRequirements?.map((req: any) => ({
        type: req.type,
        status: "pending" as const,
        isDefault: true,
        isCustom: false,
      })) || [];

    const now = Date.now();

    // Get organization settings for default leave credits
    const settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .first();

    // Use settings leaveTypes if they exist, otherwise use defaults (same as getSettings query)
    const leaveTypes = settings?.leaveTypes || [
      {
        type: "vacation",
        name: "Vacation Leave",
        defaultCredits: 15,
        isPaid: true,
        requiresApproval: true,
        maxConsecutiveDays: 30,
        carryOver: true,
        maxCarryOver: 5,
      },
      {
        type: "sick",
        name: "Sick Leave",
        defaultCredits: 15,
        isPaid: true,
        requiresApproval: true,
        maxConsecutiveDays: 30,
        carryOver: true,
        maxCarryOver: 5,
      },
      {
        type: "emergency",
        name: "Emergency Leave",
        defaultCredits: 5,
        isPaid: true,
        requiresApproval: true,
        maxConsecutiveDays: 7,
        carryOver: false,
      },
    ];

    const vacationConfig = leaveTypes.find((t: any) => t.type === "vacation");
    const sickConfig = leaveTypes.find((t: any) => t.type === "sick");
    const hasAnniversaryType = leaveTypes.some(
      (t: any) => t.isAnniversary === true || t.type === "anniversary"
    );
    const proratedLeave = settings?.proratedLeave === true;
    const hireDate = args.employment.hireDate;

    // Use defaultCredits from organization settings; apply proration if enabled
    const vacationAnnual = vacationConfig?.defaultCredits ?? 15;
    const sickAnnual = sickConfig?.defaultCredits ?? 15;
    const vacationTotal = proratedLeave
      ? Math.round(
          calculateProratedLeave(vacationAnnual, hireDate, now) * 100
        ) / 100
      : vacationAnnual;
    const sickTotal = proratedLeave
      ? Math.round(calculateProratedLeave(sickAnnual, hireDate, now) * 100) /
        100
      : sickAnnual;

    const leaveCredits: any = {
      vacation: {
        total: vacationTotal,
        used: 0,
        balance: vacationTotal,
      },
      sick: { total: sickTotal, used: 0, balance: sickTotal },
    };
    if (hasAnniversaryType) {
      leaveCredits.custom = [
        { type: "anniversary", total: 0, used: 0, balance: 0 },
      ];
    }

    const insertedId = await ctx.db.insert("employees", {
      organizationId: args.organizationId,
      personalInfo: args.personalInfo,
      employment: args.employment,
      compensation: args.compensation,
      schedule: args.schedule,
      leaveCredits,
      requirements: defaultRequirements,
      deductions: [],
      incentives: [],
      createdAt: now,
      updatedAt: now,
    });

    // Auto-generate company employee ID from document id (last 6 chars)
    const companyEmployeeId = insertedId.slice(-6);
    await ctx.db.patch(insertedId, {
      employment: {
        ...args.employment,
        employeeId: companyEmployeeId,
      },
    });

    return insertedId;
  },
});

// Update employee
export const updateEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
    personalInfo: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        middleName: v.optional(v.string()),
        email: v.string(),
        phone: v.optional(v.string()),
        address: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),
        civilStatus: v.optional(v.string()),
        emergencyContact: v.optional(
          v.object({
            name: v.string(),
            relationship: v.string(),
            phone: v.string(),
          })
        ),
      })
    ),
    employment: v.optional(
      v.object({
        employeeId: v.string(),
        position: v.string(),
        department: v.string(),
        employmentType: v.union(
          v.literal("regular"),
          v.literal("probationary"),
          v.literal("contractual"),
          v.literal("part-time")
        ),
        hireDate: v.number(),
        regularizationDate: v.optional(v.number()),
        status: v.union(
          v.literal("active"),
          v.literal("inactive"),
          v.literal("resigned"),
          v.literal("terminated")
        ),
      })
    ),
    compensation: v.optional(
      v.object({
        basicSalary: v.number(),
        allowance: v.optional(v.number()),
        salaryType: v.union(
          v.literal("monthly"),
          v.literal("daily"),
          v.literal("hourly")
        ),
        bankDetails: v.optional(
          v.object({
            bankName: v.string(),
            accountNumber: v.string(),
            accountName: v.string(),
          })
        ),
        regularHolidayRate: v.optional(v.number()),
        specialHolidayRate: v.optional(v.number()),
        nightDiffPercent: v.optional(v.number()),
        overtimeRegularRate: v.optional(v.number()),
        overtimeRestDayRate: v.optional(v.number()),
        regularHolidayOtRate: v.optional(v.number()),
        specialHolidayOtRate: v.optional(v.number()),
      })
    ),
    schedule: v.optional(
      v.object({
        defaultSchedule: v.object({
          monday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          tuesday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          wednesday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          thursday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          friday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          saturday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
          sunday: v.object({
            in: v.string(),
            out: v.string(),
            isWorkday: v.boolean(),
          }),
        }),
        scheduleOverrides: v.optional(
          v.array(
            v.object({
              date: v.number(),
              in: v.string(),
              out: v.string(),
              reason: v.string(),
            })
          )
        ),
      })
    ),
    customFields: v.optional(v.any()), // Flexible object for custom fields
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
    if (args.personalInfo) updates.personalInfo = args.personalInfo;
    if (args.employment) updates.employment = args.employment;
    if (args.compensation) updates.compensation = args.compensation;
    if (args.schedule) updates.schedule = args.schedule;
    if (args.customFields !== undefined) {
      // Merge with existing customFields
      const existingCustomFields = (employee as any).customFields;
      updates.customFields = {
        ...(existingCustomFields || {}),
        ...args.customFields,
      };
    }

    await ctx.db.patch(args.employeeId, updates);
    return { success: true };
  },
});

// Update leave credits
export const updateLeaveCredits = mutation({
  args: {
    employeeId: v.id("employees"),
    leaveCredits: v.object({
      vacation: v.object({
        total: v.number(),
        used: v.number(),
        balance: v.number(),
      }),
      sick: v.object({
        total: v.number(),
        used: v.number(),
        balance: v.number(),
      }),
      custom: v.optional(
        v.array(
          v.object({
            type: v.string(),
            total: v.number(),
            used: v.number(),
            balance: v.number(),
          })
        )
      ),
    }),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    await ctx.db.patch(args.employeeId, {
      leaveCredits: args.leaveCredits,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add requirement document (custom requirement for specific employee)
export const addRequirement = mutation({
  args: {
    employeeId: v.id("employees"),
    requirement: v.object({
      type: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("submitted"),
        v.literal("verified")
      ),
      file: v.optional(v.id("_storage")),
      submittedDate: v.optional(v.number()),
      expiryDate: v.optional(v.number()),
      isCustom: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];
    requirements.push({
      ...args.requirement,
      isCustom: true, // Mark as custom requirement
    });

    await ctx.db.patch(args.employeeId, {
      requirements,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Remove requirement (only custom requirements can be removed)
export const removeRequirement = mutation({
  args: {
    employeeId: v.id("employees"),
    requirementIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];

    // Only allow removing custom requirements
    if (requirements[args.requirementIndex]?.isCustom) {
      requirements.splice(args.requirementIndex, 1);
      await ctx.db.patch(args.employeeId, {
        requirements,
        updatedAt: Date.now(),
      });
      return { success: true };
    } else {
      throw new Error(
        "Cannot remove default requirements. Disable them in organization settings instead."
      );
    }
  },
});

// Update requirement status
export const updateRequirementStatus = mutation({
  args: {
    employeeId: v.id("employees"),
    requirementIndex: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("submitted"),
      v.literal("verified")
    ),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];
    if (requirements[args.requirementIndex]) {
      requirements[args.requirementIndex].status = args.status;
      if (
        args.status === "submitted" &&
        !requirements[args.requirementIndex].submittedDate
      ) {
        requirements[args.requirementIndex].submittedDate = Date.now();
      }
    }

    await ctx.db.patch(args.employeeId, {
      requirements,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Set all requirements for an employee to complete (verified) or incomplete (pending)
export const setEmployeeRequirementsComplete = mutation({
  args: {
    employeeId: v.id("employees"),
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];
    const newStatus: "pending" | "verified" = args.complete
      ? "verified"
      : "pending";
    const updated = requirements.map((r) => ({ ...r, status: newStatus }));

    await ctx.db.patch(args.employeeId, {
      requirements: updated,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update requirement file (can be called by employee or HR)
export const updateRequirementFile = mutation({
  args: {
    employeeId: v.id("employees"),
    requirementIndex: v.number(),
    file: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId);

    // Employees can only update their own requirements
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const requirements = employee.requirements || [];
    if (requirements[args.requirementIndex]) {
      requirements[args.requirementIndex].file = args.file;
      if (!requirements[args.requirementIndex].submittedDate) {
        requirements[args.requirementIndex].submittedDate = Date.now();
      }
      // Auto-update status to submitted when file is uploaded
      if (requirements[args.requirementIndex].status === "pending") {
        requirements[args.requirementIndex].status = "submitted";
      }
    }

    await ctx.db.patch(args.employeeId, {
      requirements,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add deduction
export const addDeduction = mutation({
  args: {
    employeeId: v.id("employees"),
    deduction: v.object({
      id: v.string(),
      type: v.union(
        v.literal("government"),
        v.literal("loan"),
        v.literal("other")
      ),
      name: v.string(),
      amount: v.number(),
      frequency: v.union(v.literal("monthly"), v.literal("per-cutoff")),
      startDate: v.number(),
      endDate: v.optional(v.number()),
      isActive: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const deductions = employee.deductions || [];
    deductions.push(args.deduction);

    await ctx.db.patch(args.employeeId, {
      deductions,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add incentive
export const addIncentive = mutation({
  args: {
    employeeId: v.id("employees"),
    incentive: v.object({
      id: v.string(),
      name: v.string(),
      amount: v.number(),
      frequency: v.union(
        v.literal("monthly"),
        v.literal("quarterly"),
        v.literal("one-time")
      ),
      isActive: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const incentives = employee.incentives || [];
    incentives.push(args.incentive);

    await ctx.db.patch(args.employeeId, {
      incentives,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete employee
export const deleteEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    // Delete the employee record
    await ctx.db.delete(args.employeeId);

    return { success: true };
  },
});

// Migration: Remove paymentFrequency from all existing employee records
export const migrateRemovePaymentFrequency = mutation({
  args: {},
  handler: async (ctx) => {
    const employees = await ctx.db.query("employees").collect();

    for (const employee of employees) {
      if (employee.compensation.paymentFrequency !== undefined) {
        const { paymentFrequency, ...compensationWithoutPaymentFrequency } =
          employee.compensation;
        await ctx.db.patch(employee._id, {
          compensation: compensationWithoutPaymentFrequency as any,
          updatedAt: Date.now(),
        });
      }
    }

    return { migrated: employees.length };
  },
});
