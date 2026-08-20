import { v } from "convex/values";
import type { LeaveBenefitEventType } from "../lib/leave/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireActiveMembership } from "./access";
import {
  requireLeaveSelfService,
  requireSensitiveLeaveAccess,
} from "./leaveAccess";

const verificationDecision = v.union(
  v.literal("verified"),
  v.literal("rejected"),
);

const benefitEventType = v.union(
  v.literal("maternity"),
  v.literal("miscarriage"),
  v.literal("emergency_termination_of_pregnancy"),
  v.literal("spouse_delivery"),
  v.literal("maternity_credit_allocation"),
  v.literal("surgery"),
  v.literal("adoption"),
  v.literal("calamity"),
  v.literal("other_protected"),
);

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
type AccessContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;
type QualificationStatus = Doc<"employeeLeaveQualifications">["verificationStatus"];
type ReviewerRole = Doc<"userOrganizations">["role"];

function isLeaveAdministrator(role: ReviewerRole): boolean {
  return role === "owner" || role === "admin" || role === "hr";
}

function publicQualification(
  qualification: Pick<
    Doc<"employeeLeaveQualifications">,
    "qualificationType" | "validFrom" | "validUntil" | "verificationStatus"
  >,
) {
  return {
    qualificationType: qualification.qualificationType,
    validFrom: qualification.validFrom,
    validUntil: qualification.validUntil,
    verificationStatus: qualification.verificationStatus,
  };
}

function assertValidEffectiveRange(
  validFrom: number,
  validUntil: number | undefined,
): void {
  if (!Number.isFinite(validFrom) || validFrom < 0) {
    throw new Error("A valid qualification start date is required");
  }
  if (
    validUntil !== undefined &&
    (!Number.isFinite(validUntil) || validUntil < validFrom)
  ) {
    throw new Error("Qualification end date cannot precede its start date");
  }
}

async function requireEmployeeInOrganization(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<Doc<"employees">> {
  const employee = await ctx.db.get(employeeId);
  if (!employee || employee.organizationId !== organizationId) {
    throw new Error("Not authorized");
  }
  return employee;
}

async function validateEvidenceReferences(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  ownerUserId: Id<"users">,
  documentReferences: Id<"storageObjects">[] | undefined,
): Promise<void> {
  const uniqueReferences = new Set(documentReferences ?? []);
  if (uniqueReferences.size !== (documentReferences?.length ?? 0)) {
    throw new Error("Leave evidence references must be unique");
  }

  for (const referenceId of uniqueReferences) {
    const storageObject = await ctx.db.get(referenceId);
    if (
      !storageObject ||
      storageObject.organizationId !== organizationId ||
      storageObject.ownerUserId !== ownerUserId ||
      storageObject.purpose !== "leave_attachment" ||
      storageObject.state !== "active"
    ) {
      throw new Error("Not authorized");
    }
  }
}

async function requireOwner(
  ctx: AccessContext,
  organizationId: Id<"organizations">,
) {
  const access = await requireActiveMembership(ctx, organizationId);
  if (access.membership.role !== "owner") {
    throw new Error("Owner access is required");
  }
  return access;
}

function effectiveVerificationStatus(
  qualification: Doc<"employeeLeaveQualifications">,
  decision: "verified" | "rejected",
  now: number,
): QualificationStatus {
  if (
    decision === "verified" &&
    qualification.validUntil !== undefined &&
    qualification.validUntil < now
  ) {
    return "expired";
  }
  return decision;
}

export const submitLeaveQualification = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    qualificationType: v.string(),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),
    documentReferences: v.optional(v.array(v.id("storageObjects"))),
  },
  handler: async (ctx, args) => {
    const qualificationType = args.qualificationType.trim();
    if (!qualificationType) {
      throw new Error("Qualification type is required");
    }
    assertValidEffectiveRange(args.validFrom, args.validUntil);
    const { user } = await requireLeaveSelfService(
      ctx,
      args.organizationId,
      args.employeeId,
    );
    await requireEmployeeInOrganization(
      ctx,
      args.organizationId,
      args.employeeId,
    );
    await validateEvidenceReferences(
      ctx,
      args.organizationId,
      user._id,
      args.documentReferences,
    );

    const now = Date.now();
    const qualificationId = await ctx.db.insert("employeeLeaveQualifications", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      qualificationType,
      validFrom: args.validFrom,
      validUntil: args.validUntil,
      verificationStatus: "pending",
      submittedBy: user._id,
      documentReferences: args.documentReferences,
      createdAt: now,
      updatedAt: now,
    });

    return {
      qualificationId,
      ...publicQualification({
        qualificationType,
        validFrom: args.validFrom,
        validUntil: args.validUntil,
        verificationStatus: "pending",
      }),
    };
  },
});

