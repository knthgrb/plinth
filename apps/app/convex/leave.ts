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
import { isOrgQueryAuthGraceError } from "./queryAuthGrace";
import {
  getConvertibleLeaveDays,
  GENERAL_LEAVE_CREDIT_KEY,
} from "./leaveCalculations";
import {
  calculateAnnualLeaveBase,
  calculateAnniversaryLeave as calculatePolicyAnniversaryLeave,
} from "@/utils/leave-policy-calculations";
import {
  ACTIVE_LEAVE_REQUEST_STATUSES,
  leaveDateRangesOverlap,
  type ActiveLeaveRequestStatus,
} from "@/utils/leave-request-conflicts";
import { formatManilaNumericDate } from "@/lib/manila-date";
import {
  getUserIdForEmployeeInOrg,
  getUserIdsForLeaveApprovers,
  insertInAppNotification,
} from "./notificationHelpers";
import { canUseEmployeeSelfService } from "@/utils/employee-lifecycle";
import {
  loadEffectiveEmployee,
  replaceEmployeeLeaveCredits,
  type EffectiveEmployee,
  type EmployeeLeaveCredits,
} from "./leaveEmployeeCompatibility";
import { getEffectiveSettings } from "./organizationConfiguration";
import {
  loadEffectiveLeaveAttachments,
  replaceLeaveAttachments,
} from "./communicationsCompatibility";
import { assertLegacyLeaveWriteAllowed } from "./leaveMigration";
import {
  canAdministerLeave,
  canViewSensitiveLeave,
  requireFinalLeaveReviewer,
  requireLeaveSelfService,
  requireSensitiveLeaveAccess,
} from "./leaveAccess";
import {
  ensurePendingBenefitReconciliation,
  voidBenefitReconciliation,
} from "./leaveBenefitPayroll";
import {
  appendLedgerEntry,
  consumeReservation,
  releaseReservation,
  reserveUnits,
  restoreUsage,
} from "./leaveLedger";
import {
  insertLeaveRequestOccurrences,
  prepareLeaveRequestV2,
  requireActiveLeaveEngineV2,
} from "./leaveOccurrences";
import { isStatutoryPolicyCoveredAt } from "./leaveStatutoryCoverage";

const MAX_LEAVE_CONFLICT_CANDIDATES = 500;

async function assertLegacyLeaveEndpointAllowed(
  ctx: Pick<MutationCtx, "db">,
  organizationId: Id<"organizations">,
): Promise<void> {
  await assertLegacyLeaveWriteAllowed(ctx, organizationId);
  const settings = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (settings.length > 1)
    throw new Error("Duplicate organization leave settings");
  if (
    settings[0]?.migrationState === "active" &&
    settings[0].activePolicyEngineVersion === 2
  ) {
    throw new Error("Use the canonical leave request workflow");
  }
}

async function persistLeaveCredits(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  leaveCredits: EmployeeLeaveCredits,
): Promise<void> {
  const now = Date.now();
  await replaceEmployeeLeaveCredits(ctx, employee, leaveCredits, now);
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

  // Write operations (requiredRole set): admin, owner, or that role only
  if (requiredRole && !canAdministerLeave(userRole)) {
    throw new Error("Not authorized");
  }
  // Read operations (no requiredRole): all org members including accounting (for payroll/payslips)

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

async function checkAuthForQuery(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  try {
    return await checkAuth(ctx, organizationId, requiredRole);
  } catch (e) {
    if (isOrgQueryAuthGraceError(e)) return null;
    throw e;
  }
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

async function findOverlappingLeaveRequest(
  ctx: QueryCtx | MutationCtx,
  {
    organizationId,
    employeeId,
    startDate,
    endDate,
    statuses,
    excludeLeaveRequestId,
  }: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    startDate: number;
    endDate: number;
    statuses: readonly ActiveLeaveRequestStatus[];
    excludeLeaveRequestId?: Id<"leaveRequests">;
  },
) {
  for (const status of statuses) {
    const possibleConflicts = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee_status_endDate", (q) =>
        q
          .eq("employeeId", employeeId)
          .eq("status", status)
          .gte("endDate", startDate),
      )
      .take(MAX_LEAVE_CONFLICT_CANDIDATES + 1);
    if (possibleConflicts.length > MAX_LEAVE_CONFLICT_CANDIDATES) {
      throw new Error("Leave conflict history exceeds the supported limit");
    }
    const conflict = possibleConflicts.find((request) => {
      if (request.organizationId !== organizationId) return false;
      if (excludeLeaveRequestId && request._id === excludeLeaveRequestId) {
        return false;
      }
      return leaveDateRangesOverlap(
        startDate,
        endDate,
        request.startDate,
        request.endDate,
      );
    });

    if (conflict) return conflict;
  }

  return null;
}

function formatLeaveConflictMessage(conflict: Doc<"leaveRequests">) {
  const period = `${formatManilaNumericDate(conflict.startDate)} - ${formatManilaNumericDate(conflict.endDate)}`;
  return `This employee already has a ${conflict.status} leave request for ${period}.`;
}

// Resolve credit type key for non-vacation/sick: customLeaveType when leaveType is "custom", else leaveType (e.g. "emergency")
function getCreditType(
  leaveType: string,
  customLeaveType?: string,
): "vacation" | "sick" | string {
  if (leaveType === "vacation" || leaveType === "sick") return leaveType;
  return leaveType === "custom" ? customLeaveType || "" : leaveType;
}

function cloneLeaveCredits(
  source: EmployeeLeaveCredits | undefined,
): EmployeeLeaveCredits {
  return {
    vacation: { ...(source?.vacation ?? { total: 0, used: 0, balance: 0 }) },
    sick: { ...(source?.sick ?? { total: 0, used: 0, balance: 0 }) },
    custom: source?.custom?.map((credit) => ({ ...credit })) ?? [],
  };
}

function getBalanceForType(
  leaveCredits: EmployeeLeaveCredits | undefined,
  creditType: string,
): number {
  if (!leaveCredits) return 0;
  if (creditType === "vacation") return leaveCredits.vacation?.balance ?? 0;
  if (creditType === "sick") return leaveCredits.sick?.balance ?? 0;
  const custom = leaveCredits.custom?.find(
    (credit) => credit.type === creditType,
  );
  return custom?.balance ?? 0;
}

function hasTrackedCreditType(
  leaveCredits: EmployeeLeaveCredits | undefined,
  creditType: string,
): boolean {
  if (!leaveCredits) return false;
  if (creditType === "vacation") return !!leaveCredits.vacation;
  if (creditType === "sick") return !!leaveCredits.sick;
  return Boolean(
    leaveCredits.custom?.some((credit) => credit.type === creditType),
  );
}

function deductCreditsForType(
  leaveCredits: EmployeeLeaveCredits,
  creditType: string,
  numberOfDays: number,
): void {
  if (creditType === "vacation") {
    leaveCredits.vacation.used += numberOfDays;
    leaveCredits.vacation.balance -= numberOfDays;
    return;
  }
  if (creditType === "sick") {
    leaveCredits.sick.used += numberOfDays;
    leaveCredits.sick.balance -= numberOfDays;
    return;
  }
  if (!leaveCredits.custom) leaveCredits.custom = [];
  const idx = leaveCredits.custom.findIndex(
    (credit) => credit.type === creditType,
  );
  if (idx >= 0) {
    leaveCredits.custom[idx].used += numberOfDays;
    leaveCredits.custom[idx].balance -= numberOfDays;
  }
}

function ensureVacationSick(leaveCredits: EmployeeLeaveCredits) {
  if (!leaveCredits.vacation) {
    leaveCredits.vacation = { total: 0, used: 0, balance: 0 };
  }
  if (!leaveCredits.sick) {
    leaveCredits.sick = { total: 0, used: 0, balance: 0 };
  }
}

/** General SIL pool: take from vacation balance first, then sick. */
function deductCreditsGeneralPool(
  leaveCredits: EmployeeLeaveCredits,
  numberOfDays: number,
) {
  ensureVacationSick(leaveCredits);
  let remaining = numberOfDays;
  const takeV = Math.min(
    remaining,
    Math.max(0, leaveCredits.vacation.balance ?? 0),
  );
  leaveCredits.vacation.used += takeV;
  leaveCredits.vacation.balance -= takeV;
  remaining -= takeV;
  if (remaining > 0) {
    const takeS = Math.min(
      remaining,
      Math.max(0, leaveCredits.sick.balance ?? 0),
    );
    leaveCredits.sick.used += takeS;
    leaveCredits.sick.balance -= takeS;
    remaining -= takeS;
  }
  if (remaining > 0) {
    throw new Error(
      "Insufficient pooled leave credits (vacation/sick balances)",
    );
  }
}

function isGeneralPoolLeaveRequest(
  request: Pick<Doc<"leaveRequests">, "leaveType" | "customLeaveType">,
  leaveTrackerMode: string,
) {
  return (
    leaveTrackerMode === "general" &&
    request.leaveType === "custom" &&
    request.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
  );
}

type EffectiveSettings = Awaited<ReturnType<typeof getEffectiveSettings>>;

const leaveRequestV2DraftArgs = {
  organizationId: v.id("organizations"),
  employeeId: v.id("employees"),
  policyId: v.id("leavePolicies"),
  startLocalDate: v.string(),
  endLocalDate: v.string(),
  requestedDurationMode: v.union(
    v.literal("day"),
    v.literal("half_day"),
    v.literal("hour"),
  ),
  requestedMinutes: v.optional(v.number()),
  benefitEventId: v.optional(v.id("leaveBenefitEvents")),
  benefitEventDraft: v.optional(
    v.object({
      eventType: v.union(
        v.literal("maternity"),
        v.literal("miscarriage"),
        v.literal("emergency_termination_of_pregnancy"),
        v.literal("spouse_delivery"),
        v.literal("surgery"),
        v.literal("adoption"),
        v.literal("calamity"),
        v.literal("other_protected"),
      ),
      qualifyingLocalDate: v.string(),
      benefitVariant: v.optional(v.string()),
    }),
  ),
};

const leaveRequestAttachmentValidator = v.object({
  storageObjectId: v.id("storageObjects"),
  documentType: v.string(),
});

type LeaveRequestAttachmentInput = {
  storageObjectId: Id<"storageObjects">;
  documentType: string;
};

async function validateLeaveRequestAttachments(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    userId: Id<"users">;
    attachments: readonly LeaveRequestAttachmentInput[];
    policyVersion: Doc<"leavePolicyVersions">;
    chargeableDuration: number;
  },
): Promise<Id<"_storage">[]> {
  const seenObjects = new Set<Id<"storageObjects">>();
  const documentTypes = new Set<string>();
  const storageIds: Id<"_storage">[] = [];
  for (const attachment of args.attachments) {
    if (seenObjects.has(attachment.storageObjectId)) {
      throw new Error("Leave attachments must be unique");
    }
    seenObjects.add(attachment.storageObjectId);
    const documentType = attachment.documentType.trim();
    if (!documentType) throw new Error("Leave attachment type is required");
    documentTypes.add(documentType);
    const storageObject = await ctx.db.get(attachment.storageObjectId);
    if (
      !storageObject ||
      storageObject.organizationId !== args.organizationId ||
      storageObject.ownerUserId !== args.userId ||
      storageObject.purpose !== "leave_attachment" ||
      storageObject.state !== "active"
    ) {
      throw new Error("Not authorized");
    }
    storageIds.push(storageObject.storageId);
  }

  for (const rule of args.policyVersion.requiredDocumentRules ?? []) {
    if (
      rule.requiredBefore === "submission" &&
      args.chargeableDuration >= (rule.minimumDuration ?? 0) &&
      !documentTypes.has(rule.documentType)
    ) {
      throw new Error(
        `Required leave evidence is missing: ${rule.documentType}`,
      );
    }
  }
  return storageIds;
}

