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
  COMMUNICATIONS_MIGRATION_KEY,
  COMMUNICATIONS_MIGRATION_VERSION,
  parseMemoReaction,
  planCommunicationsProjection,
} from "./communicationsMigrationPlanner";
import type {
  CommunicationsMigrationIssue,
  CommunicationsMigrationIssueCode,
  CommunicationsProjectionPlan,
} from "./communicationsMigrationTypes";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;

type CommunicationsPhase =
  | "communications_memos"
  | "communications_conversations"
  | "communications_messages"
  | "communications_preferences"
  | "communications_documents"
  | "communications_leave_attachments";

type MigrationRun = Doc<"migrationRuns"> & { phase: CommunicationsPhase };
type MigrationCounters = Doc<"migrationRuns">["counters"];
type StorageParentId =
  | Id<"memos">
  | Id<"messages">
  | Id<"documents">
  | Id<"leaveRequests">;
type StorageParentType =
  | "memo"
  | "message"
  | "document"
  | "leave_request";
type StoragePurpose =
  | "announcement_attachment"
  | "memo_attachment"
  | "chat_attachment"
  | "document_attachment"
  | "leave_attachment";

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};

const PHASES: readonly CommunicationsPhase[] = [
  "communications_memos",
  "communications_conversations",
  "communications_messages",
  "communications_preferences",
  "communications_documents",
  "communications_leave_attachments",
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

function countersForPlan<T>(
  plan: CommunicationsProjectionPlan<T>,
): Partial<MigrationCounters> {
  if (plan.outcome === "create") return { changed: 1 };
  if (plan.outcome === "unchanged") return { unchanged: 1 };
  return { conflicts: 1 };
}

function assertRun(
  run: Doc<"migrationRuns"> | null,
): asserts run is MigrationRun {
  if (
    !run ||
    run.key !== COMMUNICATIONS_MIGRATION_KEY ||
    run.version !== COMMUNICATIONS_MIGRATION_VERSION ||
    !PHASES.includes(run.phase as CommunicationsPhase)
  ) {
    throw new Error("Communications migration run was not found");
  }
}

function nextPhase(phase: CommunicationsPhase): CommunicationsPhase | null {
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
    issues: CommunicationsMigrationIssue[];
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

async function recordConflict(
  ctx: MutationCtx,
  run: MigrationRun,
  args: {
    organizationId?: Id<"organizations">;
    entityType: string;
    entityId: string;
    code: CommunicationsMigrationIssueCode;
    field: string;
    now: number;
  },
): Promise<Partial<MigrationCounters>> {
  await recordIssues(ctx, {
    runId: run._id,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    issues: [{ code: args.code, field: args.field }],
    now: args.now,
  });
  return { conflicts: 1 };
}

async function applyPlan<T>(
  ctx: MutationCtx,
  run: MigrationRun,
  args: {
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    plan: CommunicationsProjectionPlan<T>;
    insert: (value: T, now: number) => Promise<unknown>;
    now: number;
  },
): Promise<Partial<MigrationCounters>> {
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
  const memberships = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (query) =>
      query.eq("userId", userId).eq("organizationId", organizationId),
    )
    .take(2);
  if (memberships.length > 0) return true;
  const user = await ctx.db.get(userId);
  return user?.organizationId === organizationId;
}

async function employeeBelongsToOrganization(
  ctx: MutationCtx,
  employeeId: Id<"employees">,
  organizationId: Id<"organizations">,
) {
  const employee = await ctx.db.get(employeeId);
  return employee?.organizationId === organizationId;
}

async function organizationExists(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
) {
  return Boolean(await ctx.db.get(organizationId));
}

async function validateStorageMetadata(
  ctx: MutationCtx,
  args: {
    storageId: Id<"_storage">;
    organizationId: Id<"organizations">;
    purpose: StoragePurpose;
  },
): Promise<CommunicationsMigrationIssue | null> {
  const metadataRows = await ctx.db
    .query("storageObjects")
    .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
    .take(2);
  if (metadataRows.length > 1) {
    return { code: "DUPLICATE_STORAGE_OBJECT", field: "storageId" };
  }
  const metadata = metadataRows[0];
  if (!metadata) return null;
  if (metadata.organizationId !== args.organizationId) {
    return { code: "STORAGE_OBJECT_TENANT_MISMATCH", field: "storageId" };
  }
  if (
    !(await userBelongsToOrganization(
      ctx,
      metadata.ownerUserId,
      args.organizationId,
    ))
  ) {
    return {
      code: "STORAGE_OBJECT_OWNER_TENANT_MISMATCH",
      field: "ownerUserId",
    };
  }
  if (metadata.purpose !== args.purpose) {
    return { code: "STORAGE_OBJECT_PURPOSE_MISMATCH", field: "purpose" };
  }
  if (metadata.state !== "active") {
    return { code: "STORAGE_OBJECT_STATE_MISMATCH", field: "state" };
  }
  return null;
}

async function planStorageLink(
  ctx: MutationCtx,
  run: MigrationRun,
  args: {
    organizationId: Id<"organizations">;
    storageId: Id<"_storage">;
    parentType: StorageParentType;
    parentId: StorageParentId;
    purpose: StoragePurpose;
    sourceIndex: number;
    contentType?: string;
    entityType: string;
    now: number;
  },
): Promise<Partial<MigrationCounters>> {
  const metadataIssue = await validateStorageMetadata(ctx, args);
  if (metadataIssue) {
    await recordIssues(ctx, {
      runId: run._id,
      organizationId: args.organizationId,
      entityType: args.entityType,
      entityId: args.parentId,
      issues: [metadataIssue],
      now: args.now,
    });
    return { conflicts: 1 };
  }
  const expected = {
    organizationId: args.organizationId,
    storageId: args.storageId,
    parentType: args.parentType,
    parentId: args.parentId,
    purpose: args.purpose,
    sourceIndex: args.sourceIndex,
    ...(args.contentType !== undefined
      ? { contentType: args.contentType }
      : {}),
    migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
  };
  const rows = await ctx.db
    .query("storageObjectLinks")
    .withIndex("by_storage_parent", (query) =>
      query
        .eq("storageId", args.storageId)
        .eq("parentType", args.parentType)
        .eq("parentId", args.parentId),
    )
    .take(2);
  const plan = planCommunicationsProjection({
    expected,
    destinations: rows,
    duplicateCode: "DUPLICATE_STORAGE_LINK",
    mismatchCode: "STORAGE_LINK_MISMATCH",
    field: "attachments",
  });
  return applyPlan(ctx, run, {
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.parentId,
    plan,
    insert: (value, timestamp) =>
      ctx.db.insert("storageObjectLinks", {
        ...value,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    now: args.now,
  });
}

async function processMemos(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("memos").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const memo of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, memo.organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memo",
          entityId: memo._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (
      !(await userBelongsToOrganization(
        ctx,
        memo.author,
        memo.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memo",
          entityId: memo._id,
          code: "USER_TENANT_MISMATCH",
          field: "author",
          now,
        }),
      );
      continue;
    }
    const reactionKeys = new Set<string>();
    for (const [sourceIndex, rawReaction] of (
      memo.reactions ?? []
    ).entries()) {
      const parsed = parseMemoReaction(rawReaction);
      if (!parsed.ok) {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: memo.organizationId,
          entityType: "memo",
          entityId: memo._id,
          issues: [parsed.issue],
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      const userId = ctx.db.normalizeId("users", parsed.value.userId);
      const key = `${parsed.value.userId}:${parsed.value.emoji}`;
      if (
        !userId ||
        reactionKeys.has(key) ||
        !(await userBelongsToOrganization(ctx, userId, memo.organizationId))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: memo.organizationId,
            entityType: "memo",
            entityId: memo._id,
            code: reactionKeys.has(key)
              ? "DUPLICATE_MEMO_REACTION"
              : "USER_TENANT_MISMATCH",
            field: "reactions",
            now,
          }),
        );
        continue;
      }
      reactionKeys.add(key);
      const expected = {
        organizationId: memo.organizationId,
        memoId: memo._id,
        userId,
        emoji: parsed.value.emoji,
        reactedAt: parsed.value.reactedAt,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("memoReactions")
        .withIndex("by_memo_user_emoji", (query) =>
          query
            .eq("memoId", memo._id)
            .eq("userId", userId)
            .eq("emoji", parsed.value.emoji),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memoReaction",
          entityId: memo._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_MEMO_REACTION",
            mismatchCode: "MEMO_REACTION_MISMATCH",
            field: "reactions",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("memoReactions", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const acknowledgementKeys = new Set<string>();
    for (const [sourceIndex, acknowledgement] of (
      memo.acknowledgedBy ?? []
    ).entries()) {
      const key = acknowledgement.employeeId;
      if (
        acknowledgementKeys.has(key) ||
        !(await employeeBelongsToOrganization(
          ctx,
          acknowledgement.employeeId,
          memo.organizationId,
        ))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: memo.organizationId,
            entityType: "memo",
            entityId: memo._id,
            code: acknowledgementKeys.has(key)
              ? "DUPLICATE_MEMO_ACKNOWLEDGEMENT"
              : "EMPLOYEE_TENANT_MISMATCH",
            field: "acknowledgedBy",
            now,
          }),
        );
        continue;
      }
      acknowledgementKeys.add(key);
      const expected = {
        organizationId: memo.organizationId,
        memoId: memo._id,
        employeeId: acknowledgement.employeeId,
        acknowledgedAt: acknowledgement.date,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("memoAcknowledgements")
        .withIndex("by_memo_employee", (query) =>
          query
            .eq("memoId", memo._id)
            .eq("employeeId", acknowledgement.employeeId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memoAcknowledgement",
          entityId: memo._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_MEMO_ACKNOWLEDGEMENT",
            mismatchCode: "MEMO_ACKNOWLEDGEMENT_MISMATCH",
            field: "acknowledgedBy",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("memoAcknowledgements", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const employeeAudienceKeys = new Set<string>();
    for (const [sourceIndex, employeeId] of (
      memo.specificEmployees ?? []
    ).entries()) {
      const key = employeeId;
      if (
        employeeAudienceKeys.has(key) ||
        !(await employeeBelongsToOrganization(
          ctx,
          employeeId,
          memo.organizationId,
        ))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: memo.organizationId,
            entityType: "memo",
            entityId: memo._id,
            code: employeeAudienceKeys.has(key)
              ? "DUPLICATE_MEMO_AUDIENCE_MEMBER"
              : "EMPLOYEE_TENANT_MISMATCH",
            field: "specificEmployees",
            now,
          }),
        );
        continue;
      }
      employeeAudienceKeys.add(key);
      const expected = {
        organizationId: memo.organizationId,
        memoId: memo._id,
        audienceType: "employee" as const,
        employeeId,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("memoAudienceMembers")
        .withIndex("by_memo_employee", (query) =>
          query.eq("memoId", memo._id).eq("employeeId", employeeId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memoAudienceMember",
          entityId: memo._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_MEMO_AUDIENCE_MEMBER",
            mismatchCode: "MEMO_AUDIENCE_MEMBER_MISMATCH",
            field: "specificEmployees",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("memoAudienceMembers", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const departmentKeys = new Set<string>();
    for (const [sourceIndex, department] of (
      memo.departments ?? []
    ).entries()) {
      const key = department.trim();
      if (key.length === 0 || departmentKeys.has(key)) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: memo.organizationId,
            entityType: "memo",
            entityId: memo._id,
            code: departmentKeys.has(key)
              ? "DUPLICATE_MEMO_AUDIENCE_MEMBER"
              : "MEMO_AUDIENCE_MEMBER_MISMATCH",
            field: "departments",
            now,
          }),
        );
        continue;
      }
      departmentKeys.add(key);
      const expected = {
        organizationId: memo.organizationId,
        memoId: memo._id,
        audienceType: "department" as const,
        department: key,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("memoAudienceMembers")
        .withIndex("by_memo_department", (query) =>
          query.eq("memoId", memo._id).eq("department", key),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memoAudienceMember",
          entityId: memo._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_MEMO_AUDIENCE_MEMBER",
            mismatchCode: "MEMO_AUDIENCE_MEMBER_MISMATCH",
            field: "departments",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("memoAudienceMembers", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const attachments = memo.attachments ?? [];
    if (
      memo.attachmentContentTypes !== undefined &&
      memo.attachmentContentTypes.length !== attachments.length
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: memo.organizationId,
          entityType: "memo",
          entityId: memo._id,
          code: "MEMO_ATTACHMENT_METADATA_MISMATCH",
          field: "attachmentContentTypes",
          now,
        }),
      );
    } else {
      const storageKeys = new Set<string>();
      for (const [sourceIndex, storageId] of attachments.entries()) {
        if (storageKeys.has(storageId)) {
          counters = addCounters(
            counters,
            await recordConflict(ctx, run, {
              organizationId: memo.organizationId,
              entityType: "memo",
              entityId: memo._id,
              code: "DUPLICATE_STORAGE_LINK",
              field: "attachments",
              now,
            }),
          );
          continue;
        }
        storageKeys.add(storageId);
        counters = addCounters(
          counters,
          await planStorageLink(ctx, run, {
            organizationId: memo.organizationId,
            storageId,
            parentType: "memo",
            parentId: memo._id,
            purpose: "announcement_attachment",
            sourceIndex,
            contentType: memo.attachmentContentTypes?.[sourceIndex],
            entityType: "memoAttachment",
            now,
          }),
        );
      }
    }
  }
  return { ...page, counters };
}

async function processConversations(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("conversations").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const conversation of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, conversation.organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: conversation.organizationId,
          entityType: "conversation",
          entityId: conversation._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (
      conversation.createdBy &&
      !(await userBelongsToOrganization(
        ctx,
        conversation.createdBy,
        conversation.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: conversation.organizationId,
          entityType: "conversation",
          entityId: conversation._id,
          code: "USER_TENANT_MISMATCH",
          field: "createdBy",
          now,
        }),
      );
      continue;
    }
    if (
      conversation.adminPersonaUserId &&
      !(await userBelongsToOrganization(
        ctx,
        conversation.adminPersonaUserId,
        conversation.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: conversation.organizationId,
          entityType: "conversation",
          entityId: conversation._id,
          code: "USER_TENANT_MISMATCH",
          field: "adminPersonaUserId",
          now,
        }),
      );
      continue;
    }
    const participantKeys = new Set<string>();
    for (const [sourceIndex, userId] of (
      conversation.participants ?? []
    ).entries()) {
      if (
        participantKeys.has(userId) ||
        !(await userBelongsToOrganization(
          ctx,
          userId,
          conversation.organizationId,
        ))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: conversation.organizationId,
            entityType: "conversation",
            entityId: conversation._id,
            code: participantKeys.has(userId)
              ? "DUPLICATE_CONVERSATION_MEMBER"
              : "USER_TENANT_MISMATCH",
            field: "participants",
            now,
          }),
        );
        continue;
      }
      participantKeys.add(userId);
      const expected = {
        organizationId: conversation.organizationId,
        conversationId: conversation._id,
        userId,
        status: "active" as const,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation_user", (query) =>
          query
            .eq("conversationId", conversation._id)
            .eq("userId", userId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: conversation.organizationId,
          entityType: "conversationMember",
          entityId: conversation._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_CONVERSATION_MEMBER",
            mismatchCode: "CONVERSATION_MEMBER_MISMATCH",
            field: "participants",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("conversationMembers", {
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

async function processMessages(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("messages").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const message of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: undefined,
          entityType: "message",
          entityId: message._id,
          code: "MESSAGE_CONVERSATION_MISMATCH",
          field: "conversationId",
          now,
        }),
      );
      continue;
    }
    const organizationId = conversation.organizationId;
    if (!(await organizationExists(ctx, organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId,
          entityType: "message",
          entityId: message._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (!(await userBelongsToOrganization(ctx, message.senderId, organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId,
          entityType: "message",
          entityId: message._id,
          code: "USER_TENANT_MISMATCH",
          field: "senderId",
          now,
        }),
      );
      continue;
    }
    const readerKeys = new Set<string>();
    for (const [sourceIndex, userId] of (message.readBy ?? []).entries()) {
      if (
        readerKeys.has(userId) ||
        !(await userBelongsToOrganization(ctx, userId, organizationId))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId,
            entityType: "message",
            entityId: message._id,
            code: readerKeys.has(userId)
              ? "DUPLICATE_MESSAGE_RECEIPT"
              : "USER_TENANT_MISMATCH",
            field: "readBy",
            now,
          }),
        );
        continue;
      }
      readerKeys.add(userId);
      const expected = {
        organizationId,
        conversationId: conversation._id,
        messageId: message._id,
        userId,
        state: "read" as const,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("messageReceipts")
        .withIndex("by_message_user", (query) =>
          query.eq("messageId", message._id).eq("userId", userId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId,
          entityType: "messageReceipt",
          entityId: message._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_MESSAGE_RECEIPT",
            mismatchCode: "MESSAGE_RECEIPT_MISMATCH",
            field: "readBy",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("messageReceipts", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }
    const storageKeys = new Set<string>();
    for (const [sourceIndex, storageId] of (
      message.attachments ?? []
    ).entries()) {
      if (storageKeys.has(storageId)) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId,
            entityType: "message",
            entityId: message._id,
            code: "DUPLICATE_STORAGE_LINK",
            field: "attachments",
            now,
          }),
        );
        continue;
      }
      storageKeys.add(storageId);
      counters = addCounters(
        counters,
        await planStorageLink(ctx, run, {
          organizationId,
          storageId,
          parentType: "message",
          parentId: message._id,
          purpose: "chat_attachment",
          sourceIndex,
          entityType: "messageAttachment",
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

async function processPreferences(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("userChatPreferences").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const preferences of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, preferences.organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: preferences.organizationId,
          entityType: "userChatPreferences",
          entityId: preferences._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (
      !(await userBelongsToOrganization(
        ctx,
        preferences.userId,
        preferences.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: preferences.organizationId,
          entityType: "userChatPreferences",
          entityId: preferences._id,
          code: "USER_TENANT_MISMATCH",
          field: "userId",
          now,
        }),
      );
      continue;
    }
    const conversationKeys = new Set<string>();
    for (const [position, conversationId] of (
      preferences.pinnedConversations ?? []
    ).entries()) {
      const conversation = await ctx.db.get(conversationId);
      if (
        conversationKeys.has(conversationId) ||
        !conversation ||
        conversation.organizationId !== preferences.organizationId
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: preferences.organizationId,
            entityType: "userChatPreferences",
            entityId: preferences._id,
            code: conversationKeys.has(conversationId)
              ? "DUPLICATE_PINNED_CONVERSATION"
              : "CONVERSATION_TENANT_MISMATCH",
            field: "pinnedConversations",
            now,
          }),
        );
        continue;
      }
      conversationKeys.add(conversationId);
      const expected = {
        organizationId: preferences.organizationId,
        userId: preferences.userId,
        conversationId,
        sourcePreferencesId: preferences._id,
        position,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("userPinnedConversations")
        .withIndex("by_user_conversation", (query) =>
          query
            .eq("userId", preferences.userId)
            .eq("conversationId", conversationId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: preferences.organizationId,
          entityType: "userPinnedConversation",
          entityId: preferences._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_PINNED_CONVERSATION",
            mismatchCode: "PINNED_CONVERSATION_MISMATCH",
            field: "pinnedConversations",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("userPinnedConversations", {
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

async function processDocuments(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("documents").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const document of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, document.organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: document.organizationId,
          entityType: "document",
          entityId: document._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (
      !(await userBelongsToOrganization(
        ctx,
        document.createdBy,
        document.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: document.organizationId,
          entityType: "document",
          entityId: document._id,
          code: "USER_TENANT_MISMATCH",
          field: "createdBy",
          now,
        }),
      );
      continue;
    }
    if (
      document.employeeId &&
      !(await employeeBelongsToOrganization(
        ctx,
        document.employeeId,
        document.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: document.organizationId,
          entityType: "document",
          entityId: document._id,
          code: "EMPLOYEE_TENANT_MISMATCH",
          field: "employeeId",
          now,
        }),
      );
      continue;
    }
    const userKeys = new Set<string>();
    for (const [sourceIndex, userId] of (document.sharedWith ?? []).entries()) {
      if (
        userKeys.has(userId) ||
        !(await userBelongsToOrganization(ctx, userId, document.organizationId))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: document.organizationId,
            entityType: "document",
            entityId: document._id,
            code: userKeys.has(userId)
              ? "DUPLICATE_DOCUMENT_ACCESS_GRANT"
              : "USER_TENANT_MISMATCH",
            field: "sharedWith",
            now,
          }),
        );
        continue;
      }
      userKeys.add(userId);
      const expected = {
        organizationId: document.organizationId,
        documentId: document._id,
        grantType: "user" as const,
        userId,
        sourceField: "sharedWith" as const,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("documentAccessGrants")
        .withIndex("by_document_user", (query) =>
          query.eq("documentId", document._id).eq("userId", userId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: document.organizationId,
          entityType: "documentAccessGrant",
          entityId: document._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_DOCUMENT_ACCESS_GRANT",
            mismatchCode: "DOCUMENT_ACCESS_GRANT_MISMATCH",
            field: "sharedWith",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("documentAccessGrants", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const employeeKeys = new Set<string>();
    for (const [sourceIndex, employeeId] of (
      document.visibleEmployeeIds ?? []
    ).entries()) {
      if (
        employeeKeys.has(employeeId) ||
        !(await employeeBelongsToOrganization(
          ctx,
          employeeId,
          document.organizationId,
        ))
      ) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: document.organizationId,
            entityType: "document",
            entityId: document._id,
            code: employeeKeys.has(employeeId)
              ? "DUPLICATE_DOCUMENT_ACCESS_GRANT"
              : "EMPLOYEE_TENANT_MISMATCH",
            field: "visibleEmployeeIds",
            now,
          }),
        );
        continue;
      }
      employeeKeys.add(employeeId);
      const expected = {
        organizationId: document.organizationId,
        documentId: document._id,
        grantType: "employee" as const,
        employeeId,
        sourceField: "visibleEmployeeIds" as const,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("documentAccessGrants")
        .withIndex("by_document_employee", (query) =>
          query.eq("documentId", document._id).eq("employeeId", employeeId),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: document.organizationId,
          entityType: "documentAccessGrant",
          entityId: document._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_DOCUMENT_ACCESS_GRANT",
            mismatchCode: "DOCUMENT_ACCESS_GRANT_MISMATCH",
            field: "visibleEmployeeIds",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("documentAccessGrants", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const departmentKeys = new Set<string>();
    for (const [sourceIndex, department] of (
      document.visibleDepartments ?? []
    ).entries()) {
      const key = department.trim();
      if (key.length === 0 || departmentKeys.has(key)) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: document.organizationId,
            entityType: "document",
            entityId: document._id,
            code: departmentKeys.has(key)
              ? "DUPLICATE_DOCUMENT_ACCESS_GRANT"
              : "DOCUMENT_ACCESS_GRANT_MISMATCH",
            field: "visibleDepartments",
            now,
          }),
        );
        continue;
      }
      departmentKeys.add(key);
      const expected = {
        organizationId: document.organizationId,
        documentId: document._id,
        grantType: "department" as const,
        department: key,
        sourceField: "visibleDepartments" as const,
        sourceIndex,
        migrationVersion: COMMUNICATIONS_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("documentAccessGrants")
        .withIndex("by_document_department", (query) =>
          query.eq("documentId", document._id).eq("department", key),
        )
        .take(2);
      counters = addCounters(
        counters,
        await applyPlan(ctx, run, {
          organizationId: document.organizationId,
          entityType: "documentAccessGrant",
          entityId: document._id,
          plan: planCommunicationsProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_DOCUMENT_ACCESS_GRANT",
            mismatchCode: "DOCUMENT_ACCESS_GRANT_MISMATCH",
            field: "visibleDepartments",
          }),
          insert: (value, timestamp) =>
            ctx.db.insert("documentAccessGrants", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const storageKeys = new Set<string>();
    for (const [sourceIndex, storageId] of (
      document.attachments ?? []
    ).entries()) {
      if (storageKeys.has(storageId)) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: document.organizationId,
            entityType: "document",
            entityId: document._id,
            code: "DUPLICATE_STORAGE_LINK",
            field: "attachments",
            now,
          }),
        );
        continue;
      }
      storageKeys.add(storageId);
      counters = addCounters(
        counters,
        await planStorageLink(ctx, run, {
          organizationId: document.organizationId,
          storageId,
          parentType: "document",
          parentId: document._id,
          purpose: "document_attachment",
          sourceIndex,
          entityType: "documentAttachment",
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

async function processLeaveAttachments(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("leaveRequests").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const request of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, request.organizationId))) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: request.organizationId,
          entityType: "leaveRequest",
          entityId: request._id,
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          now,
        }),
      );
      continue;
    }
    if (
      !(await employeeBelongsToOrganization(
        ctx,
        request.employeeId,
        request.organizationId,
      ))
    ) {
      counters = addCounters(
        counters,
        await recordConflict(ctx, run, {
          organizationId: request.organizationId,
          entityType: "leaveRequest",
          entityId: request._id,
          code: "EMPLOYEE_TENANT_MISMATCH",
          field: "employeeId",
          now,
        }),
      );
      continue;
    }
    const storageKeys = new Set<string>();
    for (const [sourceIndex, storageId] of (
      request.supportingDocuments ?? []
    ).entries()) {
      if (storageKeys.has(storageId)) {
        counters = addCounters(
          counters,
          await recordConflict(ctx, run, {
            organizationId: request.organizationId,
            entityType: "leaveRequest",
            entityId: request._id,
            code: "DUPLICATE_STORAGE_LINK",
            field: "supportingDocuments",
            now,
          }),
        );
        continue;
      }
      storageKeys.add(storageId);
      counters = addCounters(
        counters,
        await planStorageLink(ctx, run, {
          organizationId: request.organizationId,
          storageId,
          parentType: "leave_request",
          parentId: request._id,
          purpose: "leave_attachment",
          sourceIndex,
          entityType: "leaveAttachment",
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

function processPhase(ctx: MutationCtx, run: MigrationRun) {
  switch (run.phase) {
    case "communications_memos":
      return processMemos(ctx, run);
    case "communications_conversations":
      return processConversations(ctx, run);
    case "communications_messages":
      return processMessages(ctx, run);
    case "communications_preferences":
      return processPreferences(ctx, run);
    case "communications_documents":
      return processDocuments(ctx, run);
    case "communications_leave_attachments":
      return processLeaveAttachments(ctx, run);
  }
}

const continueReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("communicationsMigrations:continueCommunicationsMigration");
const processReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("communicationsMigrations:processCommunicationsMigrationBatch");
const failReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("communicationsMigrations:failCommunicationsMigration");

export const startCommunicationsMigration = internalMutation({
  args: {
    dryRun: v.boolean(),
    dryRunId: v.optional(v.id("migrationRuns")),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      throw new Error("Batch size must be between 1 and 50");
    }
    const active = [
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query.eq("key", COMMUNICATIONS_MIGRATION_KEY).eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query
            .eq("key", COMMUNICATIONS_MIGRATION_KEY)
            .eq("status", "running"),
        )
        .take(1)),
    ];
    if (active.length > 0) {
      throw new Error("A communications migration is already active");
    }
    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (
        !dryRun ||
        dryRun.key !== COMMUNICATIONS_MIGRATION_KEY ||
        dryRun.version !== COMMUNICATIONS_MIGRATION_VERSION ||
        !dryRun.dryRun ||
        dryRun.status !== "completed" ||
        dryRun.counters.conflicts > 0 ||
        dryRun.counters.errors > 0
      ) {
        throw new Error("Conflict-free completed dry-run is required");
      }
      requiredDryRunId = dryRun._id;
    }
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: COMMUNICATIONS_MIGRATION_KEY,
      version: COMMUNICATIONS_MIGRATION_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "communications_memos",
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
      key: COMMUNICATIONS_MIGRATION_KEY,
      version: COMMUNICATIONS_MIGRATION_VERSION,
    };
  },
});

export const processCommunicationsMigrationBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      return { done: true };
    }
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

export const continueCommunicationsMigration = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const result = await ctx.runMutation(processReference, args);
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueReference, args);
      }
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

