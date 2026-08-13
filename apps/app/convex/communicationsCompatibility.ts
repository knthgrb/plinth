import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MIGRATION_VERSION = 1;
type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
export type MemoReaction = {
  userId: Id<"users">;
  emoji: string;
  createdAt: number;
};

function assertMemoChild(
  memo: Doc<"memos">,
  child: { organizationId: Id<"organizations">; memoId: Id<"memos"> },
): void {
  if (
    child.organizationId !== memo.organizationId ||
    child.memoId !== memo._id
  ) {
    throw new Error("Memo child tenant mismatch");
  }
}

export async function loadEffectiveMemo(
  ctx: DatabaseContext,
  memo: Doc<"memos">,
): Promise<Doc<"memos">> {
  const [reactions, acknowledgements, audience, links] = await Promise.all([
    ctx.db.query("memoReactions").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("memoAcknowledgements").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("memoAudienceMembers").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "memo").eq("parentId", memo._id)).collect(),
  ]);
  for (const row of [...reactions, ...acknowledgements, ...audience]) {
    assertMemoChild(memo, row);
  }
  for (const row of links) {
    if (row.organizationId !== memo.organizationId) {
      throw new Error("Memo attachment tenant mismatch");
    }
  }
  const orderedReactions: MemoReaction[] = reactions
    .slice()
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => ({
      userId: row.userId,
      emoji: row.emoji,
      createdAt: row.reactedAt,
    }));
  const orderedAcknowledgements = acknowledgements
    .slice()
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => ({ employeeId: row.employeeId, date: row.acknowledgedAt }));
  const employees = audience
    .filter((row) => row.audienceType === "employee" && row.employeeId)
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => row.employeeId as Id<"employees">);
  const departments = audience
    .filter((row) => row.audienceType === "department" && row.department)
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => row.department as string);
  const orderedLinks = links.slice().sort((a, b) => a.sourceIndex - b.sourceIndex);
  return {
    ...memo,
    reactions: reactions.length > 0 ? orderedReactions : memo.reactions,
    acknowledgedBy:
      acknowledgements.length > 0
        ? orderedAcknowledgements
        : memo.acknowledgedBy,
    specificEmployees: employees.length > 0 ? employees : memo.specificEmployees,
    departments: departments.length > 0 ? departments : memo.departments,
    attachments:
      links.length > 0 ? orderedLinks.map((row) => row.storageId) : memo.attachments,
    attachmentContentTypes:
      links.length > 0
        ? orderedLinks.map((row) => row.contentType ?? "application/octet-stream")
        : memo.attachmentContentTypes,
  };
}

