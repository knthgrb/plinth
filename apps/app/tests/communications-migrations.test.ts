import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const startMigration = makeFunctionReference<
  "mutation",
  {
    dryRun: boolean;
    dryRunId?: Id<"migrationRuns">;
    batchSize?: number;
  },
  { runId: Id<"migrationRuns">; dryRun: boolean; key: string; version: number }
>("communicationsMigrations:startCommunicationsMigration");

const getRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: {
      status: "queued" | "running" | "completed" | "failed";
      counters: {
        scanned: number;
        changed: number;
        unchanged: number;
        skipped: number;
        conflicts: number;
        errors: number;
      };
    };
    issues: Array<{ code: string; field: string }>;
    canStartWrite: boolean;
  }
>("communicationsMigrations:getCommunicationsMigrationRun");

const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits">; runId: Id<"migrationRuns"> }
>("communicationsMigrations:startCommunicationsAudit");

const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    _id: Id<"migrationAudits">;
    status: string;
    ready: boolean;
    sourceConflicts: number;
    destination: {
      expected: number;
      matching: number;
      missing: number;
      duplicate: number;
      mismatched: number;
      unexpected: number;
      totalRows: number;
    };
  }
>("communicationsMigrations:getCommunicationsAudit");

const listAuditIssues = makeFunctionReference<
  "query",
  {
    auditId: Id<"migrationAudits">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{ code: string; field: string; entityId?: string }>;
    isDone: boolean;
    continueCursor: string;
  }
>("communicationsMigrations:listCommunicationsAuditIssues");

type MigrationTestCtx = Omit<MutationCtx, "storage"> & {
  storage: { store(blob: Blob): Promise<Id<"_storage">> };
};

const insertSources = async (ctx: MigrationTestCtx) => {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Communications Migration Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const authorId = await ctx.db.insert("users", {
    email: "author@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const readerId = await ctx.db.insert("users", {
    email: "reader@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  for (const [userId, role] of [
    [authorId, "hr"],
    [readerId, "employee"],
  ] as const) {
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      role,
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
  }
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Reader",
      lastName: "Employee",
      email: "reader@example.com",
    },
    employment: {
      employeeId: "COMM-001",
      position: "Analyst",
      department: "People",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 1, salaryType: "monthly" },
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
    createdAt: 1,
    updatedAt: 1,
  });
  const [memoStorageId, messageStorageId, documentStorageId, leaveStorageId] =
    await Promise.all([
      ctx.storage.store(new Blob(["private memo attachment"])),
      ctx.storage.store(new Blob(["private chat attachment"])),
      ctx.storage.store(new Blob(["private document attachment"])),
      ctx.storage.store(new Blob(["private leave attachment"])),
    ]);
  const memoId = await ctx.db.insert("memos", {
    organizationId,
    title: "Private announcement title",
    content: "Private announcement content",
    type: "announcement",
    priority: "normal",
    author: authorId,
    targetAudience: "specific-employees",
    departments: ["People"],
    specificEmployees: [employeeId],
    publishedDate: 1,
    reactions: [{ userId: readerId, emoji: "👍", createdAt: 2 }],
    attachments: [memoStorageId],
    attachmentContentTypes: ["application/pdf"],
    isPublished: true,
    acknowledgementRequired: true,
    acknowledgedBy: [{ employeeId, date: 3 }],
    createdAt: 1,
    updatedAt: 3,
  });
  const conversationId = await ctx.db.insert("conversations", {
    organizationId,
    participants: [authorId, readerId],
    type: "direct",
    createdBy: authorId,
    createdAt: 1,
    updatedAt: 1,
  });
  const messageId = await ctx.db.insert("messages", {
    conversationId,
    senderId: authorId,
    content: "Private encrypted chat content",
    messageType: "file",
    attachments: [messageStorageId],
    readBy: [authorId, readerId],
    createdAt: 2,
  });
  const preferencesId = await ctx.db.insert("userChatPreferences", {
    userId: readerId,
    organizationId,
    pinnedConversations: [conversationId],
    createdAt: 1,
    updatedAt: 1,
  });
  const documentId = await ctx.db.insert("documents", {
    organizationId,
    employeeId,
    createdBy: authorId,
    title: "Private document title",
    content: "Private document content",
    type: "employment",
    attachments: [documentStorageId],
    isShared: true,
    sharedWith: [readerId],
    visibilityScope: "specific_employee",
    visibleDepartments: ["People"],
    visibleEmployeeIds: [employeeId],
    createdAt: 1,
    updatedAt: 1,
  });
  const leaveRequestId = await ctx.db.insert("leaveRequests", {
    organizationId,
    employeeId,
    leaveType: "vacation",
    startDate: 10,
    endDate: 10,
    numberOfDays: 1,
    reason: "Private leave reason",
    status: "pending",
    supportingDocuments: [leaveStorageId],
    filedDate: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    organizationId,
    authorId,
    readerId,
    employeeId,
    memoId,
    conversationId,
    messageId,
    preferencesId,
    documentId,
    leaveRequestId,
    memoStorageId,
  };
};

