import {
  buildGovernmentRemittancePaymentJournal,
  type GovernmentRemittancePaymentJournal,
} from "@/lib/government-remittance";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { encryptGovernmentRemittanceReason } from "./governmentRemittanceCrypto";

type JournalEntryType = Doc<"accountingJournalEntries">["entryType"];

const COST_ITEM_SUFFIX = {
  bir: "tax",
  sss: "sss",
  philhealth: "philhealth",
  pagibig: "pagibig",
} as const;

function accountingCostStatus(
  amount: number,
  amountPaid: number,
): Doc<"accountingCostItems">["status"] {
  if (amountPaid <= 0) return "pending";
  if (amountPaid >= amount) return "paid";
  return "partial";
}

async function insertGovernmentRemittanceJournal(
  ctx: MutationCtx,
  input: {
    remittance: Doc<"governmentRemittances">;
    actorId: Id<"users">;
    sourceKey: string;
    entryType: JournalEntryType;
    description: string;
    effectiveAt: number;
    journal: GovernmentRemittancePaymentJournal;
    reversalOf?: Id<"accountingJournalEntries">;
    reason?: string;
  },
): Promise<Id<"accountingJournalEntries">> {
  const existing = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source_key", (query) =>
      query
        .eq("organizationId", input.remittance.organizationId)
        .eq("sourceType", "government_remittance")
        .eq("sourceKey", input.sourceKey),
    )
    .unique();
  if (existing) return existing._id;
  if (input.journal.lines.length === 0) {
    throw new Error("Cannot post an empty government remittance journal.");
  }

  const createdAt = Date.now();
  const journalEntryId = await ctx.db.insert("accountingJournalEntries", {
    organizationId: input.remittance.organizationId,
    sourceType: "government_remittance",
    sourceId: String(input.remittance._id),
    sourceKey: input.sourceKey,
    sourceVersion: 1,
    entryType: input.entryType,
    status: "posted",
    description: input.description,
    effectiveAt: input.effectiveAt,
    postedBy: input.actorId,
    reversalOf: input.reversalOf,
    reason: input.reason
      ? encryptGovernmentRemittanceReason(input.reason)
      : undefined,
    createdAt,
  });
  for (const line of input.journal.lines) {
    await ctx.db.insert("accountingJournalLines", {
      organizationId: input.remittance.organizationId,
      journalEntryId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: line.debit,
      credit: line.credit,
      createdAt,
    });
  }
  return journalEntryId;
}

export async function postGovernmentRemittancePaymentJournal(
  ctx: MutationCtx,
  remittanceId: Id<"governmentRemittances">,
  actorId: Id<"users">,
  effectiveAt: number,
): Promise<Id<"accountingJournalEntries">> {
  const remittance = await ctx.db.get(remittanceId);
  if (!remittance) throw new Error("Government remittance not found.");
  const journal = buildGovernmentRemittancePaymentJournal({
    agency: remittance.agency,
    liabilityAmount: remittance.liabilityAmount,
    penaltyAmount: remittance.penaltyAmount,
    interestAmount: remittance.interestAmount,
    advancePaymentAmount: remittance.advancePaymentAmount,
    advanceAppliedAmount: remittance.advanceAppliedAmount,
  });
  return insertGovernmentRemittanceJournal(ctx, {
    remittance,
    actorId,
    sourceKey: `${remittanceId}:payment:v1`,
    entryType: "government_remittance_payment",
    description: `${remittance.remittanceNumber} government remittance payment`,
    effectiveAt,
    journal,
  });
}

