import type { PayrollJournalLine } from "@/lib/payroll-journal";

export type GovernmentAgency = "bir" | "sss" | "philhealth" | "pagibig";

export type GovernmentRemittanceStatus =
  | "draft"
  | "reviewed"
  | "approved"
  | "filed"
  | "paid"
  | "failed"
  | "cancelled"
  | "reversed";

export type GovernmentRemittanceFailureStage = "filing" | "payment";

export type GovernmentRemittanceAccount = {
  code: string;
  name: string;
};

export type GovernmentRemittancePaymentJournal = {
  lines: PayrollJournalLine[];
  totalDebits: number;
  totalCredits: number;
  cashAmount: number;
};

const LIABILITY_ACCOUNTS = {
  bir: { code: "2140", name: "Withholding Tax Payable" },
  sss: { code: "2110", name: "SSS Payable" },
  philhealth: { code: "2120", name: "PhilHealth Payable" },
  pagibig: { code: "2130", name: "Pag-IBIG Payable" },
} as const satisfies Record<GovernmentAgency, GovernmentRemittanceAccount>;

const ADVANCE_ACCOUNTS = {
  bir: { code: "1310", name: "BIR Remittance Advances" },
  sss: { code: "1320", name: "SSS Remittance Advances" },
  philhealth: { code: "1330", name: "PhilHealth Remittance Advances" },
  pagibig: { code: "1340", name: "Pag-IBIG Remittance Advances" },
} as const satisfies Record<GovernmentAgency, GovernmentRemittanceAccount>;

const PENALTY_ACCOUNT = {
  code: "6900",
  name: "Government Penalties Expense",
} as const;

const INTEREST_ACCOUNT = {
  code: "6910",
  name: "Government Interest Expense",
} as const;

const CASH_ACCOUNT = { code: "1000", name: "Cash and Bank" } as const;

const STANDARD_TRANSITIONS: Readonly<
  Record<GovernmentRemittanceStatus, ReadonlySet<GovernmentRemittanceStatus>>
> = {
  draft: new Set(["reviewed", "cancelled"]),
  reviewed: new Set(["draft", "approved", "cancelled"]),
  approved: new Set(["filed", "failed", "cancelled"]),
  filed: new Set(["paid", "failed"]),
  paid: new Set(["reversed"]),
  failed: new Set(["cancelled"]),
  cancelled: new Set(),
  reversed: new Set(),
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeGovernmentRemittanceAmount(
  value: number,
  label: string,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative amount.`);
  }
  return roundCurrency(value);
}

export function getGovernmentLiabilityAccount(
  agency: GovernmentAgency,
): GovernmentRemittanceAccount {
  return LIABILITY_ACCOUNTS[agency];
}

export function getGovernmentAdvanceAccount(
  agency: GovernmentAgency,
): GovernmentRemittanceAccount {
  return ADVANCE_ACCOUNTS[agency];
}

export function assertGovernmentRemittanceTransition(
  current: GovernmentRemittanceStatus,
  next: GovernmentRemittanceStatus,
  failureStage?: GovernmentRemittanceFailureStage,
): void {
  const allowedAfterFailure =
    current === "failed"
      ? failureStage === "filing"
        ? next === "approved"
        : failureStage === "payment"
          ? next === "filed"
          : false
      : false;
  if (!STANDARD_TRANSITIONS[current].has(next) && !allowedAfterFailure) {
    throw new Error(
      `Invalid government remittance transition from ${current} to ${next}.`,
    );
  }
}

function journalLine(
  account: GovernmentRemittanceAccount,
  debit: number,
  credit: number,
): PayrollJournalLine {
  return {
    accountCode: account.code,
    accountName: account.name,
    debit: roundCurrency(debit),
    credit: roundCurrency(credit),
  };
}

export function buildGovernmentRemittancePaymentJournal(input: {
  agency: GovernmentAgency;
  liabilityAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  advancePaymentAmount: number;
  advanceAppliedAmount: number;
}): GovernmentRemittancePaymentJournal {
  const liabilityAmount = normalizeGovernmentRemittanceAmount(
    input.liabilityAmount,
    "Liability amount",
  );
  const penaltyAmount = normalizeGovernmentRemittanceAmount(
    input.penaltyAmount,
    "Penalty amount",
  );
  const interestAmount = normalizeGovernmentRemittanceAmount(
    input.interestAmount,
    "Interest amount",
  );
  const advancePaymentAmount = normalizeGovernmentRemittanceAmount(
    input.advancePaymentAmount,
    "Advance payment amount",
  );
  const advanceAppliedAmount = normalizeGovernmentRemittanceAmount(
    input.advanceAppliedAmount,
    "Applied advance amount",
  );
  if (advanceAppliedAmount > liabilityAmount) {
    throw new Error("Applied advance cannot exceed the liability amount.");
  }

  const cashAmount = roundCurrency(
    liabilityAmount +
      penaltyAmount +
      interestAmount +
      advancePaymentAmount -
      advanceAppliedAmount,
  );
  const advanceAccount = getGovernmentAdvanceAccount(input.agency);
  const lines = [
    journalLine(
      getGovernmentLiabilityAccount(input.agency),
      liabilityAmount,
      0,
    ),
    journalLine(PENALTY_ACCOUNT, penaltyAmount, 0),
    journalLine(INTEREST_ACCOUNT, interestAmount, 0),
    journalLine(advanceAccount, advancePaymentAmount, 0),
    journalLine(advanceAccount, 0, advanceAppliedAmount),
    journalLine(CASH_ACCOUNT, 0, cashAmount),
  ].filter((line) => line.debit !== 0 || line.credit !== 0);

  const totalDebits = roundCurrency(
    lines.reduce((sum, line) => sum + line.debit, 0),
  );
  const totalCredits = roundCurrency(
    lines.reduce((sum, line) => sum + line.credit, 0),
  );
  if (lines.length === 0) {
    throw new Error("Cannot post an empty government remittance journal.");
  }
  if (totalDebits !== totalCredits) {
    throw new Error(
      `Government remittance journal is not balanced: debits ${totalDebits.toFixed(2)}, credits ${totalCredits.toFixed(2)}.`,
    );
  }

  return { lines, totalDebits, totalCredits, cashAmount };
}