function legacyLeaveTypeForPolicy(policy: Doc<"leavePolicies">): {
  leaveType: Doc<"leaveRequests">["leaveType"];
  customLeaveType?: string;
} {
  const sourceKey = policy.sourceKey.toLowerCase();
  if (sourceKey.includes("vacation")) return { leaveType: "vacation" };
  if (sourceKey.includes("sick")) return { leaveType: "sick" };
  if (sourceKey.includes("emergency")) return { leaveType: "emergency" };
  if (sourceKey.includes("maternity")) return { leaveType: "maternity" };
  if (sourceKey.includes("paternity")) return { leaveType: "paternity" };
  return { leaveType: "custom", customLeaveType: policy.name };
}

async function getV2LeaveApprovers(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  requesterId: Id<"users">,
): Promise<Id<"users">[]> {
  const memberships = await ctx.db
    .query("userOrganizations")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(501);
  if (memberships.length > 500) {
    throw new Error("Organization membership list exceeds the supported limit");
  }
  const result = new Set<Id<"users">>();
  for (const membership of memberships) {
    if (
      membership.userId !== requesterId &&
      (membership.accessStatus === undefined ||
        membership.accessStatus === "active") &&
      (membership.role === "owner" ||
        membership.role === "admin" ||
        membership.role === "hr")
    ) {
      result.add(membership.userId);
    }
  }
  return [...result];
}

const MAX_REQUEST_WORKFLOW_ROWS = 500;

type CanonicalRequestState = {
  occurrences: Doc<"leaveRequestOccurrences">[];
  ledgerEntries: Doc<"leaveLedgerEntries">[];
};

function reviewerDisplayName(user: Doc<"users">): string {
  return user.name?.trim() || user.email;
}

async function requireRequestSensitiveAccessIfNeeded(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"leaveRequests">,
): Promise<void> {
  if (!request.policyId) return;
  const policy = await ctx.db.get(request.policyId);
  if (
    policy?.organizationId === request.organizationId &&
    policy.confidentiality === "restricted"
  ) {
    await requireSensitiveLeaveAccess(
      ctx,
      request.organizationId,
      request.employeeId,
    );
  }
}

export const getLeaveEngineStatus = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);
    const settings = await ctx.db
      .query("organizationLeaveSettings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .unique();
    return {
      isActive:
        settings?.migrationState === "active" &&
        settings.activePolicyEngineVersion === 2,
      migrationState: settings?.migrationState ?? "not_started",
      employmentSector: settings?.employmentSector,
      approvalSignatureMode: settings?.approvalSignatureMode ?? "none",
    };
  },
});

async function requireLeaveAdministrator(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const access = await requireActiveMembership(ctx, organizationId);
  if (
    access.membership.role !== "owner" &&
    access.membership.role !== "admin" &&
    access.membership.role !== "hr"
  ) {
    throw new Error("Owner, Admin, or HR approval is required");
  }
  await requireActiveLeaveEngineV2(ctx, organizationId);
  return access;
}

async function loadCanonicalRequestState(
  ctx: QueryCtx | MutationCtx,
  leaveRequestId: Id<"leaveRequests">,
): Promise<CanonicalRequestState> {
  const [occurrences, ledgerEntries] = await Promise.all([
    ctx.db
      .query("leaveRequestOccurrences")
      .withIndex("by_request_local_date", (query) =>
        query.eq("leaveRequestId", leaveRequestId),
      )
      .take(MAX_REQUEST_WORKFLOW_ROWS + 1),
    ctx.db
      .query("leaveLedgerEntries")
      .withIndex("by_request", (query) =>
        query.eq("leaveRequestId", leaveRequestId),
      )
      .take(MAX_REQUEST_WORKFLOW_ROWS + 1),
  ]);
  if (
    occurrences.length > MAX_REQUEST_WORKFLOW_ROWS ||
    ledgerEntries.length > MAX_REQUEST_WORKFLOW_ROWS
  ) {
    throw new Error("Leave request workflow exceeds the supported row limit");
  }
  if (occurrences.length === 0) {
    throw new Error("Canonical leave request occurrences are missing");
  }
  return { occurrences, ledgerEntries };
}

function originalReservation(
  ledgerEntries: readonly Doc<"leaveLedgerEntries">[],
): Doc<"leaveLedgerEntries"> | null {
  return (
    ledgerEntries.find(
      (entry) => entry.kind === "reservation" && entry.amount < 0,
    ) ?? null
  );
}

function requestUsageEntries(
  ledgerEntries: readonly Doc<"leaveLedgerEntries">[],
): Doc<"leaveLedgerEntries">[] {
  return ledgerEntries.filter(
    (entry) => entry.kind === "usage" && entry.amount < 0,
  );
}

function assertOccurrencesUnlocked(
  occurrences: readonly Doc<"leaveRequestOccurrences">[],
): void {
  if (
    occurrences.some(
      (occurrence) =>
        occurrence.payrollLockedAt !== undefined ||
        occurrence.payrollRunId !== undefined,
    )
  ) {
    throw new Error(
      "A payroll-locked leave requires the audited correction workflow",
    );
  }
}

function assertFutureOccurrences(
  occurrences: readonly Doc<"leaveRequestOccurrences">[],
  now: number,
): void {
  const today = new Date(now + 8 * 60 * 60 * 1_000);
  const todayLocalDate = [
    String(today.getUTCFullYear()).padStart(4, "0"),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    String(today.getUTCDate()).padStart(2, "0"),
  ].join("-");
  if (
    occurrences.some((occurrence) => occurrence.localDate <= todayLocalDate)
  ) {
    throw new Error("Past or current leave requires the correction workflow");
  }
}

async function setOccurrenceLifecycle(
  ctx: MutationCtx,
  occurrences: readonly Doc<"leaveRequestOccurrences">[],
  lifecycleState: Doc<"leaveRequestOccurrences">["lifecycleState"],
  now: number,
): Promise<void> {
  for (const occurrence of occurrences) {
    await ctx.db.patch(occurrence._id, { lifecycleState, updatedAt: now });
  }
}

function parseSubmissionDetails(event: Doc<"leaveRequestEvents"> | null): {
  benefitEventId?: Id<"leaveBenefitEvents">;
  evidenceDocumentTypes: string[];
} {
  if (!event?.detailsJson) return { evidenceDocumentTypes: [] };
  let value: unknown;
  try {
    value = JSON.parse(event.detailsJson) as unknown;
  } catch {
    throw new Error("Leave request submission audit details are invalid");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Leave request submission audit details are invalid");
  }
  const record = value as Record<string, unknown>;
  const evidenceDocumentTypes = Array.isArray(record.evidenceDocumentTypes)
    ? record.evidenceDocumentTypes.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  return {
    benefitEventId:
      typeof record.benefitEventId === "string"
        ? (record.benefitEventId as Id<"leaveBenefitEvents">)
        : undefined,
    evidenceDocumentTypes,
  };
}

async function revalidatePendingRequest(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"leaveRequests">,
  state: CanonicalRequestState,
  now: number,
): Promise<Awaited<ReturnType<typeof prepareLeaveRequestV2>>> {
  if (
    !request.policyId ||
    !request.policyVersionId ||
    request.engineVersion !== 2
  ) {
    throw new Error("Canonical leave policy identity is missing");
  }
  const reservation = originalReservation(state.ledgerEntries);
  const submittedEvent = await ctx.db
    .query("leaveRequestEvents")
    .withIndex("by_request_created", (query) =>
      query.eq("leaveRequestId", request._id),
    )
    .filter((query) => query.eq(query.field("type"), "submitted"))
    .first();
  const details = parseSubmissionDetails(submittedEvent);
  const firstOccurrence = state.occurrences[0];
  const lastOccurrence = state.occurrences.at(-1);
  if (!firstOccurrence || !lastOccurrence || !request.requestedDurationMode) {
    throw new Error("Canonical leave request duration is missing");
  }
  const prepared = await prepareLeaveRequestV2(
    ctx,
    {
      organizationId: request.organizationId,
      employeeId: request.employeeId,
      policyId: request.policyId,
      startLocalDate: firstOccurrence.localDate,
      endLocalDate: lastOccurrence.localDate,
      requestedDurationMode: request.requestedDurationMode,
      requestedMinutes:
        request.requestedDurationMode === "hour"
          ? firstOccurrence.leaveMinutes
          : undefined,
      benefitEventId: request.benefitEventId ?? details.benefitEventId,
    },
    now,
    {
      existingReservationUnits: reservation ? -reservation.amount : 0,
      excludeLeaveRequestId: request._id,
    },
  );
  if (prepared.policyVersion._id !== request.policyVersionId) {
    throw new Error("Leave request policy version is no longer applicable");
  }
  if (
    prepared.occurrences.length !== state.occurrences.length ||
    prepared.occurrences.some((draft, index) => {
      const stored = state.occurrences[index];
      return (
        !stored ||
        stored.localDate !== draft.localDate ||
        stored.scheduledMinutes !== draft.scheduledMinutes ||
        stored.leaveMinutes !== draft.leaveMinutes ||
        stored.creditAmount !== draft.creditUnits ||
        stored.payTreatment !== prepared.policyVersion.payTreatment
      );
    })
  ) {
    throw new Error(
      "Leave schedule or holiday details changed after submission",
    );
  }
  const evidenceTypes = new Set(details.evidenceDocumentTypes);
  const attachments = await loadEffectiveLeaveAttachments(ctx, request);
  if (attachments.length < evidenceTypes.size) {
    throw new Error("Required leave evidence is no longer available");
  }
  for (const storageId of attachments) {
    const storageObject = await ctx.db
      .query("storageObjects")
      .withIndex("by_storage", (query) => query.eq("storageId", storageId))
      .unique();
    if (
      !storageObject ||
      storageObject.organizationId !== request.organizationId ||
      storageObject.purpose !== "leave_attachment" ||
      storageObject.state !== "active"
    ) {
      throw new Error("Required leave evidence is no longer available");
    }
  }
  for (const rule of prepared.policyVersion.requiredDocumentRules ?? []) {
    if (
      rule.requiredBefore === "approval" &&
      prepared.chargeableDuration >= (rule.minimumDuration ?? 0) &&
      !evidenceTypes.has(rule.documentType)
    ) {
      throw new Error(
        `Required leave evidence is missing: ${rule.documentType}`,
      );
    }
  }
  return prepared;
}

async function releasePendingReservation(
  ctx: MutationCtx,
  request: Doc<"leaveRequests">,
  state: CanonicalRequestState,
  actorId: Id<"users">,
  reason: string,
  now: number,
  actionKey: string,
): Promise<void> {
  const reservation = originalReservation(state.ledgerEntries);
  if (!reservation) return;
  await releaseReservation(ctx, {
    organizationId: request.organizationId,
    employeeId: request.employeeId,
    balanceId: reservation.balanceId,
    policyVersionId: reservation.policyVersionId,
    effectiveDate: now,
    unit: reservation.unit,
    referenceType: "request",
    leaveRequestId: request._id,
    actorId,
    reason,
    idempotencyKey: `leave-request:${request._id}:${actionKey}:release`,
    reversalOfEntryId: reservation._id,
    createdAt: now,
    units: -reservation.amount,
  });
}

