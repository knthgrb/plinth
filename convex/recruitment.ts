import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { calculateTotalLeaveEntitlement } from "./leaveCalculations";

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

// Get job postings
export const getJobs = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("on-hold"))
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    let jobs = await (ctx.db.query("jobs") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (args.status) {
      jobs = jobs.filter((j: any) => j.status === args.status);
    }

    jobs.sort((a: any, b: any) => b.postedDate - a.postedDate);
    return jobs;
  },
});

// Get single job
export const getJob = query({
  args: {
    jobId: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    const userRecord = await checkAuth(ctx, job.organizationId);

    return job;
  },
});

// Create job posting
export const createJob = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.optional(v.string()),
    department: v.optional(v.string()),
    position: v.optional(v.string()),
    employmentType: v.optional(v.string()),
    numberOfOpenings: v.optional(v.number()),
    description: v.optional(v.string()),
    requirements: v.optional(v.array(v.string())),
    qualifications: v.optional(v.array(v.string())),
    salaryRange: v.optional(
      v.object({
        min: v.number(),
        max: v.number(),
      })
    ),
    closingDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      organizationId: args.organizationId,
      title: args.title || "",
      department: args.department || "",
      position: args.position || "",
      employmentType: args.employmentType || "",
      numberOfOpenings: args.numberOfOpenings || 1,
      description: args.description || "",
      requirements: args.requirements || [],
      qualifications: args.qualifications || [],
      salaryRange: args.salaryRange,
      status: "open",
      postedDate: now,
      closingDate: args.closingDate,
      createdAt: now,
      updatedAt: now,
    });

    return jobId;
  },
});

// Update job
export const updateJob = mutation({
  args: {
    jobId: v.id("jobs"),
    title: v.optional(v.string()),
    department: v.optional(v.string()),
    position: v.optional(v.string()),
    employmentType: v.optional(v.string()),
    numberOfOpenings: v.optional(v.number()),
    description: v.optional(v.string()),
    requirements: v.optional(v.array(v.string())),
    qualifications: v.optional(v.array(v.string())),
    salaryRange: v.optional(
      v.object({
        min: v.number(),
        max: v.number(),
      })
    ),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("on-hold"))
    ),
    closingDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    const userRecord = await checkAuth(ctx, job.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.department !== undefined) updates.department = args.department;
    if (args.position !== undefined) updates.position = args.position;
    if (args.employmentType !== undefined)
      updates.employmentType = args.employmentType;
    if (args.numberOfOpenings !== undefined)
      updates.numberOfOpenings = args.numberOfOpenings;
    if (args.description !== undefined) updates.description = args.description;
    if (args.requirements !== undefined)
      updates.requirements = args.requirements;
    if (args.qualifications !== undefined)
      updates.qualifications = args.qualifications;
    if (args.salaryRange !== undefined) updates.salaryRange = args.salaryRange;
    if (args.status !== undefined) updates.status = args.status;
    if (args.closingDate !== undefined) updates.closingDate = args.closingDate;

    await ctx.db.patch(args.jobId, updates);
    return { success: true };
  },
});

// Delete job
export const deleteJob = mutation({
  args: {
    jobId: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    const userRecord = await checkAuth(ctx, job.organizationId, "hr");

    await ctx.db.delete(args.jobId);
    return { success: true };
  },
});

