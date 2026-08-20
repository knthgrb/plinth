import {
  assertGovernmentRemittanceTransition,
  buildGovernmentRemittancePaymentJournal,
  getGovernmentLiabilityAccount,
  normalizeGovernmentRemittanceAmount,
  type GovernmentAgency,
  type GovernmentRemittanceFailureStage,
  type GovernmentRemittanceStatus,
} from "@/lib/government-remittance";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireActiveMembership } from "./access";
import { requireRegisteredStorageObject } from "./files";
import {
  postGovernmentRemittancePaymentJournal,
  reverseGovernmentRemittancePaymentJournal,
  syncGovernmentRemittanceAccountingProjections,
} from "./governmentRemittanceAccounting";
import {
  decryptGovernmentRemittanceDetails,
  decryptGovernmentRemittanceNotes,
  decryptGovernmentRemittanceReason,
  encryptGovernmentRemittanceDetails,
  encryptGovernmentRemittanceNotes,
  encryptGovernmentRemittanceReason,
} from "./governmentRemittanceCrypto";
import { appendOperationalEvent } from "./operationalEvents";

const MAX_PAYROLL_RUNS_PER_RECONCILIATION = 500;
const MAX_JOURNAL_ENTRIES_PER_PAYROLL_RUN = 500;
const MAX_JOURNAL_LINES_PER_ENTRY = 100;
const MAX_ALLOCATIONS_PER_PAYROLL_RUN = 1_000;
const MAX_ADVANCE_SOURCES = 500;
const MAX_APPLICATIONS_PER_ADVANCE = 1_000;
const MAX_ALLOCATIONS_PER_REMITTANCE = 100;
const MAX_ADVANCE_APPLICATIONS = 50;
const MAX_EVIDENCE_FILES = 20;
const MAX_LIST_LIMIT = 200;
const CURRENCY_TOLERANCE = 0.005;

const agencyValidator = v.union(
  v.literal("bir"),
  v.literal("sss"),
  v.literal("philhealth"),
  v.literal("pagibig"),
);

const remittanceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("reviewed"),
  v.literal("approved"),
  v.literal("filed"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("reversed"),
);

const failureStageValidator = v.union(
  v.literal("filing"),
  v.literal("payment"),
);

const allocationValidator = v.object({
  payrollRunId: v.id("payrollRuns"),
  amount: v.number(),
});

const advanceApplicationValidator = v.object({
  sourceRemittanceId: v.id("governmentRemittances"),
  amount: v.number(),
});

type DatabaseCtx = Pick<QueryCtx | MutationCtx, "db">;
type RemittanceActor = Awaited<ReturnType<typeof requireActiveMembership>>;
type AllocationInput = {
  payrollRunId: Id<"payrollRuns">;
  amount: number;
};
type AdvanceApplicationInput = {
  sourceRemittanceId: Id<"governmentRemittances">;
  amount: number;
};

type LiabilityCandidate = {
  payrollRunId: Id<"payrollRuns">;
  period: string;
  cutoffStart: number;
  cutoffEnd: number;
  accruedAmount: number;
  reservedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  overRemittedAmount: number;
};

