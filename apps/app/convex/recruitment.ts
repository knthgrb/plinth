import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { encryptCompensationForDb } from "./employeeCompensationCrypto";
import { getEffectiveRequirementDefinitions } from "./organizationConfiguration";
import {
  appendApplicantOfferEvent,
  loadEffectiveApplicant,
  synchronizeEffectiveApplicant,
} from "./workflowCompatibility";
import { runOrgQuery } from "./queryAuthGrace";
import {
  replaceEmployeeDeductions,
  replaceEmployeeIncentives,
  replaceEmployeeRequirements,
} from "./leaveEmployeeCompatibility";
import { filterApplicableRequirementPolicies } from "@/lib/requirements/workflow";
import {
  assertApplicantTransition,
  validateScorecard,
  type ApplicantStage,
} from "@/lib/recruitment/workflow";
import { normalizeOrgMembershipAccessStatus } from "@/utils/org-membership-lifecycle";
import {
  assertHireDateIsNotFuture,
  recordEmployeeLifecycleEvent,
  toManilaDayStartUtcMs,
} from "./employeeLifecycle";
import { requireRegisteredStorageObject } from "./files";

const PUBLIC_APPLICANT_UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_APPLICANT_RESUME_BYTES = 10 * 1024 * 1024;
const APPLICANT_RESUME_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function assertApplicantResumeMetadata(
  metadata: {
    contentType?: string;
    size: number;
  },
  fileName?: string,
  allowUnknownContentType = false,
): void {
  const validFileName = fileName
    ? /\.(pdf|doc|docx)$/i.test(fileName.trim())
    : false;
  if (
    (metadata.contentType !== undefined &&
      !APPLICANT_RESUME_CONTENT_TYPES.has(metadata.contentType)) ||
    (metadata.contentType === undefined &&
      !validFileName &&
      !allowUnknownContentType) ||
    metadata.size > MAX_APPLICANT_RESUME_BYTES
  ) {
    throw new Error("Resume must be a PDF, DOC, or DOCX file up to 10 MB");
  }
}

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

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "hr" | "approver",
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  if (requiredRole) {
    const hasHrAccess = ["owner", "admin", "hr"].includes(userRole);
    const canApprove = ["owner", "admin"].includes(userRole);
    if (!hasHrAccess || (requiredRole === "approver" && !canApprove)) {
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

function requireNonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function cleanList(values: readonly string[] | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}

function assertPositiveOpenings(value: number | undefined): number {
  const openings = value ?? 1;
  if (!Number.isInteger(openings) || openings < 1) {
    throw new Error("Number of openings must be a positive whole number");
  }
  return openings;
}

function validateSalaryRange(
  range: { min: number; max: number } | undefined,
): { min: number; max: number } | undefined {
  if (!range) return undefined;
  if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min < 0 ||
    range.max < range.min
  ) {
    throw new Error(
      "Salary range must use non-negative values with maximum at least minimum",
    );
  }
  return range;
}

async function hasApplicantEmailDuplicate(
  ctx: QueryCtx | MutationCtx,
  jobId: Id<"jobs">,
  normalizedEmail: string,
  excludedApplicantId?: Id<"applicants">,
): Promise<boolean> {
  if (!normalizedEmail) return false;
  const candidates = await ctx.db
    .query("applicants")
    .withIndex("by_job", (query) => query.eq("jobId", jobId))
    .collect();
  return candidates.some(
    (candidate) =>
      candidate._id !== excludedApplicantId &&
      candidate.archivedAt === undefined &&
      candidate.email.trim().toLocaleLowerCase() === normalizedEmail,
  );
}

async function assertOrganizationUsers(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userIds: readonly Id<"users">[],
): Promise<void> {
  for (const userId of new Set(userIds)) {
    const membership = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (query) =>
        query.eq("userId", userId).eq("organizationId", organizationId),
      )
      .unique();
    if (
      !membership ||
      normalizeOrgMembershipAccessStatus(membership.accessStatus) !== "active"
    ) {
      throw new Error(
        "Every interviewer must be an active organization member",
      );
    }
  }
}

