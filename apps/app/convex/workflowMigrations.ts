import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  WORKFLOW_MIGRATION_KEY,
  WORKFLOW_MIGRATION_VERSION,
  buildWorkflowCustomValue,
  normalizeWorkflowSourceKey,
  planWorkflowProjection,
} from "./workflowMigrationPlanner";
import type {
  WorkflowMigrationIssue,
  WorkflowProjectionPlan,
} from "./workflowMigrationTypes";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;

type WorkflowPhase =
  | "workflow_settings"
  | "workflow_evaluations"
  | "workflow_applicants";
type MigrationCounters = Doc<"migrationRuns">["counters"];

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};
const PHASES: readonly WorkflowPhase[] = [
  "workflow_settings",
  "workflow_evaluations",
  "workflow_applicants",
];

function addCounters(
  counters: MigrationCounters,
  increment: Partial<MigrationCounters>,
): MigrationCounters {
  return {
    scanned: counters.scanned + (increment.scanned ?? 0),
    changed: counters.changed + (increment.changed ?? 0),
    unchanged: counters.unchanged + (increment.unchanged ?? 0),
    skipped: counters.skipped + (increment.skipped ?? 0),
    conflicts: counters.conflicts + (increment.conflicts ?? 0),
    errors: counters.errors + (increment.errors ?? 0),
  };
}

function countersForPlan<T>(plan: WorkflowProjectionPlan<T>) {
  if (plan.outcome === "create") return { changed: 1 };
  if (plan.outcome === "unchanged") return { unchanged: 1 };
  return { conflicts: 1 };
}

function stripDocumentMetadata<
  T extends { _id: unknown; _creationTime: number },
>(document: T): Omit<T, "_id" | "_creationTime" | "createdAt" | "updatedAt"> {
  const result = { ...document } as Record<string, unknown>;
  delete result._id;
  delete result._creationTime;
  delete result.createdAt;
  delete result.updatedAt;
  return result as Omit<T, "_id" | "_creationTime" | "createdAt" | "updatedAt">;
}

function assertRun(
  run: Doc<"migrationRuns"> | null,
): asserts run is Doc<"migrationRuns"> & { phase: WorkflowPhase } {
  if (
    !run ||
    run.key !== WORKFLOW_MIGRATION_KEY ||
    run.version !== WORKFLOW_MIGRATION_VERSION ||
    !PHASES.includes(run.phase as WorkflowPhase)
  ) {
    throw new Error("Workflow migration run was not found");
  }
}

function nextPhase(phase: WorkflowPhase): WorkflowPhase | null {
  const index = PHASES.indexOf(phase);
  return PHASES[index + 1] ?? null;
}

async function recordIssues(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    organizationId?: Id<"organizations">;
    entityType: string;
    entityId?: string;
    issues: WorkflowMigrationIssue[];
    now: number;
    auditId?: Id<"migrationAudits">;
  },
) {
  for (const issue of args.issues) {
    await ctx.db.insert("migrationIssues", {
      runId: args.runId,
      ...(args.auditId ? { auditId: args.auditId } : {}),
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
      entityType: args.entityType,
      ...(args.entityId ? { entityId: args.entityId } : {}),
      field: issue.field,
      code: issue.code,
      createdAt: args.now,
    });
  }
}

async function applyPlan<T>(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
  args: {
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    plan: WorkflowProjectionPlan<T>;
    insert: (value: T, now: number) => Promise<unknown>;
    now: number;
  },
) {
  if (args.plan.outcome === "create" && !run.dryRun) {
    await args.insert(args.plan.value, args.now);
  } else if (args.plan.outcome === "conflict") {
    await recordIssues(ctx, {
      runId: run._id,
      organizationId: args.organizationId,
      entityType: args.entityType,
      entityId: args.entityId,
      issues: args.plan.issues,
      now: args.now,
    });
  }
  return countersForPlan(args.plan);
}

async function userBelongsToOrganization(
  ctx: MutationCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
) {
  const membership = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (query) =>
      query.eq("userId", userId).eq("organizationId", organizationId),
    )
    .first();
  if (membership) return true;
  const user = await ctx.db.get(userId);
  return user?.organizationId === organizationId;
}

function uiSettingsProjection(settings: Doc<"settings">) {
  return {
    organizationId: settings.organizationId,
    ...(settings.evaluationColumns !== undefined
      ? { evaluationColumns: settings.evaluationColumns }
      : {}),
    ...(settings.recruitmentTableColumns !== undefined
      ? { recruitmentTableColumns: settings.recruitmentTableColumns }
      : {}),
    ...(settings.requirementsTableColumns !== undefined
      ? { requirementsTableColumns: settings.requirementsTableColumns }
      : {}),
    ...(settings.leaveTableColumns !== undefined
      ? { leaveTableColumns: settings.leaveTableColumns }
      : {}),
    sourceSettingsId: settings._id,
    migrationVersion: WORKFLOW_MIGRATION_VERSION,
  };
}

