import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type SeededOrganization = {
  organizationId: Id<"organizations">;
  ownerId: Id<"users">;
  accountingId: Id<"users">;
  hrId: Id<"users">;
};

async function seedOrganization(ctx: MutationCtx): Promise<SeededOrganization> {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Government Remittance Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const ownerId = await ctx.db.insert("users", {
    email: "remittance-owner@example.com",
    name: "Remittance Owner",
    createdAt: 1,
    updatedAt: 1,
  });
  const accountingId = await ctx.db.insert("users", {
    email: "remittance-accounting@example.com",
    name: "Remittance Accountant",
    createdAt: 1,
    updatedAt: 1,
  });
  const hrId = await ctx.db.insert("users", {
    email: "remittance-hr@example.com",
    name: "Remittance HR",
    createdAt: 1,
    updatedAt: 1,
  });
  await Promise.all([
    ctx.db.insert("userOrganizations", {
      organizationId,
      userId: ownerId,
      role: "owner",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    }),
    ctx.db.insert("userOrganizations", {
      organizationId,
      userId: accountingId,
      role: "accounting",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    }),
    ctx.db.insert("userOrganizations", {
      organizationId,
      userId: hrId,
      role: "hr",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    }),
  ]);
  return { organizationId, ownerId, accountingId, hrId };
}

async function seedPayrollLiability(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organizations">;
    actorId: Id<"users">;
    cutoffStart: number;
    cutoffEnd: number;
    period: string;
    accountCode: string;
    accountName: string;
    amount: number;
  },
): Promise<Id<"payrollRuns">> {
  const payrollRunId = await ctx.db.insert("payrollRuns", {
    organizationId: input.organizationId,
    cutoffStart: input.cutoffStart,
    cutoffEnd: input.cutoffEnd,
    period: input.period,
    runType: "regular",
    status: "finalized",
    processedBy: input.actorId,
    createdAt: input.cutoffEnd,
    updatedAt: input.cutoffEnd,
  });
  const journalEntryId = await ctx.db.insert("accountingJournalEntries", {
    organizationId: input.organizationId,
    sourceType: "payroll_run",
    sourceId: String(payrollRunId),
    sourceKey: `${payrollRunId}:accrual:v1`,
    sourceVersion: 1,
    entryType: "payroll_accrual",
    status: "posted",
    description: `${input.period} payroll accrual`,
    effectiveAt: input.cutoffEnd,
    postedBy: input.actorId,
    createdAt: input.cutoffEnd,
  });
  await Promise.all([
    ctx.db.insert("accountingJournalLines", {
      organizationId: input.organizationId,
      journalEntryId,
      accountCode: "6000",
      accountName: "Compensation Expense",
      debit: input.amount,
      credit: 0,
      createdAt: input.cutoffEnd,
    }),
    ctx.db.insert("accountingJournalLines", {
      organizationId: input.organizationId,
      journalEntryId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      debit: 0,
      credit: input.amount,
      createdAt: input.cutoffEnd,
    }),
  ]);
  return payrollRunId;
}

