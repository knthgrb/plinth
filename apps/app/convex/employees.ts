import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import {
  loadEffectiveEmployee,
  loadEffectiveEmployeeCustomFields,
  loadEffectiveEmployeeRequirements,
  type EmployeePaymentAccount,
  replaceEmployeeLeaveCredits,
  replaceEmployeeCustomFields,
  replaceEmployeePaymentAccount,
  replaceEmployeeRequirements,
  replaceEmployeeScheduleOverrides,
  upsertEmployeeDeduction,
  upsertEmployeeIncentive,
} from "./leaveEmployeeCompatibility";
import {
  encryptCompensationForDb,
  decryptEmployeeFromDb,
} from "./employeeCompensationCrypto";
import {
  deriveAccessStatusForEmployeeArchive,
  deriveAccessStatusForEmploymentStatus,
  normalizeOrgMembershipAccessStatus,
  resolveMembershipAccessStatusForEmployeeSync,
} from "@/utils/org-membership-lifecycle";
import {
  getEffectiveRequirementDefinitions,
  type RequirementConfigurationInput,
} from "./organizationConfiguration";
import {
  calculateSubmissionExpiry,
  filterApplicableRequirementPolicies,
} from "@/lib/requirements/workflow";
import { createEmployeeLinkedInvitation } from "./invitationCreation";
import {
  cancelPendingEmployeeInvitations,
  ensureEmployeeLifecycleBaseline,
  recordEmployeeLifecycleEvent,
} from "./employeeLifecycle";

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

type DefaultRequirement = RequirementConfigurationInput;

const customFieldPrimitive = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);
const customFieldValue = v.union(
  customFieldPrimitive,
  v.array(customFieldPrimitive),
  v.record(v.string(), customFieldPrimitive),
);

function buildRequirementFromDefault(req: DefaultRequirement) {
  return {
    type: req.type,
    status: "pending" as const,
    isRequired: req.isRequired ?? true,
    appliesToDepartments: req.appliesToDepartments,
    appliesToEmploymentTypes: req.appliesToEmploymentTypes,
    reminderDaysBeforeDue: req.reminderDaysBeforeDue,
    requiresVerification: req.requiresVerification ?? true,
    isDefault: true,
    isCustom: false,
  };
}