async function processSettings(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
) {
  const page = await ctx.db.query("settings").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const settings of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const settingsRows = await ctx.db
      .query("settings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", settings.organizationId),
      )
      .take(2);
    if (
      settingsRows.length > 1 ||
      !(await ctx.db.get(settings.organizationId))
    ) {
      const code =
        settingsRows.length > 1
          ? "DUPLICATE_SETTINGS"
          : "SETTINGS_ORGANIZATION_NOT_FOUND";
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: settings.organizationId,
        entityType: "settings",
        entityId: settings._id,
        issues: [{ code, field: "organizationId" }],
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const uiProjection = uiSettingsProjection(settings);
    const uiRows = await ctx.db
      .query("organizationUiSettings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", settings.organizationId),
      )
      .take(2);
    const uiPlan = planWorkflowProjection({
      expected: uiProjection,
      destinations: uiRows.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_UI_SETTINGS",
      mismatchCode: "UI_SETTINGS_MISMATCH",
      field: "organizationId",
    });
    counters = addCounters(
      counters,
      await applyPlan(ctx, run, {
        organizationId: settings.organizationId,
        entityType: "settings",
        entityId: settings._id,
        plan: uiPlan,
        insert: (value, timestamp) =>
          ctx.db.insert("organizationUiSettings", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
    for (const [sourceIndex, event] of (
      settings.settingsChangeLog ?? []
    ).entries()) {
      if (
        !(await userBelongsToOrganization(
          ctx,
          event.changedBy,
          settings.organizationId,
        ))
      ) {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: settings.organizationId,
          entityType: "settingsEvent",
          entityId: `${settings._id}:${sourceIndex}`,
          issues: [
            { code: "WORKFLOW_ACTOR_TENANT_MISMATCH", field: "changedBy" },
          ],
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      const projection = {
        organizationId: settings.organizationId,
        sourceSettingsId: settings._id,
        sourceIndex,
        ...event,
        migrationVersion: WORKFLOW_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("organizationSettingsEvents")
        .withIndex("by_settings_source_index", (query) =>
          query
            .eq("sourceSettingsId", settings._id)
            .eq("sourceIndex", sourceIndex),
        )
        .take(2);
      const plan = planWorkflowProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        duplicateCode: "DUPLICATE_SETTINGS_EVENT",
        mismatchCode: "SETTINGS_EVENT_MISMATCH",
        field: "sourceIndex",
      });
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: settings.organizationId,
          entityType: "settingsEvent",
          entityId: `${settings._id}:${sourceIndex}`,
          plan,
          insert: (value, timestamp) =>
            ctx.db.insert("organizationSettingsEvents", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

async function processEvaluations(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
) {
  const page = await ctx.db.query("evaluations").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const evaluation of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const employee = await ctx.db.get(evaluation.employeeId);
    if (!employee || employee.organizationId !== evaluation.organizationId) {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: evaluation.organizationId,
        entityType: "evaluation",
        entityId: evaluation._id,
        issues: [{ code: "EVALUATION_TENANT_MISMATCH", field: "employeeId" }],
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const reviewerIds = new Set<string>();
    for (const [sourceIndex, reviewerId] of (
      evaluation.assignedReviewerIds ?? []
    ).entries()) {
      const duplicate = reviewerIds.has(reviewerId);
      const belongs = await userBelongsToOrganization(
        ctx,
        reviewerId,
        evaluation.organizationId,
      );
      if (duplicate || !belongs) {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: evaluation.organizationId,
          entityType: "evaluation",
          entityId: evaluation._id,
          issues: [
            {
              code: duplicate
                ? "DUPLICATE_EVALUATION_REVIEWER"
                : "WORKFLOW_ACTOR_TENANT_MISMATCH",
              field: "reviewerId",
            },
          ],
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      reviewerIds.add(reviewerId);
      const projection = {
        organizationId: evaluation.organizationId,
        evaluationId: evaluation._id,
        reviewerId,
        sourceIndex,
        migrationVersion: WORKFLOW_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("evaluationReviewers")
        .withIndex("by_evaluation_reviewer", (query) =>
          query.eq("evaluationId", evaluation._id).eq("reviewerId", reviewerId),
        )
        .take(2);
      const plan = planWorkflowProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        duplicateCode: "DUPLICATE_EVALUATION_REVIEWER",
        mismatchCode: "EVALUATION_REVIEWER_MISMATCH",
        field: "reviewerId",
      });
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: evaluation.organizationId,
          entityType: "evaluationReviewer",
          entityId: evaluation._id,
          plan,
          insert: (value, timestamp) =>
            ctx.db.insert("evaluationReviewers", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }
    for (const [sourceIndex, event] of (evaluation.history ?? []).entries()) {
      if (
        !(await userBelongsToOrganization(
          ctx,
          event.by,
          evaluation.organizationId,
        ))
      ) {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: evaluation.organizationId,
          entityType: "evaluationEvent",
          entityId: evaluation._id,
          issues: [{ code: "WORKFLOW_ACTOR_TENANT_MISMATCH", field: "by" }],
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      const projection = {
        organizationId: evaluation.organizationId,
        evaluationId: evaluation._id,
        sourceIndex,
        ...event,
        migrationVersion: WORKFLOW_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("evaluationEvents")
        .withIndex("by_evaluation_source_index", (query) =>
          query
            .eq("evaluationId", evaluation._id)
            .eq("sourceIndex", sourceIndex),
        )
        .take(2);
      const plan = planWorkflowProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        duplicateCode: "DUPLICATE_EVALUATION_EVENT",
        mismatchCode: "EVALUATION_EVENT_MISMATCH",
        field: "sourceIndex",
      });
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: evaluation.organizationId,
          entityType: "evaluationEvent",
          entityId: evaluation._id,
          plan,
          insert: (value, timestamp) =>
            ctx.db.insert("evaluationEvents", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

async function processApplicantIndexedRows(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
  applicant: Doc<"applicants">,
  now: number,
) {
  let counters: Partial<MigrationCounters> = {};
  const add = (increment: Partial<MigrationCounters>) => {
    counters = addCounters(
      {
        scanned: 0,
        changed: counters.changed ?? 0,
        unchanged: counters.unchanged ?? 0,
        skipped: counters.skipped ?? 0,
        conflicts: counters.conflicts ?? 0,
        errors: counters.errors ?? 0,
      },
      increment,
    );
  };
  for (const [sourceIndex, event] of (
    applicant.pipelineStageHistory ?? []
  ).entries()) {
    const projection = {
      organizationId: applicant.organizationId,
      applicantId: applicant._id,
      sourceIndex,
      ...event,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const rows = await ctx.db
      .query("applicantStageEvents")
      .withIndex("by_applicant_source_index", (query) =>
        query.eq("applicantId", applicant._id).eq("sourceIndex", sourceIndex),
      )
      .take(2);
    const plan = planWorkflowProjection({
      expected: projection,
      destinations: rows.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_STAGE_EVENT",
      mismatchCode: "STAGE_EVENT_MISMATCH",
      field: "sourceIndex",
    });
    add(
      await applyPlan(ctx, run, {
        organizationId: applicant.organizationId,
        entityType: "applicantStageEvent",
        entityId: applicant._id,
        plan,
        insert: (value, timestamp) =>
          ctx.db.insert("applicantStageEvents", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
  }
  for (const [sourceIndex, note] of (applicant.notes ?? []).entries()) {
    const projection = {
      organizationId: applicant.organizationId,
      applicantId: applicant._id,
      sourceIndex,
      ...note,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const rows = await ctx.db
      .query("applicantNotes")
      .withIndex("by_applicant_source_index", (query) =>
        query.eq("applicantId", applicant._id).eq("sourceIndex", sourceIndex),
      )
      .take(2);
    const plan = planWorkflowProjection({
      expected: projection,
      destinations: rows.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_APPLICANT_NOTE",
      mismatchCode: "APPLICANT_NOTE_MISMATCH",
      field: "sourceIndex",
    });
    add(
      await applyPlan(ctx, run, {
        organizationId: applicant.organizationId,
        entityType: "applicantNote",
        entityId: applicant._id,
        plan,
        insert: (value, timestamp) =>
          ctx.db.insert("applicantNotes", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
  }
  for (const [sourceIndex, interview] of (
    applicant.interviewSchedules ?? []
  ).entries()) {
    const projection = {
      organizationId: applicant.organizationId,
      applicantId: applicant._id,
      sourceIndex,
      ...interview,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const rows = await ctx.db
      .query("applicantInterviews")
      .withIndex("by_applicant_source_index", (query) =>
        query.eq("applicantId", applicant._id).eq("sourceIndex", sourceIndex),
      )
      .take(2);
    const plan = planWorkflowProjection({
      expected: projection,
      destinations: rows.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_APPLICANT_INTERVIEW",
      mismatchCode: "APPLICANT_INTERVIEW_MISMATCH",
      field: "sourceIndex",
    });
    add(
      await applyPlan(ctx, run, {
        organizationId: applicant.organizationId,
        entityType: "applicantInterview",
        entityId: applicant._id,
        plan,
        insert: (value, timestamp) =>
          ctx.db.insert("applicantInterviews", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
  }
  for (const [sourceIndex, scorecard] of (
    applicant.scorecards ?? []
  ).entries()) {
    const projection = {
      organizationId: applicant.organizationId,
      applicantId: applicant._id,
      sourceIndex,
      ...scorecard,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const rows = await ctx.db
      .query("applicantScorecards")
      .withIndex("by_applicant_source_index", (query) =>
        query.eq("applicantId", applicant._id).eq("sourceIndex", sourceIndex),
      )
      .take(2);
    const plan = planWorkflowProjection({
      expected: projection,
      destinations: rows.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_APPLICANT_SCORECARD",
      mismatchCode: "APPLICANT_SCORECARD_MISMATCH",
      field: "sourceIndex",
    });
    add(
      await applyPlan(ctx, run, {
        organizationId: applicant.organizationId,
        entityType: "applicantScorecard",
        entityId: applicant._id,
        plan,
        insert: (value, timestamp) =>
          ctx.db.insert("applicantScorecards", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
  }
  return counters;
}

async function processApplicantOffer(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
  applicant: Doc<"applicants">,
  now: number,
) {
  if (!applicant.offerApproval) return {};
  const projection = {
    organizationId: applicant.organizationId,
    applicantId: applicant._id,
    ...applicant.offerApproval,
    migrationVersion: WORKFLOW_MIGRATION_VERSION,
  };
  const rows = await ctx.db
    .query("applicantOfferEvents")
    .withIndex("by_applicant", (query) =>
      query.eq("applicantId", applicant._id),
    )
    .take(2);
  const plan = planWorkflowProjection({
    expected: projection,
    destinations: rows.map(stripDocumentMetadata),
    duplicateCode: "DUPLICATE_APPLICANT_OFFER",
    mismatchCode: "APPLICANT_OFFER_MISMATCH",
    field: "applicantId",
  });
  return applyPlan(ctx, run, {
    organizationId: applicant.organizationId,
    entityType: "applicantOffer",
    entityId: applicant._id,
    plan,
    insert: (value, timestamp) =>
      ctx.db.insert("applicantOfferEvents", {
        ...value,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    now,
  });
}

async function processApplicantCustomFields(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
  applicant: Doc<"applicants">,
  now: number,
) {
  let counters: Partial<MigrationCounters> = {};
  const add = (increment: Partial<MigrationCounters>) => {
    counters = {
      changed: (counters.changed ?? 0) + (increment.changed ?? 0),
      unchanged: (counters.unchanged ?? 0) + (increment.unchanged ?? 0),
      conflicts: (counters.conflicts ?? 0) + (increment.conflicts ?? 0),
    };
  };
  if (
    !applicant.customFields ||
    typeof applicant.customFields !== "object" ||
    Array.isArray(applicant.customFields)
  )
    return counters;
  const seen = new Set<string>();
  for (const [sourceKey, rawValue] of Object.entries(
    applicant.customFields as Record<string, unknown>,
  )) {
    let custom;
    try {
      custom = buildWorkflowCustomValue(sourceKey, rawValue);
    } catch {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: applicant.organizationId,
        entityType: "applicant",
        entityId: applicant._id,
        issues: [
          { code: "CUSTOM_FIELD_VALUE_UNSUPPORTED", field: "customFields" },
        ],
        now,
      });
      add({ conflicts: 1 });
      continue;
    }
    if (seen.has(custom.sourceKey)) {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: applicant.organizationId,
        entityType: "applicant",
        entityId: applicant._id,
        issues: [
          { code: "DUPLICATE_APPLICANT_CUSTOM_VALUE", field: "sourceKey" },
        ],
        now,
      });
      add({ conflicts: 1 });
      continue;
    }
    seen.add(custom.sourceKey);
    const definitionProjection = {
      organizationId: applicant.organizationId,
      entityType: "applicant" as const,
      sourceKey: custom.sourceKey,
      label: custom.sourceKey,
      valueType: "mixed" as const,
      isActive: true,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const definitions = await ctx.db
      .query("organizationCustomFieldDefinitions")
      .withIndex("by_organization_entity_key", (query) =>
        query
          .eq("organizationId", applicant.organizationId)
          .eq("entityType", "applicant")
          .eq("sourceKey", custom.sourceKey),
      )
      .take(2);
    const definitionPlan = planWorkflowProjection({
      expected: definitionProjection,
      destinations: definitions.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_CUSTOM_FIELD_DEFINITION",
      mismatchCode: "CUSTOM_FIELD_DEFINITION_MISMATCH",
      field: "sourceKey",
    });
    let definitionId = definitions[0]?._id;
    if (definitionPlan.outcome === "create" && !run.dryRun)
      definitionId = await ctx.db.insert("organizationCustomFieldDefinitions", {
        ...definitionPlan.value,
        createdAt: now,
        updatedAt: now,
      });
    else if (definitionPlan.outcome === "conflict")
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: applicant.organizationId,
        entityType: "applicant",
        entityId: applicant._id,
        issues: definitionPlan.issues,
        now,
      });
    add(countersForPlan(definitionPlan));
    if (definitionPlan.outcome === "conflict") continue;
    const values = await ctx.db
      .query("applicantCustomFieldValues")
      .withIndex("by_applicant_source_key", (query) =>
        query
          .eq("applicantId", applicant._id)
          .eq("sourceKey", custom.sourceKey),
      )
      .take(2);
    if (!definitionId && run.dryRun) {
      if (values.length === 0) add({ changed: 1 });
      else {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: applicant.organizationId,
          entityType: "applicant",
          entityId: applicant._id,
          issues: [
            {
              code:
                values.length > 1
                  ? "DUPLICATE_APPLICANT_CUSTOM_VALUE"
                  : "APPLICANT_CUSTOM_VALUE_MISMATCH",
              field: "sourceKey",
            },
          ],
          now,
        });
        add({ conflicts: 1 });
      }
      continue;
    }
    const valueProjection = {
      organizationId: applicant.organizationId,
      applicantId: applicant._id,
      definitionId: definitionId!,
      ...custom,
      migrationVersion: WORKFLOW_MIGRATION_VERSION,
    };
    const valuePlan = planWorkflowProjection({
      expected: valueProjection,
      destinations: values.map(stripDocumentMetadata),
      duplicateCode: "DUPLICATE_APPLICANT_CUSTOM_VALUE",
      mismatchCode: "APPLICANT_CUSTOM_VALUE_MISMATCH",
      field: "sourceKey",
    });
    add(
      await applyPlan(ctx, run, {
        organizationId: applicant.organizationId,
        entityType: "applicant",
        entityId: applicant._id,
        plan: valuePlan,
        insert: (value, timestamp) =>
          ctx.db.insert("applicantCustomFieldValues", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        now,
      }),
    );
  }
  return counters;
}

async function processApplicants(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
) {
  const page = await ctx.db
    .query("applicants")
    .paginate({ cursor: run.cursor ?? null, numItems: run.batchSize });
  let counters = run.counters;
  const now = Date.now();
  applicantLoop: for (const applicant of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const job = await ctx.db.get(applicant.jobId);
    if (!job || job.organizationId !== applicant.organizationId) {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: applicant.organizationId,
        entityType: "applicant",
        entityId: applicant._id,
        issues: [{ code: "APPLICANT_JOB_TENANT_MISMATCH", field: "jobId" }],
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const actorIds = [
      ...(applicant.pipelineStageHistory ?? []).flatMap(({ changedBy }) =>
        changedBy ? [changedBy] : [],
      ),
      ...(applicant.notes ?? []).map(({ author }) => author),
      ...(applicant.interviewSchedules ?? []).flatMap(
        ({ interviewer, interviewers }) => [
          interviewer,
          ...(interviewers ?? []),
        ],
      ),
      ...(applicant.scorecards ?? []).map(({ reviewer }) => reviewer),
      ...(applicant.offerApproval?.requestedBy
        ? [applicant.offerApproval.requestedBy]
        : []),
      ...(applicant.offerApproval?.approvedBy
        ? [applicant.offerApproval.approvedBy]
        : []),
    ];
    for (const actorId of new Set(actorIds)) {
      if (
        !(await userBelongsToOrganization(
          ctx,
          actorId,
          applicant.organizationId,
        ))
      ) {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: applicant.organizationId,
          entityType: "applicant",
          entityId: applicant._id,
          issues: [{ code: "WORKFLOW_ACTOR_TENANT_MISMATCH", field: "userId" }],
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue applicantLoop;
      }
    }
    counters = addCounters(
      counters,
      await processApplicantIndexedRows(ctx, run, applicant, now),
    );
    counters = addCounters(
      counters,
      await processApplicantOffer(ctx, run, applicant, now),
    );
    counters = addCounters(
      counters,
      await processApplicantCustomFields(ctx, run, applicant, now),
    );
  }
  return { ...page, counters };
}

function processPhase(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: WorkflowPhase },
) {
  if (run.phase === "workflow_settings") return processSettings(ctx, run);
  if (run.phase === "workflow_evaluations") return processEvaluations(ctx, run);
  return processApplicants(ctx, run);
}

const continueReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("workflowMigrations:continueWorkflowMigration");
const processReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("workflowMigrations:processWorkflowMigrationBatch");
const failReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("workflowMigrations:failWorkflowMigration");

export const startWorkflowMigration = internalMutation({
  args: {
    dryRun: v.boolean(),
    dryRunId: v.optional(v.id("migrationRuns")),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50)
      throw new Error("Batch size must be between 1 and 50");
    const active = [
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query.eq("key", WORKFLOW_MIGRATION_KEY).eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query.eq("key", WORKFLOW_MIGRATION_KEY).eq("status", "running"),
        )
        .take(1)),
    ];
    if (active.length > 0)
      throw new Error("A workflow migration is already active");
    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (
        !dryRun ||
        dryRun.key !== WORKFLOW_MIGRATION_KEY ||
        dryRun.version !== WORKFLOW_MIGRATION_VERSION ||
        !dryRun.dryRun ||
        dryRun.status !== "completed" ||
        dryRun.counters.conflicts > 0 ||
        dryRun.counters.errors > 0
      )
        throw new Error("Conflict-free completed dry-run is required");
      requiredDryRunId = dryRun._id;
    }
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: WORKFLOW_MIGRATION_KEY,
      version: WORKFLOW_MIGRATION_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "workflow_settings",
      batchSize,
      counters: EMPTY_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueReference, { runId });
    return {
      runId,
      dryRun: args.dryRun,
      key: WORKFLOW_MIGRATION_KEY,
      version: WORKFLOW_MIGRATION_VERSION,
    };
  },
});

export const processWorkflowMigrationBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running")
      return { done: true };
    const result = await processPhase(ctx, run);
    const now = Date.now();
    if (!result.isDone) {
      await ctx.db.patch(run._id, {
        status: "running",
        cursor: result.continueCursor,
        counters: result.counters,
        updatedAt: now,
      });
      return { done: false };
    }
    const following = nextPhase(run.phase);
    if (following) {
      await ctx.db.patch(run._id, {
        status: "running",
        phase: following,
        cursor: undefined,
        counters: result.counters,
        updatedAt: now,
      });
      return { done: false };
    }
    await ctx.db.patch(run._id, {
      status: "completed",
      cursor: undefined,
      counters: result.counters,
      completedAt: now,
      updatedAt: now,
    });
    return { done: true };
  },
});

export const continueWorkflowMigration = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const result = await ctx.runMutation(processReference, args);
      if (!result.done)
        await ctx.scheduler.runAfter(0, continueReference, args);
      return { done: result.done };
    } catch {
      await ctx.runMutation(failReference, {
        runId: args.runId,
        failureCode: "BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failWorkflowMigration = internalMutation({
  args: { runId: v.id("migrationRuns"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== WORKFLOW_MIGRATION_KEY ||
      run.version !== WORKFLOW_MIGRATION_VERSION ||
      run.status === "completed" ||
      run.status === "failed"
    )
      return;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "failed",
      failureCode: args.failureCode,
      counters: addCounters(run.counters, { errors: 1 }),
      updatedAt: now,
      completedAt: now,
    });
  },
});

export const getWorkflowMigrationRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const issues = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .take(MAX_STATUS_ISSUES + 1);
    return {
      run,
      issues: issues
        .slice(0, MAX_STATUS_ISSUES)
        .map(
          ({
            code,
            field,
            entityType,
            entityId,
            organizationId,
            createdAt,
          }) => ({
            code,
            field,
            entityType,
            entityId,
            organizationId,
            createdAt,
          }),
        ),
      issuesTruncated: issues.length > MAX_STATUS_ISSUES,
      canStartWrite:
        run.dryRun &&
        run.status === "completed" &&
        run.counters.conflicts === 0 &&
        run.counters.errors === 0,
    };
  },
});

export const listWorkflowMigrationIssues = internalQuery({
  args: {
    runId: v.id("migrationRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(
        ({ code, field, entityType, entityId, organizationId, createdAt }) => ({
          code,
          field,
          entityType,
          entityId,
          organizationId,
          createdAt,
        }),
      ),
    };
  },
});

export const resumeWorkflowMigration = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running")
      throw new Error("Only an active workflow migration can resume");
    if (Date.now() - run.updatedAt < STALE_RUN_MILLISECONDS)
      throw new Error("Workflow migration is not stale");
    await ctx.scheduler.runAfter(0, continueReference, { runId: run._id });
    return { resumed: true, runId: run._id };
  },
});

type WorkflowAuditPhase =
  | "workflow_source_verification"
  | "workflow_target_ui_settings"
  | "workflow_target_settings_events"
  | "workflow_target_reviewers"
  | "workflow_target_evaluation_events"
  | "workflow_target_stage_events"
  | "workflow_target_notes"
  | "workflow_target_interviews"
  | "workflow_target_scorecards"
  | "workflow_target_offer_events"
  | "workflow_target_custom_definitions"
  | "workflow_target_custom_values";

const AUDIT_PHASES: readonly WorkflowAuditPhase[] = [
  "workflow_source_verification",
  "workflow_target_ui_settings",
  "workflow_target_settings_events",
  "workflow_target_reviewers",
  "workflow_target_evaluation_events",
  "workflow_target_stage_events",
  "workflow_target_notes",
  "workflow_target_interviews",
  "workflow_target_scorecards",
  "workflow_target_offer_events",
  "workflow_target_custom_definitions",
  "workflow_target_custom_values",
];

function isAuditPhase(
  phase: Doc<"migrationAudits">["phase"],
): phase is WorkflowAuditPhase {
  return AUDIT_PHASES.includes(phase as WorkflowAuditPhase);
}

function nextAuditPhase(phase: WorkflowAuditPhase) {
  const index = AUDIT_PHASES.indexOf(phase);
  return AUDIT_PHASES[index + 1] ?? null;
}

async function latestAudit(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (query) => query.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

type AuditPage = {
  isDone: boolean;
  continueCursor: string;
  destination: Doc<"migrationAudits">["destination"];
  sourceConflicts: number;
};

async function auditVerification(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
): Promise<AuditPage> {
  if (!audit.verificationRunId)
    throw new Error("Audit verification is missing");
  const page = await ctx.db
    .query("migrationIssues")
    .withIndex("by_run", (query) => query.eq("runId", audit.verificationRunId!))
    .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  for (const issue of page.page) {
    sourceConflicts += 1;
    if (issue.code.startsWith("DUPLICATE_")) destination.duplicate += 1;
    else if (issue.code.includes("MISMATCH")) destination.mismatched += 1;
    await ctx.db.insert("migrationIssues", {
      runId: run._id,
      auditId: audit._id,
      ...(issue.organizationId ? { organizationId: issue.organizationId } : {}),
      entityType: issue.entityType,
      ...(issue.entityId ? { entityId: issue.entityId } : {}),
      field: issue.field,
      code: issue.code,
      createdAt: issue.createdAt,
    });
  }
  return { ...page, destination, sourceConflicts };
}

async function markUnexpected(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
  args: {
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    field: string;
  },
) {
  await recordIssues(ctx, {
    runId: run._id,
    auditId: audit._id,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    issues: [{ code: "UNEXPECTED_DESTINATION_ROW", field: args.field }],
    now: Date.now(),
  });
}

async function auditTarget(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits"> & { phase: WorkflowAuditPhase },
  run: Doc<"migrationRuns">,
): Promise<AuditPage> {
  const destination = { ...audit.destination };
  const initialUnexpected = destination.unexpected;
  const acceptRows = async <
    T extends { _id: string; organizationId: Id<"organizations"> },
  >(
    page: { page: T[]; isDone: boolean; continueCursor: string },
    entityType: string,
    field: string,
    exists: (row: T) => Promise<boolean>,
  ): Promise<AuditPage> => {
    for (const row of page.page) {
      destination.totalRows += 1;
      if (!(await exists(row))) {
        destination.unexpected += 1;
        await markUnexpected(ctx, audit, run, {
          organizationId: row.organizationId,
          entityType,
          entityId: row._id,
          field,
        });
      }
    }
    const newUnexpected = destination.unexpected - initialUnexpected;
    destination.matching += page.page.length - newUnexpected;
    return {
      ...page,
      destination,
      sourceConflicts: audit.sourceConflicts + newUnexpected,
    };
  };

  switch (audit.phase) {
    case "workflow_target_ui_settings": {
      const page = await ctx.db
        .query("organizationUiSettings")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "organizationUiSettings",
        "sourceSettingsId",
        async (row) => {
          const source = await ctx.db.get(row.sourceSettingsId);
          return source?.organizationId === row.organizationId;
        },
      );
    }
    case "workflow_target_settings_events": {
      const page = await ctx.db
        .query("organizationSettingsEvents")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "organizationSettingsEvent",
        "sourceIndex",
        async (row) => {
          const source = await ctx.db.get(row.sourceSettingsId);
          return (
            source?.organizationId === row.organizationId &&
            Boolean(source.settingsChangeLog?.[row.sourceIndex])
          );
        },
      );
    }
    case "workflow_target_reviewers": {
      const page = await ctx.db
        .query("evaluationReviewers")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "evaluationReviewer",
        "reviewerId",
        async (row) => {
          const source = await ctx.db.get(row.evaluationId);
          return (
            source?.organizationId === row.organizationId &&
            source.assignedReviewerIds?.[row.sourceIndex] === row.reviewerId
          );
        },
      );
    }
    case "workflow_target_evaluation_events": {
      const page = await ctx.db
        .query("evaluationEvents")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(page, "evaluationEvent", "sourceIndex", async (row) => {
        const source = await ctx.db.get(row.evaluationId);
        return (
          source?.organizationId === row.organizationId &&
          Boolean(source.history?.[row.sourceIndex])
        );
      });
    }
    case "workflow_target_stage_events": {
      const page = await ctx.db
        .query("applicantStageEvents")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "applicantStageEvent",
        "sourceIndex",
        async (row) => {
          const source = await ctx.db.get(row.applicantId);
          return (
            source?.organizationId === row.organizationId &&
            Boolean(source.pipelineStageHistory?.[row.sourceIndex])
          );
        },
      );
    }
    case "workflow_target_notes": {
      const page = await ctx.db
        .query("applicantNotes")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(page, "applicantNote", "sourceIndex", async (row) => {
        const source = await ctx.db.get(row.applicantId);
        return (
          source?.organizationId === row.organizationId &&
          Boolean(source.notes?.[row.sourceIndex])
        );
      });
    }
    case "workflow_target_interviews": {
      const page = await ctx.db
        .query("applicantInterviews")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "applicantInterview",
        "sourceIndex",
        async (row) => {
          const source = await ctx.db.get(row.applicantId);
          return (
            source?.organizationId === row.organizationId &&
            Boolean(source.interviewSchedules?.[row.sourceIndex])
          );
        },
      );
    }
    case "workflow_target_scorecards": {
      const page = await ctx.db
        .query("applicantScorecards")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "applicantScorecard",
        "sourceIndex",
        async (row) => {
          const source = await ctx.db.get(row.applicantId);
          return (
            source?.organizationId === row.organizationId &&
            Boolean(source.scorecards?.[row.sourceIndex])
          );
        },
      );
    }
    case "workflow_target_offer_events": {
      const page = await ctx.db
        .query("applicantOfferEvents")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "applicantOfferEvent",
        "applicantId",
        async (row) => {
          const source = await ctx.db.get(row.applicantId);
          return (
            source?.organizationId === row.organizationId &&
            Boolean(source.offerApproval)
          );
        },
      );
    }
    case "workflow_target_custom_definitions": {
      const rawPage = await ctx.db
        .query("organizationCustomFieldDefinitions")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      const page = {
        ...rawPage,
        page: rawPage.page.filter(
          (row) =>
            row.entityType === "applicant" &&
            row.migrationVersion === WORKFLOW_MIGRATION_VERSION,
        ),
      };
      return acceptRows(
        page,
        "applicantCustomFieldDefinition",
        "sourceKey",
        async (row) => {
          return Boolean(
            await ctx.db
              .query("applicantCustomFieldValues")
              .withIndex("by_definition", (query) =>
                query.eq("definitionId", row._id),
              )
              .first(),
          );
        },
      );
    }
    case "workflow_target_custom_values": {
      const page = await ctx.db
        .query("applicantCustomFieldValues")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(
        page,
        "applicantCustomFieldValue",
        "sourceKey",
        async (row) => {
          const source = await ctx.db.get(row.applicantId);
          if (
            source?.organizationId !== row.organizationId ||
            !source.customFields ||
            typeof source.customFields !== "object" ||
            Array.isArray(source.customFields)
          )
            return false;
          return Object.keys(
            source.customFields as Record<string, unknown>,
          ).some((key) => normalizeWorkflowSourceKey(key) === row.sourceKey);
        },
      );
    }
    default:
      throw new Error("Unsupported workflow audit phase");
  }
}

async function runAuditBatch(ctx: MutationCtx, auditId: Id<"migrationAudits">) {
  const audit = await ctx.db.get(auditId);
  if (!audit || !isAuditPhase(audit.phase) || audit.status !== "running")
    throw new Error("Workflow audit is not active");
  const run = await ctx.db.get(audit.migrationRunId);
  assertRun(run);
  const page =
    audit.phase === "workflow_source_verification"
      ? await auditVerification(ctx, audit, run)
      : await auditTarget(
          ctx,
          audit as Doc<"migrationAudits"> & { phase: WorkflowAuditPhase },
          run,
        );
  const now = Date.now();
  if (!page.isDone) {
    await ctx.db.patch(audit._id, {
      cursor: page.continueCursor,
      destination: page.destination,
      sourceConflicts: page.sourceConflicts,
      updatedAt: now,
    });
    return { done: false };
  }
  const following = nextAuditPhase(audit.phase);
  if (following) {
    await ctx.db.patch(audit._id, {
      phase: following,
      cursor: undefined,
      destination: page.destination,
      sourceConflicts: page.sourceConflicts,
      updatedAt: now,
    });
    return { done: false };
  }
  await ctx.db.patch(audit._id, {
    status: "completed",
    cursor: undefined,
    destination: {
      ...page.destination,
      expected: page.destination.matching + page.destination.missing,
    },
    sourceConflicts: page.sourceConflicts,
    completedAt: now,
    updatedAt: now,
  });
  return { done: true };
}

const continueAuditReference = makeFunctionReference<
  "action",
  { auditId: Id<"migrationAudits"> }
>("workflowMigrations:continueWorkflowAudit");
const getAuditStateReference = makeFunctionReference<
  "query",
  { auditId: Id<"migrationAudits"> },
  {
    status: Doc<"migrationAudits">["status"];
    phase: Doc<"migrationAudits">["phase"];
    verificationRunId?: Id<"migrationRuns">;
  }
>("workflowMigrations:getWorkflowAuditState");
const prepareAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> }
>("workflowMigrations:prepareWorkflowAudit");
const processAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> },
  { done: boolean }
>("workflowMigrations:processWorkflowAuditBatch");
const failAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("workflowMigrations:failWorkflowAudit");

export const startWorkflowAudit = internalMutation({
  args: { runId: v.id("migrationRuns"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10)
      throw new Error("Audit batch size must be between 1 and 10");
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    )
      throw new Error("Conflict-free completed write run is required");
    const existing = await latestAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running")
      throw new Error("Workflow audit is already active");
    const now = Date.now();
    const verificationRunId = await ctx.db.insert("migrationRuns", {
      key: WORKFLOW_MIGRATION_KEY,
      version: WORKFLOW_MIGRATION_VERSION,
      dryRun: true,
      status: "queued",
      phase: "workflow_settings",
      batchSize,
      counters: EMPTY_COUNTERS,
      startedAt: now,
      updatedAt: now,
    });
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      verificationRunId,
      status: "queued",
      phase: "workflow_settings",
      batchSize,
      organizations: 0,
      destination: {
        expected: 0,
        matching: 0,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 0,
      },
      duplicateLegacySettings: 0,
      sourceConflicts: 0,
      auditTruncated: false,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueAuditReference, { auditId });
    return { auditId, runId: run._id };
  },
});