async function notifyLeaveDecision(
  ctx: MutationCtx,
  request: Doc<"leaveRequests">,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const requesterId = await getUserIdForEmployeeInOrg(
    ctx,
    request.organizationId,
    request.employeeId,
  );
  if (!requesterId) return;
  await insertInAppNotification(ctx, {
    userId: requesterId,
    organizationId: request.organizationId,
    type: decision === "approved" ? "leave_approved" : "leave_rejected",
    title:
      decision === "approved"
        ? "Leave request approved"
        : "Leave request not approved",
    body: reason?.trim() || undefined,
    pathAfterOrg: "leave?tab=history",
    leaveRequestId: request._id,
  });
}

async function restoreRequestUsageEntries(
  ctx: MutationCtx,
  request: Doc<"leaveRequests">,
  ledgerEntries: readonly Doc<"leaveLedgerEntries">[],
  actorId: Id<"users">,
  reason: string,
  now: number,
  actionKey: string,
): Promise<void> {
  const usageEntries = requestUsageEntries(ledgerEntries);
  if (usageEntries.length === 0) {
    const policyVersion = request.policyVersionId
      ? await ctx.db.get(request.policyVersionId)
      : null;
    if (policyVersion?.accountBehavior === "non_credit") return;
    throw new Error("Approved leave usage entry is missing");
  }
  for (const usage of usageEntries) {
    await restoreUsage(ctx, {
      organizationId: request.organizationId,
      employeeId: request.employeeId,
      balanceId: usage.balanceId,
      policyVersionId: usage.policyVersionId,
      effectiveDate: now,
      unit: usage.unit,
      referenceType: actionKey === "correction" ? "correction" : "request",
      leaveRequestId: request._id,
      actorId,
      reason,
      idempotencyKey: `leave-request:${request._id}:${actionKey}:${usage._id}`,
      reversalOfEntryId: usage._id,
      createdAt: now,
      units: -usage.amount,
    });
  }
}

function getDefaultLeaveRequestIsPaid(
  request: Pick<
    Doc<"leaveRequests">,
    "leaveType" | "customLeaveType" | "isPaid"
  >,
  settings: EffectiveSettings,
) {
  if (
    request.leaveType === "custom" &&
    request.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
  ) {
    return true;
  }

  const typeKey =
    request.leaveType === "custom" && request.customLeaveType
      ? request.customLeaveType
      : request.leaveType;
  const configured = (settings?.leaveTypes ?? []).find(
    (type) => type.type === typeKey,
  );

  return configured?.isPaid !== false;
}

function resolveLeaveRequestIsPaid(
  request: Pick<
    Doc<"leaveRequests">,
    "leaveType" | "customLeaveType" | "isPaid"
  >,
  settings: EffectiveSettings,
) {
  return typeof request.isPaid === "boolean"
    ? request.isPaid
    : getDefaultLeaveRequestIsPaid(request, settings);
}

function getUsedForConfiguredType(
  leaveCredits: EmployeeLeaveCredits,
  typeKey: string,
): number {
  if (typeKey === "vacation") return leaveCredits.vacation?.used ?? 0;
  if (typeKey === "sick") return leaveCredits.sick?.used ?? 0;
  const c = leaveCredits.custom?.find((credit) => credit.type === typeKey);
  return c?.used ?? 0;
}

function computeGeneralLeaveSummary(
  employee: EffectiveEmployee,
  settings: EffectiveSettings,
  referenceDate: number,
) {
  const hireDate = employee.employment?.hireDate;
  const regularizationDate =
    employee.employment?.regularizationDate ?? undefined;
  const grantLeaveUponRegularization =
    settings?.grantLeaveUponRegularization !== false;
  const proratedLeaveSetting = settings?.proratedLeave !== false;
  const annualSilBase = settings?.annualSil ?? 8;
  const enableAnniversaryLeave = settings?.enableAnniversaryLeave !== false;
  const anniversaryLeaveMaxDays = settings?.anniversaryLeaveMaxDays ?? 15;
  const paidLeaveRequiresRegularization =
    settings?.paidLeaveRequiresRegularization !== false;

  const leaveCredits = cloneLeaveCredits(employee.leaveCredits);

  if (!hireDate) {
    return {
      proratedSil: 0,
      anniversaryLeave: 0,
      entitlementTotal: 0,
      usedCombined:
        (leaveCredits.vacation?.used ?? 0) + (leaveCredits.sick?.used ?? 0),
      available: 0,
    };
  }

  const anniversaryStartDate = grantLeaveUponRegularization
    ? regularizationDate
    : hireDate;

  const proratedSil = calculateAnnualLeaveBase({
    annualLeave: annualSilBase,
    hireDate,
    regularizationDate,
    referenceDate,
    proratedLeave: proratedLeaveSetting,
    grantLeaveUponRegularization,
    paidLeaveRequiresRegularization,
  });
  const anniversaryLeave = calculatePolicyAnniversaryLeave({
    enabled: enableAnniversaryLeave,
    maxDays: anniversaryLeaveMaxDays,
    startDate:
      paidLeaveRequiresRegularization && !regularizationDate
        ? undefined
        : anniversaryStartDate,
    referenceDate,
  });
  const entitlementTotal =
    Math.round((proratedSil + anniversaryLeave) * 100) / 100;
  const usedCombined =
    (leaveCredits.vacation?.used ?? 0) + (leaveCredits.sick?.used ?? 0);
  const available = Math.max(
    0,
    Math.round((entitlementTotal - usedCombined) * 100) / 100,
  );

  return {
    proratedSil,
    anniversaryLeave,
    entitlementTotal,
    usedCombined,
    available,
  };
}

export const previewLeaveRequestV2 = query({
  args: leaveRequestV2DraftArgs,
  handler: async (ctx, args) => {
    await requireLeaveSelfService(ctx, args.organizationId, args.employeeId);
    const prepared = await prepareLeaveRequestV2(ctx, args, Date.now());
    const overlap = await findOverlappingLeaveRequest(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      startDate: prepared.requestedStart,
      endDate: prepared.requestedEnd,
      statuses: ACTIVE_LEAVE_REQUEST_STATUSES,
    });
    if (overlap) throw new Error(formatLeaveConflictMessage(overlap));
    return {
      policy: {
        policyId: prepared.policy._id,
        policyVersionId: prepared.policyVersion._id,
        name: prepared.policy.name,
        payTreatment: prepared.policyVersion.payTreatment,
      },
      requestedStart: prepared.requestedStart,
      requestedEnd: prepared.requestedEnd,
      chargeableDuration: prepared.chargeableDuration,
      availableBalance: prepared.availableBalance,
      remainingBalance: prepared.remainingBalance,
      requiredDocuments: (prepared.policyVersion.requiredDocumentRules ?? [])
        .filter(
          (rule) =>
            rule.requiredBefore === "submission" &&
            prepared.chargeableDuration >= (rule.minimumDuration ?? 0),
        )
        .map((rule) => rule.documentType),
      occurrences: prepared.occurrences.map((occurrence) => ({
        localDate: occurrence.localDate,
        scheduledMinutes: occurrence.scheduledMinutes,
        leaveMinutes: occurrence.leaveMinutes,
        creditAmount: occurrence.creditUnits,
        isHoliday: occurrence.isHoliday,
        isRestDay: occurrence.isRestDay,
      })),
    };
  },
});

export const createLeaveRequestV2 = mutation({
  args: {
    ...leaveRequestV2DraftArgs,
    reason: v.string(),
    attachments: v.optional(v.array(leaveRequestAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Leave reason is required");
    const access = await requireLeaveSelfService(
      ctx,
      args.organizationId,
      args.employeeId,
    );
    const now = Date.now();
    const prepared = await prepareLeaveRequestV2(ctx, args, now);
    const overlap = await findOverlappingLeaveRequest(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      startDate: prepared.requestedStart,
      endDate: prepared.requestedEnd,
      statuses: ACTIVE_LEAVE_REQUEST_STATUSES,
    });
    if (overlap) throw new Error(formatLeaveConflictMessage(overlap));

    const storageIds = await validateLeaveRequestAttachments(ctx, {
      organizationId: args.organizationId,
      userId: access.user._id,
      attachments: args.attachments ?? [],
      policyVersion: prepared.policyVersion,
      chargeableDuration: prepared.chargeableDuration,
    });
    const benefitEventId = prepared.benefitEvent
      ? prepared.benefitEvent._id
      : prepared.benefitEventDraft
        ? await ctx.db.insert("leaveBenefitEvents", {
            organizationId: args.organizationId,
            employeeId: args.employeeId,
            eventType: prepared.benefitEventDraft.eventType,
            qualifyingDate: prepared.benefitEventDraft.qualifyingDate,
            benefitVariant: prepared.benefitEventDraft.benefitVariant,
            verificationStatus: "pending",
            documentReferences: (args.attachments ?? []).map(
              (attachment) => attachment.storageObjectId,
            ),
            createdBy: access.user._id,
            createdAt: now,
            updatedAt: now,
          })
        : undefined;
    const legacyType = legacyLeaveTypeForPolicy(prepared.policy);
    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      ...legacyType,
      startDate: prepared.requestedStart,
      endDate: prepared.requestedEnd,
      numberOfDays: prepared.chargeableDuration,
      reason,
      isPaid: prepared.policyVersion.payTreatment !== "unpaid",
      status: "pending",
      policyId: prepared.policy._id,
      policyVersionId: prepared.policyVersion._id,
      benefitEventId,
      requestedStart: prepared.requestedStart,
      requestedEnd: prepared.requestedEnd,
      requestedDurationMode: args.requestedDurationMode,
      chargeableDuration: prepared.chargeableDuration,
      payTreatment: prepared.policyVersion.payTreatment,
      submittedBy: access.user._id,
      engineVersion: 2,
      cutoverAt: prepared.settings.policyEngineCutoverAt,
      filedDate: now,
      createdAt: now,
      updatedAt: now,
    });
    const leaveRequest = await ctx.db.get(leaveRequestId);
    if (!leaveRequest) throw new Error("Leave request was not created");

    await insertLeaveRequestOccurrences(ctx, {
      leaveRequestId,
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      payTreatment: prepared.policyVersion.payTreatment,
      occurrences: prepared.occurrences,
      now,
    });
    if (prepared.balance) {
      await reserveUnits(ctx, {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        balanceId: prepared.balance._id,
        policyVersionId: prepared.policyVersion._id,
        effectiveDate: prepared.requestedStart,
        unit: "day",
        referenceType: "request",
        leaveRequestId,
        actorId: access.user._id,
        reason: `Reservation for ${prepared.policy.name}`,
        idempotencyKey: `leave-request:${leaveRequestId}:reservation`,
        createdAt: now,
        units: prepared.chargeableDuration,
      });
    }
    await replaceLeaveAttachments(ctx, leaveRequest, storageIds, now);
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId,
      organizationId: args.organizationId,
      type: "submitted",
      actorId: access.user._id,
      detailsJson: JSON.stringify({
        startLocalDate: args.startLocalDate,
        endLocalDate: args.endLocalDate,
        requestedDurationMode: args.requestedDurationMode,
        benefitEventId,
        benefitEventCreated: prepared.benefitEventDraft !== null,
        evidenceDocumentTypes: (args.attachments ?? []).map((attachment) =>
          attachment.documentType.trim(),
        ),
      }),
      createdAt: now,
    });

    const approverIds = await getV2LeaveApprovers(
      ctx,
      args.organizationId,
      access.user._id,
    );
    const employeeName =
      `${prepared.employee.personalInfo.firstName} ${prepared.employee.personalInfo.lastName}`.trim() ||
      "An employee";
    for (const approverId of approverIds) {
      await insertInAppNotification(ctx, {
        userId: approverId,
        organizationId: args.organizationId,
        type: "leave_submitted",
        title: `New leave request: ${employeeName}`,
        body: `${prepared.policy.name} · ${args.startLocalDate} – ${args.endLocalDate} · ${prepared.chargeableDuration} day(s)`,
        pathAfterOrg: "leave?tab=requests",
        leaveRequestId,
      });
    }
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId,
      organizationId: args.organizationId,
      type: "notification_sent",
      actorId: access.user._id,
      detailsJson: JSON.stringify({ approverCount: approverIds.length }),
      createdAt: now,
    });
    return { leaveRequestId, chargeableDuration: prepared.chargeableDuration };
  },
});