const AGENCY_LABELS = {
  bir: "BIR Withholding Tax",
  sss: "SSS",
  philhealth: "PhilHealth",
  pagibig: "Pag-IBIG",
} as const satisfies Record<GovernmentAgency, string>;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeRequiredString(
  value: string,
  label: string,
  maxLength = 200,
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} cannot exceed ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeOptionalString(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new Error(`${label} cannot exceed ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

function assertPeriod(periodStart: number, periodEnd: number, dueDate: number) {
  normalizeTimestamp(periodStart, "Period start");
  normalizeTimestamp(periodEnd, "Period end");
  normalizeTimestamp(dueDate, "Due date");
  if (periodEnd < periodStart) {
    throw new Error("Period end cannot be before period start.");
  }
  if (dueDate < periodEnd) {
    throw new Error("Due date cannot be before the remittance period ends.");
  }
}

function isAccountingRole(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accounting";
}

async function requireRemittanceAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
): Promise<RemittanceActor> {
  const actor = await requireActiveMembership(ctx, organizationId);
  if (!isAccountingRole(actor.membership.role)) {
    throw new Error("Not authorized to access government remittances.");
  }
  return actor;
}

function requireOwnerOrAdmin(actor: RemittanceActor): void {
  if (actor.membership.role !== "owner" && actor.membership.role !== "admin") {
    throw new Error(
      "Government remittance approval or reversal requires an owner or admin.",
    );
  }
}

async function loadRemittanceForActor(
  ctx: QueryCtx | MutationCtx,
  remittanceId: Id<"governmentRemittances">,
): Promise<{
  remittance: Doc<"governmentRemittances">;
  actor: RemittanceActor;
}> {
  const remittance = await ctx.db.get(remittanceId);
  if (!remittance) throw new Error("Government remittance not found.");
  const actor = await requireRemittanceAccess(ctx, remittance.organizationId);
  return { remittance, actor };
}

function normalizeAllocations(
  allocations: readonly AllocationInput[],
): AllocationInput[] {
  if (allocations.length === 0) {
    throw new Error("At least one payroll liability allocation is required.");
  }
  if (allocations.length > MAX_ALLOCATIONS_PER_REMITTANCE) {
    throw new Error(
      `A remittance cannot contain more than ${MAX_ALLOCATIONS_PER_REMITTANCE} allocations.`,
    );
  }
  const seen = new Set<string>();
  return allocations.map((allocation) => {
    const key = String(allocation.payrollRunId);
    if (seen.has(key)) {
      throw new Error(
        "A payroll run can be allocated only once per remittance.",
      );
    }
    seen.add(key);
    const amount = normalizeGovernmentRemittanceAmount(
      allocation.amount,
      "Allocation amount",
    );
    if (amount === 0)
      throw new Error("Allocation amount must be greater than zero.");
    return { payrollRunId: allocation.payrollRunId, amount };
  });
}

function normalizeAdvanceApplications(
  applications: readonly AdvanceApplicationInput[] | undefined,
): AdvanceApplicationInput[] {
  if (!applications) return [];
  if (applications.length > MAX_ADVANCE_APPLICATIONS) {
    throw new Error(
      `A remittance cannot apply more than ${MAX_ADVANCE_APPLICATIONS} advances.`,
    );
  }
  const seen = new Set<string>();
  return applications.map((application) => {
    const key = String(application.sourceRemittanceId);
    if (seen.has(key)) {
      throw new Error(
        "A source advance can be applied only once per remittance.",
      );
    }
    seen.add(key);
    const amount = normalizeGovernmentRemittanceAmount(
      application.amount,
      "Applied advance amount",
    );
    if (amount === 0) {
      throw new Error("Applied advance amount must be greater than zero.");
    }
    return { sourceRemittanceId: application.sourceRemittanceId, amount };
  });
}

function isReservationStatus(status: GovernmentRemittanceStatus): boolean {
  return status === "approved" || status === "filed" || status === "failed";
}

async function loadPayrollLiabilityAccrued(
  ctx: DatabaseCtx,
  organizationId: Id<"organizations">,
  payrollRunId: Id<"payrollRuns">,
  accountCode: string,
): Promise<number> {
  const entries = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source", (queryBuilder) =>
      queryBuilder
        .eq("organizationId", organizationId)
        .eq("sourceType", "payroll_run")
        .eq("sourceId", String(payrollRunId)),
    )
    .take(MAX_JOURNAL_ENTRIES_PER_PAYROLL_RUN + 1);
  if (entries.length > MAX_JOURNAL_ENTRIES_PER_PAYROLL_RUN) {
    throw new Error(
      "Payroll run has too many journal entries to reconcile safely.",
    );
  }
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db
        .query("accountingJournalLines")
        .withIndex("by_entry", (queryBuilder) =>
          queryBuilder.eq("journalEntryId", entry._id),
        )
        .take(MAX_JOURNAL_LINES_PER_ENTRY + 1),
    ),
  );
  if (lineGroups.some((lines) => lines.length > MAX_JOURNAL_LINES_PER_ENTRY)) {
    throw new Error("Payroll journal has too many lines to reconcile safely.");
  }
  return roundCurrency(
    Math.max(
      0,
      lineGroups
        .flat()
        .filter((line) => line.accountCode === accountCode)
        .reduce((sum, line) => sum + line.credit - line.debit, 0),
    ),
  );
}

async function loadAllocationUsage(
  ctx: DatabaseCtx,
  payrollRunId: Id<"payrollRuns">,
  agency: GovernmentAgency,
  excludeRemittanceId?: Id<"governmentRemittances">,
): Promise<{ reservedAmount: number; paidAmount: number }> {
  const allocations = await ctx.db
    .query("governmentRemittanceAllocations")
    .withIndex("by_payroll_run_agency", (queryBuilder) =>
      queryBuilder.eq("payrollRunId", payrollRunId).eq("agency", agency),
    )
    .take(MAX_ALLOCATIONS_PER_PAYROLL_RUN + 1);
  if (allocations.length > MAX_ALLOCATIONS_PER_PAYROLL_RUN) {
    throw new Error(
      "Payroll run has too many remittance allocations to reconcile safely.",
    );
  }
  let reservedAmount = 0;
  let paidAmount = 0;
  for (const allocation of allocations) {
    if (allocation.remittanceId === excludeRemittanceId) continue;
    const remittance = await ctx.db.get(allocation.remittanceId);
    if (!remittance) continue;
    if (remittance.status === "paid") paidAmount += allocation.amount;
    if (isReservationStatus(remittance.status)) {
      reservedAmount += allocation.amount;
    }
  }
  return {
    reservedAmount: roundCurrency(reservedAmount),
    paidAmount: roundCurrency(paidAmount),
  };
}

async function loadLiabilityCandidate(
  ctx: DatabaseCtx,
  input: {
    run: Doc<"payrollRuns">;
    organizationId: Id<"organizations">;
    agency: GovernmentAgency;
    excludeRemittanceId?: Id<"governmentRemittances">;
  },
): Promise<LiabilityCandidate> {
  const account = getGovernmentLiabilityAccount(input.agency);
  const [accruedAmount, usage] = await Promise.all([
    loadPayrollLiabilityAccrued(
      ctx,
      input.organizationId,
      input.run._id,
      account.code,
    ),
    loadAllocationUsage(
      ctx,
      input.run._id,
      input.agency,
      input.excludeRemittanceId,
    ),
  ]);
  return {
    payrollRunId: input.run._id,
    period: input.run.period,
    cutoffStart: input.run.cutoffStart,
    cutoffEnd: input.run.cutoffEnd,
    accruedAmount,
    reservedAmount: usage.reservedAmount,
    paidAmount: usage.paidAmount,
    outstandingAmount: roundCurrency(
      Math.max(0, accruedAmount - usage.reservedAmount - usage.paidAmount),
    ),
    overRemittedAmount: roundCurrency(
      Math.max(0, usage.paidAmount - accruedAmount),
    ),
  };
}

async function loadLiabilityCandidates(
  ctx: DatabaseCtx,
  input: {
    organizationId: Id<"organizations">;
    agency: GovernmentAgency;
    periodStart: number;
    periodEnd: number;
    excludeRemittanceId?: Id<"governmentRemittances">;
  },
): Promise<LiabilityCandidate[]> {
  const runs = await ctx.db
    .query("payrollRuns")
    .withIndex("by_organization", (queryBuilder) =>
      queryBuilder.eq("organizationId", input.organizationId),
    )
    .take(MAX_PAYROLL_RUNS_PER_RECONCILIATION + 1);
  if (runs.length > MAX_PAYROLL_RUNS_PER_RECONCILIATION) {
    throw new Error(
      "The remittance period contains too many payroll runs to reconcile safely.",
    );
  }
  const periodRuns = runs.filter(
    (run) =>
      run.cutoffEnd >= input.periodStart && run.cutoffEnd <= input.periodEnd,
  );
  const candidates = await Promise.all(
    periodRuns.map((run) =>
      loadLiabilityCandidate(ctx, {
        run,
        organizationId: input.organizationId,
        agency: input.agency,
        excludeRemittanceId: input.excludeRemittanceId,
      }),
    ),
  );
  return candidates
    .filter(
      (candidate) =>
        candidate.accruedAmount > 0 ||
        candidate.reservedAmount > 0 ||
        candidate.paidAmount > 0,
    )
    .sort((left, right) => left.cutoffEnd - right.cutoffEnd);
}

async function loadAdvanceAvailability(
  ctx: DatabaseCtx,
  input: {
    source: Doc<"governmentRemittances">;
    excludeRemittanceId?: Id<"governmentRemittances">;
  },
): Promise<{
  reservedAmount: number;
  appliedAmount: number;
  availableAmount: number;
}> {
  const applications = await ctx.db
    .query("governmentRemittanceAdvanceApplications")
    .withIndex("by_source_remittance", (queryBuilder) =>
      queryBuilder.eq("sourceRemittanceId", input.source._id),
    )
    .take(MAX_APPLICATIONS_PER_ADVANCE + 1);
  if (applications.length > MAX_APPLICATIONS_PER_ADVANCE) {
    throw new Error(
      "Government advance has too many applications to reconcile safely.",
    );
  }
  let reservedAmount = 0;
  let appliedAmount = 0;
  for (const application of applications) {
    if (application.remittanceId === input.excludeRemittanceId) continue;
    const remittance = await ctx.db.get(application.remittanceId);
    if (!remittance) continue;
    if (remittance.status === "paid") appliedAmount += application.amount;
    if (isReservationStatus(remittance.status)) {
      reservedAmount += application.amount;
    }
  }
  return {
    reservedAmount: roundCurrency(reservedAmount),
    appliedAmount: roundCurrency(appliedAmount),
    availableAmount: roundCurrency(
      Math.max(
        0,
        input.source.advancePaymentAmount - reservedAmount - appliedAmount,
      ),
    ),
  };
}

async function loadAvailableAdvances(
  ctx: DatabaseCtx,
  input: {
    organizationId: Id<"organizations">;
    agency: GovernmentAgency;
    excludeRemittanceId?: Id<"governmentRemittances">;
  },
) {
  const sources = await ctx.db
    .query("governmentRemittances")
    .withIndex("by_organization_agency_status", (queryBuilder) =>
      queryBuilder
        .eq("organizationId", input.organizationId)
        .eq("agency", input.agency)
        .eq("status", "paid"),
    )
    .take(MAX_ADVANCE_SOURCES + 1);
  if (sources.length > MAX_ADVANCE_SOURCES) {
    throw new Error(
      "Organization has too many open advances to reconcile safely.",
    );
  }
  const rows = await Promise.all(
    sources
      .filter(
        (source) =>
          source._id !== input.excludeRemittanceId &&
          source.advancePaymentAmount > 0,
      )
      .map(async (source) => ({
        sourceRemittanceId: source._id,
        remittanceNumber: source.remittanceNumber,
        advancePaymentAmount: source.advancePaymentAmount,
        ...(await loadAdvanceAvailability(ctx, {
          source,
          excludeRemittanceId: input.excludeRemittanceId,
        })),
      })),
  );
  return rows.filter((row) => row.availableAmount > 0);
}

async function validateDraftSources(
  ctx: DatabaseCtx,
  input: {
    organizationId: Id<"organizations">;
    agency: GovernmentAgency;
    periodStart: number;
    periodEnd: number;
    allocations: readonly AllocationInput[];
    advanceApplications: readonly AdvanceApplicationInput[];
    remittanceId?: Id<"governmentRemittances">;
  },
): Promise<void> {
  const account = getGovernmentLiabilityAccount(input.agency);
  for (const allocation of input.allocations) {
    const run = await ctx.db.get(allocation.payrollRunId);
    if (!run || run.organizationId !== input.organizationId) {
      throw new Error(
        "Payroll allocation does not belong to this organization.",
      );
    }
    if (run.cutoffEnd < input.periodStart || run.cutoffEnd > input.periodEnd) {
      throw new Error("Payroll allocation is outside the remittance period.");
    }
    const accrued = await loadPayrollLiabilityAccrued(
      ctx,
      input.organizationId,
      run._id,
      account.code,
    );
    if (allocation.amount > accrued + CURRENCY_TOLERANCE) {
      throw new Error(
        `Allocation exceeds the payroll run's ${AGENCY_LABELS[input.agency]} liability.`,
      );
    }
  }
  for (const application of input.advanceApplications) {
    if (application.sourceRemittanceId === input.remittanceId) {
      throw new Error("A remittance cannot apply its own advance.");
    }
    const source = await ctx.db.get(application.sourceRemittanceId);
    if (
      !source ||
      source.organizationId !== input.organizationId ||
      source.agency !== input.agency ||
      source.status !== "paid"
    ) {
      throw new Error("Applied advance is not available for this remittance.");
    }
    if (application.amount > source.advancePaymentAmount + CURRENCY_TOLERANCE) {
      throw new Error(
        `Applied amount exceeds the source ${AGENCY_LABELS[input.agency]} advance.`,
      );
    }
  }
}