function toEmployeeDirectoryEntry(employee: Doc<"employees">) {
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getLinkedEmployeeMemberships(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<Doc<"userOrganizations">[]> {
  const memberships = await ctx.db
    .query("userOrganizations")
    .withIndex("by_organization_employee", (query) =>
      query.eq("organizationId", organizationId).eq("employeeId", employeeId),
    )
    .take(2);

  if (memberships.length > 1) {
    throw new Error("Employee has multiple organization memberships");
  }

  return memberships;
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
    } catch (error: unknown) {
      // Handle auth errors gracefully by returning empty array instead of throwing
      // This prevents errors during initial page load when there's a race condition:
      // - Next.js middleware checks cookies (server-side) → sees authenticated → allows access
      // - Convex queries use JWT tokens (client-side) → token might not be ready yet → throws "Not authenticated"
      // By returning empty array, the query succeeds and will retry once auth token is ready
      const message = getErrorMessage(error);
      if (
        message.includes("Not authenticated") ||
        message.includes("Unauthenticated") ||
        message.includes("Not authorized") ||
        message.includes("User is not a member")
      ) {
        return [];
      }
      throw error;
    }

    let employees = await ctx.db
      .query("employees")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Filter by status ("all" means no status filter).
    if (args.status && args.status !== "all") {
      employees = employees.filter(
        (employee) => employee.employment.status === args.status,
      );
    }

    // Filter by department
    if (args.department) {
      employees = employees.filter(
        (employee) => employee.employment.department === args.department,
      );
    }

    // Search filter
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      employees = employees.filter(
        (employee) =>
          employee.personalInfo.firstName.toLowerCase().includes(searchLower) ||
          employee.personalInfo.lastName.toLowerCase().includes(searchLower) ||
          employee.personalInfo.email.toLowerCase().includes(searchLower) ||
          employee.employment.employeeId.toLowerCase().includes(searchLower),
      );
    }

    const statusRank: Record<string, number> = {
      active: 0,
      resigned: 1,
      terminated: 2,
    };
    employees.sort((a, b) => {
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

    const effectiveEmployees = await Promise.all(
      employees.map((employee: Doc<"employees">) =>
        loadEffectiveEmployee(ctx, employee),
      ),
    );
    return effectiveEmployees.map(decryptEmployeeFromDb);
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
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (
        message.includes("Not authenticated") ||
        message.includes("Unauthenticated") ||
        message.includes("Not authorized") ||
        message.includes("User is not a member") ||
        message.includes("User record not found") ||
        message.includes("Please complete your account setup")
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

    return decryptEmployeeFromDb(await loadEffectiveEmployee(ctx, employee));
  },
});

export const getEmployeeLifecycleTimeline = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    const userRecord = await checkAuth(ctx, employee.organizationId);
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const events = await ctx.db
      .query("employeeLifecycleEvents")
      .withIndex("by_employee_effective_at", (query) =>
        query.eq("employeeId", args.employeeId),
      )
      .order("asc")
      .collect();

    if (events.length === 0) {
      const baseline: Array<{
        _id: string;
        type: "hired" | "resigned" | "terminated" | "rehired";
        effectiveAt: number;
        position: string;
        department: string;
        employmentType:
          | "regular"
          | "probationary"
          | "contractual"
          | "part-time";
        reason?: string;
        recordedBy: null;
        createdAt: number;
      }> = [
        {
          _id: `legacy-hired-${employee._id}`,
          type: "hired" as const,
          effectiveAt: employee.employment.hireDate,
          position: employee.employment.position,
          department: employee.employment.department,
          employmentType: employee.employment.employmentType,
          reason: undefined,
          recordedBy: null,
          createdAt: employee.createdAt,
        },
      ];
      if (
        employee.employment.status === "resigned" ||
        employee.employment.status === "terminated"
      ) {
        baseline.push({
          _id: `legacy-separated-${employee._id}`,
          type: employee.employment.status,
          effectiveAt:
            employee.employment.separationDate ??
            employee.employment.lastWorkingDay ??
            employee.updatedAt,
          position: employee.employment.position,
          department: employee.employment.department,
          employmentType: employee.employment.employmentType,
          reason: employee.employment.separationReason,
          recordedBy: null,
          createdAt: employee.updatedAt,
        });
      }
      return baseline;
    }

    return Promise.all(
      events.map(async (event) => {
        const actor = await ctx.db.get(event.recordedBy);
        return {
          ...event,
          recordedBy: actor
            ? { _id: actor._id, name: actor.name, email: actor.email }
            : null,
        };
      }),
    );
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
    const userOrg = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("employeeId"), args.employeeId))
      .first();

    if (userOrg) {
      return { hasAccount: true, userId: userOrg.userId };
    }

    // Also check if there's a user with this employee's email (regardless of organization)
    const employee = await ctx.db.get(args.employeeId);
    if (employee) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) =>
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
    const userOrgs = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Filter to only those with matching employeeIds
    const employeeUserMap = new Map<string, string>();
    userOrgs.forEach((userOrg) => {
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
    employees.forEach((emp) => {
      if (emp) {
        emailToEmployeeMap.set(emp.personalInfo.email, emp._id);
      }
    });

    // Check for users with matching emails
    if (emailToEmployeeMap.size > 0) {
      const emails = Array.from(emailToEmployeeMap.keys());
      for (const email of emails) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
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

    const userOrgs = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
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

      const employees = await ctx.db
        .query("employees")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      const userOrgs = await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (q) =>
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

      const invitations = await ctx.db
        .query("invitations")
        .withIndex("by_organization", (q) =>
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
        if (e.archivedAt !== undefined || e.employment.status !== "active") {
          continue;
        }
        const em = String(e.personalInfo.email ?? "").trim();
        if (!em) continue;
        const emNorm = normalizeInviteListEmail(em);
        if (linkedEmployeeIds.has(e._id as string)) continue;
        if (memberEmails.has(emNorm)) continue;
        if (pendingInviteEmails.has(emNorm)) continue;
        out.push({
          _id: e._id as string,
          firstName: e.personalInfo.firstName,
          lastName: e.personalInfo.lastName,
          middleName: e.personalInfo.middleName,
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

export const getAvailableOrganizationMembers = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");
    const memberships = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .collect();
    const availableMemberships = memberships.filter(
      (membership) =>
        normalizeOrgMembershipAccessStatus(membership.accessStatus) ===
          "active" && membership.employeeId === undefined,
    );
    const members = await Promise.all(
      availableMemberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        if (!user?.email) return null;
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
        };
      }),
    );
    return members.filter((member) => member !== null);
  },
});