function buildDefaultRequirementsForConvertedEmployee(
  requirements: readonly import("./organizationConfiguration").RequirementConfigurationInput[],
  employment: { department: string; employmentType: string },
) {
  return filterApplicableRequirementPolicies(requirements, employment).map(
    (req) => ({
      type: req.type,
      status: "pending" as const,
      isRequired: req.isRequired ?? true,
      appliesToDepartments: req.appliesToDepartments,
      appliesToEmploymentTypes: req.appliesToEmploymentTypes,
      reminderDaysBeforeDue: req.reminderDaysBeforeDue,
      requiresVerification: req.requiresVerification ?? true,
      isDefault: true,
      isCustom: false,
    }),
  );
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
      await checkAuth(ctx, args.organizationId, "hr");

      let jobs = await ctx.db
        .query("jobs")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      if (args.status) {
        jobs = jobs.filter((job) => job.status === args.status);
      }

      jobs.sort((left, right) => right.postedDate - left.postedDate);
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

      await checkAuth(ctx, job.organizationId, "hr");

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
    await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const title = requireNonEmpty(args.title, "Job title");
    const department = requireNonEmpty(args.department, "Department");
    const employmentType = requireNonEmpty(
      args.employmentType,
      "Employment type",
    );
    const numberOfOpenings = assertPositiveOpenings(args.numberOfOpenings);
    if (args.closingDate !== undefined && args.closingDate <= now) {
      throw new Error("Closing date must be in the future");
    }
    const jobId = await ctx.db.insert("jobs", {
      organizationId: args.organizationId,
      title,
      department,
      position: args.position?.trim() || title,
      employmentType,
      numberOfOpenings,
      description: args.description?.trim() || "",
      requirements: cleanList(args.requirements),
      qualifications: cleanList(args.qualifications),
      salaryRange: validateSalaryRange(args.salaryRange),
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

    await checkAuth(ctx, job.organizationId, "hr");

    const updates: Partial<Doc<"jobs">> = { updatedAt: Date.now() };
    if (args.title !== undefined)
      updates.title = requireNonEmpty(args.title, "Job title");
    if (args.department !== undefined)
      updates.department = requireNonEmpty(args.department, "Department");
    if (args.position !== undefined) updates.position = args.position.trim();
    if (args.employmentType !== undefined)
      updates.employmentType = requireNonEmpty(
        args.employmentType,
        "Employment type",
      );
    if (args.numberOfOpenings !== undefined)
      updates.numberOfOpenings = assertPositiveOpenings(args.numberOfOpenings);
    if (args.description !== undefined)
      updates.description = args.description.trim();
    if (args.requirements !== undefined)
      updates.requirements = cleanList(args.requirements);
    if (args.qualifications !== undefined)
      updates.qualifications = cleanList(args.qualifications);
    if (args.salaryRange !== undefined)
      updates.salaryRange = validateSalaryRange(args.salaryRange);
    if (args.status !== undefined) updates.status = args.status;
    if (args.closingDate !== undefined) {
      if (args.closingDate <= Date.now()) {
        throw new Error("Closing date must be in the future");
      }
      updates.closingDate = args.closingDate;
    }

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

    await checkAuth(ctx, job.organizationId, "hr");

    const applicants = await ctx.db
      .query("applicants")
      .withIndex("by_job", (query) => query.eq("jobId", job._id))
      .take(1);
    if (applicants.length > 0) {
      throw new Error(
        "Archive positions with applicants instead of deleting them",
      );
    }

    await ctx.db.delete(args.jobId);
    return { success: true };
  },
});