async function assertCurrentAvailability(
  ctx: DatabaseCtx,
  input: {
    remittance: Doc<"governmentRemittances">;
    allocations: readonly Doc<"governmentRemittanceAllocations">[];
    advanceApplications: readonly Doc<"governmentRemittanceAdvanceApplications">[];
  },
): Promise<void> {
  const account = getGovernmentLiabilityAccount(input.remittance.agency);
  for (const allocation of input.allocations) {
    const run = await ctx.db.get(allocation.payrollRunId);
    if (!run || run.organizationId !== input.remittance.organizationId) {
      throw new Error("Payroll allocation no longer exists.");
    }
    const [accruedAmount, usage] = await Promise.all([
      loadPayrollLiabilityAccrued(
        ctx,
        input.remittance.organizationId,
        run._id,
        account.code,
      ),
      loadAllocationUsage(
        ctx,
        run._id,
        input.remittance.agency,
        input.remittance._id,
      ),
    ]);
    const availableAmount = roundCurrency(
      Math.max(0, accruedAmount - usage.reservedAmount - usage.paidAmount),
    );
    if (allocation.amount > availableAmount + CURRENCY_TOLERANCE) {
      throw new Error(
        `Allocation exceeds the available ${AGENCY_LABELS[input.remittance.agency]} liability for ${run.period}.`,
      );
    }
  }
  for (const application of input.advanceApplications) {
    const source = await ctx.db.get(application.sourceRemittanceId);
    if (
      !source ||
      source.organizationId !== input.remittance.organizationId ||
      source.agency !== input.remittance.agency ||
      source.status !== "paid"
    ) {
      throw new Error(
        `The selected ${AGENCY_LABELS[input.remittance.agency]} advance is no longer available.`,
      );
    }
    const availability = await loadAdvanceAvailability(ctx, {
      source,
      excludeRemittanceId: input.remittance._id,
    });
    if (
      application.amount >
      availability.availableAmount + CURRENCY_TOLERANCE
    ) {
      throw new Error(
        `Applied amount exceeds the available ${AGENCY_LABELS[input.remittance.agency]} advance.`,
      );
    }
  }
}