export const verifyLeaveQualification = mutation({
  args: {
    qualificationId: v.id("employeeLeaveQualifications"),
    decision: verificationDecision,
  },
  handler: async (ctx, args) => {
    const qualification = await ctx.db.get(args.qualificationId);
    if (!qualification) {
      throw new Error("Leave qualification not found");
    }
    const { user, membership } = await requireActiveMembership(
      ctx,
      qualification.organizationId,
    );
    if (!isLeaveAdministrator(membership.role)) {
      throw new Error("Owner, Admin, or HR approval is required");
    }
    await requireEmployeeInOrganization(
      ctx,
      qualification.organizationId,
      qualification.employeeId,
    );

    const now = Date.now();
    const verificationStatus = effectiveVerificationStatus(
      qualification,
      args.decision,
      now,
    );
    await ctx.db.patch(qualification._id, {
      verificationStatus,
      verifiedBy: user._id,
      verifiedAt: now,
      updatedAt: now,
    });

    return publicQualification({ ...qualification, verificationStatus });
  },
});

export const recordLeaveBenefitEvent = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    eventType: benefitEventType,
    qualifyingDate: v.number(),
    benefitVariant: v.optional(v.string()),
    documentReferences: v.optional(v.array(v.id("storageObjects"))),
    allocatedFromEventId: v.optional(v.id("leaveBenefitEvents")),
    allocatedToEmployeeId: v.optional(v.id("employees")),
    allocatedDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.qualifyingDate) || args.qualifyingDate < 0) {
      throw new Error("A valid qualifying date is required");
    }
    const { user } = await requireLeaveSelfService(
      ctx,
      args.organizationId,
      args.employeeId,
    );
    await requireEmployeeInOrganization(
      ctx,
      args.organizationId,
      args.employeeId,
    );
    await validateEvidenceReferences(
      ctx,
      args.organizationId,
      user._id,
      args.documentReferences,
    );

    if (args.eventType === "maternity_credit_allocation") {
      if (
        args.allocatedFromEventId === undefined ||
        args.allocatedToEmployeeId === undefined ||
        args.allocatedDays === undefined ||
        !Number.isFinite(args.allocatedDays) ||
        args.allocatedDays <= 0
      ) {
        throw new Error("A complete maternity credit allocation is required");
      }
      const [sourceEvent] = await Promise.all([
        ctx.db.get(args.allocatedFromEventId),
        requireEmployeeInOrganization(
          ctx,
          args.organizationId,
          args.allocatedToEmployeeId,
        ),
      ]);
      if (
        !sourceEvent ||
        sourceEvent.organizationId !== args.organizationId ||
        sourceEvent.employeeId !== args.employeeId ||
        sourceEvent.eventType !== "maternity" ||
        sourceEvent.verificationStatus !== "verified"
      ) {
        throw new Error("Invalid maternity benefit event");
      }
      const priorAllocations = await ctx.db
        .query("leaveBenefitEvents")
        .withIndex("by_allocation_source", (query) =>
          query.eq("allocatedFromEventId", args.allocatedFromEventId),
        )
        .collect();
      const totalAllocatedDays = priorAllocations.reduce(
        (total, event) => total + (event.allocatedDays ?? 0),
        args.allocatedDays,
      );
      if (totalAllocatedDays > 7) {
        throw new Error("Maternity credit allocation cannot exceed 7 days");
      }
    } else if (
      args.allocatedFromEventId !== undefined ||
      args.allocatedToEmployeeId !== undefined ||
      args.allocatedDays !== undefined
    ) {
      throw new Error(
        "Allocation fields are valid only for maternity credit allocations",
      );
    }

    const now = Date.now();
    return await ctx.db.insert("leaveBenefitEvents", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      eventType: args.eventType,
      qualifyingDate: args.qualifyingDate,
      benefitVariant: args.benefitVariant?.trim() || undefined,
      verificationStatus: "pending",
      documentReferences: args.documentReferences,
      allocatedFromEventId: args.allocatedFromEventId,
      allocatedToEmployeeId: args.allocatedToEmployeeId,
      allocatedDays: args.allocatedDays,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const verifyLeaveBenefitEvent = mutation({
  args: {
    benefitEventId: v.id("leaveBenefitEvents"),
    decision: verificationDecision,
  },
  handler: async (ctx, args) => {
    const benefitEvent = await ctx.db.get(args.benefitEventId);
    if (!benefitEvent) throw new Error("Leave benefit event not found");
    const { user, membership } = await requireActiveMembership(
      ctx,
      benefitEvent.organizationId,
    );
    if (!isLeaveAdministrator(membership.role)) {
      throw new Error("Owner, Admin, or HR approval is required");
    }
    await requireSensitiveLeaveAccess(
      ctx,
      benefitEvent.organizationId,
      benefitEvent.employeeId,
    );
    const linkedRequests = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee", (query) =>
        query.eq("employeeId", benefitEvent.employeeId),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("organizationId"), benefitEvent.organizationId),
          query.eq(query.field("benefitEventId"), benefitEvent._id),
          query.eq(query.field("status"), "pending"),
        ),
      )
      .take(2);
    if (linkedRequests.length > 0) {
      throw new Error(
        "Review the linked leave request to verify or reject this event atomically",
      );
    }
    const now = Date.now();
    await ctx.db.patch(benefitEvent._id, {
      verificationStatus: args.decision,
      verifiedBy: user._id,
      verifiedAt: now,
      updatedAt: now,
    });
    return { verificationStatus: args.decision };
  },
});

