import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { decryptPayslipRowFromDb } from "./payslipCrypto";
import {
  buildPayrollAccrualJournal,
  buildPayrollJournalAdjustment,
  buildPayrollPaymentJournal,
  reversePayrollJournal,
  type PayrollJournal,
  type PayrollJournalDeduction,
  type PayrollJournalPayslip,
} from "@/lib/payroll-journal";
import { encryptPayrollJournalReason } from "./payrollSensitiveCrypto";

type DecryptedPayslipView = {
  employeeId: Id<"employees">;
  netPay: number;
  deductions?: PayrollJournalDeduction[];
  employerContributions?: {
    sss?: number;
    philhealth?: number;
    pagibig?: number;
  };
};

type JournalEntryType = Doc<"accountingJournalEntries">["entryType"];

function toJournalPayslip(
  payslip: DecryptedPayslipView,
): PayrollJournalPayslip {
  return {
    employeeId: String(payslip.employeeId),
    netPay: Number(payslip.netPay) || 0,
    deductions: Array.isArray(payslip.deductions) ? payslip.deductions : [],
    employerContributions: payslip.employerContributions,
  };
}

async function loadPayrollJournalPayslips(
  ctx: MutationCtx,
  payrollRunId: Id<"payrollRuns">,
): Promise<PayrollJournalPayslip[]> {
  const rows = await ctx.db
    .query("payslips")
    .withIndex("by_payroll_run", (query) =>
      query.eq("payrollRunId", payrollRunId),
    )
    .collect();
  return rows.map((row) => {
    const decrypted = decryptPayslipRowFromDb(row);
    if (!decrypted) throw new Error("Payroll journal payslip is unavailable.");
    return toJournalPayslip(decrypted as unknown as DecryptedPayslipView);
  });
}

async function postJournal(
  ctx: MutationCtx,
  input: {
    run: Doc<"payrollRuns">;
    actorId: Id<"users">;
    sourceKey: string;
    sourceVersion: number;
    entryType: JournalEntryType;
    description: string;
    journal: PayrollJournal;
    effectiveAt?: number;
    reversalOf?: Id<"accountingJournalEntries">;
    reason?: string;
  },
): Promise<Id<"accountingJournalEntries">> {
  const existing = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source_key", (query) =>
      query
        .eq("organizationId", input.run.organizationId)
        .eq("sourceType", "payroll_run")
        .eq("sourceKey", input.sourceKey),
    )
    .unique();
  if (existing) return existing._id;
  if (input.journal.lines.length === 0) {
    throw new Error("Cannot post an empty payroll journal.");
  }
  const now = Date.now();
  const journalEntryId = await ctx.db.insert("accountingJournalEntries", {
    organizationId: input.run.organizationId,
    sourceType: "payroll_run",
    sourceId: String(input.run._id),
    sourceKey: input.sourceKey,
    sourceVersion: input.sourceVersion,
    entryType: input.entryType,
    status: "posted",
    description: input.description,
    effectiveAt: input.effectiveAt ?? input.run.cutoffEnd,
    postedBy: input.actorId,
    reversalOf: input.reversalOf,
    reason: input.reason
      ? encryptPayrollJournalReason(input.reason)
      : undefined,
    createdAt: now,
  });
  for (const line of input.journal.lines) {
    await ctx.db.insert("accountingJournalLines", {
      organizationId: input.run.organizationId,
      journalEntryId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: line.debit,
      credit: line.credit,
      createdAt: now,
    });
  }
  return journalEntryId;
}

export async function postPayrollAccrualJournal(
  ctx: MutationCtx,
  payrollRunId: Id<"payrollRuns">,
  actorId: Id<"users">,
): Promise<Id<"accountingJournalEntries">> {
  const run = await ctx.db.get(payrollRunId);
  if (!run) throw new Error("Payroll run not found.");
  const payslips = await loadPayrollJournalPayslips(ctx, payrollRunId);
  return postJournal(ctx, {
    run,
    actorId,
    sourceKey: `${payrollRunId}:accrual:v1`,
    sourceVersion: 1,
    entryType: "payroll_accrual",
    description: `Payroll accrual - ${run.period}`,
    journal: buildPayrollAccrualJournal(payslips),
  });
}