async function loadRemittanceChildren(
  ctx: DatabaseCtx,
  remittanceId: Id<"governmentRemittances">,
) {
  const [allocations, advanceApplications] = await Promise.all([
    ctx.db
      .query("governmentRemittanceAllocations")
      .withIndex("by_remittance", (queryBuilder) =>
        queryBuilder.eq("remittanceId", remittanceId),
      )
      .take(MAX_ALLOCATIONS_PER_REMITTANCE + 1),
    ctx.db
      .query("governmentRemittanceAdvanceApplications")
      .withIndex("by_remittance", (queryBuilder) =>
        queryBuilder.eq("remittanceId", remittanceId),
      )
      .take(MAX_ADVANCE_APPLICATIONS + 1),
  ]);
  if (allocations.length > MAX_ALLOCATIONS_PER_REMITTANCE) {
    throw new Error("Government remittance has too many allocations.");
  }
  if (advanceApplications.length > MAX_ADVANCE_APPLICATIONS) {
    throw new Error("Government remittance has too many advance applications.");
  }
  return { allocations, advanceApplications };
}

async function loadRemittanceEvidence(
  ctx: DatabaseCtx,
  remittance: Doc<"governmentRemittances">,
) {
  const links = await ctx.db
    .query("storageObjectLinks")
    .withIndex("by_parent", (queryBuilder) =>
      queryBuilder
        .eq("parentType", "government_remittance")
        .eq("parentId", remittance._id),
    )
    .take(MAX_EVIDENCE_FILES + 1);
  if (links.length > MAX_EVIDENCE_FILES) {
    throw new Error("Government remittance has too many evidence files.");
  }
  const evidence = await Promise.all(
    links
      .filter(
        (link) =>
          link.organizationId === remittance.organizationId &&
          link.purpose === "government_remittance_evidence",
      )
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .map(async (link) => {
        const storageObject = await ctx.db
          .query("storageObjects")
          .withIndex("by_storage", (queryBuilder) =>
            queryBuilder.eq("storageId", link.storageId),
          )
          .unique();
        if (
          !storageObject ||
          storageObject.organizationId !== remittance.organizationId ||
          storageObject.state !== "active"
        ) {
          return null;
        }
        return {
          storageId: link.storageId,
          fileName: storageObject.fileName,
          contentType: storageObject.contentType,
          size: storageObject.size,
          createdAt: link.createdAt,
        };
      }),
  );
  return evidence.filter((row) => row !== null);
}

