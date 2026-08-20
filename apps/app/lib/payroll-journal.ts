export type PayrollJournalDeduction = {
  name: string;
  type: string;
  amount: number;
};

export type PayrollJournalPayslip = {
  employeeId: string;
  netPay: number;
  deductions: readonly PayrollJournalDeduction[];
  employerContributions?: {
    sss?: number;
    philhealth?: number;
    pagibig?: number;
  };
};

export type PayrollJournalLine = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

export type PayrollJournal = {
  lines: PayrollJournalLine[];
  totalDebits: number;
  totalCredits: number;
};

const ACCOUNTS = {
  compensationExpense: ["6000", "Compensation Expense"],
  employerStatutoryExpense: ["6010", "Employer Statutory Contribution Expense"],
  payrollPayable: ["2100", "Payroll Payable"],
  sssPayable: ["2110", "SSS Payable"],
  philHealthPayable: ["2120", "PhilHealth Payable"],
  pagibigPayable: ["2130", "Pag-IBIG Payable"],
  withholdingTaxPayable: ["2140", "Withholding Tax Payable"],
  otherDeductionsPayable: ["2150", "Other Payroll Deductions Payable"],
} as const;

function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase().replaceAll("-", "").replaceAll(" ", "");
}

function classifyDeduction(
  deduction: PayrollJournalDeduction,
): "sss" | "philhealth" | "pagibig" | "tax" | "attendance" | "other" {
  const name = normalizedName(deduction.name);
  if (name === "sss") return "sss";
  if (name === "philhealth") return "philhealth";
  if (name === "pagibig") return "pagibig";
  if (name === "withholdingtax") return "tax";
  if (
    deduction.type.trim().toLowerCase() === "attendance" ||
    name.includes("absence") ||
    name.includes("late") ||
    name.includes("undertime") ||
    name.includes("leavewithoutpay") ||
    name.includes("noworknopay")
  ) {
    return "attendance";
  }
  return "other";
}

function line(
  account: readonly [string, string],
  debit: number,
  credit: number,
): PayrollJournalLine {
  return {
    accountCode: account[0],
    accountName: account[1],
    debit: roundCurrency(debit),
    credit: roundCurrency(credit),
  };
}

function finalize(lines: PayrollJournalLine[]): PayrollJournal {
  const nonZeroLines = lines.filter(
    (entry) => entry.debit !== 0 || entry.credit !== 0,
  );
  const totalDebits = roundCurrency(
    nonZeroLines.reduce((sum, entry) => sum + entry.debit, 0),
  );
  const totalCredits = roundCurrency(
    nonZeroLines.reduce((sum, entry) => sum + entry.credit, 0),
  );
  if (totalDebits !== totalCredits) {
    throw new Error(
      `Payroll journal is not balanced: debits ${totalDebits.toFixed(2)}, credits ${totalCredits.toFixed(2)}.`,
    );
  }
  return { lines: nonZeroLines, totalDebits, totalCredits };
}

export function buildPayrollAccrualJournal(
  payslips: readonly PayrollJournalPayslip[],
): PayrollJournal {
  let netPay = 0;
  let employeeSss = 0;
  let employeePhilHealth = 0;
  let employeePagibig = 0;
  let withholdingTax = 0;
  let otherDeductions = 0;
  let employerSss = 0;
  let employerPhilHealth = 0;
  let employerPagibig = 0;

  for (const payslip of payslips) {
    netPay += roundCurrency(payslip.netPay);
    for (const deduction of payslip.deductions) {
      const amount = roundCurrency(Math.max(0, deduction.amount));
      switch (classifyDeduction(deduction)) {
        case "sss":
          employeeSss += amount;
          break;
        case "philhealth":
          employeePhilHealth += amount;
          break;
        case "pagibig":
          employeePagibig += amount;
          break;
        case "tax":
          withholdingTax += amount;
          break;
        case "other":
          otherDeductions += amount;
          break;
        case "attendance":
          break;
      }
    }
    employerSss += roundCurrency(payslip.employerContributions?.sss ?? 0);
    employerPhilHealth += roundCurrency(
      payslip.employerContributions?.philhealth ?? 0,
    );
    employerPagibig += roundCurrency(
      payslip.employerContributions?.pagibig ?? 0,
    );
  }

  const compensationExpense = roundCurrency(
    netPay +
      employeeSss +
      employeePhilHealth +
      employeePagibig +
      withholdingTax +
      otherDeductions,
  );
  const employerStatutoryExpense = roundCurrency(
    employerSss + employerPhilHealth + employerPagibig,
  );

  return finalize([
    line(ACCOUNTS.compensationExpense, compensationExpense, 0),
    line(ACCOUNTS.employerStatutoryExpense, employerStatutoryExpense, 0),
    line(ACCOUNTS.payrollPayable, 0, netPay),
    line(ACCOUNTS.sssPayable, 0, employeeSss + employerSss),
    line(
      ACCOUNTS.philHealthPayable,
      0,
      employeePhilHealth + employerPhilHealth,
    ),
    line(ACCOUNTS.pagibigPayable, 0, employeePagibig + employerPagibig),
    line(ACCOUNTS.withholdingTaxPayable, 0, withholdingTax),
    line(ACCOUNTS.otherDeductionsPayable, 0, otherDeductions),
  ]);
}

export function buildPayrollPaymentJournal(netPay: number): PayrollJournal {
  const amount = roundCurrency(Math.max(0, netPay));
  return finalize([
    line(ACCOUNTS.payrollPayable, amount, 0),
    line(["1000", "Cash and Bank"], 0, amount),
  ]);
}

export function buildPayrollJournalAdjustment(
  previous: PayrollJournal,
  next: PayrollJournal,
): PayrollJournal {
  const previousByAccount = new Map(
    previous.lines.map((entry) => [
      entry.accountCode,
      { ...entry, signedAmount: entry.debit - entry.credit },
    ]),
  );
  const nextByAccount = new Map(
    next.lines.map((entry) => [
      entry.accountCode,
      { ...entry, signedAmount: entry.debit - entry.credit },
    ]),
  );
  const accountCodes = new Set([
    ...previousByAccount.keys(),
    ...nextByAccount.keys(),
  ]);
  const lines: PayrollJournalLine[] = [];
  for (const accountCode of accountCodes) {
    const previousLine = previousByAccount.get(accountCode);
    const nextLine = nextByAccount.get(accountCode);
    const delta = roundCurrency(
      (nextLine?.signedAmount ?? 0) - (previousLine?.signedAmount ?? 0),
    );
    if (delta === 0) continue;
    const accountName =
      nextLine?.accountName ?? previousLine?.accountName ?? accountCode;
    lines.push({
      accountCode,
      accountName,
      debit: delta > 0 ? delta : 0,
      credit: delta < 0 ? -delta : 0,
    });
  }
  lines.sort((left, right) =>
    left.accountCode.localeCompare(right.accountCode),
  );
  return finalize(lines);
}

export function reversePayrollJournal(journal: PayrollJournal): PayrollJournal {
  return finalize(
    journal.lines.map((entry) => ({
      ...entry,
      debit: entry.credit,
      credit: entry.debit,
    })),
  );
}
