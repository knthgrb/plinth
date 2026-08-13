import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { encryptCompensationForDb } from "./employeeCompensationCrypto";
import { getEffectiveRequirementDefinitions } from "./organizationConfiguration";
import { runOrgQuery } from "./queryAuthGrace";

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

  // Owner and admin have access to everything
  // If requiredRole is specified, allow owner, admin, hr, or the requiredRole itself
  if (requiredRole) {
    if (
      userRole !== requiredRole &&
      userRole !== "owner" &&
      userRole !== "admin" &&
      userRole !== "hr"
    ) {
      throw new Error("Not authorized");
    }
  }
  // If no requiredRole specified, allow all authenticated users (read access)

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

function buildDefaultRequirementsForConvertedEmployee(requirements: any[]) {
  const now = Date.now();
  return requirements.map((req: any) => ({
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
  }));
}

// Get job postings
export const getJobs = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("on-hold")),
    ),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId);

      let jobs = await (ctx.db.query("jobs") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      if (args.status) {
        jobs = jobs.filter((j: any) => j.status === args.status);
      }

      jobs.sort((a: any, b: any) => b.postedDate - a.postedDate);
      return jobs;
    }, []);
  },
});

// Get single job
export const getJob = query({
  args: {
    jobId: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const job = await ctx.db.get(args.jobId);
      if (!job) throw new Error("Job not found");

      await checkAuth(ctx, job.organizationId);

      return job;
    }, null);
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
      }),
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
      }),
    ),
    status: v.optional(
      v.union(v.literal("open"), v.literal("closed"), v.literal("on-hold")),
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
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId, "hr");

      let applicants = await (ctx.db.query("applicants") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
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
    }, []);
  },
});

// Get single applicant
export const getApplicant = query({
  args: {
    applicantId: v.id("applicants"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const applicant = await ctx.db.get(args.applicantId);
      if (!applicant) throw new Error("Applicant not found");

      await checkAuth(ctx, applicant.organizationId, "hr");

      return applicant;
    }, null);
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
    source: v.optional(v.string()),
    sourceDetails: v.optional(v.string()),
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
      source: args.source,
      sourceDetails: args.sourceDetails,
      status: "new",
      pipelineStageHistory: [{ to: "new", changedAt: now }],
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
    source: v.optional(v.string()),
    sourceDetails: v.optional(v.string()),
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
      email: args.email || "",
      phone: args.phone || "",
      resume: args.resume,
      coverLetter: args.coverLetter,
      source: args.source,
      sourceDetails: args.sourceDetails,
      googleMeetLink: args.googleMeetLink,
      interviewVideoLink: args.interviewVideoLink,
      portfolioLink: args.portfolioLink,
      status: "new",
      pipelineStageHistory: [
        { to: "new", changedAt: now, changedBy: userRecord._id },
      ],
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
    source: v.optional(v.string()),
    sourceDetails: v.optional(v.string()),
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
    if (args.source !== undefined) updates.source = args.source;
    if (args.sourceDetails !== undefined)
      updates.sourceDetails = args.sourceDetails;
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
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    const now = Date.now();
    const pipelineStageHistory = applicant.pipelineStageHistory || [];
    pipelineStageHistory.push({
      from: applicant.status,
      to: args.status,
      changedAt: now,
      changedBy: userRecord._id,
    });

    await ctx.db.patch(args.applicantId, {
      status: args.status,
      pipelineStageHistory,
      updatedAt: now,
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
    interviewers: v.optional(v.array(v.id("users"))),
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
      interviewers: args.interviewers,
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

export const addApplicantScorecard = mutation({
  args: {
    applicantId: v.id("applicants"),
    criteria: v.array(
      v.object({
        label: v.string(),
        score: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
    overallScore: v.number(),
    recommendation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");
    const scorecards = applicant.scorecards || [];
    const now = Date.now();
    scorecards.push({
      reviewer: userRecord._id,
      criteria: args.criteria,
      overallScore: args.overallScore,
      recommendation: args.recommendation,
      submittedAt: now,
    });

    await ctx.db.patch(args.applicantId, {
      scorecards,
      rating: args.overallScore,
      updatedAt: now,
    });

    return { success: true };
  },
});

export const requestOfferApproval = mutation({
  args: {
    applicantId: v.id("applicants"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");
    const now = Date.now();
    await ctx.db.patch(args.applicantId, {
      status: "offer",
      offerApproval: {
        status: "pending",
        requestedBy: userRecord._id,
        requestedAt: now,
        notes: args.notes,
      },
      updatedAt: now,
    });

    return { success: true };
  },
});

export const approveOffer = mutation({
  args: {
    applicantId: v.id("applicants"),
    approved: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");
    const now = Date.now();
    await ctx.db.patch(args.applicantId, {
      offerApproval: {
        ...(applicant.offerApproval || {}),
        status: args.approved ? "approved" : "rejected",
        approvedBy: userRecord._id,
        approvedAt: now,
        notes: args.notes ?? applicant.offerApproval?.notes,
      },
      updatedAt: now,
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
        v.literal("part-time"),
      ),
      hireDate: v.number(),
      basicSalary: v.number(),
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly"),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    // Create employee record
    const now = Date.now();
    const requirementDefinitions = await getEffectiveRequirementDefinitions(
      ctx,
      applicant.organizationId,
    );
    const defaultRequirements = buildDefaultRequirementsForConvertedEmployee(
      requirementDefinitions.requirements,
    );

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
      compensation: encryptCompensationForDb({
        basicSalary: args.employeeData.basicSalary,
        salaryType: args.employeeData.salaryType,
      }) as any,
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
      requirements: defaultRequirements,
      deductions: [],
      incentives: [],
      createdAt: now,
      updatedAt: now,
    });

    // Update applicant status
    await ctx.db.patch(args.applicantId, {
      status: "hired",
      convertedEmployeeId: employeeId,
      updatedAt: Date.now(),
    });

    return employeeId;
  },
});