async function linkRemittanceEvidence(
  ctx: MutationCtx,
  input: {
    remittance: Doc<"governmentRemittances">;
    actor: RemittanceActor;
    storageIds: readonly Id<"_storage">[];
  },
) {
  const storageIds = Array.from(new Set(input.storageIds));
  if (storageIds.length !== input.storageIds.length) {
    throw new Error("Evidence files cannot be duplicated.");
  }
  if (storageIds.length > MAX_EVIDENCE_FILES) {
    throw new Error(
      `A remittance cannot attach more than ${MAX_EVIDENCE_FILES} evidence files.`,
    );
  }
  const existing = await ctx.db
    .query("storageObjectLinks")
    .withIndex("by_parent", (queryBuilder) =>
      queryBuilder
        .eq("parentType", "government_remittance")
        .eq("parentId", input.remittance._id),
    )
    .take(MAX_EVIDENCE_FILES + 1);
  if (existing.length > MAX_EVIDENCE_FILES) {
    throw new Error("Government remittance has too many evidence files.");
  }
  const existingStorageIds = new Set(
    existing.map((link) => String(link.storageId)),
  );
  const newStorageIds = storageIds.filter(
    (storageId) => !existingStorageIds.has(String(storageId)),
  );
  if (existing.length + newStorageIds.length > MAX_EVIDENCE_FILES) {
    throw new Error(
      `A remittance cannot attach more than ${MAX_EVIDENCE_FILES} evidence files.`,
    );
  }
  const registeredObjects = await Promise.all(
    newStorageIds.map((storageId) =>
      requireRegisteredStorageObject(ctx, {
        organizationId: input.remittance.organizationId,
        storageId,
        ownerUserId: input.actor.user._id,
        purpose: "government_remittance_evidence",
      }),
    ),
  );
  const now = Date.now();
  const nextSourceIndex =
    existing.reduce(
      (highest, link) => Math.max(highest, link.sourceIndex),
      -1,
    ) + 1;
  await Promise.all(
    registeredObjects.map((storageObject, offset) =>
      ctx.db.insert("storageObjectLinks", {
        organizationId: input.remittance.organizationId,
        storageId: storageObject.storageId,
        parentType: "government_remittance",
        parentId: input.remittance._id,
        purpose: "government_remittance_evidence",
        sourceIndex: nextSourceIndex + offset,
        contentType: storageObject.contentType,
        migrationVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
  return registeredObjects;
}

function hydrateRemittance(remittance: Doc<"governmentRemittances">) {
  return {
    ...remittance,
    notes: remittance.notes
      ? decryptGovernmentRemittanceNotes(remittance.notes)
      : undefined,
    filingDetails: remittance.filingDetails
      ? decryptGovernmentRemittanceDetails<{
          referenceNumber: string;
        }>(remittance.filingDetails, "filing")
      : undefined,
    paymentDetails: remittance.paymentDetails
      ? decryptGovernmentRemittanceDetails<{
          referenceNumber: string;
          bankAccountLabel?: string;
        }>(remittance.paymentDetails, "payment")
      : undefined,
    failureDetails: remittance.failureDetails
      ? decryptGovernmentRemittanceDetails<{
          stage: GovernmentRemittanceFailureStage;
          reason: string;
        }>(remittance.failureDetails, "failure")
      : undefined,
    cancellationReason: remittance.cancellationReason
      ? decryptGovernmentRemittanceReason(remittance.cancellationReason)
      : undefined,
    reversalReason: remittance.reversalReason
      ? decryptGovernmentRemittanceReason(remittance.reversalReason)
      : undefined,
  };
}

async function appendRemittanceEvent(
  ctx: MutationCtx,
  input: {
    remittance: Doc<"governmentRemittances">;
    actor: RemittanceActor;
    eventType: string;
    summary: string;
    changedFields: readonly string[];
    payload?: unknown;
    idempotencyKey?: string;
  },
) {
  await appendOperationalEvent(ctx, {
    organizationId: input.remittance.organizationId,
    eventType: input.eventType,
    aggregateType: "government_remittance",
    aggregateId: String(input.remittance._id),
    actor: {
      type: "user",
      userId: input.actor.user._id,
      membershipId: input.actor.membership._id,
      role: input.actor.membership.role,
      displayName: input.actor.user.name,
    },
    summary: input.summary,
    changedFields: input.changedFields,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  });
}

export const getGovernmentLiabilityCandidates = query({
  args: {
    organizationId: v.id("organizations"),
    agency: agencyValidator,
    periodStart: v.number(),
    periodEnd: v.number(),
    excludeRemittanceId: v.optional(v.id("governmentRemittances")),
  },
  handler: async (ctx, args) => {
    await requireRemittanceAccess(ctx, args.organizationId);
    normalizeTimestamp(args.periodStart, "Period start");
    normalizeTimestamp(args.periodEnd, "Period end");
    if (args.periodEnd < args.periodStart) {
      throw new Error("Period end cannot be before period start.");
    }
    const [candidates, advances] = await Promise.all([
      loadLiabilityCandidates(ctx, args),
      loadAvailableAdvances(ctx, {
        organizationId: args.organizationId,
        agency: args.agency,
        excludeRemittanceId: args.excludeRemittanceId,
      }),
    ]);
    return {
      candidates,
      advances,
      totals: {
        accruedAmount: roundCurrency(
          candidates.reduce((sum, row) => sum + row.accruedAmount, 0),
        ),
        reservedAmount: roundCurrency(
          candidates.reduce((sum, row) => sum + row.reservedAmount, 0),
        ),
        paidAmount: roundCurrency(
          candidates.reduce((sum, row) => sum + row.paidAmount, 0),
        ),
        outstandingAmount: roundCurrency(
          candidates.reduce((sum, row) => sum + row.outstandingAmount, 0),
        ),
        overRemittedAmount: roundCurrency(
          candidates.reduce((sum, row) => sum + row.overRemittedAmount, 0),
        ),
      },
    };
  },
});

export const listGovernmentRemittances = query({
  args: {
    organizationId: v.id("organizations"),
    agency: v.optional(agencyValidator),
    status: v.optional(remittanceStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRemittanceAccess(ctx, args.organizationId);
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Math.floor(args.limit ?? 100)),
    );
    const candidates = await ctx.db
      .query("governmentRemittances")
      .withIndex("by_organization", (queryBuilder) =>
        queryBuilder.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(Math.min(MAX_LIST_LIMIT * 5, limit * 5));
    return candidates
      .filter(
        (remittance) =>
          (!args.agency || remittance.agency === args.agency) &&
          (!args.status || remittance.status === args.status),
      )
      .slice(0, limit)
      .map(hydrateRemittance);
  },
});

export const getGovernmentRemittance = query({
  args: { remittanceId: v.id("governmentRemittances") },
  handler: async (ctx, args) => {
    const { remittance } = await loadRemittanceForActor(ctx, args.remittanceId);
    const children = await loadRemittanceChildren(ctx, remittance._id);
    const evidence = await loadRemittanceEvidence(ctx, remittance);
    return { ...hydrateRemittance(remittance), ...children, evidence };
  },
});

export const createGovernmentRemittance = mutation({
  args: {
    organizationId: v.id("organizations"),
    agency: agencyValidator,
    periodStart: v.number(),
    periodEnd: v.number(),
    dueDate: v.number(),
    allocations: v.array(allocationValidator),
    penaltyAmount: v.optional(v.number()),
    interestAmount: v.optional(v.number()),
    advancePaymentAmount: v.optional(v.number()),
    advanceApplications: v.optional(v.array(advanceApplicationValidator)),
    notes: v.optional(v.string()),
    replacementFor: v.optional(v.id("governmentRemittances")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRemittanceAccess(ctx, args.organizationId);
    assertPeriod(args.periodStart, args.periodEnd, args.dueDate);
    const allocations = normalizeAllocations(args.allocations);
    const advanceApplications = normalizeAdvanceApplications(
      args.advanceApplications,
    );
    const penaltyAmount = normalizeGovernmentRemittanceAmount(
      args.penaltyAmount ?? 0,
      "Penalty amount",
    );
    const interestAmount = normalizeGovernmentRemittanceAmount(
      args.interestAmount ?? 0,
      "Interest amount",
    );
    const advancePaymentAmount = normalizeGovernmentRemittanceAmount(
      args.advancePaymentAmount ?? 0,
      "Advance payment amount",
    );
    const liabilityAmount = roundCurrency(
      allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    );
    const advanceAppliedAmount = roundCurrency(
      advanceApplications.reduce(
        (sum, application) => sum + application.amount,
        0,
      ),
    );
    const journal = buildGovernmentRemittancePaymentJournal({
      agency: args.agency,
      liabilityAmount,
      penaltyAmount,
      interestAmount,
      advancePaymentAmount,
      advanceAppliedAmount,
    });
    const notes = normalizeOptionalString(args.notes, "Notes", 2_000);
    await validateDraftSources(ctx, {
      organizationId: args.organizationId,
      agency: args.agency,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      allocations,
      advanceApplications,
    });
    if (args.replacementFor) {
      const replaced = await ctx.db.get(args.replacementFor);
      if (
        !replaced ||
        replaced.organizationId !== args.organizationId ||
        replaced.status !== "reversed"
      ) {
        throw new Error("A replacement must reference a reversed remittance.");
      }
    }

    const now = Date.now();
    const remittanceId = await ctx.db.insert("governmentRemittances", {
      organizationId: args.organizationId,
      remittanceNumber: "pending",
      agency: args.agency,
      status: "draft",
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      dueDate: args.dueDate,
      liabilityAmount,
      penaltyAmount,
      interestAmount,
      advancePaymentAmount,
      advanceAppliedAmount,
      cashAmount: journal.cashAmount,
      notes: notes ? encryptGovernmentRemittanceNotes(notes) : undefined,
      replacementFor: args.replacementFor,
      createdBy: actor.user._id,
      createdAt: now,
      updatedAt: now,
    });
    const suffix = String(remittanceId).slice(-8).toUpperCase();
    const period = new Date(args.periodEnd)
      .toISOString()
      .slice(0, 7)
      .replace("-", "");
    const remittanceNumber = `${args.agency.toUpperCase()}-${period}-${suffix}`;
    await ctx.db.patch(remittanceId, { remittanceNumber });
    await Promise.all([
      ...allocations.map((allocation) =>
        ctx.db.insert("governmentRemittanceAllocations", {
          organizationId: args.organizationId,
          remittanceId,
          payrollRunId: allocation.payrollRunId,
          agency: args.agency,
          liabilityAccountCode: getGovernmentLiabilityAccount(args.agency).code,
          amount: allocation.amount,
          createdAt: now,
          updatedAt: now,
        }),
      ),
      ...advanceApplications.map((application) =>
        ctx.db.insert("governmentRemittanceAdvanceApplications", {
          organizationId: args.organizationId,
          remittanceId,
          sourceRemittanceId: application.sourceRemittanceId,
          agency: args.agency,
          amount: application.amount,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ]);
    const remittance = await ctx.db.get(remittanceId);
    if (!remittance) throw new Error("Government remittance was not created.");
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.created",
      summary: `${remittanceNumber} was created`,
      changedFields: ["status", "allocations", "amounts"],
      payload: {
        agency: args.agency,
        liabilityAmount,
        cashAmount: journal.cashAmount,
      },
      idempotencyKey: `government-remittance:${remittanceId}:created`,
    });
    return remittanceId;
  },
});

export const updateGovernmentRemittanceDraft = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    periodStart: v.number(),
    periodEnd: v.number(),
    dueDate: v.number(),
    allocations: v.array(allocationValidator),
    penaltyAmount: v.number(),
    interestAmount: v.number(),
    advancePaymentAmount: v.number(),
    advanceApplications: v.array(advanceApplicationValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    if (remittance.status !== "draft") {
      throw new Error("Only a draft government remittance can be edited.");
    }
    assertPeriod(args.periodStart, args.periodEnd, args.dueDate);
    const allocations = normalizeAllocations(args.allocations);
    const advanceApplications = normalizeAdvanceApplications(
      args.advanceApplications,
    );
    const penaltyAmount = normalizeGovernmentRemittanceAmount(
      args.penaltyAmount,
      "Penalty amount",
    );
    const interestAmount = normalizeGovernmentRemittanceAmount(
      args.interestAmount,
      "Interest amount",
    );
    const advancePaymentAmount = normalizeGovernmentRemittanceAmount(
      args.advancePaymentAmount,
      "Advance payment amount",
    );
    const liabilityAmount = roundCurrency(
      allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    );
    const advanceAppliedAmount = roundCurrency(
      advanceApplications.reduce(
        (sum, application) => sum + application.amount,
        0,
      ),
    );
    const journal = buildGovernmentRemittancePaymentJournal({
      agency: remittance.agency,
      liabilityAmount,
      penaltyAmount,
      interestAmount,
      advancePaymentAmount,
      advanceAppliedAmount,
    });
    const notes = normalizeOptionalString(args.notes, "Notes", 2_000);
    await validateDraftSources(ctx, {
      organizationId: remittance.organizationId,
      agency: remittance.agency,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      allocations,
      advanceApplications,
      remittanceId: remittance._id,
    });
    const children = await loadRemittanceChildren(ctx, remittance._id);
    const now = Date.now();
    await Promise.all([
      ...children.allocations.map((allocation) =>
        ctx.db.delete(allocation._id),
      ),
      ...children.advanceApplications.map((application) =>
        ctx.db.delete(application._id),
      ),
    ]);
    await Promise.all([
      ...allocations.map((allocation) =>
        ctx.db.insert("governmentRemittanceAllocations", {
          organizationId: remittance.organizationId,
          remittanceId: remittance._id,
          payrollRunId: allocation.payrollRunId,
          agency: remittance.agency,
          liabilityAccountCode: getGovernmentLiabilityAccount(remittance.agency)
            .code,
          amount: allocation.amount,
          createdAt: now,
          updatedAt: now,
        }),
      ),
      ...advanceApplications.map((application) =>
        ctx.db.insert("governmentRemittanceAdvanceApplications", {
          organizationId: remittance.organizationId,
          remittanceId: remittance._id,
          sourceRemittanceId: application.sourceRemittanceId,
          agency: remittance.agency,
          amount: application.amount,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ]);
    await ctx.db.patch(remittance._id, {
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      dueDate: args.dueDate,
      liabilityAmount,
      penaltyAmount,
      interestAmount,
      advancePaymentAmount,
      advanceAppliedAmount,
      cashAmount: journal.cashAmount,
      notes: notes ? encryptGovernmentRemittanceNotes(notes) : undefined,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.updated",
      summary: `${remittance.remittanceNumber} draft was updated`,
      changedFields: ["period", "dueDate", "allocations", "amounts", "notes"],
      payload: {
        liabilityAmount,
        penaltyAmount,
        interestAmount,
        advancePaymentAmount,
        advanceAppliedAmount,
        cashAmount: journal.cashAmount,
      },
    });
    return remittance._id;
  },
});

export const submitGovernmentRemittanceForReview = mutation({
  args: { remittanceId: v.id("governmentRemittances") },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    assertGovernmentRemittanceTransition(remittance.status, "reviewed");
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "reviewed",
      reviewedBy: actor.user._id,
      reviewedAt: now,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.reviewed",
      summary: `${remittance.remittanceNumber} was submitted for approval`,
      changedFields: ["status", "reviewedBy", "reviewedAt"],
    });
    return "reviewed" as const;
  },
});

export const returnGovernmentRemittanceToDraft = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    assertGovernmentRemittanceTransition(remittance.status, "draft");
    const reason = normalizeRequiredString(args.reason, "Return reason", 1_000);
    await ctx.db.patch(remittance._id, {
      status: "draft",
      updatedAt: Date.now(),
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.returned_to_draft",
      summary: `${remittance.remittanceNumber} was returned to draft`,
      changedFields: ["status"],
      payload: { reason },
    });
    return "draft" as const;
  },
});

export const approveGovernmentRemittance = mutation({
  args: { remittanceId: v.id("governmentRemittances") },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    requireOwnerOrAdmin(actor);
    assertGovernmentRemittanceTransition(remittance.status, "approved");
    const children = await loadRemittanceChildren(ctx, remittance._id);
    await assertCurrentAvailability(ctx, { remittance, ...children });
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "approved",
      approvedBy: actor.user._id,
      approvedAt: now,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.approved",
      summary: `${remittance.remittanceNumber} was approved`,
      changedFields: ["status", "approvedBy", "approvedAt"],
      payload: { liabilityAmount: remittance.liabilityAmount },
    });
    return "approved" as const;
  },
});