export async function postPayrollPaymentJournal(
  ctx: MutationCtx,
  payrollRunId: Id<"payrollRuns">,
  actorId: Id<"users">,
): Promise<Id<"accountingJournalEntries">> {
  const run = await ctx.db.get(payrollRunId);
  if (!run) throw new Error("Payroll run not found.");
  const payslips = await loadPayrollJournalPayslips(ctx, payrollRunId);
  const totalNetPay = payslips.reduce(
    (sum, payslip) => sum + payslip.netPay,
    0,
  );
  return postJournal(ctx, {
    run,
    actorId,
    sourceKey: `${payrollRunId}:payment:v1`,
    sourceVersion: 1,
    entryType: "payroll_payment",
    description: `Payroll payment - ${run.period}`,
    journal: buildPayrollPaymentJournal(totalNetPay),
  });
}

export async function postPayrollCorrectionJournal(
  ctx: MutationCtx,
  input: {
    payrollRunId: Id<"payrollRuns">;
    correctionId: Id<"payslipCorrections">;
    actorId: Id<"users">;
    previousPayslip: PayrollJournalPayslip;
    nextPayslip: PayrollJournalPayslip;
    reason: string;
  },
): Promise<Id<"accountingJournalEntries"> | null> {
  const run = await ctx.db.get(input.payrollRunId);
  if (!run) throw new Error("Payroll run not found.");
  const adjustment = buildPayrollJournalAdjustment(
    buildPayrollAccrualJournal([input.previousPayslip]),
    buildPayrollAccrualJournal([input.nextPayslip]),
  );
  if (adjustment.lines.length === 0) return null;
  return postJournal(ctx, {
    run,
    actorId: input.actorId,
    sourceKey: `${input.payrollRunId}:adjustment:${input.correctionId}`,
    sourceVersion: 1,
    entryType: "payroll_adjustment",
    description: `Payroll correction - ${run.period}`,
    journal: adjustment,
    reason: input.reason,
  });
}

export async function reversePayrollJournalsForRun(
  ctx: MutationCtx,
  payrollRunId: Id<"payrollRuns">,
  actorId: Id<"users">,
  reason: string,
): Promise<Id<"accountingJournalEntries">[]> {
  const run = await ctx.db.get(payrollRunId);
  if (!run) throw new Error("Payroll run not found.");
  const entries = await ctx.db
    .query("accountingJournalEntries")
    .withIndex("by_source", (query) =>
      query
        .eq("organizationId", run.organizationId)
        .eq("sourceType", "payroll_run")
        .eq("sourceId", String(payrollRunId)),
    )
    .collect();
  const reversals: Id<"accountingJournalEntries">[] = [];
  for (const entry of entries) {
    if (entry.entryType === "payroll_reversal" || entry.status === "reversed") {
      continue;
    }
    const storedLines = await ctx.db
      .query("accountingJournalLines")
      .withIndex("by_entry", (query) => query.eq("journalEntryId", entry._id))
      .collect();
    const journal: PayrollJournal = {
      lines: storedLines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: line.debit,
        credit: line.credit,
      })),
      totalDebits: storedLines.reduce((sum, line) => sum + line.debit, 0),
      totalCredits: storedLines.reduce((sum, line) => sum + line.credit, 0),
    };
    const reversalId = await postJournal(ctx, {
      run,
      actorId,
      sourceKey: `${entry.sourceKey}:reversal`,
      sourceVersion: entry.sourceVersion,
      entryType: "payroll_reversal",
      description: `Reversal: ${entry.description}`,
      journal: reversePayrollJournal(journal),
      reversalOf: entry._id,
      reason,
    });
    await ctx.db.patch(entry._id, {
      status: "reversed",
      reversedBy: actorId,
      reversedAt: Date.now(),
    });
    reversals.push(reversalId);
  }
  return reversals;
}