// Get applicants
export const getApplicants = query({
  args: {
    paginationOpts: paginationOptsValidator,
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
    return runOrgQuery(
      async () => {
        await checkAuth(ctx, args.organizationId, "hr");
        if (args.jobId) {
          const job = await ctx.db.get(args.jobId);
          if (!job || job.organizationId !== args.organizationId) {
            throw new Error("Invalid job");
          }
        }
        const paginationOpts = {
          ...args.paginationOpts,
          numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 50)),
        };
        const result = args.jobId
          ? await ctx.db
              .query("applicants")
              .withIndex("by_job", (query) => query.eq("jobId", args.jobId!))
              .order("desc")
              .paginate(paginationOpts)
          : await ctx.db
              .query("applicants")
              .withIndex("by_organization", (query) =>
                query.eq("organizationId", args.organizationId),
              )
              .order("desc")
              .paginate(paginationOpts);
        const visibleApplicants = result.page.filter(
          (applicant) =>
            applicant.organizationId === args.organizationId &&
            applicant.archivedAt === undefined &&
            (!args.status || applicant.status === args.status),
        );
        return {
          ...result,
          page: await Promise.all(
            visibleApplicants.map((applicant: Doc<"applicants">) =>
              loadEffectiveApplicant(ctx, applicant),
            ),
          ),
        };
      },
      { page: [], isDone: true, continueCursor: "" },
    );
  },
});

export const getRecruitmentMetrics = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) =>
    runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId, "hr");
      const [jobs, rows] = await Promise.all([
        ctx.db
          .query("jobs")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
        ctx.db
          .query("applicants")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
      ]);
      const stages: ApplicantStage[] = [
        "new",
        "screening",
        "interview",
        "assessment",
        "offer",
        "hired",
        "rejected",
      ];
      const emptyStageCounts = (): Record<ApplicantStage, number> =>
        Object.fromEntries(stages.map((stage) => [stage, 0])) as Record<
          ApplicantStage,
          number
        >;
      const stageCounts = emptyStageCounts();
      const byJob = new Map<
        Id<"jobs">,
        {
          total: number;
          hired: number;
          activeCandidates: number;
          awaitingDecision: number;
          staleCandidates: number;
          stageCounts: Record<ApplicantStage, number>;
        }
      >();
      const now = Date.now();
      let activeCandidates = 0;
      let awaitingDecision = 0;
      let staleCandidates = 0;
      const applicants = rows.filter(
        (applicant) => applicant.archivedAt === undefined,
      );
      for (const applicant of applicants) {
        const stage = applicant.status as ApplicantStage;
        stageCounts[stage] += 1;
        const jobMetrics = byJob.get(applicant.jobId) ?? {
          total: 0,
          hired: 0,
          activeCandidates: 0,
          awaitingDecision: 0,
          staleCandidates: 0,
          stageCounts: emptyStageCounts(),
        };
        jobMetrics.total += 1;
        jobMetrics.stageCounts[stage] += 1;
        if (stage === "hired") jobMetrics.hired += 1;
        if (stage !== "hired" && stage !== "rejected") {
          activeCandidates += 1;
          jobMetrics.activeCandidates += 1;
          const stageChangedAt =
            applicant.currentStageChangedAt ?? applicant.updatedAt;
          if (now - stageChangedAt >= 14 * 24 * 60 * 60 * 1000) {
            staleCandidates += 1;
            jobMetrics.staleCandidates += 1;
          }
        }
        if (stage === "assessment" || stage === "offer") {
          awaitingDecision += 1;
          jobMetrics.awaitingDecision += 1;
        }
        byJob.set(applicant.jobId, jobMetrics);
      }
      const openJobs = jobs.filter((job) => job.status === "open");
      return {
        activePositions: openJobs.length,
        openHeadcount: openJobs.reduce(
          (total, job) =>
            total +
            Math.max(
              0,
              job.numberOfOpenings - (byJob.get(job._id)?.hired ?? 0),
            ),
          0,
        ),
        totalApplicants: applicants.length,
        activeCandidates,
        awaitingDecision,
        staleCandidates,
        stageCounts,
        byJob: [...byJob].map(([jobId, metrics]) => ({ jobId, ...metrics })),
      };
    }, null),
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

      return loadEffectiveApplicant(ctx, applicant);
    }, null);
  },
});