// Create employee
export const createEmployee = mutation({
  args: {
    organizationId: v.id("organizations"),
    accountAccess: v.optional(
      v.union(
        v.object({ kind: v.literal("employee_only") }),
        v.object({
          kind: v.literal("link_member"),
          userId: v.id("users"),
        }),
        v.object({
          kind: v.literal("invite_member"),
          email: v.string(),
        }),
      ),
    ),
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
      status: v.literal("active"),
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
    const accountAccess = args.accountAccess ?? {
      kind: "employee_only" as const,
    };
    let membershipToLink: Doc<"userOrganizations"> | null = null;
    let personalInfo = args.personalInfo;

    if (accountAccess.kind === "link_member") {
      membershipToLink = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (query) =>
          query
            .eq("userId", accountAccess.userId)
            .eq("organizationId", args.organizationId),
        )
        .unique();
      if (
        !membershipToLink ||
        membershipToLink.employeeId ||
        membershipToLink.accessStatus === "alumni" ||
        membershipToLink.accessStatus === "removed" ||
        membershipToLink.accessStatus === "disabled" ||
        membershipToLink.accessStatus === "suspended"
      ) {
        throw new Error("Selected organization member is not available");
      }
      const linkedUser = await ctx.db.get(accountAccess.userId);
      if (!linkedUser?.email) {
        throw new Error("Selected organization member has no account email");
      }
      personalInfo = { ...args.personalInfo, email: linkedUser.email };
    } else if (accountAccess.kind === "invite_member") {
      personalInfo = {
        ...args.personalInfo,
        email: accountAccess.email.trim(),
      };
    }

    // Get organization default requirements
    const requirementDefinitions = await getEffectiveRequirementDefinitions(
      ctx,
      args.organizationId,
    );
    const defaultRequirements = filterApplicableRequirementPolicies(
      requirementDefinitions.requirements,
      args.employment,
    ).map(buildRequirementFromDefault);

    const { bankDetails: ignoredBankDetails, ...canonicalCompensation } =
      args.compensation;
    const { scheduleOverrides: ignoredOverrides, ...canonicalSchedule } =
      args.schedule;
    void ignoredBankDetails;
    void ignoredOverrides;
    const insertedId = await ctx.db.insert("employees", {
      organizationId: args.organizationId,
      personalInfo,
      employment: args.employment,
      compensation: encryptCompensationForDb(
        canonicalCompensation,
      ) as Doc<"employees">["compensation"],
      schedule: canonicalSchedule,
      shiftId: args.shiftId ?? null,
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
      schedule: canonicalSchedule,
      shiftId: args.shiftId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const insertedEmployee = await ctx.db.get(insertedId);
    if (!insertedEmployee) throw new Error("Employee creation did not persist");
    await Promise.all([
      replaceEmployeeRequirements(
        ctx,
        insertedEmployee,
        defaultRequirements,
        now,
      ),
      replaceEmployeeScheduleOverrides(
        ctx,
        insertedEmployee,
        args.schedule.scheduleOverrides ?? [],
        now,
      ),
      replaceEmployeePaymentAccount(
        ctx,
        insertedEmployee,
        args.compensation.bankDetails,
        now,
      ),
    ]);

    if (membershipToLink) {
      await ctx.db.patch(membershipToLink._id, {
        employeeId: insertedId,
        updatedAt: now,
      });
    }

    await recordEmployeeLifecycleEvent(ctx, {
      organizationId: args.organizationId,
      employeeId: insertedId,
      type: "hired",
      effectiveAt: args.employment.hireDate,
      employment: args.employment,
      recordedBy: userRecord._id,
      createdAt: now,
    });

    const invitation =
      accountAccess.kind === "invite_member"
        ? await createEmployeeLinkedInvitation(ctx, {
            organizationId: args.organizationId,
            employeeId: insertedId,
            email: accountAccess.email,
            invitedBy: userRecord._id,
            inviteeName: [
              personalInfo.firstName,
              personalInfo.middleName,
              personalInfo.lastName,
            ]
              .filter(Boolean)
              .join(" "),
          })
        : null;

    return {
      employeeId: insertedId,
      invitationId: invitation?.invitationId,
      invitationEmail: invitation?.email,
      invitationToken: invitation?.token,
    };
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
    customFields: v.optional(v.record(v.string(), customFieldValue)),
    shiftId: v.optional(v.union(v.id("shifts"), v.null())), // Optional shift (schedule + lunch); null = use defaultSchedule + org default lunch
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");
    if (args.employment?.hireDate !== undefined) {
      assertHireDateIsNotFuture(args.employment.hireDate);
    }
    if (
      employee.employment.status !== "active" &&
      args.employment?.status === "active"
    ) {
      throw new Error("Use Rehire Employee to restore an alumni employee");
    }
    if (
      employee.employment.status !== "active" &&
      args.employment?.status !== undefined &&
      args.employment.status !== employee.employment.status
    ) {
      throw new Error(
        "A separated employee status cannot be changed through generic editing",
      );
    }
    if (
      args.employment &&
      (args.employment.status === "resigned" ||
        args.employment.status === "terminated")
    ) {
      if (args.employment.hireDate !== employee.employment.hireDate) {
        throw new Error("Hire date cannot be changed during separation");
      }
      const effectiveAt =
        args.employment.separationDate ??
        args.employment.lastWorkingDay ??
        Date.now();
      if (effectiveAt < employee.employment.hireDate) {
        throw new Error(
          "Separation date must be on or after the current hire date",
        );
      }
    }

    const updates: Partial<Doc<"employees">> = { updatedAt: Date.now() };
    let nextBankDetails: EmployeePaymentAccount | undefined;
    if (args.personalInfo) {
      // If employee has a linked user account, email cannot be changed (auth is tied to it)
      const existingPersonal = employee.personalInfo;
      const personalInfoUpdate = { ...existingPersonal, ...args.personalInfo };
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
      const linkedUser = canonicalMemberships[0]
        ? await ctx.db.get(canonicalMemberships[0].userId)
        : null;
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
      const nextCompensation = {
        ...currentComp,
        ...args.compensation,
      } as typeof currentComp & {
        bankDetails?: EmployeePaymentAccount;
        paymentFrequency?: string;
      };
      nextBankDetails = nextCompensation.bankDetails;
      const {
        bankDetails: ignoredBankDetails,
        paymentFrequency: ignoredPaymentFrequency,
        ...canonicalCompensation
      } = nextCompensation;
      void ignoredBankDetails;
      void ignoredPaymentFrequency;
      updates.compensation = encryptCompensationForDb(
        canonicalCompensation,
      ) as Doc<"employees">["compensation"];
    }
    if (args.schedule) {
      const { scheduleOverrides: ignoredOverrides, ...canonicalSchedule } =
        args.schedule;
      void ignoredOverrides;
      updates.schedule = canonicalSchedule;
    }
    if (args.shiftId !== undefined) updates.shiftId = args.shiftId;
    let nextCustomFields: Record<string, unknown> | undefined;
    if (args.customFields !== undefined) {
      // Merge with existing customFields
      const existingCustomFields = await loadEffectiveEmployeeCustomFields(
        ctx,
        employee,
      );
      nextCustomFields = {
        ...(existingCustomFields || {}),
        ...args.customFields,
      };
    }

    await ctx.db.patch(args.employeeId, updates);
    const compatibilityNow = Date.now();
    if (args.employment) {
      const [definitions, currentRequirements] = await Promise.all([
        getEffectiveRequirementDefinitions(ctx, employee.organizationId),
        loadEffectiveEmployeeRequirements(ctx, employee),
      ]);
      const existingDefaultTypes = new Set(
        currentRequirements
          .filter((requirement) => requirement.isDefault)
          .map((requirement) => requirement.type.trim().toLocaleLowerCase()),
      );
      const newlyApplicable = filterApplicableRequirementPolicies(
        definitions.requirements,
        args.employment,
      )
        .filter(
          (definition) =>
            !existingDefaultTypes.has(
              definition.type.trim().toLocaleLowerCase(),
            ),
        )
        .map(buildRequirementFromDefault);
      if (newlyApplicable.length > 0) {
        await replaceEmployeeRequirements(
          ctx,
          employee,
          [...currentRequirements, ...newlyApplicable],
          compatibilityNow,
        );
      }
    }
    if (args.schedule) {
      await replaceEmployeeScheduleOverrides(
        ctx,
        employee,
        args.schedule.scheduleOverrides ?? [],
        compatibilityNow,
      );
    }
    if (args.compensation) {
      await replaceEmployeePaymentAccount(
        ctx,
        employee,
        nextBankDetails,
        compatibilityNow,
      );
    }
    if (nextCustomFields) {
      await replaceEmployeeCustomFields(
        ctx,
        employee,
        nextCustomFields,
        compatibilityNow,
      );
    }

    const normalizedCurrentShiftId = employee.shiftId ?? null;
    const normalizedNextShiftId =
      args.shiftId !== undefined
        ? (args.shiftId ?? null)
        : normalizedCurrentShiftId;
    const nextSchedule = args.schedule ?? employee.schedule;
    const scheduleChanged =
      args.schedule !== undefined &&
      JSON.stringify(args.schedule) !== JSON.stringify(employee.schedule);
    const shiftChanged =
      args.shiftId !== undefined &&
      normalizedNextShiftId !== normalizedCurrentShiftId;

    if ((scheduleChanged || shiftChanged) && nextSchedule) {
      const now = Date.now();
      const effectiveFrom = toManilaDayStartUtcMs(now);
      const existingTodayHistory = await ctx.db
        .query("employeeScheduleHistory")
        .withIndex("by_employee_effective_from", (q) =>
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
      const isNewSeparation =
        employee.employment.status === "active" &&
        (newStatus === "resigned" || newStatus === "terminated");
      const linkedMemberships = await getLinkedEmployeeMemberships(
        ctx,
        employee.organizationId,
        args.employeeId,
      );

      const derivedAccessStatus =
        employee.archivedAt !== undefined
          ? deriveAccessStatusForEmployeeArchive(newStatus)
          : deriveAccessStatusForEmploymentStatus(newStatus);
      const now = Date.now();
      for (const membership of linkedMemberships) {
        const accessStatus = resolveMembershipAccessStatusForEmployeeSync(
          membership.accessStatus,
          derivedAccessStatus,
        );
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

      if (newStatus === "resigned" || newStatus === "terminated") {
        if (isNewSeparation) {
          await ensureEmployeeLifecycleBaseline(ctx, employee, userRecord._id);
          await recordEmployeeLifecycleEvent(ctx, {
            organizationId: employee.organizationId,
            employeeId: args.employeeId,
            type: newStatus,
            effectiveAt:
              args.employment.separationDate ??
              args.employment.lastWorkingDay ??
              now,
            employment: args.employment,
            reason: args.employment.separationReason,
            recordedBy: userRecord._id,
            createdAt: now,
          });
        }
        await cancelPendingEmployeeInvitations(
          ctx,
          employee.organizationId,
          args.employeeId,
        );
      }
    }

    return { success: true };
  },
});

export const rehireEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
    hireDate: v.number(),
    position: v.string(),
    department: v.string(),
    employmentType: v.union(
      v.literal("regular"),
      v.literal("probationary"),
      v.literal("contractual"),
      v.literal("part-time"),
    ),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    if (employee.employment.status === "active") {
      throw new Error("Employee is already active");
    }

    const userRecord = await checkAuth(ctx, employee.organizationId, "hr");
    assertHireDateIsNotFuture(args.hireDate);
    const lifecycleEvents = await ctx.db
      .query("employeeLifecycleEvents")
      .withIndex("by_employee_effective_at", (query) =>
        query.eq("employeeId", employee._id),
      )
      .collect();
    const latestSeparationAt = Math.max(
      employee.employment.separationDate ??
        employee.employment.lastWorkingDay ??
        employee.updatedAt,
      ...lifecycleEvents
        .filter(
          (event) => event.type === "resigned" || event.type === "terminated",
        )
        .map((event) => event.effectiveAt),
    );
    if (args.hireDate <= latestSeparationAt) {
      throw new Error("Rehire date must be after the latest separation date");
    }
    const linkedMemberships = await getLinkedEmployeeMemberships(
      ctx,
      employee.organizationId,
      employee._id,
    );
    if (linkedMemberships.length > 1) {
      throw new Error("Employee has multiple organization memberships");
    }
    const membership = linkedMemberships[0];
    if (
      membership &&
      normalizeOrgMembershipAccessStatus(membership.accessStatus) !== "alumni"
    ) {
      throw new Error("Rehire requires an existing alumni membership");
    }

    await ensureEmployeeLifecycleBaseline(ctx, employee, userRecord._id);
    const {
      separationDate: ignoredSeparationDate,
      lastWorkingDay: ignoredLastWorkingDay,
      separationReason: ignoredSeparationReason,
      ...retainedEmployment
    } = employee.employment;
    void ignoredSeparationDate;
    void ignoredLastWorkingDay;
    void ignoredSeparationReason;

    const nextEmployment: Doc<"employees">["employment"] = {
      ...retainedEmployment,
      hireDate: args.hireDate,
      position: args.position,
      department: args.department,
      employmentType: args.employmentType,
      status: "active",
      finalPayStatus: "not_started",
      clearanceStatus: "not_started",
    };
    const now = Date.now();

    await ctx.db.patch(employee._id, {
      employment: nextEmployment,
      archivedAt: undefined,
      archivedBy: undefined,
      updatedAt: now,
    });
    if (membership) {
      await ctx.db.patch(membership._id, {
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: userRecord._id,
        updatedAt: now,
      });
    }
    await recordEmployeeLifecycleEvent(ctx, {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      type: "rehired",
      effectiveAt: args.hireDate,
      employment: nextEmployment,
      recordedBy: userRecord._id,
      createdAt: now,
    });

    return { success: true, membershipReactivated: membership !== undefined };
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

    await checkAuth(ctx, employee.organizationId, "hr");
    const now = Date.now();

    await replaceEmployeeLeaveCredits(ctx, employee, args.leaveCredits, now);

    await ctx.db.patch(args.employeeId, { updatedAt: now });

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

    await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = await loadEffectiveEmployeeRequirements(ctx, employee);
    const normalizedType = args.requirement.type.trim().toLocaleLowerCase();
    if (!normalizedType) throw new Error("Requirement type is required");
    if (
      requirements.some(
        (requirement) =>
          requirement.type.trim().toLocaleLowerCase() === normalizedType,
      )
    ) {
      throw new Error("This employee already has that requirement");
    }
    requirements.push({
      ...args.requirement,
      type: args.requirement.type.trim(),
      isCustom: true, // Mark as custom requirement
    });

    const now = Date.now();
    await replaceEmployeeRequirements(ctx, employee, requirements, now);
    await ctx.db.patch(args.employeeId, { updatedAt: now });

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

    await checkAuth(ctx, employee.organizationId, "hr");

    const requirements = await loadEffectiveEmployeeRequirements(ctx, employee);

    const requirement = requirements[args.requirementIndex];
    if (!requirement) throw new Error("Requirement not found");
    if (requirement.isCustom) {
      requirements.splice(args.requirementIndex, 1);
      const now = Date.now();
      await replaceEmployeeRequirements(ctx, employee, requirements, now);
      await ctx.db.patch(args.employeeId, { updatedAt: now });
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

    const requirements = await loadEffectiveEmployeeRequirements(ctx, employee);
    const now = Date.now();
    const requirement = requirements[args.requirementIndex];
    if (!requirement) throw new Error("Requirement not found");
    if (
      (args.status === "submitted" || args.status === "verified") &&
      !requirement.file
    ) {
      throw new Error("Upload evidence before submitting this requirement");
    }
    if (
      args.status === "pending" &&
      requirement.file &&
      !args.rejectionReason?.trim()
    ) {
      throw new Error("A rejection reason is required");
    }
    requirement.status = args.status;
    if (args.status === "submitted" && !requirement.submittedDate) {
      requirement.submittedDate = now;
    }
    if (args.status === "verified") {
      requirement.verifiedAt = now;
      requirement.verifiedBy = userRecord._id;
      requirement.verificationNotes =
        args.verificationNotes?.trim() || undefined;
      requirement.rejectedAt = undefined;
      requirement.rejectedBy = undefined;
      requirement.rejectionReason = undefined;
    }
    if (args.status === "pending" && requirement.file) {
      requirement.rejectedAt = now;
      requirement.rejectedBy = userRecord._id;
      requirement.rejectionReason = args.rejectionReason?.trim();
      requirement.verifiedAt = undefined;
      requirement.verifiedBy = undefined;
      requirement.verificationNotes = undefined;
    }

    await replaceEmployeeRequirements(ctx, employee, requirements, now);
    await ctx.db.patch(args.employeeId, { updatedAt: now });

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

    const requirements = await loadEffectiveEmployeeRequirements(ctx, employee);
    const newStatus: "pending" | "verified" = args.complete
      ? "verified"
      : "pending";
    const now = Date.now();
    if (
      args.complete &&
      requirements.some(
        (requirement) => requirement.isRequired !== false && !requirement.file,
      )
    ) {
      throw new Error("Every required item needs evidence before completion");
    }
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

    await replaceEmployeeRequirements(ctx, employee, updated, now);
    await ctx.db.patch(args.employeeId, { updatedAt: now });

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

    const requirements = await loadEffectiveEmployeeRequirements(ctx, employee);
    const requirement = requirements[args.requirementIndex];
    if (!requirement) throw new Error("Requirement not found");
    const submittedAt = Date.now();
    const definitions = await getEffectiveRequirementDefinitions(
      ctx,
      employee.organizationId,
    );
    const definition = definitions.requirements.find(
      (candidate) =>
        candidate.type.trim().toLocaleLowerCase() ===
        requirement.type.trim().toLocaleLowerCase(),
    );
    requirement.file = args.file;
    requirement.submittedDate = submittedAt;
    requirement.expiryDate = definition
      ? calculateSubmissionExpiry(definition, submittedAt)
      : requirement.expiryDate;
    requirement.status =
      requirement.requiresVerification === false ? "verified" : "submitted";
    requirement.verifiedAt =
      requirement.requiresVerification === false ? submittedAt : undefined;
    requirement.verifiedBy =
      requirement.requiresVerification === false ? userRecord._id : undefined;
    requirement.verificationNotes = undefined;
    requirement.rejectedAt = undefined;
    requirement.rejectedBy = undefined;
    requirement.rejectionReason = undefined;

    const now = Date.now();
    await replaceEmployeeRequirements(ctx, employee, requirements, now);
    await ctx.db.patch(args.employeeId, { updatedAt: now });

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

    await checkAuth(ctx, employee.organizationId, "hr");

    const now = Date.now();
    await upsertEmployeeDeduction(ctx, employee, args.deduction, now);

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

    await checkAuth(ctx, employee.organizationId, "hr");

    const now = Date.now();
    await upsertEmployeeIncentive(ctx, employee, args.incentive, now);

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

    if (employee.employment.status === "active") {
      throw new Error("Separate the employee before archiving their record");
    }

    const employment = employee.employment;

    await ctx.db.patch(args.employeeId, {
      employment,
      archivedAt: now,
      archivedBy: userRecord._id,
      updatedAt: now,
    });

    const linkedMemberships = await getLinkedEmployeeMemberships(
      ctx,
      employee.organizationId,
      args.employeeId,
    );
    const derivedAccessStatus = deriveAccessStatusForEmployeeArchive(
      employment.status,
    );

    for (const membership of linkedMemberships) {
      const accessStatus = resolveMembershipAccessStatusForEmployeeSync(
        membership.accessStatus,
        derivedAccessStatus,
      );
      if (membership.role === "owner") {
        throw new Error(
          "Transfer organization ownership before archiving this employee",
        );
      }
      await ctx.db.patch(membership._id, {
        accessStatus,
        accessUpdatedAt: now,
        accessUpdatedBy: userRecord._id,
        updatedAt: now,
      });
    }

    await cancelPendingEmployeeInvitations(
      ctx,
      employee.organizationId,
      args.employeeId,
    );

    return { success: true };
  },
});