export const getWorkflowAuditState = internalQuery({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Workflow audit was not found");
    return {
      status: audit.status,
      phase: audit.phase,
      verificationRunId: audit.verificationRunId,
    };
  },
});

export const prepareWorkflowAudit = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit?.verificationRunId || audit.phase !== "workflow_settings")
      throw new Error("Workflow audit verification is not pending");
    const verification = await ctx.db.get(audit.verificationRunId);
    assertRun(verification);
    if (verification.status !== "completed")
      throw new Error("Workflow audit verification is not completed");
    await ctx.db.patch(audit._id, {
      status: "running",
      phase: "workflow_source_verification",
      destination: {
        expected: 0,
        matching: 0,
        missing: verification.counters.changed,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 0,
      },
      updatedAt: Date.now(),
    });
  },
});

export const processWorkflowAuditBatch = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: (ctx, args) => runAuditBatch(ctx, args.auditId),
});

export const continueWorkflowAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const state = await ctx.runQuery(getAuditStateReference, args);
      if (state.status === "completed" || state.status === "failed")
        return { done: true };
      if (state.phase === "workflow_settings") {
        if (!state.verificationRunId)
          throw new Error("Audit verification is missing");
        const result = await ctx.runMutation(processReference, {
          runId: state.verificationRunId,
        });
        if (result.done) await ctx.runMutation(prepareAuditReference, args);
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
        return { done: false };
      }
      const result = await ctx.runMutation(processAuditReference, args);
      if (!result.done)
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
      return { done: result.done };
    } catch {
      await ctx.runMutation(failAuditReference, {
        auditId: args.auditId,
        failureCode: "AUDIT_BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failWorkflowAudit = internalMutation({
  args: { auditId: v.id("migrationAudits"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.status === "completed" || audit.status === "failed")
      return;
    const now = Date.now();
    await ctx.db.patch(audit._id, {
      status: "failed",
      failureCode: args.failureCode,
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const resumeWorkflowAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit || audit.status === "completed")
      throw new Error("Resumable workflow audit was not found");
    if (
      audit.status !== "failed" &&
      Date.now() - audit.updatedAt < STALE_RUN_MILLISECONDS
    )
      throw new Error("Workflow audit is not stale");
    await ctx.db.patch(audit._id, {
      status: audit.phase === "workflow_settings" ? "queued" : "running",
      failureCode: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, continueAuditReference, {
      auditId: audit._id,
    });
    return { resumed: true, auditId: audit._id };
  },
});

export const getWorkflowAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await ctx.db
      .query("migrationAudits")
      .withIndex("by_run", (query) => query.eq("migrationRunId", run._id))
      .order("desc")
      .first();
    if (!audit) return { status: "not_started" as const, ready: false };
    const ready =
      audit.status === "completed" &&
      !audit.auditTruncated &&
      audit.sourceConflicts === 0 &&
      audit.destination.missing === 0 &&
      audit.destination.duplicate === 0 &&
      audit.destination.mismatched === 0 &&
      audit.destination.unexpected === 0 &&
      audit.destination.matching === audit.destination.expected &&
      audit.destination.totalRows === audit.destination.expected;
    return { ...audit, ready };
  },
});

export const listWorkflowAuditIssues = internalQuery({
  args: {
    auditId: v.id("migrationAudits"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Workflow audit was not found");
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_audit", (query) => query.eq("auditId", audit._id))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(
        ({ code, field, entityType, entityId, organizationId, createdAt }) => ({
          code,
          field,
          entityType,
          entityId,
          organizationId,
          createdAt,
        }),
      ),
    };
  },
});