export const getMyLeaveDashboard = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireActiveMembership(ctx, args.organizationId);
    await requireActiveLeaveEngineV2(ctx, args.organizationId);
    const employeeId = access.membership.employeeId;
    if (!employeeId) throw new Error("Employee record is not linked");
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      throw new Error("Employee not found in organization");
    }
    const year = new Date(Date.now() + 8 * 60 * 60 * 1_000).getUTCFullYear();
    const [balances, policies, pendingRequests] = await Promise.all([
      ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_employee_year_type", (builder) =>
          builder.eq("employeeId", employeeId).eq("year", year),
        )
        .filter((builder) =>
          builder.and(
            builder.eq(builder.field("migrationVersion"), 2),
            builder.neq(builder.field("periodStart"), undefined),
            builder.neq(builder.field("periodEnd"), undefined),
            builder.neq(builder.field("engineStatus"), undefined),
          ),
        )
        .take(101),
      ctx.db
        .query("leavePolicies")
        .withIndex("by_organization_state", (builder) =>
          builder
            .eq("organizationId", args.organizationId)
            .eq("state", "active"),
        )
        .take(101),
      ctx.db
        .query("leaveRequests")
        .withIndex("by_employee", (builder) =>
          builder.eq("employeeId", employeeId),
        )
        .filter((builder) => builder.eq(builder.field("status"), "pending"))
        .take(101),
    ]);
    if (
      balances.length > 100 ||
      policies.length > 100 ||
      pendingRequests.length > 100
    ) {
      throw new Error("Leave dashboard exceeds the supported row limit");
    }
    const policyCoverage = await Promise.all(
      policies.map((policy) =>
        isStatutoryPolicyCoveredAt(ctx, policy, Date.now()),
      ),
    );
    const policyOptions = await Promise.all(
      policies
        .filter((_, index) => !policyCoverage[index])
        .map(async (policy) => {
          const version = await ctx.db
            .query("leavePolicyVersions")
            .withIndex("by_policy_effective", (builder) =>
              builder
                .eq("leavePolicyId", policy._id)
                .lte("effectiveStart", Date.now()),
            )
            .order("desc")
            .first();
          if (!version || (version.effectiveEnd ?? Infinity) < Date.now()) {
            return null;
          }
          return {
            policyId: policy._id,
            sourceKey: policy.sourceKey,
            name: policy.name,
            category: policy.category,
            confidentiality: policy.confidentiality,
            qualifyingEventRequired:
              version.qualifyingEventRequired === true ||
              version.eligibilityBasis === "event",
            eventEntitlementRules: version.eventEntitlementRules ?? [],
          };
        }),
    );
    return {
      employee: {
        employeeId,
        displayName:
          `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim(),
        employmentStatus: employee.employment.status,
      },
      year,
      balances: balances.map((balance) => ({
        balanceId: balance._id,
        policyId: balance.policyId,
        poolKey: balance.poolKey,
        leaveTypeKey: balance.leaveTypeKey,
        granted: balance.granted ?? balance.total,
        used: balance.used,
        reserved: balance.reserved ?? 0,
        available: balance.balance,
      })),
      policies: policyOptions.filter(
        (policy): policy is NonNullable<typeof policy> => policy !== null,
      ),
      pendingRequestCount: pendingRequests.length,
    };
  },
});

export const getMyLeaveRequests = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("cancellation_requested"),
        v.literal("cancelled"),
        v.literal("corrected"),
      ),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireActiveMembership(ctx, args.organizationId);
    await requireActiveLeaveEngineV2(ctx, args.organizationId);
    const employeeId = access.membership.employeeId;
    if (!employeeId) throw new Error("Employee record is not linked");
    const page = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee", (builder) =>
        builder.eq("employeeId", employeeId),
      )
      .filter((builder) =>
        builder.and(
          builder.eq(builder.field("organizationId"), args.organizationId),
          args.status === undefined
            ? builder.eq(builder.field("employeeId"), employeeId)
            : builder.eq(builder.field("status"), args.status),
        ),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (request) => ({
          ...request,
          supportingDocuments: await loadEffectiveLeaveAttachments(
            ctx,
            request,
          ),
        })),
      ),
    };
  },
});

export const getLeaveApprovalInbox = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("cancellation_requested")),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireLeaveAdministrator(ctx, args.organizationId);
    const activeSensitiveGrant = await ctx.db
      .query("leaveSensitiveAccessGrants")
      .withIndex("by_membership_active", (query) =>
        query.eq("membershipId", access.membership._id).eq("isActive", true),
      )
      .filter((query) =>
        query.eq(query.field("organizationId"), args.organizationId),
      )
      .first();
    const page = await ctx.db
      .query("leaveRequests")
      .withIndex("by_organization_status_created", (query) =>
        query
          .eq("organizationId", args.organizationId)
          .eq("status", args.status ?? "pending"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (request) => {
          const [employee, policy, policyVersion, attachments, occurrences] =
            await Promise.all([
              ctx.db.get(request.employeeId),
              request.policyId
                ? ctx.db.get(request.policyId)
                : Promise.resolve(null),
              request.policyVersionId
                ? ctx.db.get(request.policyVersionId)
                : Promise.resolve(null),
              loadEffectiveLeaveAttachments(ctx, request),
              ctx.db
                .query("leaveRequestOccurrences")
                .withIndex("by_request_local_date", (query) =>
                  query.eq("leaveRequestId", request._id),
                )
                .take(MAX_REQUEST_WORKFLOW_ROWS + 1),
            ]);
          if (occurrences.length > MAX_REQUEST_WORKFLOW_ROWS) {
            throw new Error("Leave request occurrence count exceeds the limit");
          }
          const requiredDocumentCount =
            policyVersion?.requiredDocumentRules?.filter(
              (rule) =>
                rule.requiredBefore === "approval" &&
                (rule.minimumDuration === undefined ||
                  (request.chargeableDuration ?? request.numberOfDays) >=
                    rule.minimumDuration),
            ).length ?? 0;
          const hasSensitiveAccess =
            policy?.confidentiality !== "restricted" ||
            canViewSensitiveLeave({
              isRequestEmployee:
                access.membership.employeeId === request.employeeId,
              hasActiveGrant: activeSensitiveGrant !== null,
            });
          const safeRequest = hasSensitiveAccess
            ? request
            : {
                ...request,
                leaveType: "custom" as const,
                customLeaveType: undefined,
                policyId: undefined,
                policyVersionId: undefined,
                benefitEventId: undefined,
                payTreatment: undefined,
                reason: "Restricted leave details",
                formTemplateContent: undefined,
                filledFormContent: undefined,
                signatureDataUrl: undefined,
                decisionReason: undefined,
                cancellationReason: undefined,
                remarks: undefined,
              };
          return {
            ...safeRequest,
            employeeName: employee
              ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim() ||
                "Employee"
              : "Former employee",
            policyName:
              policy?.confidentiality === "restricted" && !hasSensitiveAccess
                ? "Protected leave"
                : (policy?.name ??
                  request.customLeaveType ??
                  request.leaveType),
            confidentiality: policy?.confidentiality ?? "standard",
            hasSensitiveAccess,
            requiredDocumentCount,
            submittedDocumentCount: attachments.length,
            hasConflict: occurrences.some(
              (occurrence) => occurrence.attendanceConflictState === "detected",
            ),
          };
        }),
      ),
    };
  },
});

export const getApprovedLeaveCalendar = query({
  args: {
    organizationId: v.id("organizations"),
    startLocalDate: v.string(),
    endLocalDate: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireLeaveAdministrator(ctx, args.organizationId);
    const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (
      !localDatePattern.test(args.startLocalDate) ||
      !localDatePattern.test(args.endLocalDate) ||
      args.startLocalDate > args.endLocalDate
    ) {
      throw new Error("A valid leave calendar date range is required");
    }
    const page = await ctx.db
      .query("leaveRequestOccurrences")
      .withIndex("by_organization_local_date", (query) =>
        query
          .eq("organizationId", args.organizationId)
          .gte("localDate", args.startLocalDate)
          .lte("localDate", args.endLocalDate),
      )
      .filter((query) => query.eq(query.field("lifecycleState"), "approved"))
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (occurrence) => {
          const request = await ctx.db.get(occurrence.leaveRequestId);
          if (!request || request.organizationId !== args.organizationId) {
            throw new Error("Leave calendar request is missing");
          }
          const [employee, policy] = await Promise.all([
            ctx.db.get(occurrence.employeeId),
            request.policyId
              ? ctx.db.get(request.policyId)
              : Promise.resolve(null),
          ]);
          const confidentiality = policy?.confidentiality ?? "standard";
          const date = Date.parse(`${occurrence.localDate}T00:00:00+08:00`);
          return {
            id: occurrence._id,
            leaveRequestId: request._id,
            employeeName: employee
              ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim() ||
                "Employee"
              : "Former employee",
            policyName:
              confidentiality === "restricted"
                ? "Protected leave"
                : (policy?.name ??
                  request.customLeaveType ??
                  request.leaveType),
            confidentiality,
            reason:
              confidentiality === "restricted" ? undefined : request.reason,
            startDate: date,
            endDate: date,
            status: "approved" as const,
          };
        }),
      ),
    };
  },
});

export const getLeaveBalanceAdministration = query({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireLeaveAdministrator(ctx, args.organizationId);
    if (!Number.isInteger(args.year) || args.year < 1970 || args.year > 9999) {
      throw new Error("A valid leave balance year is required");
    }
    const page = await ctx.db
      .query("employeeLeaveBalances")
      .withIndex("by_organization_year", (query) =>
        query.eq("organizationId", args.organizationId).eq("year", args.year),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("migrationVersion"), 2),
          query.neq(query.field("periodStart"), undefined),
          query.neq(query.field("periodEnd"), undefined),
          query.neq(query.field("engineStatus"), undefined),
        ),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (balance) => {
          const [employee, policy] = await Promise.all([
            ctx.db.get(balance.employeeId),
            balance.policyId
              ? ctx.db.get(balance.policyId)
              : Promise.resolve(null),
          ]);
          const employeeName = employee
            ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim()
            : "Former employee";
          return {
            balanceId: balance._id,
            employeeId: balance.employeeId,
            policyId: balance.policyId,
            employeeName: employeeName || "Employee",
            policyName: policy?.name ?? balance.leaveTypeKey,
            available: balance.balance,
            isSeparated:
              !employee || !canUseEmployeeSelfService(employee.employment.status),
            periodStart: balance.periodStart,
            periodEnd: balance.periodEnd,
            engineStatus: balance.engineStatus ?? "reconciliation_required",
          };
        }),
      ),
    };
  },
});

export const getLeaveBalanceLedgerEntries = query({
  args: {
    balanceId: v.id("employeeLeaveBalances"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const balance = await ctx.db.get(args.balanceId);
    if (!balance) throw new Error("Leave balance not found");
    await requireLeaveAdministrator(ctx, balance.organizationId);
    const page = await ctx.db
      .query("leaveLedgerEntries")
      .withIndex("by_balance_effective", (query) =>
        query.eq("balanceId", balance._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (entry) => {
          const actor = entry.actorId ? await ctx.db.get(entry.actorId) : null;
          return {
            id: entry._id,
            kind: entry.kind,
            amount: entry.amount,
            effectiveDate: entry.effectiveDate,
            actorName: actor ? reviewerDisplayName(actor) : undefined,
            reason: entry.reason,
          };
        }),
      ),
    };
  },
});

export const getLeaveReviewContext = query({
  args: { leaveRequestId: v.id("leaveRequests") },
  handler: async (ctx, args) => {
    const { request } = await requireFinalLeaveReviewer(
      ctx,
      args.leaveRequestId,
    );
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    await requireRequestSensitiveAccessIfNeeded(ctx, request);
    const state = await loadCanonicalRequestState(ctx, request._id);
    const ledgerEntry =
      originalReservation(state.ledgerEntries) ??
      requestUsageEntries(state.ledgerEntries)[0];
    const balance = ledgerEntry
      ? await ctx.db.get(ledgerEntry.balanceId)
      : null;
    const benefitEvent = request.benefitEventId
      ? await ctx.db.get(request.benefitEventId)
      : null;
    if (
      benefitEvent &&
      (benefitEvent.organizationId !== request.organizationId ||
        benefitEvent.employeeId !== request.employeeId)
    ) {
      throw new Error("Leave qualifying event does not match the request");
    }
    const attachmentStorageIds = await loadEffectiveLeaveAttachments(ctx, request);
    const supportingDocuments = await Promise.all(
      attachmentStorageIds.map(async (storageId, index) => {
        const storageObject = await ctx.db
          .query("storageObjects")
          .withIndex("by_storage", (query) => query.eq("storageId", storageId))
          .unique();
        if (
          !storageObject ||
          storageObject.organizationId !== request.organizationId ||
          storageObject.purpose !== "leave_attachment" ||
          storageObject.state !== "active"
        ) {
          throw new Error("Leave evidence is no longer available");
        }
        return {
          storageId,
          fileName: storageObject.fileName ?? `Leave evidence ${index + 1}`,
          contentType: storageObject.contentType,
          size: storageObject.size,
          url: await ctx.storage.getUrl(storageId),
        };
      }),
    );
    return {
      request,
      benefitEvent,
      occurrences: state.occurrences,
      balance: balance
        ? {
            balanceId: balance._id,
            available: balance.balance,
            reserved: balance.reserved ?? 0,
            used: balance.used,
          }
        : null,
      supportingDocuments,
    };
  },
});

export const approveLeaveRequestV2 = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    decisionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireFinalLeaveReviewer(ctx, args.leaveRequestId);
    const request = access.request;
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    await requireRequestSensitiveAccessIfNeeded(ctx, request);
    if (request.status !== "pending") {
      throw new Error("Leave request is no longer pending");
    }
    const now = Date.now();
    if (request.benefitEventId) {
      const benefitEvent = await ctx.db.get(request.benefitEventId);
      if (
        !benefitEvent ||
        benefitEvent.organizationId !== request.organizationId ||
        benefitEvent.employeeId !== request.employeeId ||
        benefitEvent.verificationStatus === "rejected"
      ) {
        throw new Error("The qualifying event is not eligible for approval");
      }
      if (benefitEvent.verificationStatus === "pending") {
        await ctx.db.patch(benefitEvent._id, {
          verificationStatus: "verified",
          verifiedBy: access.user._id,
          verifiedAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("leaveRequestEvents", {
          leaveRequestId: request._id,
          organizationId: request.organizationId,
          type: "document_verified",
          actorId: access.user._id,
          detailsJson: JSON.stringify({ benefitEventId: benefitEvent._id }),
          createdAt: now,
        });
      }
    }
    const state = await loadCanonicalRequestState(ctx, request._id);
    if (
      state.occurrences.some(
        (occurrence) => occurrence.lifecycleState !== "reserved",
      )
    ) {
      throw new Error("Leave request occurrence state is invalid");
    }
    assertOccurrencesUnlocked(state.occurrences);
    const overlap = await findOverlappingLeaveRequest(ctx, {
      organizationId: request.organizationId,
      employeeId: request.employeeId,
      startDate: request.requestedStart ?? request.startDate,
      endDate: request.requestedEnd ?? request.endDate,
      statuses: ["approved"],
      excludeLeaveRequestId: request._id,
    });
    if (overlap) throw new Error(formatLeaveConflictMessage(overlap));
    const prepared = await revalidatePendingRequest(ctx, request, state, now);
    const reservation = originalReservation(state.ledgerEntries);
    if (prepared.balance && !reservation) {
      throw new Error("Leave request reservation is missing");
    }
    if (reservation) {
      await consumeReservation(ctx, {
        organizationId: request.organizationId,
        employeeId: request.employeeId,
        balanceId: reservation.balanceId,
        policyVersionId: reservation.policyVersionId,
        effectiveDate: now,
        unit: reservation.unit,
        referenceType: "request",
        leaveRequestId: request._id,
        actorId: access.user._id,
        reason: args.decisionReason?.trim() || "Leave request approved",
        idempotencyKey: `leave-request:${request._id}:approval`,
        createdAt: now,
        units: -reservation.amount,
      });
    }
    await setOccurrenceLifecycle(ctx, state.occurrences, "approved", now);
    const displayName = reviewerDisplayName(access.user);
    const decisionReason = args.decisionReason?.trim() || undefined;
    await ctx.db.patch(request._id, {
      status: "approved",
      reviewerId: access.user._id,
      reviewedAt: now,
      decisionReason,
      reviewerSnapshot: {
        displayName,
        position: access.membership.role,
      },
      reviewedBy: access.user._id,
      reviewedDate: now,
      approvedByName: displayName,
      remarks: decisionReason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "approved",
      actorId: access.user._id,
      reason: decisionReason,
      createdAt: now,
    });
    await ensurePendingBenefitReconciliation(
      ctx,
      request,
      access.user._id,
      now,
    );
    await notifyLeaveDecision(ctx, request, "approved", decisionReason);
    return { status: "approved" as const };
  },
});

export const rejectLeaveRequestV2 = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    decisionReason: v.string(),
  },
  handler: async (ctx, args) => {
    const decisionReason = args.decisionReason.trim();
    if (!decisionReason) throw new Error("Decision reason is required");
    const access = await requireFinalLeaveReviewer(ctx, args.leaveRequestId);
    const request = access.request;
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    await requireRequestSensitiveAccessIfNeeded(ctx, request);
    if (request.status !== "pending") {
      throw new Error("Leave request is no longer pending");
    }
    const now = Date.now();
    if (request.benefitEventId) {
      const benefitEvent = await ctx.db.get(request.benefitEventId);
      if (
        benefitEvent &&
        benefitEvent.organizationId === request.organizationId &&
        benefitEvent.employeeId === request.employeeId &&
        benefitEvent.verificationStatus === "pending"
      ) {
        await ctx.db.patch(benefitEvent._id, {
          verificationStatus: "rejected",
          verifiedBy: access.user._id,
          verifiedAt: now,
          updatedAt: now,
        });
      }
    }
    const state = await loadCanonicalRequestState(ctx, request._id);
    await releasePendingReservation(
      ctx,
      request,
      state,
      access.user._id,
      decisionReason,
      now,
      "rejection",
    );
    await setOccurrenceLifecycle(ctx, state.occurrences, "cancelled", now);
    const displayName = reviewerDisplayName(access.user);
    await ctx.db.patch(request._id, {
      status: "rejected",
      reviewerId: access.user._id,
      reviewedAt: now,
      decisionReason,
      reviewerSnapshot: {
        displayName,
        position: access.membership.role,
      },
      reviewedBy: access.user._id,
      reviewedDate: now,
      remarks: decisionReason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "rejected",
      actorId: access.user._id,
      reason: decisionReason,
      createdAt: now,
    });
    await notifyLeaveDecision(ctx, request, "rejected", decisionReason);
    return { status: "rejected" as const };
  },
});

export const withdrawPendingLeaveRequest = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");
    const access = await requireLeaveSelfService(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    if (request.status !== "pending") {
      throw new Error("Only a pending leave request can be withdrawn");
    }
    const now = Date.now();
    const reason = args.reason?.trim() || "Withdrawn by employee";
    const state = await loadCanonicalRequestState(ctx, request._id);
    await releasePendingReservation(
      ctx,
      request,
      state,
      access.user._id,
      reason,
      now,
      "withdrawal",
    );
    await setOccurrenceLifecycle(ctx, state.occurrences, "cancelled", now);
    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledBy: access.user._id,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "cancelled",
      actorId: access.user._id,
      reason,
      createdAt: now,
    });
    await voidBenefitReconciliation(ctx, request._id, access.user._id, now);
    return { status: "cancelled" as const };
  },
});

export const requestApprovedLeaveCancellation = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Cancellation reason is required");
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");
    const access = await requireLeaveSelfService(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    if (request.status !== "approved") {
      throw new Error("Only an approved leave request can be cancelled");
    }
    const now = Date.now();
    const state = await loadCanonicalRequestState(ctx, request._id);
    assertOccurrencesUnlocked(state.occurrences);
    assertFutureOccurrences(state.occurrences, now);
    await ctx.db.patch(request._id, {
      status: "cancellation_requested",
      cancellationRequestedBy: access.user._id,
      cancellationRequestedAt: now,
      cancellationReason: reason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "cancellation_requested",
      actorId: access.user._id,
      reason,
      createdAt: now,
    });
    return { status: "cancellation_requested" as const };
  },
});

export const approveLeaveCancellation = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Cancellation reason is required");
    const access = await requireFinalLeaveReviewer(ctx, args.leaveRequestId);
    const request = access.request;
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    await requireRequestSensitiveAccessIfNeeded(ctx, request);
    if (
      request.status !== "approved" &&
      request.status !== "cancellation_requested"
    ) {
      throw new Error("Leave request is not eligible for cancellation");
    }
    if (request.cancellationRequestedBy === access.user._id) {
      throw new Error("A second actor must approve the leave cancellation");
    }
    const now = Date.now();
    const state = await loadCanonicalRequestState(ctx, request._id);
    assertOccurrencesUnlocked(state.occurrences);
    assertFutureOccurrences(state.occurrences, now);
    await restoreRequestUsageEntries(
      ctx,
      request,
      state.ledgerEntries,
      access.user._id,
      reason,
      now,
      "cancellation",
    );
    await setOccurrenceLifecycle(ctx, state.occurrences, "cancelled", now);
    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledBy: access.user._id,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "cancelled",
      actorId: access.user._id,
      reason,
      createdAt: now,
    });
    await voidBenefitReconciliation(ctx, request._id, access.user._id, now);
    return { status: "cancelled" as const };
  },
});

export const correctProcessedLeave = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Correction reason is required");
    const access = await requireFinalLeaveReviewer(ctx, args.leaveRequestId);
    const request = access.request;
    await requireActiveLeaveEngineV2(ctx, request.organizationId);
    await requireRequestSensitiveAccessIfNeeded(ctx, request);
    if (request.status !== "approved") {
      throw new Error("Only approved processed leave can be corrected");
    }
    const now = Date.now();
    const state = await loadCanonicalRequestState(ctx, request._id);
    if (
      !state.occurrences.some(
        (occurrence) =>
          occurrence.payrollLockedAt !== undefined ||
          occurrence.payrollRunId !== undefined,
      )
    ) {
      throw new Error(
        "Use the ordinary cancellation workflow for unlocked leave",
      );
    }
    await restoreRequestUsageEntries(
      ctx,
      request,
      state.ledgerEntries,
      access.user._id,
      reason,
      now,
      "correction",
    );
    await setOccurrenceLifecycle(ctx, state.occurrences, "corrected", now);
    await ctx.db.patch(request._id, {
      status: "corrected",
      decisionReason: reason,
      updatedAt: now,
    });
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId: request._id,
      organizationId: request.organizationId,
      type: "corrected",
      actorId: access.user._id,
      reason,
      createdAt: now,
    });
    await voidBenefitReconciliation(ctx, request._id, access.user._id, now);
    return { status: "corrected" as const };
  },
});

export const adjustLeaveBalance = mutation({
  args: {
    balanceId: v.id("employeeLeaveBalances"),
    amount: v.number(),
    effectiveDate: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) throw new Error("Adjustment reason is required");
    if (!Number.isFinite(args.amount) || args.amount === 0) {
      throw new Error("Adjustment amount must be a non-zero finite number");
    }
    if (!Number.isFinite(args.effectiveDate) || args.effectiveDate < 0) {
      throw new Error("Adjustment effective date is required");
    }
    const balance = await ctx.db.get(args.balanceId);
    if (!balance) throw new Error("Leave balance not found");
    const access = await requireLeaveAdministrator(ctx, balance.organizationId);
    if (
      balance.periodStart === undefined ||
      balance.periodEnd === undefined ||
      args.effectiveDate < balance.periodStart ||
      args.effectiveDate > balance.periodEnd
    ) {
      throw new Error("Adjustment date must be within the balance period");
    }
    if (balance.engineStatus !== "open") {
      throw new Error("Only an open leave balance can be adjusted");
    }
    let policyVersionId = balance.policyVersionId;
    if (!policyVersionId && balance.lastLedgerEntryId) {
      policyVersionId = (await ctx.db.get(balance.lastLedgerEntryId))
        ?.policyVersionId;
    }
    if (!policyVersionId) {
      throw new Error("Leave balance policy version is missing");
    }
    const now = Date.now();
    await appendLedgerEntry(ctx, {
      organizationId: balance.organizationId,
      employeeId: balance.employeeId,
      balanceId: balance._id,
      policyVersionId,
      effectiveDate: args.effectiveDate,
      kind: "adjustment",
      amount: args.amount,
      unit: "day",
      referenceType: "correction",
      actorId: access.user._id,
      reason,
      idempotencyKey: `leave-adjustment:${balance._id}:${now}:${access.user._id}`,
      createdAt: now,
    });
    const updated = await ctx.db.get(balance._id);
    if (!updated) throw new Error("Leave balance disappeared after adjustment");
    return { balanceId: updated._id, available: updated.balance };
  },
});

export const recordManualLeaveV2 = mutation({
  args: {
    ...leaveRequestV2DraftArgs,
    reason: v.string(),
    decisionReason: v.string(),
    attachments: v.optional(v.array(leaveRequestAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    const decisionReason = args.decisionReason.trim();
    if (!reason) throw new Error("Leave reason is required");
    if (!decisionReason) throw new Error("Decision reason is required");
    const access = await requireLeaveAdministrator(ctx, args.organizationId);
    if (access.membership.employeeId === args.employeeId) {
      throw new Error("You cannot approve your own leave request");
    }
    const now = Date.now();
    const prepared = await prepareLeaveRequestV2(ctx, args, now);
    const overlap = await findOverlappingLeaveRequest(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      startDate: prepared.requestedStart,
      endDate: prepared.requestedEnd,
      statuses: ACTIVE_LEAVE_REQUEST_STATUSES,
    });
    if (overlap) throw new Error(formatLeaveConflictMessage(overlap));
    const storageIds = await validateLeaveRequestAttachments(ctx, {
      organizationId: args.organizationId,
      userId: access.user._id,
      attachments: args.attachments ?? [],
      policyVersion: prepared.policyVersion,
      chargeableDuration: prepared.chargeableDuration,
    });
    const displayName = reviewerDisplayName(access.user);
    const legacyType = legacyLeaveTypeForPolicy(prepared.policy);
    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      ...legacyType,
      startDate: prepared.requestedStart,
      endDate: prepared.requestedEnd,
      numberOfDays: prepared.chargeableDuration,
      reason,
      isPaid: prepared.policyVersion.payTreatment !== "unpaid",
      isManual: true,
      status: "approved",
      policyId: prepared.policy._id,
      policyVersionId: prepared.policyVersion._id,
      benefitEventId: prepared.benefitEvent?._id,
      requestedStart: prepared.requestedStart,
      requestedEnd: prepared.requestedEnd,
      requestedDurationMode: args.requestedDurationMode,
      chargeableDuration: prepared.chargeableDuration,
      payTreatment: prepared.policyVersion.payTreatment,
      submittedBy: access.user._id,
      reviewerId: access.user._id,
      reviewedAt: now,
      decisionReason,
      reviewerSnapshot: {
        displayName,
        position: access.membership.role,
      },
      engineVersion: 2,
      cutoverAt: prepared.settings.policyEngineCutoverAt,
      filedDate: now,
      reviewedBy: access.user._id,
      reviewedDate: now,
      approvedByName: displayName,
      remarks: decisionReason,
      createdAt: now,
      updatedAt: now,
    });
    const request = await ctx.db.get(leaveRequestId);
    if (!request) throw new Error("Manual leave request was not created");
    await insertLeaveRequestOccurrences(ctx, {
      leaveRequestId,
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      payTreatment: prepared.policyVersion.payTreatment,
      occurrences: prepared.occurrences,
      now,
    });
    const occurrences = await ctx.db
      .query("leaveRequestOccurrences")
      .withIndex("by_request_local_date", (query) =>
        query.eq("leaveRequestId", leaveRequestId),
      )
      .take(MAX_REQUEST_WORKFLOW_ROWS + 1);
    await setOccurrenceLifecycle(ctx, occurrences, "approved", now);
    if (prepared.balance) {
      await appendLedgerEntry(ctx, {
        organizationId: args.organizationId,
        employeeId: args.employeeId,
        balanceId: prepared.balance._id,
        policyVersionId: prepared.policyVersion._id,
        effectiveDate: prepared.requestedStart,
        kind: "usage",
        amount: -prepared.chargeableDuration,
        unit: "day",
        referenceType: "request",
        leaveRequestId,
        actorId: access.user._id,
        reason: decisionReason,
        idempotencyKey: `leave-request:${leaveRequestId}:manual-usage`,
        createdAt: now,
      });
    }
    await replaceLeaveAttachments(ctx, request, storageIds, now);
    await ctx.db.insert("leaveRequestEvents", {
      leaveRequestId,
      organizationId: args.organizationId,
      type: "approved",
      actorId: access.user._id,
      reason: decisionReason,
      detailsJson: JSON.stringify({
        manual: true,
        benefitEventId: prepared.benefitEvent?._id,
        evidenceDocumentTypes: (args.attachments ?? []).map((attachment) =>
          attachment.documentType.trim(),
        ),
      }),
      createdAt: now,
    });
    await ensurePendingBenefitReconciliation(
      ctx,
      request,
      access.user._id,
      now,
    );
    await notifyLeaveDecision(ctx, request, "approved", decisionReason);
    return { leaveRequestId, status: "approved" as const };
  },
});

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
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    const canReviewOrganizationLeave = canAdministerLeave(userRecord.role);

    // Only final reviewers can read organization-wide leave records. Every
    // other active member is restricted to the employee linked to membership.
    if (
      !canReviewOrganizationLeave &&
      args.employeeId &&
      args.employeeId !== userRecord.employeeId
    ) {
      throw new Error("Not authorized");
    }

    let requests = await ctx.db
      .query("leaveRequests")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    if (!canReviewOrganizationLeave && !args.employeeId) {
      const eid = userRecord.employeeId;
      if (!eid) {
        return [];
      }
      requests = requests.filter((request) => request.employeeId === eid);
    } else if (args.employeeId) {
      requests = requests.filter(
        (request) => request.employeeId === args.employeeId,
      );
    }

    if (args.status) {
      requests = requests.filter((request) => request.status === args.status);
    }

    requests.sort((a, b) => b.filedDate - a.filedDate);
    return await Promise.all(
      requests.map(async (request: Doc<"leaveRequests">) => ({
        ...request,
        supportingDocuments: await loadEffectiveLeaveAttachments(ctx, request),
      })),
    );
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

    const userRecord = await checkAuthForQuery(ctx, request.organizationId);
    if (!userRecord) return null;

    // Check authorization
    if (
      !canAdministerLeave(userRecord.role) &&
      userRecord.employeeId !== request.employeeId
    ) {
      throw new Error("Not authorized");
    }

    if (request.organizationId !== userRecord.organizationId) {
      throw new Error("Not authorized");
    }

    return {
      ...request,
      supportingDocuments: await loadEffectiveLeaveAttachments(ctx, request),
    };
  },
});

// Get approval eligibility for a pending leave request (admin/hr: why Approve may be disabled)
export const getLeaveRequestApprovalInfo = query({
  args: {
    leaveRequestId: v.id("leaveRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request)
      return { canApprove: false, blockReason: "Leave request not found" };

    const userRecord = await checkAuthForQuery(ctx, request.organizationId);
    if (!userRecord) {
      return { canApprove: false, blockReason: "Not authenticated" };
    }
    if (
      !canAdministerLeave(userRecord.role) &&
      userRecord.employeeId !== request.employeeId
    ) {
      return { canApprove: false, blockReason: "Not authorized" };
    }
    if (request.organizationId !== userRecord.organizationId) {
      return { canApprove: false, blockReason: "Not authorized" };
    }

    if (request.status !== "pending") {
      return { canApprove: false, blockReason: "Request is no longer pending" };
    }

    const employeeRow = await ctx.db.get(request.employeeId);
    if (!employeeRow)
      return { canApprove: false, blockReason: "Employee not found" };
    const employee = await loadEffectiveEmployee(ctx, employeeRow);

    const overlappingApprovedRequest = await findOverlappingLeaveRequest(ctx, {
      organizationId: request.organizationId,
      employeeId: request.employeeId,
      startDate: request.startDate,
      endDate: request.endDate,
      statuses: ["approved"] as const,
      excludeLeaveRequestId: args.leaveRequestId,
    });
    if (overlappingApprovedRequest) {
      return {
        canApprove: false,
        blockReason: formatLeaveConflictMessage(overlappingApprovedRequest),
      };
    }

    const settings = await getEffectiveSettings(ctx, request.organizationId);
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const now = Date.now();
    const requestIsPaid = resolveLeaveRequestIsPaid(request, settings);

    if (!requestIsPaid) {
      return { canApprove: true };
    }

    if (isGeneralPoolLeaveRequest(request, leaveTrackerMode)) {
      const g = computeGeneralLeaveSummary(employee, settings, now);
      if (g.available < request.numberOfDays) {
        return {
          canApprove: false,
          blockReason: `Insufficient leave credits. Available: ${g.available} days, Requested: ${request.numberOfDays} days.`,
        };
      }
      return { canApprove: true };
    }

    const leaveCredits = JSON.parse(
      JSON.stringify(employee.leaveCredits || {}),
    );
    const creditType = getCreditType(
      request.leaveType,
      request.customLeaveType,
    );
    const trackedCredit = hasTrackedCreditType(leaveCredits, creditType);
    const balance = trackedCredit
      ? getBalanceForType(leaveCredits, creditType)
      : Number.POSITIVE_INFINITY;

    if (trackedCredit && balance < request.numberOfDays) {
      const typeLabel =
        creditType === "vacation"
          ? "vacation"
          : creditType === "sick"
            ? "sick"
            : creditType || "this leave type";
      return {
        canApprove: false,
        blockReason: `Insufficient ${typeLabel} leave balance. Available: ${balance} days, Requested: ${request.numberOfDays} days.`,
      };
    }

    return { canApprove: true };
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
      v.literal("custom"),
    ),
    customLeaveType: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    reason: v.string(),
    formTemplateContent: v.optional(v.string()),
    filledFormContent: v.optional(v.string()),
    signatureDataUrl: v.optional(v.string()),
    supportingDocuments: v.optional(v.array(v.id("_storage"))),
    isPaid: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await assertLegacyLeaveEndpointAllowed(ctx, args.organizationId);
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Employees can only create requests for themselves
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);
    if (employee.organizationId !== args.organizationId) {
      throw new Error("Employee is not in this organization");
    }
    if (!canUseEmployeeSelfService(employee.employment.status)) {
      throw new Error(
        "Separated or inactive employees cannot create new leave requests.",
      );
    }

    if (args.endDate < args.startDate) {
      throw new Error("End date must be on or after start date");
    }

    // Calculate number of working days
    const numberOfDays = calculateWorkingDays(args.startDate, args.endDate);
    if (numberOfDays <= 0) {
      throw new Error("Leave period must include at least one working day");
    }

    const overlappingRequest = await findOverlappingLeaveRequest(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      startDate: args.startDate,
      endDate: args.endDate,
      statuses: ACTIVE_LEAVE_REQUEST_STATUSES,
    });
    if (overlappingRequest) {
      throw new Error(formatLeaveConflictMessage(overlappingRequest));
    }

    const settings = await getEffectiveSettings(ctx, args.organizationId);
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const usesGeneralPool =
      args.leaveType === "custom" &&
      args.customLeaveType === GENERAL_LEAVE_CREDIT_KEY;
    const requestIsPaid = resolveLeaveRequestIsPaid(args, settings);

    if (leaveTrackerMode === "by_type" && usesGeneralPool) {
      throw new Error(
        "This organization uses leave types — select the type of leave for your request.",
      );
    }

    const creditType = getCreditType(args.leaveType, args.customLeaveType);
    if (args.leaveType === "custom" && !args.customLeaveType) {
      throw new Error("Custom leave type name is required");
    }

    if (requestIsPaid) {
      if (usesGeneralPool && leaveTrackerMode === "general") {
        const g = computeGeneralLeaveSummary(employee, settings, Date.now());
        if (g.available < numberOfDays) {
          throw new Error(
            `Insufficient leave credits. Available: ${g.available} days, Requested: ${numberOfDays} days`,
          );
        }
      } else {
        const trackedCredit = hasTrackedCreditType(
          employee.leaveCredits,
          creditType,
        );
        const balance = trackedCredit
          ? getBalanceForType(employee.leaveCredits, creditType)
          : Number.POSITIVE_INFINITY;
        if (trackedCredit && balance < numberOfDays) {
          const typeLabel =
            creditType === "vacation"
              ? "vacation"
              : creditType === "sick"
                ? "sick"
                : creditType || "this leave type";
          throw new Error(
            `Insufficient ${typeLabel} leave credits. Available: ${balance} days, Requested: ${numberOfDays} days`,
          );
        }
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
      isPaid: requestIsPaid,
      formTemplateContent: args.formTemplateContent,
      filledFormContent: args.filledFormContent,
      signatureDataUrl: args.signatureDataUrl,
      status: "pending",
      filedDate: now,
      createdAt: now,
      updatedAt: now,
    });
    const leaveRequest = await ctx.db.get(leaveRequestId);
    if (!leaveRequest) throw new Error("Leave request was not created");
    await replaceLeaveAttachments(
      ctx,
      leaveRequest,
      args.supportingDocuments ?? [],
      now,
    );

    const typeLabel =
      args.leaveType === "custom" &&
      args.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
        ? "Annual leave"
        : args.customLeaveType || args.leaveType;
    const employeeName =
      `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim() ||
      "An employee";
    const periodStr = `${formatManilaNumericDate(args.startDate)} – ${formatManilaNumericDate(args.endDate)}`;
    const approverUserIds = await getUserIdsForLeaveApprovers(
      ctx,
      args.organizationId,
    );
    for (const approverId of approverUserIds) {
      await insertInAppNotification(ctx, {
        userId: approverId,
        organizationId: args.organizationId,
        type: "leave_submitted",
        title: `New leave request: ${employeeName}`,
        body: `${typeLabel} · ${periodStr} · ${numberOfDays} day(s)`,
        pathAfterOrg: "leave?tab=requests",
        leaveRequestId,
      });
    }

    return leaveRequestId;
  },
});