export async function replaceMemoProjection(
  ctx: MutationCtx,
  memo: Doc<"memos">,
  values: {
    reactions: MemoReaction[];
    acknowledgements: NonNullable<Doc<"memos">["acknowledgedBy"]>;
    employees: Id<"employees">[];
    departments: string[];
    attachments: Id<"_storage">[];
    contentTypes?: string[];
  },
  now: number,
): Promise<void> {
  if (
    values.contentTypes !== undefined &&
    values.contentTypes.length !== values.attachments.length
  ) {
    throw new Error("Memo attachment metadata mismatch");
  }
  const existing = await Promise.all([
    ctx.db.query("memoReactions").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("memoAcknowledgements").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("memoAudienceMembers").withIndex("by_memo", (q) => q.eq("memoId", memo._id)).collect(),
    ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "memo").eq("parentId", memo._id)).collect(),
  ]);
  for (const rows of existing) for (const row of rows) await ctx.db.delete(row._id);
  const reactionKeys = new Set<string>();
  for (const [sourceIndex, reaction] of values.reactions.entries()) {
    const key = `${reaction.userId}:${reaction.emoji}`;
    if (reactionKeys.has(key)) throw new Error("Memo reaction is not unique");
    reactionKeys.add(key);
    await ctx.db.insert("memoReactions", { organizationId: memo.organizationId, memoId: memo._id, userId: reaction.userId, emoji: reaction.emoji, reactedAt: reaction.createdAt, sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
  const employeeIds = new Set<Id<"employees">>();
  for (const [sourceIndex, acknowledgement] of values.acknowledgements.entries()) {
    if (employeeIds.has(acknowledgement.employeeId)) throw new Error("Memo acknowledgement is not unique");
    employeeIds.add(acknowledgement.employeeId);
    await ctx.db.insert("memoAcknowledgements", { organizationId: memo.organizationId, memoId: memo._id, employeeId: acknowledgement.employeeId, acknowledgedAt: acknowledgement.date, sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
  const audienceEmployees = new Set<Id<"employees">>();
  for (const [sourceIndex, employeeId] of values.employees.entries()) {
    if (audienceEmployees.has(employeeId)) throw new Error("Memo employee audience is not unique");
    audienceEmployees.add(employeeId);
    await ctx.db.insert("memoAudienceMembers", { organizationId: memo.organizationId, memoId: memo._id, audienceType: "employee", employeeId, sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
  const audienceDepartments = new Set<string>();
  for (const [sourceIndex, department] of values.departments.entries()) {
    const normalized = department.trim();
    if (!normalized || audienceDepartments.has(normalized)) throw new Error("Memo department audience is not unique");
    audienceDepartments.add(normalized);
    await ctx.db.insert("memoAudienceMembers", { organizationId: memo.organizationId, memoId: memo._id, audienceType: "department", department: normalized, sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
  const storageIds = new Set<Id<"_storage">>();
  for (const [sourceIndex, storageId] of values.attachments.entries()) {
    if (storageIds.has(storageId)) throw new Error("Memo attachment is not unique");
    storageIds.add(storageId);
    await ctx.db.insert("storageObjectLinks", { organizationId: memo.organizationId, storageId, parentType: "memo", parentId: memo._id, purpose: memo.type === "announcement" ? "announcement_attachment" : "memo_attachment", sourceIndex, ...(values.contentTypes?.[sourceIndex] ? { contentType: values.contentTypes[sourceIndex] } : {}), migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
}

export async function synchronizeEffectiveMemo(
  ctx: MutationCtx,
  memo: Doc<"memos">,
  patch: Partial<Pick<Doc<"memos">, "reactions" | "acknowledgedBy" | "specificEmployees" | "departments" | "attachments" | "attachmentContentTypes">>,
  now: number,
): Promise<void> {
  const effective = await loadEffectiveMemo(ctx, memo);
  const reactions = (patch.reactions ?? effective.reactions ?? []) as MemoReaction[];
  await replaceMemoProjection(ctx, memo, {
    reactions,
    acknowledgements: patch.acknowledgedBy ?? effective.acknowledgedBy ?? [],
    employees: patch.specificEmployees ?? effective.specificEmployees ?? [],
    departments: patch.departments ?? effective.departments ?? [],
    attachments: patch.attachments ?? effective.attachments ?? [],
    contentTypes: patch.attachmentContentTypes ?? effective.attachmentContentTypes,
  }, now);
}

export async function loadEffectiveDocument(
  ctx: DatabaseContext,
  document: Doc<"documents">,
): Promise<Doc<"documents">> {
  const [grants, links] = await Promise.all([
    ctx.db.query("documentAccessGrants").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect(),
    ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "document").eq("parentId", document._id)).collect(),
  ]);
  for (const row of [...grants, ...links]) {
    if (row.organizationId !== document.organizationId) throw new Error("Document child tenant mismatch");
  }
  const sharedWith = grants.filter((row) => row.grantType === "user" && row.userId).sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => row.userId as Id<"users">);
  const visibleEmployeeIds = grants.filter((row) => row.grantType === "employee" && row.employeeId).sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => row.employeeId as Id<"employees">);
  const visibleDepartments = grants.filter((row) => row.grantType === "department" && row.department).sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => row.department as string);
  return {
    ...document,
    sharedWith: sharedWith.length > 0 ? sharedWith : document.sharedWith,
    visibleEmployeeIds: visibleEmployeeIds.length > 0 ? visibleEmployeeIds : document.visibleEmployeeIds,
    visibleDepartments: visibleDepartments.length > 0 ? visibleDepartments : document.visibleDepartments,
    attachments: links.length > 0 ? links.sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => row.storageId) : document.attachments,
  };
}

export async function replaceDocumentProjection(
  ctx: MutationCtx,
  document: Doc<"documents">,
  values: Pick<Doc<"documents">, "sharedWith" | "visibleEmployeeIds" | "visibleDepartments" | "attachments">,
  now: number,
): Promise<void> {
  const [grants, links] = await Promise.all([
    ctx.db.query("documentAccessGrants").withIndex("by_document", (q) => q.eq("documentId", document._id)).collect(),
    ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "document").eq("parentId", document._id)).collect(),
  ]);
  for (const row of [...grants, ...links]) await ctx.db.delete(row._id);
  const insertGrant = async (grant: Omit<Doc<"documentAccessGrants">, "_id" | "_creationTime" | "createdAt" | "updatedAt">) => {
    await ctx.db.insert("documentAccessGrants", { ...grant, createdAt: now, updatedAt: now });
  };
  for (const [sourceIndex, userId] of (values.sharedWith ?? []).entries()) await insertGrant({ organizationId: document.organizationId, documentId: document._id, grantType: "user", userId, sourceField: "sharedWith", sourceIndex, migrationVersion: MIGRATION_VERSION });
  for (const [sourceIndex, employeeId] of (values.visibleEmployeeIds ?? []).entries()) await insertGrant({ organizationId: document.organizationId, documentId: document._id, grantType: "employee", employeeId, sourceField: "visibleEmployeeIds", sourceIndex, migrationVersion: MIGRATION_VERSION });
  for (const [sourceIndex, department] of (values.visibleDepartments ?? []).entries()) await insertGrant({ organizationId: document.organizationId, documentId: document._id, grantType: "department", department, sourceField: "visibleDepartments", sourceIndex, migrationVersion: MIGRATION_VERSION });
  for (const [sourceIndex, storageId] of (values.attachments ?? []).entries()) await ctx.db.insert("storageObjectLinks", { organizationId: document.organizationId, storageId, parentType: "document", parentId: document._id, purpose: "document_attachment", sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
}

export async function loadEffectiveConversation(
  ctx: DatabaseContext,
  conversation: Doc<"conversations">,
): Promise<Doc<"conversations">> {
  const rows = await ctx.db.query("conversationMembers").withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id)).collect();
  if (rows.length === 0) return conversation;
  const participants = rows.sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => {
    if (row.organizationId !== conversation.organizationId) throw new Error("Conversation member tenant mismatch");
    return row.userId;
  });
  return { ...conversation, participants };
}

export async function replaceConversationMembers(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  participants: Id<"users">[],
  now: number,
): Promise<void> {
  const existing = await ctx.db.query("conversationMembers").withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const users = new Set<Id<"users">>();
  for (const [sourceIndex, userId] of participants.entries()) {
    if (users.has(userId)) throw new Error("Conversation member is not unique");
    users.add(userId);
    await ctx.db.insert("conversationMembers", { organizationId: conversation.organizationId, conversationId: conversation._id, userId, status: "active", sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
}

export async function loadEffectiveMessageReadBy(
  ctx: DatabaseContext,
  conversation: Doc<"conversations">,
  message: Doc<"messages">,
): Promise<Id<"users">[]> {
  const rows = await ctx.db.query("messageReceipts").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect();
  if (rows.length === 0) return message.readBy ?? [];
  return rows.sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => {
    if (row.organizationId !== conversation.organizationId || row.conversationId !== conversation._id) throw new Error("Message receipt tenant mismatch");
    return row.userId;
  });
}

export async function replaceMessageReceipts(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  message: Doc<"messages">,
  readBy: Id<"users">[],
  now: number,
): Promise<void> {
  const existing = await ctx.db.query("messageReceipts").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const users = new Set<Id<"users">>();
  for (const [sourceIndex, userId] of readBy.entries()) {
    if (users.has(userId)) throw new Error("Message receipt is not unique");
    users.add(userId);
    await ctx.db.insert("messageReceipts", { organizationId: conversation.organizationId, conversationId: conversation._id, messageId: message._id, userId, state: "read", sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
}

export async function loadEffectivePinnedConversations(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  legacy: Id<"conversations">[],
): Promise<Id<"conversations">[]> {
  const rows = await ctx.db.query("userPinnedConversations").withIndex("by_user_organization", (q) => q.eq("userId", userId).eq("organizationId", organizationId)).collect();
  return rows.length > 0 ? rows.sort((a, b) => a.position - b.position).map((row) => row.conversationId) : legacy;
}

export async function replacePinnedConversations(
  ctx: MutationCtx,
  preferences: Doc<"userChatPreferences">,
  conversations: Id<"conversations">[],
  now: number,
): Promise<void> {
  const existing = await ctx.db.query("userPinnedConversations").withIndex("by_user_organization", (q) => q.eq("userId", preferences.userId).eq("organizationId", preferences.organizationId)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const [position, conversationId] of conversations.entries()) await ctx.db.insert("userPinnedConversations", { organizationId: preferences.organizationId, userId: preferences.userId, conversationId, sourcePreferencesId: preferences._id, position, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
}