export const failCommunicationsMigration = internalMutation({
  args: { runId: v.id("migrationRuns"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== COMMUNICATIONS_MIGRATION_KEY ||
      run.version !== COMMUNICATIONS_MIGRATION_VERSION ||
      run.status === "completed" ||
      run.status === "failed"
    ) {
      return;
    }
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

export const getCommunicationsMigrationRun = internalQuery({
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
      issues: issues.slice(0, MAX_STATUS_ISSUES).map(
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

export const listCommunicationsMigrationIssues = internalQuery({
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

export const resumeCommunicationsMigration = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Only an active communications migration can resume");
    }
    if (Date.now() - run.updatedAt < STALE_RUN_MILLISECONDS) {
      throw new Error("Communications migration is not stale");
    }
    await ctx.scheduler.runAfter(0, continueReference, { runId: run._id });
    return { resumed: true, runId: run._id };
  },
});

type CommunicationsAuditPhase =
  | "communications_source_verification"
  | "communications_target_memo_reactions"
  | "communications_target_memo_acknowledgements"
  | "communications_target_memo_audience"
  | "communications_target_conversation_members"
  | "communications_target_message_receipts"
  | "communications_target_pins"
  | "communications_target_document_grants"
  | "communications_target_storage_links";

type AuditPage = {
  isDone: boolean;
  continueCursor: string;
  destination: Doc<"migrationAudits">["destination"];
  sourceConflicts: number;
};

const AUDIT_PHASES: readonly CommunicationsAuditPhase[] = [
  "communications_source_verification",
  "communications_target_memo_reactions",
  "communications_target_memo_acknowledgements",
  "communications_target_memo_audience",
  "communications_target_conversation_members",
  "communications_target_message_receipts",
  "communications_target_pins",
  "communications_target_document_grants",
  "communications_target_storage_links",
];

function isAuditPhase(
  phase: Doc<"migrationAudits">["phase"],
): phase is CommunicationsAuditPhase {
  return AUDIT_PHASES.includes(phase as CommunicationsAuditPhase);
}

function nextAuditPhase(
  phase: CommunicationsAuditPhase,
): CommunicationsAuditPhase | null {
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

async function auditVerification(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: MigrationRun,
): Promise<AuditPage> {
  if (!audit.verificationRunId) {
    throw new Error("Communications audit verification is missing");
  }
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
  run: MigrationRun,
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

async function storageLinkHasSource(
  ctx: MutationCtx,
  row: Doc<"storageObjectLinks">,
): Promise<boolean> {
  switch (row.parentType) {
    case "memo": {
      const memo = await ctx.db.get(row.parentId as Id<"memos">);
      return (
        memo?.organizationId === row.organizationId &&
        memo.attachments?.[row.sourceIndex] === row.storageId &&
        (memo.attachmentContentTypes?.[row.sourceIndex] ?? undefined) ===
          row.contentType
      );
    }
    case "message": {
      const message = await ctx.db.get(row.parentId as Id<"messages">);
      if (message?.attachments?.[row.sourceIndex] !== row.storageId) return false;
      const conversation = await ctx.db.get(message.conversationId);
      return conversation?.organizationId === row.organizationId;
    }
    case "document": {
      const document = await ctx.db.get(row.parentId as Id<"documents">);
      return (
        document?.organizationId === row.organizationId &&
        document.attachments?.[row.sourceIndex] === row.storageId
      );
    }
    case "leave_request": {
      const request = await ctx.db.get(row.parentId as Id<"leaveRequests">);
      return (
        request?.organizationId === row.organizationId &&
        request.supportingDocuments?.[row.sourceIndex] === row.storageId
      );
    }
    case "accounting_cost_item":
      return false;
  }
}

async function auditTarget(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits"> & { phase: CommunicationsAuditPhase },
  run: MigrationRun,
): Promise<AuditPage> {
  const destination = { ...audit.destination };
  const acceptRows = async <
    T extends { _id: string; organizationId: Id<"organizations"> },
  >(
    page: { page: T[]; isDone: boolean; continueCursor: string },
    entityType: string,
    field: string,
    exists: (row: T) => Promise<boolean>,
  ): Promise<AuditPage> => {
    let newUnexpected = 0;
    for (const row of page.page) {
      destination.totalRows += 1;
      if (!(await exists(row))) {
        newUnexpected += 1;
        destination.unexpected += 1;
        await markUnexpected(ctx, audit, run, {
          organizationId: row.organizationId,
          entityType,
          entityId: row._id,
          field,
        });
      }
    }
    destination.matching += page.page.length - newUnexpected;
    return {
      ...page,
      destination,
      sourceConflicts: audit.sourceConflicts + newUnexpected,
    };
  };

  switch (audit.phase) {
    case "communications_target_memo_reactions": {
      const page = await ctx.db.query("memoReactions").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(page, "memoReaction", "sourceIndex", async (row) => {
        const memo = await ctx.db.get(row.memoId);
        const parsed = parseMemoReaction(memo?.reactions?.[row.sourceIndex]);
        return (
          memo?.organizationId === row.organizationId &&
          parsed.ok &&
          ctx.db.normalizeId("users", parsed.value.userId) === row.userId &&
          parsed.value.emoji === row.emoji &&
          parsed.value.reactedAt === row.reactedAt
        );
      });
    }
    case "communications_target_memo_acknowledgements": {
      const page = await ctx.db.query("memoAcknowledgements").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(
        page,
        "memoAcknowledgement",
        "sourceIndex",
        async (row) => {
          const memo = await ctx.db.get(row.memoId);
          const source = memo?.acknowledgedBy?.[row.sourceIndex];
          return (
            memo?.organizationId === row.organizationId &&
            source?.employeeId === row.employeeId &&
            source.date === row.acknowledgedAt
          );
        },
      );
    }
    case "communications_target_memo_audience": {
      const page = await ctx.db.query("memoAudienceMembers").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(
        page,
        "memoAudienceMember",
        "sourceIndex",
        async (row) => {
          const memo = await ctx.db.get(row.memoId);
          if (memo?.organizationId !== row.organizationId) return false;
          return row.audienceType === "employee"
            ? memo.specificEmployees?.[row.sourceIndex] === row.employeeId
            : memo.departments?.[row.sourceIndex]?.trim() === row.department;
        },
      );
    }
    case "communications_target_conversation_members": {
      const page = await ctx.db.query("conversationMembers").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(
        page,
        "conversationMember",
        "sourceIndex",
        async (row) => {
          const conversation = await ctx.db.get(row.conversationId);
          return (
            conversation?.organizationId === row.organizationId &&
            conversation.participants?.[row.sourceIndex] === row.userId
          );
        },
      );
    }
    case "communications_target_message_receipts": {
      const page = await ctx.db.query("messageReceipts").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(page, "messageReceipt", "sourceIndex", async (row) => {
        const message = await ctx.db.get(row.messageId);
        if (
          message?.conversationId !== row.conversationId ||
          message.readBy?.[row.sourceIndex] !== row.userId
        ) {
          return false;
        }
        const conversation = await ctx.db.get(message.conversationId);
        return conversation?.organizationId === row.organizationId;
      });
    }
    case "communications_target_pins": {
      const page = await ctx.db.query("userPinnedConversations").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(
        page,
        "userPinnedConversation",
        "position",
        async (row) => {
          const preferences = await ctx.db.get(row.sourcePreferencesId);
          return (
            preferences?.organizationId === row.organizationId &&
            preferences.userId === row.userId &&
            preferences.pinnedConversations?.[row.position] ===
              row.conversationId
          );
        },
      );
    }
    case "communications_target_document_grants": {
      const page = await ctx.db.query("documentAccessGrants").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      return acceptRows(
        page,
        "documentAccessGrant",
        "sourceIndex",
        async (row) => {
          const document = await ctx.db.get(row.documentId);
          if (document?.organizationId !== row.organizationId) return false;
          if (row.sourceField === "sharedWith") {
            return document.sharedWith?.[row.sourceIndex] === row.userId;
          }
          if (row.sourceField === "visibleEmployeeIds") {
            return (
              document.visibleEmployeeIds?.[row.sourceIndex] === row.employeeId
            );
          }
          return (
            document.visibleDepartments?.[row.sourceIndex]?.trim() ===
            row.department
          );
        },
      );
    }
    case "communications_target_storage_links": {
      const rawPage = await ctx.db.query("storageObjectLinks").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      const page = {
        ...rawPage,
        page: rawPage.page.filter(
          (row) => row.parentType !== "accounting_cost_item",
        ),
      };
      return acceptRows(
        page,
        "storageObjectLink",
        "sourceIndex",
        (row) => storageLinkHasSource(ctx, row),
      );
    }
    case "communications_source_verification":
      throw new Error("Source verification uses migration issues");
  }
}

async function runAuditBatch(
  ctx: MutationCtx,
  auditId: Id<"migrationAudits">,
) {
  const audit = await ctx.db.get(auditId);
  if (!audit || !isAuditPhase(audit.phase)) {
    throw new Error("Communications audit was not found");
  }
  if (audit.status !== "queued" && audit.status !== "running") {
    return { done: true };
  }
  const rawRun = await ctx.db.get(audit.migrationRunId);
  assertRun(rawRun);
  const run = rawRun;
  const page =
    audit.phase === "communications_source_verification"
      ? await auditVerification(ctx, audit, run)
      : await auditTarget(
          ctx,
          audit as Doc<"migrationAudits"> & {
            phase: CommunicationsAuditPhase;
          },
          run,
        );
  const now = Date.now();
  if (!page.isDone) {
    await ctx.db.patch(audit._id, {
      status: "running",
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
      status: "running",
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
>("communicationsMigrations:continueCommunicationsAudit");
const getAuditStateReference = makeFunctionReference<
  "query",
  { auditId: Id<"migrationAudits"> },
  {
    status: Doc<"migrationAudits">["status"];
    phase: Doc<"migrationAudits">["phase"];
    verificationRunId?: Id<"migrationRuns">;
  }
>("communicationsMigrations:getCommunicationsAuditState");
const prepareAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> }
>("communicationsMigrations:prepareCommunicationsAudit");
const processAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> },
  { done: boolean }
>("communicationsMigrations:processCommunicationsAuditBatch");
const failAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("communicationsMigrations:failCommunicationsAudit");

export const startCommunicationsAudit = internalMutation({
  args: { runId: v.id("migrationRuns"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
      throw new Error("Audit batch size must be between 1 and 10");
    }
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const existing = await latestAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") {
      throw new Error("Communications audit is already active");
    }
    const now = Date.now();
    const verificationRunId = await ctx.db.insert("migrationRuns", {
      key: COMMUNICATIONS_MIGRATION_KEY,
      version: COMMUNICATIONS_MIGRATION_VERSION,
      dryRun: true,
      status: "queued",
      phase: "communications_memos",
      batchSize,
      counters: EMPTY_COUNTERS,
      startedAt: now,
      updatedAt: now,
    });
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      verificationRunId,
      status: "queued",
      phase: "communications_memos",
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

export const getCommunicationsAuditState = internalQuery({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Communications audit was not found");
    return {
      status: audit.status,
      phase: audit.phase,
      verificationRunId: audit.verificationRunId,
    };
  },
});

export const prepareCommunicationsAudit = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit?.verificationRunId || audit.phase !== "communications_memos") {
      throw new Error("Communications audit verification is not pending");
    }
    const verification = await ctx.db.get(audit.verificationRunId);
    assertRun(verification);
    if (verification.status !== "completed") {
      throw new Error("Communications audit verification is not completed");
    }
    await ctx.db.patch(audit._id, {
      status: "running",
      phase: "communications_source_verification",
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

export const processCommunicationsAuditBatch = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: (ctx, args) => runAuditBatch(ctx, args.auditId),
});

export const continueCommunicationsAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const state = await ctx.runQuery(getAuditStateReference, args);
      if (state.status === "completed" || state.status === "failed") {
        return { done: true };
      }
      if (state.phase === "communications_memos") {
        if (!state.verificationRunId) {
          throw new Error("Communications audit verification is missing");
        }
        const result = await ctx.runMutation(processReference, {
          runId: state.verificationRunId,
        });
        if (result.done) await ctx.runMutation(prepareAuditReference, args);
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
        return { done: false };
      }
      const result = await ctx.runMutation(processAuditReference, args);
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
      }
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

export const failCommunicationsAudit = internalMutation({
  args: { auditId: v.id("migrationAudits"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.status === "completed" || audit.status === "failed") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(audit._id, {
      status: "failed",
      failureCode: args.failureCode,
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const resumeCommunicationsAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit || audit.status === "completed") {
      throw new Error("Resumable communications audit was not found");
    }
    if (
      audit.status !== "failed" &&
      Date.now() - audit.updatedAt < STALE_RUN_MILLISECONDS
    ) {
      throw new Error("Communications audit is not stale");
    }
    await ctx.db.patch(audit._id, {
      status: audit.phase === "communications_memos" ? "queued" : "running",
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

export const getCommunicationsAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await ctx.db
      .query("migrationAudits")
      .withIndex("by_run", (query) => query.eq("migrationRunId", run._id))
      .order("desc")
      .first();
    if (!audit) throw new Error("Communications audit was not found");
    return {
      ...audit,
      ready:
        audit.status === "completed" &&
        audit.sourceConflicts === 0 &&
        audit.destination.missing === 0 &&
        audit.destination.duplicate === 0 &&
        audit.destination.mismatched === 0 &&
        audit.destination.unexpected === 0 &&
        audit.destination.matching === audit.destination.expected &&
        audit.destination.totalRows === audit.destination.expected,
    };
  },
});

export const listCommunicationsAuditIssues = internalQuery({
  args: {
    auditId: v.id("migrationAudits"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Communications audit was not found");
    const run = await ctx.db.get(audit.migrationRunId);
    assertRun(run);
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