export const createManualLeaveRequest = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveType: v.union(
      v.literal("vacation"),
      v.literal("sick"),
      v.literal("emergency"),
      v.literal("maternity"),
      v.literal("paternity"),
      v.literal("custom"),
    ),
    customLeaveType: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    numberOfDays: v.optional(v.number()),
    reason: v.string(),
    isPaid: v.boolean(),
  },
  handler: async (ctx, args) => {
    await assertLegacyLeaveEndpointAllowed(ctx, args.organizationId);
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);
    if (employee.organizationId !== args.organizationId) {
      throw new Error("Employee is not in this organization");
    }
    if (args.endDate < args.startDate) {
      throw new Error("End date must be on or after start date");
    }
    if (args.leaveType === "custom" && !args.customLeaveType) {
      throw new Error("Custom leave type name is required");
    }

    const numberOfDays =
      args.numberOfDays !== undefined
        ? args.numberOfDays
        : calculateWorkingDays(args.startDate, args.endDate);
    if (!Number.isFinite(numberOfDays) || numberOfDays <= 0) {
      throw new Error("Leave days must be greater than zero");
    }

    const overlappingRequest = await findOverlappingLeaveRequest(ctx, {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      startDate: args.startDate,
      endDate: args.endDate,
      statuses: ACTIVE_LEAVE_REQUEST_STATUSES,
    });
    if (overlappingRequest) {
      throw new Error(formatLeaveConflictMessage(overlappingRequest));
    }

    const settings = await getEffectiveSettings(ctx, args.organizationId);
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const usesGeneralPool =
      args.leaveType === "custom" &&
      args.customLeaveType === GENERAL_LEAVE_CREDIT_KEY;

    if (leaveTrackerMode === "by_type" && usesGeneralPool) {
      throw new Error("Select a configured leave type for this organization.");
    }

    if (args.isPaid) {
      const leaveCredits = JSON.parse(
        JSON.stringify(employee.leaveCredits || {}),
      );
      if (usesGeneralPool && leaveTrackerMode === "general") {
        const g = computeGeneralLeaveSummary(employee, settings, Date.now());
        if (g.available < numberOfDays) {
          throw new Error(
            `Insufficient leave credits. Available: ${g.available} days, Requested: ${numberOfDays} days`,
          );
        }
        deductCreditsGeneralPool(leaveCredits, numberOfDays);
        await persistLeaveCredits(ctx, employee, leaveCredits);
      } else {
        const creditType = getCreditType(args.leaveType, args.customLeaveType);
        const trackedCredit = hasTrackedCreditType(leaveCredits, creditType);
        const balance = trackedCredit
          ? getBalanceForType(leaveCredits, creditType)
          : Number.POSITIVE_INFINITY;

        if (trackedCredit && balance < numberOfDays) {
          const typeLabel =
            creditType === "vacation"
              ? "vacation"
              : creditType === "sick"
                ? "sick"
                : creditType || "this leave type";
          throw new Error(
            `Insufficient ${typeLabel} leave credits. Available: ${balance} days, Requested: ${numberOfDays} days`,
          );
        }

        if (trackedCredit) {
          deductCreditsForType(leaveCredits, creditType, numberOfDays);
          await persistLeaveCredits(ctx, employee, leaveCredits);
        }
      }
    }

    const now = Date.now();
    return await ctx.db.insert("leaveRequests", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      leaveType: args.leaveType,
      customLeaveType: args.customLeaveType,
      startDate: args.startDate,
      endDate: args.endDate,
      numberOfDays,
      reason: args.reason,
      isPaid: args.isPaid,
      isManual: true,
      status: "approved",
      filedDate: now,
      reviewedBy: userRecord._id,
      reviewedDate: now,
      approvedByName: "Manual entry",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Approve leave request
export const approveLeaveRequest = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    remarks: v.optional(v.string()),
    approvedByName: v.string(),
    reviewerPosition: v.optional(v.string()),
    reviewerSignatureDataUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) throw new Error("Leave request not found");
    await assertLegacyLeaveEndpointAllowed(ctx, request.organizationId);

    const userRecord = await checkAuth(ctx, request.organizationId, "hr");

    if (request.status !== "pending") {
      throw new Error("Leave request is not pending");
    }

    const approvedByTrimmed = args.approvedByName.trim();
    const reviewerSigTrimmed = args.reviewerSignatureDataUrl.trim();
    if (!approvedByTrimmed) {
      throw new Error("Reviewer name is required");
    }
    if (!reviewerSigTrimmed) {
      throw new Error("Reviewer signature is required");
    }

    // Check and update leave credits
    const employeeRow = await ctx.db.get(request.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);

    const overlappingApprovedRequest = await findOverlappingLeaveRequest(ctx, {
      organizationId: request.organizationId,
      employeeId: request.employeeId,
      startDate: request.startDate,
      endDate: request.endDate,
      statuses: ["approved"] as const,
      excludeLeaveRequestId: args.leaveRequestId,
    });
    if (overlappingApprovedRequest) {
      throw new Error(formatLeaveConflictMessage(overlappingApprovedRequest));
    }

    const settings = await getEffectiveSettings(ctx, request.organizationId);
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const nowApprove = Date.now();
    const requestIsPaid = resolveLeaveRequestIsPaid(request, settings);

    const leaveCredits = JSON.parse(
      JSON.stringify(employee.leaveCredits || {}),
    );

    if (requestIsPaid) {
      if (isGeneralPoolLeaveRequest(request, leaveTrackerMode)) {
        const g = computeGeneralLeaveSummary(employee, settings, nowApprove);
        if (g.available < request.numberOfDays) {
          throw new Error(
            `Insufficient leave credits. Available: ${g.available} days, Requested: ${request.numberOfDays} days`,
          );
        }
        deductCreditsGeneralPool(leaveCredits, request.numberOfDays);
        await persistLeaveCredits(ctx, employee, leaveCredits);
      } else {
        const creditType = getCreditType(
          request.leaveType,
          request.customLeaveType,
        );
        const trackedCredit = hasTrackedCreditType(leaveCredits, creditType);
        const balance = trackedCredit
          ? getBalanceForType(leaveCredits, creditType)
          : Number.POSITIVE_INFINITY;

        if (trackedCredit && balance < request.numberOfDays) {
          const typeLabel =
            creditType === "vacation"
              ? "vacation"
              : creditType === "sick"
                ? "sick"
                : creditType || "this leave type";
          throw new Error(
            `Insufficient ${typeLabel} leave credits. Available: ${balance} days, Requested: ${request.numberOfDays} days`,
          );
        }

        if (trackedCredit) {
          deductCreditsForType(leaveCredits, creditType, request.numberOfDays);
          await persistLeaveCredits(ctx, employee, leaveCredits);
        }
      }
    }

    // Update leave request
    const positionTrimmed = args.reviewerPosition?.trim();

    await ctx.db.patch(args.leaveRequestId, {
      status: "approved",
      reviewedBy: userRecord._id,
      reviewedDate: Date.now(),
      remarks: args.remarks,
      approvedByName: approvedByTrimmed,
      reviewerPosition: positionTrimmed || undefined,
      reviewerSignatureDataUrl: reviewerSigTrimmed,
      updatedAt: Date.now(),
    });

    const typeLabelAppr =
      request.leaveType === "custom" &&
      request.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
        ? "Annual leave"
        : request.customLeaveType || request.leaveType;
    const requesterUserId = await getUserIdForEmployeeInOrg(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    if (requesterUserId) {
      const periodAppr = `${formatManilaNumericDate(request.startDate)} – ${formatManilaNumericDate(request.endDate)}`;
      await insertInAppNotification(ctx, {
        userId: requesterUserId,
        organizationId: request.organizationId,
        type: "leave_approved",
        title: "Leave request approved",
        body: `Your ${typeLabelAppr} request (${periodAppr}) was approved.`,
        pathAfterOrg: "leave?tab=history",
        leaveRequestId: args.leaveRequestId,
      });
    }

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
    await assertLegacyLeaveEndpointAllowed(ctx, request.organizationId);

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

    const typeLabelRej =
      request.leaveType === "custom" &&
      request.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
        ? "Annual leave"
        : request.customLeaveType || request.leaveType;
    const requesterRej = await getUserIdForEmployeeInOrg(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    if (requesterRej) {
      const periodRej = `${formatManilaNumericDate(request.startDate)} – ${formatManilaNumericDate(request.endDate)}`;
      const remarkExcerpt = (args.remarks || "").trim().slice(0, 200);
      await insertInAppNotification(ctx, {
        userId: requesterRej,
        organizationId: request.organizationId,
        type: "leave_rejected",
        title: "Leave request not approved",
        body: `Your ${typeLabelRej} request (${periodRej}) was declined.${remarkExcerpt ? ` Note: ${remarkExcerpt}` : ""}`,
        pathAfterOrg: "leave?tab=history",
        leaveRequestId: args.leaveRequestId,
      });
    }

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
    await assertLegacyLeaveEndpointAllowed(ctx, request.organizationId);

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
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    const leaveTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
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
    await assertLegacyLeaveEndpointAllowed(ctx, args.organizationId);
    await checkAuth(ctx, args.organizationId, "hr");

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
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return null;

    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);

    const settings = await getEffectiveSettings(ctx, args.organizationId);

    const now = Date.now();
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const proratedLeaveSetting = settings?.proratedLeave !== false;
    const grantLeaveUponRegularization =
      settings?.grantLeaveUponRegularization !== false;
    const paidLeaveRequiresRegularization =
      settings?.paidLeaveRequiresRegularization !== false;
    const anniversaryLeaveMaxDays = settings?.anniversaryLeaveMaxDays ?? 15;
    const vacationMax = 15;
    const sickMax = 15;
    const hireDate = employee.employment?.hireDate;
    const regularizationDate =
      employee.employment?.regularizationDate ?? undefined;

    const leaveCredits = cloneLeaveCredits(employee.leaveCredits);

    const maxConvertible = settings?.maxConvertibleLeaveDays ?? 5;
    const vacationConvertible = getConvertibleLeaveDays(
      leaveCredits.vacation?.balance ?? 0,
      maxConvertible,
    );
    const sickConvertible = getConvertibleLeaveDays(
      leaveCredits.sick?.balance ?? 0,
      maxConvertible,
    );

    const vacationProrated = calculateAnnualLeaveBase({
      annualLeave: vacationMax,
      hireDate,
      regularizationDate,
      referenceDate: now,
      proratedLeave: proratedLeaveSetting,
      grantLeaveUponRegularization,
      paidLeaveRequiresRegularization,
    });
    const sickProrated = calculateAnnualLeaveBase({
      annualLeave: sickMax,
      hireDate,
      regularizationDate,
      referenceDate: now,
      proratedLeave: proratedLeaveSetting,
      grantLeaveUponRegularization,
      paidLeaveRequiresRegularization,
    });

    type GeneralLeaveDetails = {
      annualSilBase: number;
      proratedSil: number;
      anniversaryLeave: number;
      entitlementTotal: number;
      usedCombined: number;
      available: number;
    };
    type ByTypeLeaveDetails = {
      type: string;
      name: string;
      cap: number;
      used: number;
      balance: number;
    };
    type LeaveCalculations = {
      vacationProrated: number;
      sickProrated: number;
      vacationMax: number;
      sickMax: number;
      proratedLeave: number;
      anniversaryLeave: number;
      totalEntitlement: number;
    };
    let generalLeave: GeneralLeaveDetails | undefined;
    let byTypeLeaves: ByTypeLeaveDetails[] | undefined;
    let calculations: LeaveCalculations;

    if (leaveTrackerMode === "general") {
      const g = computeGeneralLeaveSummary(employee, settings, now);
      generalLeave = {
        annualSilBase: settings?.annualSil ?? 8,
        proratedSil: g.proratedSil,
        anniversaryLeave: g.anniversaryLeave,
        entitlementTotal: g.entitlementTotal,
        usedCombined: g.usedCombined,
        available: g.available,
      };
      calculations = {
        vacationProrated,
        sickProrated,
        vacationMax,
        sickMax,
        proratedLeave: g.proratedSil,
        anniversaryLeave: g.anniversaryLeave,
        totalEntitlement: g.entitlementTotal,
      };
    } else {
      const configured = (settings?.leaveTypes ?? []).filter(
        (leaveType) => !leaveType.isAnniversary,
      );
      let sumCaps = 0;
      const enableAnniversaryLeave = settings?.enableAnniversaryLeave !== false;
      const anniversaryStartDate = grantLeaveUponRegularization
        ? regularizationDate
        : hireDate;
      const anniversaryLeave = calculatePolicyAnniversaryLeave({
        enabled: enableAnniversaryLeave,
        maxDays: anniversaryLeaveMaxDays,
        startDate:
          paidLeaveRequiresRegularization && !regularizationDate
            ? undefined
            : anniversaryStartDate,
        referenceDate: now,
      });

      byTypeLeaves = configured.map((cfg) => {
        const cap = calculateAnnualLeaveBase({
          annualLeave: Number(cfg.defaultCredits || 0),
          hireDate,
          regularizationDate,
          referenceDate: now,
          proratedLeave: proratedLeaveSetting,
          grantLeaveUponRegularization,
          paidLeaveRequiresRegularization,
        });
        sumCaps += cap;
        const used = getUsedForConfiguredType(leaveCredits, cfg.type);
        const balance = Math.max(0, Math.round((cap - used) * 100) / 100);
        return {
          type: cfg.type,
          name: cfg.name,
          cap,
          used,
          balance,
        };
      });

      const totalEntitlement =
        Math.round((sumCaps + anniversaryLeave) * 100) / 100;
      calculations = {
        vacationProrated,
        sickProrated,
        vacationMax,
        sickMax,
        proratedLeave: Math.round(sumCaps * 100) / 100,
        anniversaryLeave,
        totalEntitlement,
      };
    }

    return {
      leaveTrackerMode,
      enableAnniversaryLeave: settings?.enableAnniversaryLeave !== false,
      ...leaveCredits,
      generalLeave,
      byTypeLeaves,
      maxCredits: { vacation: vacationMax, sick: sickMax },
      calculations,
      convertible: {
        vacation: {
          convertible: vacationConvertible,
          nonConvertible: Math.max(
            0,
            (leaveCredits.vacation?.balance ?? 0) - vacationConvertible,
          ),
        },
        sick: {
          convertible: sickConvertible,
          nonConvertible: Math.max(
            0,
            (leaveCredits.sick?.balance ?? 0) - sickConvertible,
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
      v.literal("custom"),
    ),
    customType: v.optional(v.string()),
    total: v.optional(v.number()),
    used: v.optional(v.number()),
    balance: v.optional(v.number()),
    adjustment: v.optional(v.number()), // Positive to add, negative to subtract
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertLegacyLeaveEndpointAllowed(ctx, args.organizationId);
    await checkAuth(ctx, args.organizationId, "hr");

    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);

    const leaveCredits = {
      vacation: { total: 0, used: 0, balance: 0 },
      sick: { total: 0, used: 0, balance: 0 },
      ...employee.leaveCredits,
    };
    if (!leaveCredits.vacation)
      leaveCredits.vacation = { total: 0, used: 0, balance: 0 };
    if (!leaveCredits.sick)
      leaveCredits.sick = { total: 0, used: 0, balance: 0 };

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
        (credit) => credit.type === args.customType,
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

    await persistLeaveCredits(ctx, employee, leaveCredits);

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
    await assertLegacyLeaveEndpointAllowed(ctx, args.organizationId);
    await checkAuth(ctx, args.organizationId, "hr");

    const employeeRow = await ctx.db.get(args.employeeId);
    if (!employeeRow) throw new Error("Employee not found");
    const employee = await loadEffectiveEmployee(ctx, employeeRow);

    const leaveCredits = {
      vacation: { total: 0, used: 0, balance: 0 },
      sick: { total: 0, used: 0, balance: 0 },
      ...employee.leaveCredits,
    };
    const targetLeave = leaveCredits[args.leaveType];
    if (!targetLeave) {
      throw new Error(`Leave type ${args.leaveType} not found for employee`);
    }

    // Check if employee has enough balance
    if (targetLeave.balance < args.daysToConvert) {
      throw new Error(
        `Insufficient ${args.leaveType} leave balance. Available: ${targetLeave.balance} days`,
      );
    }

    const settings = await getEffectiveSettings(ctx, args.organizationId);
    const maxConvertible = settings?.maxConvertibleLeaveDays ?? 5;
    const convertibleDays = getConvertibleLeaveDays(
      targetLeave.balance,
      maxConvertible,
    );
    if (args.daysToConvert > convertibleDays) {
      throw new Error(
        `Only the first ${maxConvertible} leave days are convertible to cash. Convertible: ${convertibleDays} days`,
      );
    }

    // Deduct the converted leave
    targetLeave.balance -= args.daysToConvert;
    targetLeave.used += args.daysToConvert;
    // Note: We're treating converted leave as "used" for accounting purposes
    // The total remains the same since it was already granted

    await persistLeaveCredits(ctx, employee, leaveCredits);

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
