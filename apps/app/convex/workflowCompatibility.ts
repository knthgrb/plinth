import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeMigrationSourceKey } from "./leaveEmployeeMigrationPlanner";

const MIGRATION_VERSION = 1;
type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
export type EvaluationHistory = Array<
  Pick<Doc<"evaluationEvents">, "action" | "at" | "by" | "summary">
>;
export type EffectiveEvaluation = Doc<"evaluations"> & {
  assignedReviewerIds: Id<"users">[];
  history: EvaluationHistory;
};

export async function getEffectiveOrganizationUiSettings(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationUiSettings"> | null> {
  const rows = await ctx.db
    .query("organizationUiSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(2);
  if (rows.length > 1) throw new Error("Duplicate organization UI settings");
  return rows[0] ?? null;
}

export async function upsertOrganizationUiSettings(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  sourceSettingsId: Id<"settings">,
  patch: Partial<
    Pick<
      Doc<"organizationUiSettings">,
      | "evaluationColumns"
      | "recruitmentTableColumns"
      | "requirementsTableColumns"
      | "leaveTableColumns"
    >
  >,
  now: number,
): Promise<void> {
  const existing = await getEffectiveOrganizationUiSettings(ctx, organizationId);
  const value = {
    organizationId,
    ...patch,
    sourceSettingsId,
    migrationVersion: MIGRATION_VERSION,
    updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("organizationUiSettings", { ...value, createdAt: now });
}

export async function appendOrganizationSettingsEvent(
  ctx: MutationCtx,
  settingsId: Id<"settings">,
  organizationId: Id<"organizations">,
  area: string,
  userId: Id<"users">,
  now: number,
  reason?: string,
): Promise<void> {
  const rows = await ctx.db
    .query("organizationSettingsEvents")
    .withIndex("by_settings_source_index", (q) =>
      q.eq("sourceSettingsId", settingsId),
    )
    .collect();
  const last = rows.sort((left, right) => left.sourceIndex - right.sourceIndex).at(-1);
  await ctx.db.insert("organizationSettingsEvents", {
    organizationId,
    sourceSettingsId: settingsId,
    sourceIndex: (last?.sourceIndex ?? -1) + 1,
    area,
    version: (last?.version ?? 0) + 1,
    changedBy: userId,
    changedAt: now,
    ...(reason ? { reason } : {}),
    migrationVersion: MIGRATION_VERSION,
    createdAt: now,
    updatedAt: now,
  });
}

function assertEvaluationChild(
  evaluation: Doc<"evaluations">,
  child: { organizationId: Id<"organizations">; evaluationId: Id<"evaluations"> },
): void {
  if (
    child.organizationId !== evaluation.organizationId ||
    child.evaluationId !== evaluation._id
  ) {
    throw new Error("Evaluation child tenant mismatch");
  }
}

export async function loadEffectiveEvaluation(
  ctx: DatabaseContext,
  evaluation: Doc<"evaluations">,
): Promise<EffectiveEvaluation> {
  const [reviewerRows, eventRows] = await Promise.all([
    ctx.db
      .query("evaluationReviewers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", evaluation.organizationId),
      )
      .filter((q) => q.eq(q.field("evaluationId"), evaluation._id))
      .collect(),
    ctx.db
      .query("evaluationEvents")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", evaluation.organizationId),
      )
      .filter((q) => q.eq(q.field("evaluationId"), evaluation._id))
      .collect(),
  ]);
  const reviewers = reviewerRows
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((row, index) => {
      assertEvaluationChild(evaluation, row);
      if (row.sourceIndex !== index) {
        throw new Error("Evaluation reviewer indexes are not contiguous");
      }
      return row.reviewerId;
    });
  const history = eventRows
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((row, index) => {
      assertEvaluationChild(evaluation, row);
      if (row.sourceIndex !== index) {
        throw new Error("Evaluation event indexes are not contiguous");
      }
      return {
        action: row.action,
        at: row.at,
        by: row.by,
        ...(row.summary !== undefined ? { summary: row.summary } : {}),
      };
    });
  return {
    ...evaluation,
    assignedReviewerIds: reviewers,
    history,
  };
}