export const recordGovernmentRemittanceFiling = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    filedAt: v.number(),
    referenceNumber: v.string(),
    evidenceStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    assertGovernmentRemittanceTransition(remittance.status, "filed");
    const filedAt = normalizeTimestamp(args.filedAt, "Filing date");
    const referenceNumber = normalizeRequiredString(
      args.referenceNumber,
      "Filing reference number",
    );
    const linkedEvidence = await linkRemittanceEvidence(ctx, {
      remittance,
      actor,
      storageIds: args.evidenceStorageIds ?? [],
    });
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "filed",
      filedBy: actor.user._id,
      filedAt,
      filingDetails: encryptGovernmentRemittanceDetails(
        { referenceNumber },
        "filing",
      ),
      failureStage: undefined,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.filed",
      summary: `${remittance.remittanceNumber} was filed`,
      changedFields: [
        "status",
        "filedBy",
        "filedAt",
        "filingDetails",
        ...(linkedEvidence.length > 0 ? ["evidence"] : []),
      ],
      payload: { referenceNumber, evidenceCount: linkedEvidence.length },
    });
    if (linkedEvidence.length > 0) {
      await appendRemittanceEvent(ctx, {
        remittance,
        actor,
        eventType: "government_remittance.evidence_attached",
        summary: `${linkedEvidence.length} filing evidence file${linkedEvidence.length === 1 ? "" : "s"} attached to ${remittance.remittanceNumber}`,
        changedFields: ["evidence"],
        payload: {
          lifecycleStage: "filing",
          fileNames: linkedEvidence.map((row) => row.fileName),
        },
      });
    }
    return "filed" as const;
  },
});