export async function syncGovernmentRemittanceAccountingProjections(
  ctx: MutationCtx,
  remittanceId: Id<"governmentRemittances">,
  operation: "payment" | "reversal",
): Promise<number> {
  const remittance = await ctx.db.get(remittanceId);
  if (!remittance) throw new Error("Government remittance not found.");
  const allocations = await ctx.db
    .query("governmentRemittanceAllocations")
    .withIndex("by_remittance", (query) =>
      query.eq("remittanceId", remittanceId),
    )
    .take(101);
  if (allocations.length > 100) {
    throw new Error(
      "Government remittance has too many accounting allocations.",
    );
  }
  const suffix = COST_ITEM_SUFFIX[remittance.agency];
  const now = Date.now();
  let updated = 0;
  for (const allocation of allocations) {
    const item = await ctx.db
      .query("accountingCostItems")
      .withIndex("by_source", (query) =>
        query
          .eq("organizationId", remittance.organizationId)
          .eq("sourceType", "payroll_run")
          .eq("sourceKey", `${allocation.payrollRunId}:${suffix}`),
      )
      .unique();
    if (!item || item.payrollRunId !== allocation.payrollRunId) continue;
    const delta =
      operation === "payment" ? allocation.amount : -allocation.amount;
    const amountPaid = Math.max(
      0,
      Math.round((item.amountPaid + delta) * 100) / 100,
    );
    await ctx.db.patch(item._id, {
      amountPaid,
      status: accountingCostStatus(item.amount, amountPaid),
      sourceUpdatedAt: now,
      updatedAt: now,
    });
    updated += 1;
  }
  return updated;
}

function reverseJournal(
  journal: GovernmentRemittancePaymentJournal,
): GovernmentRemittancePaymentJournal {
  return {
    lines: journal.lines.map((line) => ({
      ...line,
      debit: line.credit,
      credit: line.debit,
    })),
    totalDebits: journal.totalCredits,
    totalCredits: journal.totalDebits,
    cashAmount: journal.cashAmount,
  };
}

export async function reverseGovernmentRemittancePaymentJournal(
  ctx: MutationCtx,
  remittanceId: Id<"governmentRemittances">,
  actorId: Id<"users">,
  reason: string,
  effectiveAt: number,
): Promise<Id<"accountingJournalEntries">> {
  const remittance = await ctx.db.get(remittanceId);
  if (!remittance) throw new Error("Government remittance not found.");
  const reversalSourceKey = `${remittanceId}:payment:v1:reversal`;
  const existingReversal = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source_key", (query) =>
      query
        .eq("organizationId", remittance.organizationId)
        .eq("sourceType", "government_remittance")
        .eq("sourceKey", reversalSourceKey),
    )
    .unique();
  if (existingReversal) return existingReversal._id;

  const payment = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source_key", (query) =>
      query
        .eq("organizationId", remittance.organizationId)
        .eq("sourceType", "government_remittance")
        .eq("sourceKey", `${remittanceId}:payment:v1`),
    )
    .unique();
  if (!payment) {
    throw new Error("Government remittance payment journal was not found.");
  }
  const storedLines = await ctx.db
    .query("accountingJournalLines")
    .withIndex("by_entry", (query) => query.eq("journalEntryId", payment._id))
    .collect();
  const journal: GovernmentRemittancePaymentJournal = {
    lines: storedLines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: line.debit,
      credit: line.credit,
    })),
    totalDebits: storedLines.reduce((sum, line) => sum + line.debit, 0),
    totalCredits: storedLines.reduce((sum, line) => sum + line.credit, 0),
    cashAmount: storedLines
      .filter((line) => line.accountCode === "1000")
      .reduce((sum, line) => sum + line.credit - line.debit, 0),
  };
  const reversalId = await insertGovernmentRemittanceJournal(ctx, {
    remittance,
    actorId,
    sourceKey: reversalSourceKey,
    entryType: "government_remittance_reversal",
    description: `Reversal: ${payment.description}`,
    effectiveAt,
    journal: reverseJournal(journal),
    reversalOf: payment._id,
    reason,
  });
  await ctx.db.patch(payment._id, {
    status: "reversed",
    reversedBy: actorId,
    reversedAt: effectiveAt,
  });
  return reversalId;
}