export const createApplicantUploadIntent = mutation({
  args: { organizationId: v.id("organizations"), jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.organizationId !== args.organizationId ||
      job.status !== "open"
    ) {
      throw new Error("Job posting is unavailable");
    }
    const createdAt = Date.now();
    const intentId = await ctx.db.insert("applicantUploadIntents", {
      organizationId: args.organizationId,
      jobId: args.jobId,
      expiresAt: createdAt + PUBLIC_APPLICANT_UPLOAD_TTL_MS,
      createdAt,
    });
    return { intentId, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const registerApplicantResumeUpload = mutation({
  args: {
    intentId: v.id("applicantUploadIntents"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      !intent ||
      intent.expiresAt <= Date.now() ||
      intent.registeredAt !== undefined ||
      intent.claimedAt !== undefined
    ) {
      throw new Error("Upload intent is invalid or expired");
    }
    const [metadata, existingIntent, registeredObject] = await Promise.all([
      ctx.db.system.get("_storage", args.storageId),
      ctx.db
        .query("applicantUploadIntents")
        .withIndex("by_storage", (query) =>
          query.eq("storageId", args.storageId),
        )
        .unique(),
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (query) =>
          query.eq("storageId", args.storageId),
        )
        .unique(),
    ]);
    if (
      !metadata ||
      metadata._creationTime < intent.createdAt ||
      existingIntent ||
      registeredObject
    ) {
      throw new Error("Uploaded resume is not valid for this application");
    }
    assertApplicantResumeMetadata(metadata, args.fileName);
    await ctx.db.patch(intent._id, {
      storageId: args.storageId,
      registeredAt: Date.now(),
    });
    return { success: true };
  },
});

async function resolvePublicApplicantUpload(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    jobId: Id<"jobs">;
    storageId: Id<"_storage">;
    uploadIntentId?: Id<"applicantUploadIntents">;
  },
): Promise<Id<"applicantUploadIntents">> {
  const now = Date.now();
  if (args.uploadIntentId) {
    const intent = await ctx.db.get(args.uploadIntentId);
    if (
      !intent ||
      intent.organizationId !== args.organizationId ||
      intent.jobId !== args.jobId ||
      intent.storageId !== args.storageId ||
      intent.registeredAt === undefined ||
      intent.claimedAt !== undefined ||
      intent.expiresAt <= now
    ) {
      throw new Error("Resume upload is invalid or expired");
    }
    return intent._id;
  }

  const [metadata, existingIntent, registeredObject] = await Promise.all([
    ctx.db.system.get("_storage", args.storageId),
    ctx.db
      .query("applicantUploadIntents")
      .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
      .unique(),
    ctx.db
      .query("storageObjects")
      .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
      .unique(),
  ]);
  if (
    !metadata ||
    now - metadata._creationTime > PUBLIC_APPLICANT_UPLOAD_TTL_MS ||
    existingIntent ||
    registeredObject
  ) {
    throw new Error("Create and register a resume upload intent first");
  }
  assertApplicantResumeMetadata(metadata, undefined, true);
  return ctx.db.insert("applicantUploadIntents", {
    organizationId: args.organizationId,
    jobId: args.jobId,
    expiresAt: now + PUBLIC_APPLICANT_UPLOAD_TTL_MS,
    storageId: args.storageId,
    registeredAt: now,
    createdAt: metadata._creationTime,
  });
}

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
    uploadIntentId: v.optional(v.id("applicantUploadIntents")),
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

    const uploadIntentId = await resolvePublicApplicantUpload(ctx, {
      organizationId: args.organizationId,
      jobId: args.jobId,
      storageId: args.resume,
      uploadIntentId: args.uploadIntentId,
    });

    const normalizedEmail = args.email.trim().toLocaleLowerCase();
    if (await hasApplicantEmailDuplicate(ctx, job._id, normalizedEmail)) {
      throw new Error(
        "An applicant with this email already exists for the position",
      );
    }

    const now = Date.now();
    const pipelineStageHistory = [{ to: "new", changedAt: now }];
    const applicantId = await ctx.db.insert("applicants", {
      organizationId: args.organizationId,
      jobId: args.jobId,
      firstName: requireNonEmpty(args.firstName, "First name"),
      lastName: requireNonEmpty(args.lastName, "Last name"),
      email: normalizedEmail,
      phone: args.phone.trim(),
      resume: args.resume,
      coverLetter: args.coverLetter,
      source: args.source,
      sourceDetails: args.sourceDetails,
      status: "new",
      appliedDate: now,
      currentStageChangedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(uploadIntentId, { claimedAt: now });
    const applicant = await ctx.db.get(applicantId);
    if (!applicant) throw new Error("Applicant creation did not persist");
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory },
      now,
    );

    return applicantId;
  },
});

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

    await requireRegisteredStorageObject(ctx, {
      organizationId: args.organizationId,
      storageId: args.resume,
      ownerUserId: userRecord._id,
      purpose: "applicant_resume",
    });

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    if (job.organizationId !== args.organizationId) {
      throw new Error("Invalid job");
    }
    if (job.status !== "open") {
      throw new Error("Reopen the position before adding applicants");
    }

    const normalizedEmail = args.email?.trim().toLocaleLowerCase() ?? "";
    if (await hasApplicantEmailDuplicate(ctx, job._id, normalizedEmail)) {
      throw new Error(
        "An applicant with this email already exists for the position",
      );
    }

    const now = Date.now();
    const pipelineStageHistory = [
      { to: "new", changedAt: now, changedBy: userRecord._id },
    ];
    const applicantId = await ctx.db.insert("applicants", {
      organizationId: args.organizationId,
      jobId: args.jobId,
      firstName: requireNonEmpty(args.firstName, "First name"),
      lastName: requireNonEmpty(args.lastName, "Last name"),
      email: normalizedEmail,
      phone: args.phone?.trim() || "",
      resume: args.resume,
      coverLetter: args.coverLetter,
      source: args.source,
      sourceDetails: args.sourceDetails,
      googleMeetLink: args.googleMeetLink,
      interviewVideoLink: args.interviewVideoLink,
      portfolioLink: args.portfolioLink,
      status: "new",
      appliedDate: now,
      currentStageChangedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const applicant = await ctx.db.get(applicantId);
    if (!applicant) throw new Error("Applicant creation did not persist");
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory },
      now,
    );

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
    customFields: v.optional(v.record(v.string(), customFieldValue)),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    await checkAuth(ctx, applicant.organizationId, "hr");
    if (applicant.archivedAt !== undefined) {
      throw new Error("Archived applicants cannot be edited");
    }
    if (applicant.convertedEmployeeId) {
      throw new Error("Converted applicants cannot be edited");
    }
    const effectiveApplicant = await loadEffectiveApplicant(ctx, applicant);

    const updates: Partial<Doc<"applicants">> = { updatedAt: Date.now() };
    if (args.firstName !== undefined)
      updates.firstName = requireNonEmpty(args.firstName, "First name");
    if (args.lastName !== undefined)
      updates.lastName = requireNonEmpty(args.lastName, "Last name");
    if (args.email !== undefined) {
      const normalizedEmail = args.email.trim().toLocaleLowerCase();
      if (
        await hasApplicantEmailDuplicate(
          ctx,
          applicant.jobId,
          normalizedEmail,
          applicant._id,
        )
      ) {
        throw new Error(
          "An applicant with this email already exists for the position",
        );
      }
      updates.email = normalizedEmail;
    }
    if (args.phone !== undefined) updates.phone = args.phone.trim();
    if (args.resume !== undefined) {
      const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");
      await requireRegisteredStorageObject(ctx, {
        organizationId: applicant.organizationId,
        storageId: args.resume,
        ownerUserId: userRecord._id,
        purpose: "applicant_resume",
      });
      updates.resume = args.resume;
    }
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
      const customFields = {
        ...(effectiveApplicant.customFields || {}),
        ...args.customFields,
      };
      await synchronizeEffectiveApplicant(
        ctx,
        applicant,
        { customFields },
        updates.updatedAt ?? Date.now(),
      );
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
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

    if (applicant.archivedAt !== undefined || applicant.convertedEmployeeId) {
      throw new Error("Applicant is no longer active");
    }
    const now = Date.now();
    const effective = await loadEffectiveApplicant(ctx, applicant);
    assertApplicantTransition(applicant.status as ApplicantStage, args.status, {
      rejectionReason: args.rejectionReason,
      convertedEmployeeId: applicant.convertedEmployeeId,
    });
    const pipelineStageHistory = effective.pipelineStageHistory || [];
    pipelineStageHistory.push({
      from: applicant.status,
      to: args.status,
      changedAt: now,
      changedBy: userRecord._id,
    });

    const notes = [...effective.notes];
    if (args.status === "rejected") {
      notes.push({
        date: now,
        author: userRecord._id,
        content: `Rejection reason: ${args.rejectionReason?.trim()}`,
      });
      if (
        effective.offerApproval?.status === "pending" ||
        effective.offerApproval?.status === "approved"
      ) {
        notes.push({
          date: now,
          author: userRecord._id,
          content: `Offer ${effective.offerApproval.status} state revoked when candidate was rejected.`,
        });
      }
    }
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory, notes },
      now,
    );
    if (
      args.status === "rejected" &&
      (effective.offerApproval?.status === "pending" ||
        effective.offerApproval?.status === "approved")
    ) {
      await appendApplicantOfferEvent(
        ctx,
        applicant,
        {
          status: "rejected",
          requestedBy: effective.offerApproval.requestedBy,
          requestedAt: effective.offerApproval.requestedAt,
          approvedBy: effective.offerApproval.approvedBy,
          approvedAt: effective.offerApproval.approvedAt,
          notes: args.rejectionReason?.trim(),
        },
        now,
        false,
      );
    }
    await ctx.db.patch(args.applicantId, {
      status: args.status,
      currentStageChangedAt: now,
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

    const effective = await loadEffectiveApplicant(ctx, applicant);
    const notes = effective.notes || [];
    const now = Date.now();
    notes.push({
      date: now,
      author: userRecord._id,
      content: requireNonEmpty(args.content, "Note"),
    });

    await synchronizeEffectiveApplicant(ctx, applicant, { notes }, now);
    await ctx.db.patch(args.applicantId, { updatedAt: now });

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

    if (applicant.archivedAt !== undefined || applicant.convertedEmployeeId) {
      throw new Error("Applicant is no longer active");
    }

    if (args.date <= Date.now()) {
      throw new Error("Interview date must be in the future");
    }
    const type = requireNonEmpty(args.type, "Interview type");
    const interviewers = [args.interviewer, ...(args.interviewers ?? [])];
    await assertOrganizationUsers(ctx, applicant.organizationId, interviewers);
    if (
      applicant.status !== "screening" &&
      applicant.status !== "assessment" &&
      applicant.status !== "interview"
    ) {
      throw new Error(
        "Move the applicant to screening before scheduling an interview",
      );
    }

    const effective = await loadEffectiveApplicant(ctx, applicant);
    const interviews = effective.interviewSchedules || [];
    interviews.push({
      date: args.date,
      type,
      interviewer: args.interviewer,
      interviewers: args.interviewers,
      remarks: args.remarks,
    });

    const now = Date.now();
    const pipelineStageHistory = [...(effective.pipelineStageHistory ?? [])];
    if (applicant.status !== "interview") {
      pipelineStageHistory.push({
        from: effective.status,
        to: "interview",
        changedAt: now,
        changedBy: userRecord._id,
      });
    }
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { interviewSchedules: interviews, pipelineStageHistory },
      now,
    );
    await ctx.db.patch(args.applicantId, {
      status: "interview",
      currentStageChangedAt: now,
      updatedAt: now,
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
    recommendation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const applicant = await ctx.db.get(args.applicantId);
    if (!applicant) throw new Error("Applicant not found");

    const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");
    if (applicant.archivedAt !== undefined || applicant.convertedEmployeeId) {
      throw new Error("Applicant is no longer active");
    }
    if (applicant.status !== "interview" && applicant.status !== "assessment") {
      throw new Error(
        "Scorecards can only be submitted during interview or assessment",
      );
    }
    const validated = validateScorecard(args.criteria);
    const effective = await loadEffectiveApplicant(ctx, applicant);
    const scorecards = effective.scorecards || [];
    const now = Date.now();
    scorecards.push({
      reviewer: userRecord._id,
      criteria: args.criteria,
      overallScore: validated.overallScore,
      recommendation: args.recommendation,
      submittedAt: now,
    });

    await synchronizeEffectiveApplicant(ctx, applicant, { scorecards }, now);
    await ctx.db.patch(args.applicantId, {
      rating: validated.overallScore,
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
    if (applicant.archivedAt !== undefined || applicant.convertedEmployeeId) {
      throw new Error("Applicant is no longer active");
    }
    const effective = await loadEffectiveApplicant(ctx, applicant);
    if (applicant.status !== "interview" && applicant.status !== "assessment") {
      throw new Error(
        "Complete interviews or assessment before requesting an offer",
      );
    }
    if (effective.scorecards.length === 0) {
      throw new Error(
        "Submit at least one scorecard before requesting an offer",
      );
    }
    if (
      effective.offerApproval?.status === "pending" ||
      effective.offerApproval?.status === "approved"
    ) {
      throw new Error("An offer decision is already in progress");
    }
    const offerApproval = {
      status: "pending" as const,
      requestedBy: userRecord._id,
      requestedAt: now,
      notes: args.notes,
    };
    const pipelineStageHistory = [
      ...(effective.pipelineStageHistory ?? []),
      {
        from: effective.status,
        to: "offer",
        changedAt: now,
        changedBy: userRecord._id,
      },
    ];
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory },
      now,
    );
    await appendApplicantOfferEvent(ctx, applicant, offerApproval, now, true);
    await ctx.db.patch(args.applicantId, {
      status: "offer",
      currentStageChangedAt: now,
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

    const userRecord = await checkAuth(
      ctx,
      applicant.organizationId,
      "approver",
    );
    const now = Date.now();
    const effective = await loadEffectiveApplicant(ctx, applicant);
    if (
      applicant.archivedAt !== undefined ||
      applicant.convertedEmployeeId ||
      applicant.status !== "offer"
    ) {
      throw new Error("Applicant is not awaiting an offer decision");
    }
    if (
      !effective.offerApproval ||
      effective.offerApproval.status !== "pending"
    ) {
      throw new Error("Only a pending offer request can be decided");
    }
    if (effective.offerApproval.requestedBy === userRecord._id) {
      throw new Error(
        "Offer requests must be approved by another owner or admin",
      );
    }
    const offerApproval = {
      status: args.approved ? "approved" : "rejected",
      requestedBy: effective.offerApproval.requestedBy,
      requestedAt: effective.offerApproval.requestedAt,
      approvedBy: userRecord._id,
      approvedAt: now,
      notes: args.notes ?? effective.offerApproval?.notes,
    } as const;
    const pipelineStageHistory = [...effective.pipelineStageHistory];
    if (!args.approved) {
      pipelineStageHistory.push({
        from: "offer",
        to: "assessment",
        changedAt: now,
        changedBy: userRecord._id,
      });
    }
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory },
      now,
    );
    await appendApplicantOfferEvent(ctx, applicant, offerApproval, now, false);
    await ctx.db.patch(args.applicantId, {
      status: args.approved ? "offer" : "assessment",
      ...(args.approved ? {} : { currentStageChangedAt: now }),
      updatedAt: now,
    });

    return { success: true };
  },
});