export const recordGovernmentRemittancePayment = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    paidAt: v.number(),
    referenceNumber: v.string(),
    bankAccountLabel: v.optional(v.string()),
    evidenceStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    assertGovernmentRemittanceTransition(remittance.status, "paid");
    const paidAt = normalizeTimestamp(args.paidAt, "Payment date");
    if (remittance.filedAt !== undefined && paidAt < remittance.filedAt) {
      throw new Error("Payment date cannot be before the filing date.");
    }
    const referenceNumber = normalizeRequiredString(
      args.referenceNumber,
      "Payment reference number",
    );
    const bankAccountLabel = normalizeOptionalString(
      args.bankAccountLabel,
      "Bank account label",
      200,
    );
    const children = await loadRemittanceChildren(ctx, remittance._id);
    await assertCurrentAvailability(ctx, { remittance, ...children });
    const linkedEvidence = await linkRemittanceEvidence(ctx, {
      remittance,
      actor,
      storageIds: args.evidenceStorageIds ?? [],
    });
    const journalEntryId = await postGovernmentRemittancePaymentJournal(
      ctx,
      remittance._id,
      actor.user._id,
      paidAt,
    );
    await syncGovernmentRemittanceAccountingProjections(
      ctx,
      remittance._id,
      "payment",
    );
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "paid",
      paidBy: actor.user._id,
      paidAt,
      paymentDetails: encryptGovernmentRemittanceDetails(
        { referenceNumber, bankAccountLabel },
        "payment",
      ),
      paymentJournalEntryId: journalEntryId,
      failureStage: undefined,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.paid",
      summary: `${remittance.remittanceNumber} was paid`,
      changedFields: [
        "status",
        "paidBy",
        "paidAt",
        "paymentDetails",
        "paymentJournalEntryId",
        ...(linkedEvidence.length > 0 ? ["evidence"] : []),
      ],
      payload: {
        referenceNumber,
        cashAmount: remittance.cashAmount,
        journalEntryId,
        evidenceCount: linkedEvidence.length,
      },
    });
    if (linkedEvidence.length > 0) {
      await appendRemittanceEvent(ctx, {
        remittance,
        actor,
        eventType: "government_remittance.evidence_attached",
        summary: `${linkedEvidence.length} payment evidence file${linkedEvidence.length === 1 ? "" : "s"} attached to ${remittance.remittanceNumber}`,
        changedFields: ["evidence"],
        payload: {
          lifecycleStage: "payment",
          fileNames: linkedEvidence.map((row) => row.fileName),
        },
      });
    }
    return journalEntryId;
  },
});