describe("government remittances", () => {
  it("reconciles payroll journals and prevents double approval", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrganization);
    const payrollRunId = await t.run((ctx) =>
      seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 10,
        cutoffEnd: 20,
        period: "August first half",
        accountCode: "2110",
        accountName: "SSS Payable",
        amount: 1_510,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("accountingCostItems", {
        organizationId: fixture.organizationId,
        payrollRunId,
        sourceType: "payroll_run",
        sourceKey: `${payrollRunId}:sss`,
        categoryName: "Employee Related Cost",
        name: "SSS - August first half",
        amount: 1_510,
        amountPaid: 0,
        frequency: "one-time",
        status: "pending",
        createdAt: 20,
        updatedAt: 20,
      }),
    );
    const owner = t.withIdentity({ email: "remittance-owner@example.com" });

    const initial = await owner.query(
      api.governmentRemittances.getGovernmentLiabilityCandidates,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
      },
    );
    expect(initial.candidates).toEqual([
      expect.objectContaining({
        payrollRunId,
        accruedAmount: 1_510,
        reservedAmount: 0,
        paidAmount: 0,
        outstandingAmount: 1_510,
      }),
    ]);

    const firstId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
        dueDate: 40,
        allocations: [{ payrollRunId, amount: 1_000 }],
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId: firstId },
    );
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId: firstId },
    );

    const secondId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
        dueDate: 40,
        allocations: [{ payrollRunId, amount: 700 }],
      },
    );
    await owner.mutation(
      api.governmentRemittances.updateGovernmentRemittanceDraft,
      {
        remittanceId: secondId,
        periodStart: 1,
        periodEnd: 30,
        dueDate: 40,
        allocations: [{ payrollRunId, amount: 600 }],
        penaltyAmount: 0,
        interestAmount: 0,
        advancePaymentAmount: 0,
        advanceApplications: [],
        notes: "Reduced after review",
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId: secondId },
    );
    await expect(
      owner.mutation(api.governmentRemittances.approveGovernmentRemittance, {
        remittanceId: secondId,
      }),
    ).rejects.toThrow("exceeds the available SSS liability");

    const reserved = await owner.query(
      api.governmentRemittances.getGovernmentLiabilityCandidates,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
      },
    );
    expect(reserved.candidates[0]).toMatchObject({
      reservedAmount: 1_000,
      paidAmount: 0,
      outstandingAmount: 510,
    });

    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId: firstId,
        filedAt: 41,
        referenceNumber: "SSS-FILING-1",
      },
    );
    const journalsBeforePayment = await t.run((ctx) =>
      ctx.db
        .query("accountingJournalEntries")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("sourceType", "government_remittance")
            .eq("sourceId", String(firstId)),
        )
        .collect(),
    );
    expect(journalsBeforePayment).toHaveLength(0);

    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittancePayment,
      {
        remittanceId: firstId,
        paidAt: 42,
        referenceNumber: "SSS-PAYMENT-1",
        bankAccountLabel: "Operating Account 1234",
      },
    );
    const afterPayment = await owner.query(
      api.governmentRemittances.getGovernmentLiabilityCandidates,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
      },
    );
    expect(afterPayment.candidates[0]).toMatchObject({
      reservedAmount: 0,
      paidAmount: 1_000,
      outstandingAmount: 510,
      overRemittedAmount: 0,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("accountingCostItems")
          .withIndex("by_source", (query) =>
            query
              .eq("organizationId", fixture.organizationId)
              .eq("sourceType", "payroll_run")
              .eq("sourceKey", `${payrollRunId}:sss`),
          )
          .unique(),
      ),
    ).toMatchObject({ amountPaid: 1_000, status: "partial" });

    await t.run(async (ctx) => {
      const adjustmentId = await ctx.db.insert("accountingJournalEntries", {
        organizationId: fixture.organizationId,
        sourceType: "payroll_run",
        sourceId: String(payrollRunId),
        sourceKey: `${payrollRunId}:adjustment:post-remittance`,
        sourceVersion: 1,
        entryType: "payroll_adjustment",
        status: "posted",
        description: "Post-remittance statutory correction",
        effectiveAt: 43,
        postedBy: fixture.ownerId,
        createdAt: 43,
      });
      await Promise.all([
        ctx.db.insert("accountingJournalLines", {
          organizationId: fixture.organizationId,
          journalEntryId: adjustmentId,
          accountCode: "2110",
          accountName: "SSS Payable",
          debit: 600,
          credit: 0,
          createdAt: 43,
        }),
        ctx.db.insert("accountingJournalLines", {
          organizationId: fixture.organizationId,
          journalEntryId: adjustmentId,
          accountCode: "6000",
          accountName: "Compensation Expense",
          debit: 0,
          credit: 600,
          createdAt: 43,
        }),
      ]);
    });
    const corrected = await owner.query(
      api.governmentRemittances.getGovernmentLiabilityCandidates,
      {
        organizationId: fixture.organizationId,
        agency: "sss",
        periodStart: 1,
        periodEnd: 30,
      },
    );
    expect(corrected.candidates[0]).toMatchObject({
      accruedAmount: 910,
      paidAmount: 1_000,
      outstandingAmount: 0,
      overRemittedAmount: 90,
    });
    expect(corrected.totals.overRemittedAmount).toBe(90);
    await owner.mutation(
      api.governmentRemittances.reverseGovernmentRemittance,
      {
        remittanceId: firstId,
        reason: "Replacing corrected SSS remittance",
      },
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("accountingCostItems")
          .withIndex("by_source", (query) =>
            query
              .eq("organizationId", fixture.organizationId)
              .eq("sourceType", "payroll_run")
              .eq("sourceKey", `${payrollRunId}:sss`),
          )
          .unique(),
      ),
    ).toMatchObject({ amountPaid: 0, status: "pending" });
  });

  it("enforces accounting preparation, owner approval, encrypted references, and audit events", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrganization);
    const payrollRunId = await t.run((ctx) =>
      seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 100,
        cutoffEnd: 110,
        period: "August second half",
        accountCode: "2140",
        accountName: "Withholding Tax Payable",
        amount: 8_000,
      }),
    );
    const owner = t.withIdentity({ email: "remittance-owner@example.com" });
    const accounting = t.withIdentity({
      email: "remittance-accounting@example.com",
    });
    const hr = t.withIdentity({ email: "remittance-hr@example.com" });

    const remittanceId = await accounting.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "bir",
        periodStart: 90,
        periodEnd: 120,
        dueDate: 130,
        allocations: [{ payrollRunId, amount: 8_000 }],
        penaltyAmount: 300,
        interestAmount: 100,
        notes: "Prepared from monthly withholding return",
      },
    );
    await accounting.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId },
    );
    await expect(
      accounting.mutation(
        api.governmentRemittances.approveGovernmentRemittance,
        { remittanceId },
      ),
    ).rejects.toThrow("owner or admin");
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId },
    );
    await accounting.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId,
        filedAt: 131,
        referenceNumber: "BIR-FILE-SECRET",
      },
    );
    await accounting.mutation(
      api.governmentRemittances.recordGovernmentRemittancePayment,
      {
        remittanceId,
        paidAt: 132,
        referenceNumber: "BIR-PAY-SECRET",
        bankAccountLabel: "Tax Account 9876",
      },
    );

    const detail = await accounting.query(
      api.governmentRemittances.getGovernmentRemittance,
      { remittanceId },
    );
    expect(detail).toMatchObject({
      status: "paid",
      notes: "Prepared from monthly withholding return",
      filingDetails: { referenceNumber: "BIR-FILE-SECRET" },
      paymentDetails: {
        referenceNumber: "BIR-PAY-SECRET",
        bankAccountLabel: "Tax Account 9876",
      },
    });
    const raw = await t.run((ctx) => ctx.db.get(remittanceId));
    expect(raw?.notes).not.toContain(
      "Prepared from monthly withholding return",
    );
    expect(raw?.filingDetails).not.toContain("BIR-FILE-SECRET");
    expect(raw?.paymentDetails).not.toContain("BIR-PAY-SECRET");

    await expect(
      hr.query(api.governmentRemittances.listGovernmentRemittances, {
        organizationId: fixture.organizationId,
      }),
    ).rejects.toThrow("Not authorized");
    const eventTypes = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("operationalEvents")
        .withIndex("by_aggregate_sequence", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("aggregateType", "government_remittance")
            .eq("aggregateId", String(remittanceId)),
        )
        .collect();
      return rows.map((row) => row.eventType);
    });
    expect(eventTypes).toEqual([
      "government_remittance.created",
      "government_remittance.reviewed",
      "government_remittance.approved",
      "government_remittance.filed",
      "government_remittance.paid",
    ]);
  });

  it("reserves advances once and requires dependent reversals first", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrganization);
    const [firstRunId, secondRunId, thirdRunId] = await t.run(async (ctx) => {
      const first = await seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 200,
        cutoffEnd: 210,
        period: "September first half",
        accountCode: "2120",
        accountName: "PhilHealth Payable",
        amount: 1_000,
      });
      const second = await seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 220,
        cutoffEnd: 230,
        period: "September second half",
        accountCode: "2120",
        accountName: "PhilHealth Payable",
        amount: 1_000,
      });
      const third = await seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 225,
        cutoffEnd: 232,
        period: "September adjustment",
        accountCode: "2120",
        accountName: "PhilHealth Payable",
        amount: 200,
      });
      return [first, second, third];
    });
    const owner = t.withIdentity({ email: "remittance-owner@example.com" });

    const sourceId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "philhealth",
        periodStart: 200,
        periodEnd: 215,
        dueDate: 240,
        allocations: [{ payrollRunId: firstRunId, amount: 1_000 }],
        advancePaymentAmount: 500,
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId: sourceId },
    );
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId: sourceId },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId: sourceId,
        filedAt: 241,
        referenceNumber: "PH-FILE-1",
      },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittancePayment,
      {
        remittanceId: sourceId,
        paidAt: 242,
        referenceNumber: "PH-PAY-1",
      },
    );

    const applyingId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "philhealth",
        periodStart: 220,
        periodEnd: 235,
        dueDate: 250,
        allocations: [{ payrollRunId: secondRunId, amount: 1_000 }],
        advanceApplications: [{ sourceRemittanceId: sourceId, amount: 400 }],
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId: applyingId },
    );
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId: applyingId },
    );

    const conflictingId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "philhealth",
        periodStart: 220,
        periodEnd: 235,
        dueDate: 250,
        allocations: [{ payrollRunId: thirdRunId, amount: 200 }],
        advanceApplications: [{ sourceRemittanceId: sourceId, amount: 200 }],
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId: conflictingId },
    );
    await expect(
      owner.mutation(api.governmentRemittances.approveGovernmentRemittance, {
        remittanceId: conflictingId,
      }),
    ).rejects.toThrow("exceeds the available PhilHealth advance");

    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId: applyingId,
        filedAt: 251,
        referenceNumber: "PH-FILE-2",
      },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittancePayment,
      {
        remittanceId: applyingId,
        paidAt: 252,
        referenceNumber: "PH-PAY-2",
      },
    );
    const applying = await owner.query(
      api.governmentRemittances.getGovernmentRemittance,
      { remittanceId: applyingId },
    );
    expect(applying).toMatchObject({
      liabilityAmount: 1_000,
      advanceAppliedAmount: 400,
      cashAmount: 600,
    });

    await expect(
      owner.mutation(api.governmentRemittances.reverseGovernmentRemittance, {
        remittanceId: sourceId,
        reason: "Wrong source remittance",
      }),
    ).rejects.toThrow("Reverse dependent remittances first");
    await owner.mutation(
      api.governmentRemittances.reverseGovernmentRemittance,
      {
        remittanceId: applyingId,
        reason: "Correcting advance application",
      },
    );
    await expect(
      owner.mutation(api.governmentRemittances.reverseGovernmentRemittance, {
        remittanceId: sourceId,
        reason: "Wrong source remittance",
      }),
    ).resolves.toBeDefined();
  });

  it("records and retries filing and payment failures without posting a journal", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrganization);
    const payrollRunId = await t.run((ctx) =>
      seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 300,
        cutoffEnd: 310,
        period: "October first half",
        accountCode: "2130",
        accountName: "Pag-IBIG Payable",
        amount: 2_000,
      }),
    );
    const owner = t.withIdentity({ email: "remittance-owner@example.com" });
    const remittanceId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "pagibig",
        periodStart: 300,
        periodEnd: 320,
        dueDate: 330,
        allocations: [{ payrollRunId, amount: 2_000 }],
      },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId },
    );
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFailure,
      {
        remittanceId,
        stage: "filing",
        reason: "Agency portal unavailable",
      },
    );
    expect(
      await owner.mutation(
        api.governmentRemittances.retryGovernmentRemittance,
        { remittanceId },
      ),
    ).toBe("approved");
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId,
        filedAt: 331,
        referenceNumber: "PAG-FILE-1",
      },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFailure,
      {
        remittanceId,
        stage: "payment",
        reason: "Bank transfer returned",
      },
    );
    expect(
      await owner.mutation(
        api.governmentRemittances.retryGovernmentRemittance,
        { remittanceId },
      ),
    ).toBe("filed");
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFailure,
      {
        remittanceId,
        stage: "payment",
        reason: "Second bank transfer returned",
      },
    );
    await owner.mutation(api.governmentRemittances.cancelGovernmentRemittance, {
      remittanceId,
      reason: "Will replace with a different payment channel",
    });
    expect(
      await owner.query(api.governmentRemittances.getGovernmentRemittance, {
        remittanceId,
      }),
    ).toMatchObject({
      status: "cancelled",
      cancellationReason: "Will replace with a different payment channel",
    });
    const entries = await t.run((ctx) =>
      ctx.db
        .query("accountingJournalEntries")
        .withIndex("by_source", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("sourceType", "government_remittance")
            .eq("sourceId", String(remittanceId)),
        )
        .collect(),
    );
    expect(entries).toHaveLength(0);
  });

  it("attaches only registered organization-owned remittance evidence", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrganization);
    const payrollRunId = await t.run((ctx) =>
      seedPayrollLiability(ctx, {
        organizationId: fixture.organizationId,
        actorId: fixture.ownerId,
        cutoffStart: 400,
        cutoffEnd: 410,
        period: "November first half",
        accountCode: "2140",
        accountName: "Withholding Tax Payable",
        amount: 5_000,
      }),
    );
    const owner = t.withIdentity({ email: "remittance-owner@example.com" });
    const remittanceId = await owner.mutation(
      api.governmentRemittances.createGovernmentRemittance,
      {
        organizationId: fixture.organizationId,
        agency: "bir",
        periodStart: 400,
        periodEnd: 420,
        dueDate: 430,
        allocations: [{ payrollRunId, amount: 5_000 }],
      },
    );
    const storage = await t.run(async (ctx) => {
      const foreignOrganizationId = await ctx.db.insert("organizations", {
        name: "Foreign Evidence Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const valid = await ctx.storage.store(
        new Blob(["valid evidence"], { type: "application/pdf" }),
      );
      const wrongPurpose = await ctx.storage.store(
        new Blob(["wrong purpose"], { type: "application/pdf" }),
      );
      const filingEvidence = await ctx.storage.store(
        new Blob(["filing evidence"], { type: "application/pdf" }),
      );
      const notOwned = await ctx.storage.store(
        new Blob(["not owned"], { type: "application/pdf" }),
      );
      const foreign = await ctx.storage.store(
        new Blob(["foreign"], { type: "application/pdf" }),
      );
      await Promise.all([
        ctx.db.insert("storageObjects", {
          storageId: valid,
          organizationId: fixture.organizationId,
          ownerUserId: fixture.ownerId,
          purpose: "government_remittance_evidence",
          fileName: "bir-return.pdf",
          contentType: "application/pdf",
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("storageObjects", {
          storageId: wrongPurpose,
          organizationId: fixture.organizationId,
          ownerUserId: fixture.ownerId,
          purpose: "accounting_receipt",
          fileName: "wrong.pdf",
          contentType: "application/pdf",
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("storageObjects", {
          storageId: filingEvidence,
          organizationId: fixture.organizationId,
          ownerUserId: fixture.ownerId,
          purpose: "government_remittance_evidence",
          fileName: "bir-filing-confirmation.pdf",
          contentType: "application/pdf",
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("storageObjects", {
          storageId: notOwned,
          organizationId: fixture.organizationId,
          ownerUserId: fixture.accountingId,
          purpose: "government_remittance_evidence",
          fileName: "not-owned.pdf",
          contentType: "application/pdf",
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("storageObjects", {
          storageId: foreign,
          organizationId: foreignOrganizationId,
          ownerUserId: fixture.ownerId,
          purpose: "government_remittance_evidence",
          fileName: "foreign.pdf",
          contentType: "application/pdf",
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        }),
      ]);
      return { valid, filingEvidence, wrongPurpose, notOwned, foreign };
    });

    for (const storageId of [
      storage.wrongPurpose,
      storage.notOwned,
      storage.foreign,
    ]) {
      await expect(
        owner.mutation(
          api.governmentRemittances.attachGovernmentRemittanceEvidence,
          { remittanceId, storageIds: [storageId] },
        ),
      ).rejects.toThrow("Not authorized");
    }
    await owner.mutation(
      api.governmentRemittances.attachGovernmentRemittanceEvidence,
      { remittanceId, storageIds: [storage.valid] },
    );
    await owner.mutation(
      api.governmentRemittances.submitGovernmentRemittanceForReview,
      { remittanceId },
    );
    await owner.mutation(
      api.governmentRemittances.approveGovernmentRemittance,
      { remittanceId },
    );
    await owner.mutation(
      api.governmentRemittances.recordGovernmentRemittanceFiling,
      {
        remittanceId,
        filedAt: 431,
        referenceNumber: "BIR-FILE-WITH-EVIDENCE",
        evidenceStorageIds: [storage.filingEvidence],
      },
    );
    const hr = t.withIdentity({ email: "remittance-hr@example.com" });
    await expect(
      hr.query(api.files.getFileUrl, {
        organizationId: fixture.organizationId,
        storageId: storage.valid,
      }),
    ).rejects.toThrow("Not authorized");
    const detail = await owner.query(
      api.governmentRemittances.getGovernmentRemittance,
      { remittanceId },
    );
    expect(detail.evidence).toEqual([
      expect.objectContaining({
        storageId: storage.valid,
        fileName: "bir-return.pdf",
        contentType: "application/pdf",
      }),
      expect.objectContaining({
        storageId: storage.filingEvidence,
        fileName: "bir-filing-confirmation.pdf",
        contentType: "application/pdf",
      }),
    ]);
  });
});