export async function replaceEvaluationProjection(
  ctx: MutationCtx,
  evaluation: Doc<"evaluations">,
  reviewers: Id<"users">[],
  history: EvaluationHistory,
  now: number,
): Promise<void> {
  const [existingReviewers, existingEvents] = await Promise.all([
    ctx.db
      .query("evaluationReviewers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", evaluation.organizationId),
      )
      .filter((q) => q.eq(q.field("evaluationId"), evaluation._id))
      .collect(),
    ctx.db
      .query("evaluationEvents")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", evaluation.organizationId),
      )
      .filter((q) => q.eq(q.field("evaluationId"), evaluation._id))
      .collect(),
  ]);
  for (const row of existingReviewers) await ctx.db.delete(row._id);
  for (const row of existingEvents) await ctx.db.delete(row._id);
  const reviewerIds = new Set<Id<"users">>();
  for (const [sourceIndex, reviewerId] of reviewers.entries()) {
    if (reviewerIds.has(reviewerId)) {
      throw new Error("Evaluation reviewer is not unique");
    }
    reviewerIds.add(reviewerId);
    await ctx.db.insert("evaluationReviewers", {
      organizationId: evaluation.organizationId,
      evaluationId: evaluation._id,
      reviewerId,
      sourceIndex,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const [sourceIndex, event] of history.entries()) {
    await ctx.db.insert("evaluationEvents", {
      organizationId: evaluation.organizationId,
      evaluationId: evaluation._id,
      sourceIndex,
      ...event,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
}

type ApplicantStage = Array<
  Pick<Doc<"applicantStageEvents">, "from" | "to" | "changedAt" | "changedBy">
>;
type ApplicantNotes = Array<
  Pick<Doc<"applicantNotes">, "date" | "author" | "content">
>;
type ApplicantInterviews = Array<
  Pick<
    Doc<"applicantInterviews">,
    "date" | "type" | "interviewer" | "interviewers" | "remarks"
  >
>;
type ApplicantScorecards = Array<
  Pick<
    Doc<"applicantScorecards">,
    "reviewer" | "criteria" | "overallScore" | "recommendation" | "submittedAt"
  >
>;
type ApplicantOffer = Pick<
  Doc<"applicantOfferEvents">,
  | "status"
  | "requestedBy"
  | "requestedAt"
  | "approvedBy"
  | "approvedAt"
  | "notes"
>;
type ApplicantCustomFields = Record<string, unknown>;
export type EffectiveApplicant = Doc<"applicants"> & {
  pipelineStageHistory: ApplicantStage;
  notes: ApplicantNotes;
  interviewSchedules: ApplicantInterviews;
  scorecards: ApplicantScorecards;
  offerApproval?: ApplicantOffer;
  customFields?: ApplicantCustomFields;
};

export async function loadEffectiveApplicant(
  ctx: DatabaseContext,
  applicant: Doc<"applicants">,
): Promise<EffectiveApplicant> {
  const [stages, notes, interviews, scorecards, offers, customValues] = await Promise.all([
    ctx.db.query("applicantStageEvents").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantNotes").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantInterviews").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantScorecards").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantOfferEvents").withIndex("by_applicant", (q) => q.eq("applicantId", applicant._id)).take(2),
    ctx.db.query("applicantCustomFieldValues").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
  ]);
  const assertChild = (child: { organizationId: Id<"organizations">; applicantId: Id<"applicants"> }) => {
    if (child.organizationId !== applicant.organizationId || child.applicantId !== applicant._id) throw new Error("Applicant child tenant mismatch");
  };
  const ordered = <T extends { sourceIndex: number }>(rows: T[]) => rows.slice().sort((a, b) => a.sourceIndex - b.sourceIndex);
  for (const row of [...stages, ...notes, ...interviews, ...scorecards]) assertChild(row);
  if (offers.length > 1) throw new Error("Applicant offer state is not unique");
  if (offers[0]) assertChild(offers[0]);
  for (const row of customValues) assertChild(row);
  const customFields = Object.fromEntries(
    customValues.map((row) => [row.sourceKey, JSON.parse(row.valueJson) as unknown]),
  );
  return {
    ...applicant,
    pipelineStageHistory: ordered(stages).map(({ from, to, changedAt, changedBy }) => ({ from, to, changedAt, changedBy })),
    notes: ordered(notes).map(({ date, author, content }) => ({ date, author, content })),
    interviewSchedules: ordered(interviews).map(({ date, type, interviewer, interviewers, remarks }) => ({ date, type, interviewer, interviewers, remarks })),
    scorecards: ordered(scorecards).map(({ reviewer, criteria, overallScore, recommendation, submittedAt }) => ({ reviewer, criteria, overallScore, recommendation, submittedAt })),
    offerApproval: offers[0] ? { status: offers[0].status, requestedBy: offers[0].requestedBy, requestedAt: offers[0].requestedAt, approvedBy: offers[0].approvedBy, approvedAt: offers[0].approvedAt, notes: offers[0].notes } : undefined,
    customFields: customValues.length > 0 ? customFields : undefined,
  };
}

export async function replaceApplicantProjection(
  ctx: MutationCtx,
  applicant: Doc<"applicants">,
  values: {
    stages: ApplicantStage;
    notes: ApplicantNotes;
    interviews: ApplicantInterviews;
    scorecards: ApplicantScorecards;
    offer?: ApplicantOffer;
  },
  now: number,
): Promise<void> {
  const existing = await Promise.all([
    ctx.db.query("applicantStageEvents").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantNotes").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantInterviews").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantScorecards").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect(),
    ctx.db.query("applicantOfferEvents").withIndex("by_applicant", (q) => q.eq("applicantId", applicant._id)).collect(),
  ]);
  for (const rows of existing) for (const row of rows) await ctx.db.delete(row._id);
  for (const [sourceIndex, stage] of values.stages.entries()) await ctx.db.insert("applicantStageEvents", { organizationId: applicant.organizationId, applicantId: applicant._id, sourceIndex, ...stage, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  for (const [sourceIndex, note] of values.notes.entries()) await ctx.db.insert("applicantNotes", { organizationId: applicant.organizationId, applicantId: applicant._id, sourceIndex, ...note, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  for (const [sourceIndex, interview] of values.interviews.entries()) await ctx.db.insert("applicantInterviews", { organizationId: applicant.organizationId, applicantId: applicant._id, sourceIndex, ...interview, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  for (const [sourceIndex, scorecard] of values.scorecards.entries()) await ctx.db.insert("applicantScorecards", { organizationId: applicant.organizationId, applicantId: applicant._id, sourceIndex, ...scorecard, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  if (values.offer) await ctx.db.insert("applicantOfferEvents", { organizationId: applicant.organizationId, applicantId: applicant._id, ...values.offer, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
}

export async function synchronizeEffectiveApplicant(
  ctx: MutationCtx,
  applicant: Doc<"applicants">,
  patch: Partial<
    Pick<
      EffectiveApplicant,
      | "pipelineStageHistory"
      | "notes"
      | "interviewSchedules"
      | "scorecards"
      | "offerApproval"
      | "customFields"
    >
  >,
  now: number,
): Promise<void> {
  const effective = await loadEffectiveApplicant(ctx, applicant);
  await replaceApplicantProjection(ctx, applicant, {
    stages: patch.pipelineStageHistory ?? effective.pipelineStageHistory ?? [],
    notes: patch.notes ?? effective.notes ?? [],
    interviews: patch.interviewSchedules ?? effective.interviewSchedules ?? [],
    scorecards: patch.scorecards ?? effective.scorecards ?? [],
    offer: patch.offerApproval ?? effective.offerApproval,
  }, now);
  if (patch.customFields !== undefined) {
    const existing = await ctx.db.query("applicantCustomFieldValues").withIndex("by_organization", (q) => q.eq("organizationId", applicant.organizationId)).filter((q) => q.eq(q.field("applicantId"), applicant._id)).collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const fields = patch.customFields as Record<string, unknown>;
    for (const [rawKey, value] of Object.entries(fields)) {
      const sourceKey = normalizeMigrationSourceKey(rawKey);
      const definitions = await ctx.db.query("organizationCustomFieldDefinitions").withIndex("by_organization_entity_key", (q) => q.eq("organizationId", applicant.organizationId).eq("entityType", "applicant").eq("sourceKey", sourceKey)).take(2);
      if (definitions.length > 1) throw new Error("Applicant custom field definition is not unique");
      const definitionId = definitions[0]?._id ?? await ctx.db.insert("organizationCustomFieldDefinitions", { organizationId: applicant.organizationId, entityType: "applicant", sourceKey, label: rawKey, valueType: "mixed", isActive: true, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
      const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "string" ? "string" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "object";
      await ctx.db.insert("applicantCustomFieldValues", { organizationId: applicant.organizationId, applicantId: applicant._id, definitionId, sourceKey, valueType, valueJson: JSON.stringify(value), migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
    }
  }
}