async function archiveApplicantById(
  ctx: MutationCtx,
  applicantId: Id<"applicants">,
) {
  const applicant = await ctx.db.get(applicantId);
  if (!applicant) throw new Error("Applicant not found");

  const userRecord = await checkAuth(ctx, applicant.organizationId, "hr");

  if (applicant.convertedEmployeeId) {
    throw new Error("Converted applicants cannot be archived");
  }
  if (applicant.archivedAt !== undefined) return { success: true };
  const now = Date.now();
  await ctx.db.patch(applicantId, {
    archivedAt: now,
    archivedBy: userRecord._id,
    updatedAt: now,
  });
  return { success: true, archived: true };
}

export const archiveApplicant = mutation({
  args: { applicantId: v.id("applicants") },
  handler: (ctx, args) => archiveApplicantById(ctx, args.applicantId),
});

export const deleteApplicant = mutation({
  args: { applicantId: v.id("applicants") },
  handler: (ctx, args) => archiveApplicantById(ctx, args.applicantId),
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

    if (applicant.convertedEmployeeId) {
      throw new Error("This applicant has already been converted");
    }
    if (applicant.archivedAt !== undefined) {
      throw new Error("Archived applicants cannot be converted");
    }
    const effectiveApplicant = await loadEffectiveApplicant(ctx, applicant);
    if (
      applicant.status !== "offer" ||
      effectiveApplicant.offerApproval?.status !== "approved"
    ) {
      throw new Error(
        "An approved offer is required before employee conversion",
      );
    }
    const employeeCode = requireNonEmpty(
      args.employeeData.employeeId,
      "Employee ID",
    );
    const duplicateEmployees = await ctx.db
      .query("employees")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", applicant.organizationId),
      )
      .filter((query) =>
        query.eq(query.field("employment.employeeId"), employeeCode),
      )
      .take(1);
    if (duplicateEmployees.length > 0) {
      throw new Error("Employee ID is already in use");
    }
    if (
      !Number.isFinite(args.employeeData.basicSalary) ||
      args.employeeData.basicSalary <= 0
    ) {
      throw new Error("Basic salary must be greater than zero");
    }
    assertHireDateIsNotFuture(args.employeeData.hireDate);

    // Create employee record
    const now = Date.now();
    const requirementDefinitions = await getEffectiveRequirementDefinitions(
      ctx,
      applicant.organizationId,
    );
    const defaultRequirements = buildDefaultRequirementsForConvertedEmployee(
      requirementDefinitions.requirements,
      args.employeeData,
    );

    const defaultSchedule = {
      monday: { in: "09:00", out: "18:00", isWorkday: true },
      tuesday: { in: "09:00", out: "18:00", isWorkday: true },
      wednesday: { in: "09:00", out: "18:00", isWorkday: true },
      thursday: { in: "09:00", out: "18:00", isWorkday: true },
      friday: { in: "09:00", out: "18:00", isWorkday: true },
      saturday: { in: "09:00", out: "18:00", isWorkday: false },
      sunday: { in: "09:00", out: "18:00", isWorkday: false },
    };
    const employeeId = await ctx.db.insert("employees", {
      organizationId: applicant.organizationId,
      personalInfo: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        email: applicant.email || "",
        phone: applicant.phone,
      },
      employment: {
        employeeId: employeeCode,
        position: requireNonEmpty(args.employeeData.position, "Position"),
        department: requireNonEmpty(args.employeeData.department, "Department"),
        employmentType: args.employeeData.employmentType,
        hireDate: args.employeeData.hireDate,
        status: "active",
      },
      compensation: encryptCompensationForDb({
        basicSalary: args.employeeData.basicSalary,
        salaryType: args.employeeData.salaryType,
      }) as Doc<"employees">["compensation"],
      schedule: {
        defaultSchedule,
      },
      createdAt: now,
      updatedAt: now,
    });
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new Error("Employee conversion did not persist");
    await Promise.all([
      replaceEmployeeRequirements(ctx, employee, defaultRequirements, now),
      replaceEmployeeDeductions(ctx, employee, [], now),
      replaceEmployeeIncentives(ctx, employee, [], now),
      ctx.db.insert("employeeScheduleHistory", {
        organizationId: applicant.organizationId,
        employeeId,
        effectiveFrom: toManilaDayStartUtcMs(args.employeeData.hireDate),
        schedule: { defaultSchedule },
        shiftId: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await recordEmployeeLifecycleEvent(ctx, {
      organizationId: applicant.organizationId,
      employeeId,
      type: "hired",
      effectiveAt: args.employeeData.hireDate,
      employment: employee.employment,
      recordedBy: userRecord._id,
      createdAt: now,
    });

    const pipelineStageHistory = [
      ...effectiveApplicant.pipelineStageHistory,
      {
        from: "offer",
        to: "hired",
        changedAt: now,
        changedBy: userRecord._id,
      },
    ];
    await synchronizeEffectiveApplicant(
      ctx,
      applicant,
      { pipelineStageHistory },
      now,
    );
    await ctx.db.patch(args.applicantId, {
      status: "hired",
      currentStageChangedAt: now,
      convertedEmployeeId: employeeId,
      updatedAt: now,
    });

    return employeeId;
  },
});
