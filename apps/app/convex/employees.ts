import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import {
  encryptCompensationForDb,
  decryptEmployeeFromDb,
} from "./employeeCompensationCrypto";
import { deriveAccessStatusForEmploymentStatus } from "@/utils/org-membership-lifecycle";
import { getEffectiveRequirementDefinitions } from "./organizationConfiguration";

function assertHireDateIsNotFuture(hireDate: number) {
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  if (hireDate > todayStart) {
    throw new Error("Hire date cannot be in the future");
  }
}

function buildRequirementFromDefault(req: any, now = Date.now()) {
  return {
    type: req.type,
    status: "pending" as const,
    isRequired: req.isRequired ?? true,
    appliesToDepartments: req.appliesToDepartments,
    appliesToEmploymentTypes: req.appliesToEmploymentTypes,
    reminderDaysBeforeDue: req.reminderDaysBeforeDue,
    requiresVerification: req.requiresVerification ?? true,
    expiryDate: req.expiryDaysAfterSubmission
      ? now + req.expiryDaysAfterSubmission * 24 * 60 * 60 * 1000
      : undefined,
    isDefault: true,
    isCustom: false,
  };
}

function toEmployeeDirectoryEntry(employee: any) {
  return {
    _id: employee._id,
    organizationId: employee.organizationId,
    personalInfo: {
      firstName: employee.personalInfo.firstName,
      lastName: employee.personalInfo.lastName,
      middleName: employee.personalInfo.middleName,
      email: employee.personalInfo.email,
    },
    employment: {
      employeeId: employee.employment.employeeId,
      position: employee.employment.position,
      department: employee.employment.department,
      employmentType: employee.employment.employmentType,
      hireDate: employee.employment.hireDate,
      status: employee.employment.status,
    },
  };
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function toManilaDayStartUtcMs(ts: number): number {
  const d = new Date(ts + MANILA_OFFSET_MS);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

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

  // HR routes: no access for accounting role (employees list is HR-only)
  if (userRole === "accounting") {
    throw new Error(
      "Not authorized - HR routes are not available for accounting role",
    );
  }

  // Owner has all admin privileges - treat owner the same as admin
  const isOwnerOrAdmin = userRole === "admin" || userRole === "owner";

  if (requiredRole) {
    if (
      userRole !== requiredRole &&
      !(requiredRole === "hr" && userRole === "manager") &&
      !isOwnerOrAdmin
    ) {
      throw new Error("Not authorized");
    }
  } else {
    // Read access: hr, admin, owner, employee (not accounting)
    if (
      !isOwnerOrAdmin &&
      userRole !== "hr" &&
      userRole !== "manager" &&
      userRole !== "employee"
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
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Filter by status ("all" means no status filter).
    if (args.status && args.status !== "all") {
      employees = employees.filter(
        (e: any) => e.employment.status === args.status,
      );
    }

    // Filter by department
    if (args.department) {
      employees = employees.filter(
        (e: any) => e.employment.department === args.department,
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
          e.employment.employeeId.toLowerCase().includes(searchLower),
      );
    }

    const statusRank: Record<string, number> = {
      active: 0,
      inactive: 1,
      resigned: 2,
      terminated: 3,
    };
    employees.sort((a: any, b: any) => {
      const statusDiff =
        (statusRank[a?.employment?.status] ?? 99) -
        (statusRank[b?.employment?.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      const aLast = (a?.personalInfo?.lastName ?? "").toLowerCase();
      const bLast = (b?.personalInfo?.lastName ?? "").toLowerCase();
      if (aLast !== bLast) return aLast.localeCompare(bLast);
      const aFirst = (a?.personalInfo?.firstName ?? "").toLowerCase();
      const bFirst = (b?.personalInfo?.firstName ?? "").toLowerCase();
      return aFirst.localeCompare(bFirst);
    });

    if (userRecord.role === "employee") {
      return employees.map(toEmployeeDirectoryEntry);
    }

    return employees.map((e: any) => decryptEmployeeFromDb(e));
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

    let userRecord;
    try {
      userRecord = await checkAuth(ctx, employee.organizationId);
    } catch (error: any) {
      if (
        error.message?.includes("Not authenticated") ||
        error.message?.includes("Unauthenticated") ||
        error.message?.includes("Not authorized") ||
        error.message?.includes("User is not a member") ||
        error.message?.includes("User record not found") ||
        error.message?.includes("Please complete your account setup")
      ) {
        return null;
      }
      throw error;
    }

    // Check authorization - employees can only view their own record unless admin/hr
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    return decryptEmployeeFromDb(employee);
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
        q.eq("organizationId", args.organizationId),
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
          q.eq("email", employee.personalInfo.email),
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
        q.eq("organizationId", args.organizationId),
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
      (id) => !employeeUserMap.has(id),
    );

    const employees = await Promise.all(
      employeesWithoutUserOrg.map((id) => ctx.db.get(id)),
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

/** True when this employee is linked as an org member (userOrganizations.employeeId in this org). */
export const checkEmployeesInOrganization = query({
  args: {
    employeeIds: v.array(v.id("employees")),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const inOrg = new Set<string>();
    const idSet = new Set(args.employeeIds.map((id) => id as string));
    for (const uo of userOrgs) {
      if (uo.employeeId && idSet.has(uo.employeeId as string)) {
        inOrg.add(uo.employeeId as string);
      }
    }

    const result: Record<string, boolean> = {};
    for (const id of args.employeeIds) {
      result[id as string] = inOrg.has(id as string);
    }
    return result;
  },
});

function normalizeInviteListEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Employees with a record in this org who are not org members yet (no linked membership, no member email match, no pending invite). */
export const listEmployeesAvailableForOrgInvite = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      const userRecord = await checkAuth(ctx, args.organizationId);
      const userRole = (userRecord as { role?: string }).role;
      const canInvite =
        userRole === "owner" || userRole === "admin" || userRole === "hr";
      if (!canInvite) {
        return [];
      }

      const employees = await (ctx.db.query("employees") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      const userOrgs = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      const linkedEmployeeIds = new Set<string>(
        userOrgs
          .map((uo: { employeeId?: string }) => uo.employeeId)
          .filter((id: string | undefined): id is string => !!id),
      );

      const memberEmails = new Set<string>();
      for (const uo of userOrgs) {
        const user = await ctx.db.get(uo.userId);
        if (user && (user as { email?: string }).email) {
          memberEmails.add(
            normalizeInviteListEmail(String((user as { email: string }).email)),
          );
        }
      }

      const invitations = await (ctx.db.query("invitations") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      const pendingInviteEmails = new Set<string>();
      for (const inv of invitations) {
        if (inv.status === "pending") {
          pendingInviteEmails.add(normalizeInviteListEmail(String(inv.email)));
        }
      }

      const out: {
        _id: string;
        firstName: string;
        lastName: string;
        middleName?: string;
        email: string;
      }[] = [];

      for (const raw of employees) {
        const e = decryptEmployeeFromDb(raw);
        const em = String(
          (e as { personalInfo?: { email?: string } }).personalInfo?.email ??
            "",
        ).trim();
        if (!em) continue;
        const emNorm = normalizeInviteListEmail(em);
        if (linkedEmployeeIds.has(e._id as string)) continue;
        if (memberEmails.has(emNorm)) continue;
        if (pendingInviteEmails.has(emNorm)) continue;
        out.push({
          _id: e._id as string,
          firstName: (e as { personalInfo: { firstName: string } }).personalInfo
            .firstName,
          lastName: (e as { personalInfo: { lastName: string } }).personalInfo
            .lastName,
          middleName: (e as { personalInfo: { middleName?: string } })
            .personalInfo.middleName,
          email: em,
        });
      }

      return out;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      if (
        msg.includes("Not authenticated") ||
        msg.includes("Unauthenticated") ||
        msg.includes("Not authorized") ||
        msg.includes("User is not a member")
      ) {
        return [];
      }
      throw error;
    }
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
      province: v.optional(v.string()),
      dateOfBirth: v.optional(v.number()),
      civilStatus: v.optional(v.string()),
      emergencyContact: v.optional(
        v.object({
          name: v.string(),
          relationship: v.string(),
          phone: v.string(),
        }),
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
        v.literal("part-time"),
      ),
      hireDate: v.number(),
      regularizationDate: v.optional(v.number()),
      separationDate: v.optional(v.number()),
      lastWorkingDay: v.optional(v.number()),
      separationReason: v.optional(v.string()),
      finalPayStatus: v.optional(
        v.union(
          v.literal("not_started"),
          v.literal("pending"),
          v.literal("processing"),
          v.literal("paid"),
          v.literal("not_applicable"),
        ),
      ),
      clearanceStatus: v.optional(
        v.union(
          v.literal("not_started"),
          v.literal("pending"),
          v.literal("cleared"),
          v.literal("waived"),
        ),
      ),
      status: v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("resigned"),
        v.literal("terminated"),
      ),
    }),
    compensation: v.object({
      basicSalary: v.number(),
      allowance: v.optional(v.number()),
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly"),
      ),
      bankDetails: v.optional(
        v.object({
          bankName: v.string(),
          accountNumber: v.string(),
          accountName: v.string(),
        }),
      ),
      regularHolidayRate: v.optional(v.number()),
      specialHolidayRate: v.optional(v.number()),
      nightDiffPercent: v.optional(v.number()),
      nightDiffOnOtRate: v.optional(v.number()),
      nightDiffRegularHolidayRate: v.optional(v.number()),
      nightDiffSpecialHolidayRate: v.optional(v.number()),
      nightDiffRegularHolidayOtRate: v.optional(v.number()),
      nightDiffSpecialHolidayOtRate: v.optional(v.number()),
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
          }),
        ),
      ),
    }),
    shiftId: v.optional(v.union(v.id("shifts"), v.null())),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    assertHireDateIsNotFuture(args.employment.hireDate);

    const now = Date.now();

    // Get organization default requirements
    const requirementDefinitions = await getEffectiveRequirementDefinitions(
      ctx,
      args.organizationId,
    );
    const defaultRequirements = requirementDefinitions.requirements.map(
      (requirement) => buildRequirementFromDefault(requirement, now),
    );

    const insertedId = await ctx.db.insert("employees", {
      organizationId: args.organizationId,
      personalInfo: args.personalInfo,
      employment: args.employment,
      compensation: encryptCompensationForDb(args.compensation) as any,
      schedule: args.schedule,
      shiftId: args.shiftId ?? null,
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

    await ctx.db.insert("employeeScheduleHistory", {
      organizationId: args.organizationId,
      employeeId: insertedId,
      effectiveFrom: toManilaDayStartUtcMs(args.employment.hireDate),
      schedule: args.schedule,
      shiftId: args.shiftId ?? null,
      createdAt: now,
      updatedAt: now,
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
        province: v.optional(v.string()),
        dateOfBirth: v.optional(v.number()),
        civilStatus: v.optional(v.string()),
        emergencyContact: v.optional(
          v.object({
            name: v.string(),
            relationship: v.string(),
            phone: v.string(),
          }),
        ),
      }),
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
          v.literal("part-time"),
        ),
        hireDate: v.number(),
        regularizationDate: v.optional(v.union(v.number(), v.null())),
        separationDate: v.optional(v.number()),
        lastWorkingDay: v.optional(v.number()),
        separationReason: v.optional(v.string()),
        finalPayStatus: v.optional(
          v.union(
            v.literal("not_started"),
            v.literal("pending"),
            v.literal("processing"),
            v.literal("paid"),
            v.literal("not_applicable"),
          ),
        ),
        clearanceStatus: v.optional(
          v.union(
            v.literal("not_started"),
            v.literal("pending"),
            v.literal("cleared"),
            v.literal("waived"),
          ),
        ),
        status: v.union(
          v.literal("active"),
          v.literal("inactive"),
          v.literal("resigned"),
          v.literal("terminated"),
        ),
      }),
    ),
    compensation: v.optional(
      v.object({
        basicSalary: v.number(),
        allowance: v.optional(v.number()),
        salaryType: v.union(
          v.literal("monthly"),
          v.literal("daily"),
          v.literal("hourly"),
        ),
        bankDetails: v.optional(
          v.object({
            bankName: v.string(),
            accountNumber: v.string(),
            accountName: v.string(),
          }),
        ),
        regularHolidayRate: v.optional(v.number()),
        specialHolidayRate: v.optional(v.number()),
        nightDiffPercent: v.optional(v.number()),
        nightDiffOnOtRate: v.optional(v.number()),
        nightDiffRegularHolidayRate: v.optional(v.number()),
        nightDiffSpecialHolidayRate: v.optional(v.number()),
        nightDiffRegularHolidayOtRate: v.optional(v.number()),
        nightDiffSpecialHolidayOtRate: v.optional(v.number()),
        overtimeRegularRate: v.optional(v.number()),
        overtimeRestDayRate: v.optional(v.number()),
        regularHolidayOtRate: v.optional(v.number()),
        specialHolidayOtRate: v.optional(v.number()),
      }),
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
            }),
          ),
        ),
      }),
    ),
    customFields: v.optional(v.any()), // Flexible object for custom fields
    shiftId: v.optional(v.union(v.id("shifts"), v.null())), // Optional shift (schedule + lunch); null = use defaultSchedule + org default lunch
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");
    if (args.employment?.hireDate !== undefined) {
      assertHireDateIsNotFuture(args.employment.hireDate);
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.personalInfo) {
      // If employee has a linked user account, email cannot be changed (auth is tied to it)
      const existingPersonal = (employee as any).personalInfo || {};
      let personalInfoUpdate = { ...existingPersonal, ...args.personalInfo };
      const canonicalMemberships = await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", employee.organizationId),
        )
        .filter((q) => q.eq(q.field("employeeId"), args.employeeId))
        .take(2);
      if (canonicalMemberships.length > 1) {
        throw new Error("Employee has multiple organization memberships");
      }
      let linkedUser = canonicalMemberships[0]
        ? await ctx.db.get(canonicalMemberships[0].userId)
        : null;
      if (!linkedUser && canonicalMemberships.length === 0) {
        const legacyUser = await ctx.db
          .query("users")
          .withIndex("by_employee", (q) =>
            q.eq("employeeId", args.employeeId),
          )
          .unique();
        if (legacyUser?.organizationId === employee.organizationId) {
          linkedUser = legacyUser;
        }
      }
      if (linkedUser) {
        const exactMembership = await ctx.db
          .query("userOrganizations")
          .withIndex("by_user_organization", (q) =>
            q
              .eq("userId", linkedUser._id)
              .eq("organizationId", employee.organizationId),
          )
          .unique();
        if (canonicalMemberships.length > 0 && !exactMembership) {
          throw new Error("Employee membership link is inconsistent");
        }
      }
      if (linkedUser) {
        personalInfoUpdate.email = existingPersonal.email;
      }
      updates.personalInfo = personalInfoUpdate;
    }
    if (args.employment) updates.employment = args.employment;
    if (args.compensation) {
      const currentComp = decryptEmployeeFromDb(employee).compensation;
      updates.compensation = encryptCompensationForDb({
        ...currentComp,
        ...args.compensation,
      }) as any;
    }
    if (args.schedule) updates.schedule = args.schedule;
    if (args.shiftId !== undefined) updates.shiftId = args.shiftId;
    if (args.customFields !== undefined) {
      // Merge with existing customFields
      const existingCustomFields = (employee as any).customFields;
      updates.customFields = {
        ...(existingCustomFields || {}),
        ...args.customFields,
      };
    }

    await ctx.db.patch(args.employeeId, updates);

    const normalizedCurrentShiftId = (employee as any).shiftId ?? null;
    const normalizedNextShiftId =
      args.shiftId !== undefined
        ? (args.shiftId ?? null)
        : normalizedCurrentShiftId;
    const nextSchedule = args.schedule ?? (employee as any).schedule;
    const scheduleChanged =
      args.schedule !== undefined &&
      JSON.stringify(args.schedule) !==
        JSON.stringify((employee as any).schedule);
    const shiftChanged =
      args.shiftId !== undefined &&
      normalizedNextShiftId !== normalizedCurrentShiftId;

    if ((scheduleChanged || shiftChanged) && nextSchedule) {
      const now = Date.now();
      const effectiveFrom = toManilaDayStartUtcMs(now);
      const existingTodayHistory = await (
        ctx.db.query("employeeScheduleHistory") as any
      )
        .withIndex("by_employee_effective_from", (q: any) =>
          q
            .eq("employeeId", args.employeeId)
            .eq("effectiveFrom", effectiveFrom),
        )
        .first();

      if (existingTodayHistory) {
        await ctx.db.patch(existingTodayHistory._id, {
          schedule: nextSchedule,
          shiftId: normalizedNextShiftId,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("employeeScheduleHistory", {
          organizationId: employee.organizationId,
          employeeId: args.employeeId,
          effectiveFrom,
          schedule: nextSchedule,
          shiftId: normalizedNextShiftId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Employment status is org-scoped. It changes access to this organization,
    // not the user's global Plinth account.
    if (args.employment?.status) {
      const newStatus = args.employment.status;
      let linkedMemberships = await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", employee.organizationId),
        )
        .filter((q) => q.eq(q.field("employeeId"), args.employeeId))
        .collect();

      if (linkedMemberships.length === 0) {
        let linkedUser = await ctx.db
          .query("users")
          .withIndex("by_employee", (query) =>
            query.eq("employeeId", args.employeeId),
          )
          .unique();

        if (!linkedUser) {
          linkedUser = await ctx.db
            .query("users")
            .withIndex("by_email", (query) =>
              query.eq("email", employee.personalInfo.email),
            )
            .unique();
        }

        if (linkedUser) {
          const membership = await ctx.db
            .query("userOrganizations")
            .withIndex("by_user_organization", (query) =>
              query
                .eq("userId", linkedUser._id)
                .eq("organizationId", employee.organizationId),
            )
            .unique();

          if (!membership) {
            throw new Error(
              "Employee account is not linked to this organization membership",
            );
          }
          linkedMemberships = [membership];
        }
      }

      if (linkedMemberships.length > 1) {
        throw new Error("Employee has multiple organization memberships");
      }

      const accessStatus = deriveAccessStatusForEmploymentStatus(newStatus);
      const now = Date.now();
      for (const membership of linkedMemberships) {
        if (membership.role === "owner" && accessStatus !== "active") {
          throw new Error(
            "Transfer organization ownership before separating this employee",
          );
        }
        await ctx.db.patch(membership._id, {
          employeeId: args.employeeId,
          accessStatus,
          accessUpdatedAt: now,
          accessUpdatedBy: userRecord._id,
          updatedAt: now,
        });
      }
    }

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
          }),
        ),
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
        v.literal("verified"),
      ),
      file: v.optional(v.id("_storage")),
      submittedDate: v.optional(v.number()),
      expiryDate: v.optional(v.number()),
      isRequired: v.optional(v.boolean()),
      appliesToDepartments: v.optional(v.array(v.string())),
      appliesToEmploymentTypes: v.optional(v.array(v.string())),
      reminderDaysBeforeDue: v.optional(v.number()),
      requiresVerification: v.optional(v.boolean()),
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
        "Cannot remove default requirements. Disable them in organization settings instead.",
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
      v.literal("verified"),
    ),
    verificationNotes: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];
    const now = Date.now();
    if (requirements[args.requirementIndex]) {
      const requirement = requirements[args.requirementIndex];
      requirement.status = args.status;
      if (args.status === "submitted" && !requirement.submittedDate) {
        requirement.submittedDate = now;
      }
      if (args.status === "verified") {
        requirement.verifiedAt = now;
        requirement.verifiedBy = userRecord._id;
        requirement.verificationNotes = args.verificationNotes;
        requirement.rejectedAt = undefined;
        requirement.rejectedBy = undefined;
        requirement.rejectionReason = undefined;
      }
      if (args.status === "pending" && requirement.file) {
        requirement.rejectedAt = now;
        requirement.rejectedBy = userRecord._id;
        requirement.rejectionReason = args.rejectionReason;
        requirement.verifiedAt = undefined;
        requirement.verifiedBy = undefined;
        requirement.verificationNotes = undefined;
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

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = employee.requirements || [];
    const newStatus: "pending" | "verified" = args.complete
      ? "verified"
      : "pending";
    const now = Date.now();
    const updated = requirements.map((r) => ({
      ...r,
      status: newStatus,
      verifiedAt: args.complete ? now : undefined,
      verifiedBy: args.complete ? userRecord._id : undefined,
      verificationNotes: args.complete ? r.verificationNotes : undefined,
      rejectedAt: args.complete ? undefined : r.rejectedAt,
      rejectedBy: args.complete ? undefined : r.rejectedBy,
      rejectionReason: args.complete ? undefined : r.rejectionReason,
    }));

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
      requirements[args.requirementIndex].verifiedAt = undefined;
      requirements[args.requirementIndex].verifiedBy = undefined;
      requirements[args.requirementIndex].verificationNotes = undefined;
      requirements[args.requirementIndex].rejectedAt = undefined;
      requirements[args.requirementIndex].rejectedBy = undefined;
      requirements[args.requirementIndex].rejectionReason = undefined;
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
        v.literal("other"),
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
        v.literal("one-time"),
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

// Archive employee and disable linked org access without deleting account/history.
export const deleteEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");
    const now = Date.now();

    const employment =
      employee.employment.status === "active"
        ? {
            ...employee.employment,
            status: "inactive" as const,
          }
        : employee.employment;

    await ctx.db.patch(args.employeeId, {
      employment,
      archivedAt: now,
      archivedBy: userRecord._id,
      updatedAt: now,
    } as any);

    const linkedMemberships = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId),
      )
      .filter((q: any) => q.eq(q.field("employeeId"), args.employeeId))
      .collect();

    for (const membership of linkedMemberships) {
      if (membership.role === "owner") continue;
      await ctx.db.patch(membership._id, {
        accessStatus: "disabled",
        accessUpdatedAt: now,
        accessUpdatedBy: userRecord._id,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Migration: Remove paymentFrequency from all existing employee records
export const migrateRemovePaymentFrequency = mutation({
  args: {},
  handler: async (ctx) => {
    const employees = await ctx.db.query("employees").collect();

    for (const employee of employees) {
      const dec = decryptEmployeeFromDb(employee);
      if (dec.compensation?.paymentFrequency !== undefined) {
        const { paymentFrequency, ...compensationWithoutPaymentFrequency } =
          dec.compensation;
        await ctx.db.patch(employee._id, {
          compensation: encryptCompensationForDb(
            compensationWithoutPaymentFrequency as any,
          ) as any,
          updatedAt: Date.now(),
        });
      }
    }

    return { migrated: employees.length };
  },
});