export const getMyVerifiedLeaveBenefitEvents = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    await requireLeaveSelfService(ctx, args.organizationId, args.employeeId);
    await requireEmployeeInOrganization(ctx, args.organizationId, args.employeeId);
    const events = await ctx.db
      .query("leaveBenefitEvents")
      .withIndex("by_organization_qualifying_date", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .filter((query) =>
        query.and(
          query.eq(query.field("employeeId"), args.employeeId),
          query.eq(query.field("verificationStatus"), "verified"),
        ),
      )
      .take(101);
    if (events.length > 100) {
      throw new Error("Leave benefit event history exceeds the supported limit");
    }
    const reusableEvents: Array<{
      benefitEventId: Id<"leaveBenefitEvents">;
      eventType: LeaveBenefitEventType;
      qualifyingDate: number;
      benefitVariant?: string;
    }> = [];
    for (const event of events) {
      if (event.eventType === "maternity_credit_allocation") continue;
      reusableEvents.push({
        benefitEventId: event._id,
        eventType: event.eventType,
        qualifyingDate: event.qualifyingDate,
        benefitVariant: event.benefitVariant,
      });
    }
    return reusableEvents;
  },
});

export const grantSensitiveLeaveAccess = mutation({
  args: {
    organizationId: v.id("organizations"),
    membershipId: v.id("userOrganizations"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Access reason is required");
    const { user } = await requireOwner(ctx, args.organizationId);
    const targetMembership = await ctx.db.get(args.membershipId);
    if (
      !targetMembership ||
      targetMembership.organizationId !== args.organizationId ||
      (targetMembership.accessStatus !== undefined &&
        targetMembership.accessStatus !== "active")
    ) {
      throw new Error("Not authorized");
    }

    const currentGrant = await ctx.db
      .query("leaveSensitiveAccessGrants")
      .withIndex("by_membership_active", (query) =>
        query.eq("membershipId", args.membershipId).eq("isActive", true),
      )
      .filter((query) =>
        query.eq(query.field("organizationId"), args.organizationId),
      )
      .first();
    if (currentGrant) {
      return currentGrant._id;
    }

    const now = Date.now();
    const grantId = await ctx.db.insert("leaveSensitiveAccessGrants", {
      organizationId: args.organizationId,
      membershipId: args.membershipId,
      isActive: true,
      grantedBy: user._id,
      grantedAt: now,
    });
    await ctx.db.insert("leaveAdministrativeEvents", {
      organizationId: args.organizationId,
      type: "sensitive_access_granted",
      membershipId: args.membershipId,
      actorId: user._id,
      reason,
      createdAt: now,
    });
    return grantId;
  },
});

export const revokeSensitiveLeaveAccess = mutation({
  args: {
    organizationId: v.id("organizations"),
    membershipId: v.id("userOrganizations"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Revocation reason is required");
    const { user } = await requireOwner(ctx, args.organizationId);
    const targetMembership = await ctx.db.get(args.membershipId);
    if (
      !targetMembership ||
      targetMembership.organizationId !== args.organizationId
    ) {
      throw new Error("Not authorized");
    }
    const grants = await ctx.db
      .query("leaveSensitiveAccessGrants")
      .withIndex("by_membership_active", (query) =>
        query.eq("membershipId", args.membershipId).eq("isActive", true),
      )
      .collect();
    const now = Date.now();
    let revoked = 0;
    for (const grant of grants) {
      if (grant.organizationId !== args.organizationId) {
        throw new Error("Sensitive leave grant tenant mismatch");
      }
      await ctx.db.patch(grant._id, {
        isActive: false,
        revokedBy: user._id,
        revokedAt: now,
      });
      revoked += 1;
    }
    if (revoked > 0) {
      await ctx.db.insert("leaveAdministrativeEvents", {
        organizationId: args.organizationId,
        type: "sensitive_access_revoked",
        membershipId: args.membershipId,
        actorId: user._id,
        reason,
        createdAt: now,
      });
    }
    return { revoked };
  },
});

export const getRestrictedLeaveDetails = query({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    benefitEventId: v.optional(v.id("leaveBenefitEvents")),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) {
      throw new Error("Leave request not found");
    }
    const access = await requireActiveMembership(ctx, request.organizationId);
    const isRequestEmployee =
      access.membership.employeeId === request.employeeId;
    if (!isRequestEmployee && !isLeaveAdministrator(access.membership.role)) {
      throw new Error("Not authorized");
    }

    const benefitEvent = args.benefitEventId
      ? await ctx.db.get(args.benefitEventId)
      : null;
    if (
      benefitEvent &&
      (benefitEvent.organizationId !== request.organizationId ||
        benefitEvent.employeeId !== request.employeeId)
    ) {
      throw new Error("Not authorized");
    }

    const grant = await ctx.db
      .query("leaveSensitiveAccessGrants")
      .withIndex("by_membership_active", (query) =>
        query.eq("membershipId", access.membership._id).eq("isActive", true),
      )
      .filter((query) =>
        query.eq(query.field("organizationId"), request.organizationId),
      )
      .first();
    if (!isRequestEmployee && !grant) {
      return {
        restricted: true as const,
        detailsVisible: false as const,
        label: "Restricted leave" as const,
      };
    }

    await requireSensitiveLeaveAccess(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    return {
      restricted: true as const,
      detailsVisible: true as const,
      label: request.customLeaveType ?? "Restricted leave",
      reason: request.reason,
      benefitEvent: benefitEvent
        ? {
            eventType: benefitEvent.eventType,
            qualifyingDate: benefitEvent.qualifyingDate,
            benefitVariant: benefitEvent.benefitVariant,
            verificationStatus: benefitEvent.verificationStatus,
          }
        : null,
    };
  },
});