export const recordGovernmentRemittanceFailure = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    stage: failureStageValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    const expectedStatus = args.stage === "filing" ? "approved" : "filed";
    if (remittance.status !== expectedStatus) {
      throw new Error(
        `${args.stage === "filing" ? "Filing" : "Payment"} failure can be recorded only from ${expectedStatus} status.`,
      );
    }
    assertGovernmentRemittanceTransition(remittance.status, "failed");
    const reason = normalizeRequiredString(
      args.reason,
      "Failure reason",
      1_000,
    );
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "failed",
      failureStage: args.stage,
      failureDetails: encryptGovernmentRemittanceDetails(
        { stage: args.stage, reason },
        "failure",
      ),
      failedBy: actor.user._id,
      failedAt: now,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.failed",
      summary: `${remittance.remittanceNumber} ${args.stage} failed`,
      changedFields: ["status", "failureStage", "failureDetails", "failedAt"],
      payload: { stage: args.stage, reason },
    });
    return "failed" as const;
  },
});

export const retryGovernmentRemittance = mutation({
  args: { remittanceId: v.id("governmentRemittances") },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    if (!remittance.failureStage) {
      throw new Error("Government remittance has no retryable failure.");
    }
    const next = remittance.failureStage === "filing" ? "approved" : "filed";
    assertGovernmentRemittanceTransition(
      remittance.status,
      next,
      remittance.failureStage,
    );
    await ctx.db.patch(remittance._id, {
      status: next,
      failureStage: undefined,
      updatedAt: Date.now(),
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.retry_started",
      summary: `${remittance.remittanceNumber} was returned to ${next}`,
      changedFields: ["status", "failureStage"],
      payload: { retryStatus: next },
    });
    return next;
  },
});

export const attachGovernmentRemittanceEvidence = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    if (args.storageIds.length === 0) {
      throw new Error("At least one evidence file is required.");
    }
    const registeredObjects = await linkRemittanceEvidence(ctx, {
      remittance,
      actor,
      storageIds: args.storageIds,
    });
    if (registeredObjects.length === 0) return 0;
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.evidence_attached",
      summary: `${registeredObjects.length} evidence file${registeredObjects.length === 1 ? "" : "s"} attached to ${remittance.remittanceNumber}`,
      changedFields: ["evidence"],
      payload: {
        evidenceCount: registeredObjects.length,
        fileNames: registeredObjects.map((row) => row.fileName),
      },
    });
    return registeredObjects.length;
  },
});

export const cancelGovernmentRemittance = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    if (remittance.status === "approved" || remittance.status === "failed") {
      requireOwnerOrAdmin(actor);
    }
    assertGovernmentRemittanceTransition(remittance.status, "cancelled");
    const reason = normalizeRequiredString(
      args.reason,
      "Cancellation reason",
      1_000,
    );
    const now = Date.now();
    await ctx.db.patch(remittance._id, {
      status: "cancelled",
      cancellationReason: encryptGovernmentRemittanceReason(reason),
      cancelledBy: actor.user._id,
      cancelledAt: now,
      updatedAt: now,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.cancelled",
      summary: `${remittance.remittanceNumber} was cancelled`,
      changedFields: ["status", "cancellationReason", "cancelledAt"],
      payload: { reason },
    });
    return "cancelled" as const;
  },
});

export const reverseGovernmentRemittance = mutation({
  args: {
    remittanceId: v.id("governmentRemittances"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { remittance, actor } = await loadRemittanceForActor(
      ctx,
      args.remittanceId,
    );
    requireOwnerOrAdmin(actor);
    assertGovernmentRemittanceTransition(remittance.status, "reversed");
    const reason = normalizeRequiredString(
      args.reason,
      "Reversal reason",
      1_000,
    );
    const dependentApplications = await ctx.db
      .query("governmentRemittanceAdvanceApplications")
      .withIndex("by_source_remittance", (queryBuilder) =>
        queryBuilder.eq("sourceRemittanceId", remittance._id),
      )
      .collect();
    for (const application of dependentApplications) {
      const dependent = await ctx.db.get(application.remittanceId);
      if (
        dependent &&
        (dependent.status === "paid" || isReservationStatus(dependent.status))
      ) {
        throw new Error(
          "Reverse dependent remittances first before reversing this advance source.",
        );
      }
    }
    const reversedAt = Date.now();
    const reversalJournalEntryId =
      await reverseGovernmentRemittancePaymentJournal(
        ctx,
        remittance._id,
        actor.user._id,
        reason,
        reversedAt,
      );
    await syncGovernmentRemittanceAccountingProjections(
      ctx,
      remittance._id,
      "reversal",
    );
    await ctx.db.patch(remittance._id, {
      status: "reversed",
      reversalReason: encryptGovernmentRemittanceReason(reason),
      reversedBy: actor.user._id,
      reversedAt,
      reversalJournalEntryId,
      updatedAt: reversedAt,
    });
    await appendRemittanceEvent(ctx, {
      remittance,
      actor,
      eventType: "government_remittance.reversed",
      summary: `${remittance.remittanceNumber} was reversed`,
      changedFields: [
        "status",
        "reversalReason",
        "reversedAt",
        "reversalJournalEntryId",
      ],
      payload: { reason, reversalJournalEntryId },
    });
    return reversalJournalEntryId;
  },
});