// Get applicants
export const getApplicants = query({
  args: {
    jobId: v.optional(v.id("jobs")),
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("new"),
        v.literal("screening"),
        v.literal("interview"),
        v.literal("assessment"),
        v.literal("offer"),
        v.literal("hired"),
        v.literal("rejected")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let applicants = await (ctx.db.query("applicants") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (args.jobId) {
      applicants = applicants.filter((a: any) => a.jobId === args.jobId);
    }

    if (args.status) {
      applicants = applicants.filter((a: any) => a.status === args.status);
    }

    applicants.sort((a: any, b: any) => b.appliedDate - a.appliedDate);
    return applicants;
  },
});

// Get single applicant
export const getApplicant = query({
  args: {
    applicantId: v.id("applicants"),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    return applicant;
  },
});

// Create applicant
export const createApplicant = mutation({
  args: {
    organizationId: v.id("organizations"),
    jobId: v.id("jobs"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    resume: v.id("_storage"),
    coverLetter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Public endpoint - no auth required for job applications
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    if (job.organizationId !== args.organizationId) {
      throw new Error("Invalid job");
    }

    if (job.status !== "open") {
      throw new Error("Job posting is closed");
    }

    const now = Date.now();
    const applicantId = await ctx.db.insert("applicants", {
      organizationId: args.organizationId,
      jobId: args.jobId,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      resume: args.resume,
      coverLetter: args.coverLetter,
      status: "new",
      appliedDate: now,
      createdAt: now,
      updatedAt: now,
    });

    return applicantId;
  },
});

// Create applicant (HR/Admin only - can add to any job status)
export const createApplicantByHR = mutation({
  args: {
    organizationId: v.id("organizations"),
    jobId: v.id("jobs"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    resume: v.id("_storage"),
    coverLetter: v.optional(v.string()),
    googleMeetLink: v.optional(v.string()),
    interviewVideoLink: v.optional(v.string()),
    portfolioLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    if (job.organizationId !== args.organizationId) {
      throw new Error("Invalid job");
    }

    // HR/Admin can add applicants to any job status
    const now = Date.now();
    const applicantId = await ctx.db.insert("applicants", {
      organizationId: args.organizationId,
      jobId: args.jobId,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      resume: args.resume,
      coverLetter: args.coverLetter,
      googleMeetLink: args.googleMeetLink,
      interviewVideoLink: args.interviewVideoLink,
      portfolioLink: args.portfolioLink,
      status: "new",
      appliedDate: now,
      createdAt: now,
      updatedAt: now,
    });

    return applicantId;
  },
});

// Update applicant
export const updateApplicant = mutation({
  args: {
    applicantId: v.id("applicants"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    resume: v.optional(v.id("_storage")),
    coverLetter: v.optional(v.string()),
    googleMeetLink: v.optional(v.string()),
    interviewVideoLink: v.optional(v.string()),
    portfolioLink: v.optional(v.string()),
    customFields: v.optional(v.any()), // Flexible object for custom fields
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
    if (args.firstName !== undefined) updates.firstName = args.firstName;
    if (args.lastName !== undefined) updates.lastName = args.lastName;
    if (args.email !== undefined) updates.email = args.email;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.resume !== undefined) updates.resume = args.resume;
    if (args.coverLetter !== undefined) updates.coverLetter = args.coverLetter;
    if (args.googleMeetLink !== undefined)
      updates.googleMeetLink = args.googleMeetLink;
    if (args.interviewVideoLink !== undefined)
      updates.interviewVideoLink = args.interviewVideoLink;
    if (args.portfolioLink !== undefined)
      updates.portfolioLink = args.portfolioLink;
    if (args.customFields !== undefined) {
      // Merge with existing customFields
      updates.customFields = {
        ...(applicant.customFields || {}),
        ...args.customFields,
      };
    }

    await ctx.db.patch(args.applicantId, updates);

    return { success: true };
  },
});

// Update applicant status
export const updateApplicantStatus = mutation({
  args: {
    applicantId: v.id("applicants"),
    status: v.union(
      v.literal("new"),
      v.literal("screening"),
      v.literal("interview"),
      v.literal("assessment"),
      v.literal("offer"),
      v.literal("hired"),
      v.literal("rejected")
    ),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    await ctx.db.patch(args.applicantId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add applicant note
export const addApplicantNote = mutation({
  args: {
    applicantId: v.id("applicants"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    const notes = applicant.notes || [];
    notes.push({
      date: Date.now(),
      author: userRecord._id,
      content: args.content,
    });

    await ctx.db.patch(args.applicantId, {
      notes,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Schedule interview
export const scheduleInterview = mutation({
  args: {
    applicantId: v.id("applicants"),
    date: v.number(),
    type: v.string(),
    interviewer: v.id("users"),
    remarks: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    const interviews = applicant.interviewSchedules || [];
    interviews.push({
      date: args.date,
      type: args.type,
      interviewer: args.interviewer,
      remarks: args.remarks,
    });

    await ctx.db.patch(args.applicantId, {
      interviewSchedules: interviews,
      status: "interview",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete applicant
export const deleteApplicant = mutation({
  args: {
    applicantId: v.id("applicants"),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    await ctx.db.delete(args.applicantId);
    return { success: true };
  },
});

// Convert applicant to employee
export const convertApplicantToEmployee = mutation({
  args: {
    applicantId: v.id("applicants"),
    employeeData: v.object({
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
      basicSalary: v.number(),
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly")
      ),
    }),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    // Create employee record
    const now = Date.now();

    // Get organization settings for default leave credits
    const settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", applicant.organizationId)
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

    // Use defaultCredits from organization settings (or defaults if not set)
    const vacationTotal = vacationConfig?.defaultCredits ?? 15;
    const sickTotal = sickConfig?.defaultCredits ?? 15;

    const employeeId = await ctx.db.insert("employees", {
      organizationId: applicant.organizationId,
      personalInfo: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        email: applicant.email || "",
        phone: applicant.phone,
      },
      employment: {
        employeeId: args.employeeData.employeeId,
        position: args.employeeData.position,
        department: args.employeeData.department,
        employmentType: args.employeeData.employmentType,
        hireDate: args.employeeData.hireDate,
        status: "active",
      },
      compensation: {
        basicSalary: args.employeeData.basicSalary,
        salaryType: args.employeeData.salaryType,
      },
      schedule: {
        defaultSchedule: {
          monday: { in: "09:00", out: "18:00", isWorkday: true },
          tuesday: { in: "09:00", out: "18:00", isWorkday: true },
          wednesday: { in: "09:00", out: "18:00", isWorkday: true },
          thursday: { in: "09:00", out: "18:00", isWorkday: true },
          friday: { in: "09:00", out: "18:00", isWorkday: true },
          saturday: { in: "09:00", out: "18:00", isWorkday: false },
          sunday: { in: "09:00", out: "18:00", isWorkday: false },
        },
      },
      leaveCredits: {
        vacation: {
          total: vacationTotal,
          used: 0,
          balance: vacationTotal,
        },
        sick: { total: sickTotal, used: 0, balance: sickTotal },
      },
      requirements: [],
      deductions: [],
      incentives: [],
      createdAt: now,
      updatedAt: now,
    });

    // Update applicant status
    await ctx.db.patch(args.applicantId, {
      status: "hired",
      updatedAt: Date.now(),
    });

    return employeeId;
  },
});