afterEach(() => vi.useRealTimers());

describe("communications migration", () => {
  it("dry-runs, writes all canonical children, and becomes idempotent", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertSources);

    const dryRun = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: dryRun.runId })).resolves.toMatchObject(
      {
        canStartWrite: true,
        run: {
          status: "completed",
          counters: { scanned: 6, changed: 16, conflicts: 0, errors: 0 },
        },
      },
    );
    await expect(
      t.run((ctx) => ctx.db.query("memoReactions").collect()),
    ).resolves.toEqual([]);

    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: write.runId })).resolves.toMatchObject({
      run: {
        status: "completed",
        counters: { changed: 16, conflicts: 0, errors: 0 },
      },
    });
    const counts = await t.run(async (ctx) => ({
      memoReactions: (await ctx.db.query("memoReactions").collect()).length,
      memoAcknowledgements: (
        await ctx.db.query("memoAcknowledgements").collect()
      ).length,
      memoAudienceMembers: (
        await ctx.db.query("memoAudienceMembers").collect()
      ).length,
      conversationMembers: (
        await ctx.db.query("conversationMembers").collect()
      ).length,
      messageReceipts: (await ctx.db.query("messageReceipts").collect()).length,
      pins: (await ctx.db.query("userPinnedConversations").collect()).length,
      grants: (await ctx.db.query("documentAccessGrants").collect()).length,
      links: (await ctx.db.query("storageObjectLinks").collect()).length,
    }));
    expect(counts).toEqual({
      memoReactions: 1,
      memoAcknowledgements: 1,
      memoAudienceMembers: 2,
      conversationMembers: 2,
      messageReceipts: 2,
      pins: 1,
      grants: 3,
      links: 4,
    });

    const verification = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: verification.runId }),
    ).resolves.toMatchObject({
      canStartWrite: true,
      run: { counters: { changed: 0, unchanged: 16, conflicts: 0 } },
    });
  });

  it("blocks duplicate source keys and redacts private source values", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      await ctx.db.patch(sources.conversationId, {
        participants: [sources.readerId, sources.readerId],
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_CONVERSATION_MEMBER",
          field: "participants",
        }),
      ]),
    );
    expect(JSON.stringify(status)).not.toContain("Private");
  });

  it("blocks a document whose creator belongs to another tenant", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(sources.documentId, { createdBy: otherUserId });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "USER_TENANT_MISMATCH",
          field: "createdBy",
        }),
      ]),
    );
  });

  it("blocks a memo whose author belongs to another tenant", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Memo Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other-memo@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(sources.memoId, { author: otherUserId });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "USER_TENANT_MISMATCH",
          field: "author",
        }),
      ]),
    );
  });

  it("blocks every source parent whose organization no longer exists", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run((ctx) => ctx.db.delete(sources.organizationId));

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(
      status.issues.filter(({ code }) => code === "ORGANIZATION_NOT_FOUND"),
    ).toHaveLength(6);
    expect(
      status.issues
        .filter(({ code }) => code === "ORGANIZATION_NOT_FOUND")
        .every(({ field }) => field === "organizationId"),
    ).toBe(true);
  });

  it("accepts the canonical announcement purpose for a memo attachment", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      await ctx.db.insert("storageObjects", {
        storageId: sources.memoStorageId,
        organizationId: sources.organizationId,
        ownerUserId: sources.authorId,
        purpose: "announcement_attachment",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getRun, { runId: dryRun.runId })).resolves.toMatchObject(
      {
        canStartWrite: true,
        run: { counters: { conflicts: 0, errors: 0 } },
      },
    );
  });

  it("blocks a conversation whose creator belongs to another tenant", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Chat Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other-chat@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(sources.conversationId, { createdBy: otherUserId });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "USER_TENANT_MISMATCH",
          field: "createdBy",
        }),
      ]),
    );
  });

  it("blocks storage metadata owned by a user from another tenant", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Storage Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other-storage@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("storageObjects", {
        storageId: sources.memoStorageId,
        organizationId: sources.organizationId,
        ownerUserId: otherUserId,
        purpose: "announcement_attachment",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "STORAGE_OBJECT_OWNER_TENANT_MISMATCH",
          field: "ownerUserId",
        }),
      ]),
    );
  });

  it("blocks a legacy attachment that points to inactive storage metadata", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      await ctx.db.insert("storageObjects", {
        storageId: sources.memoStorageId,
        organizationId: sources.organizationId,
        ownerUserId: sources.authorId,
        purpose: "announcement_attachment",
        state: "deleted",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "STORAGE_OBJECT_STATE_MISMATCH",
          field: "state",
        }),
      ]),
    );
  });

  it("identifies a storage purpose mismatch without exposing file data", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    await t.run(async (ctx) => {
      await ctx.db.insert("storageObjects", {
        storageId: sources.memoStorageId,
        organizationId: sources.organizationId,
        ownerUserId: sources.authorId,
        purpose: "document_attachment",
        fileName: "private-file-name.pdf",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "STORAGE_OBJECT_PURPOSE_MISMATCH",
          field: "purpose",
        }),
      ]),
    );
    expect(JSON.stringify(status)).not.toContain("private-file-name.pdf");
  });

  it("persists a clean audit over every communications target table", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(startAudit, { runId: write.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const audit = await t.query(getAudit, { runId: write.runId });
    expect(audit).toMatchObject({
      status: "completed",
      ready: true,
      sourceConflicts: 0,
      destination: {
        expected: 16,
        matching: 16,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 16,
      },
    });
    await expect(
      t.query(listAuditIssues, {
        auditId: audit._id,
        paginationOpts: { numItems: 100, cursor: null },
      }),
    ).resolves.toMatchObject({ page: [], isDone: true });
  });

  it("blocks audit readiness on an unexpected destination row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const sources = await t.run(insertSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.run(async (ctx) => {
      await ctx.db.insert("memoReactions", {
        organizationId: sources.organizationId,
        memoId: sources.memoId,
        userId: sources.readerId,
        emoji: "💥",
        reactedAt: 99,
        sourceIndex: 99,
        migrationVersion: 1,
        createdAt: 99,
        updatedAt: 99,
      });
    });

    await t.mutation(startAudit, { runId: write.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const audit = await t.query(getAudit, { runId: write.runId });

    expect(audit).toMatchObject({
      status: "completed",
      ready: false,
      sourceConflicts: 1,
      destination: { unexpected: 1, totalRows: 17 },
    });
    const issues = await t.query(listAuditIssues, {
      auditId: audit._id,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(issues.page).toEqual([
      expect.objectContaining({
        code: "UNEXPECTED_DESTINATION_ROW",
        field: "sourceIndex",
      }),
    ]);
    expect(JSON.stringify(issues)).not.toContain("Private");
  });
});
