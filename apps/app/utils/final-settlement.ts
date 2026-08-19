export type FinalSettlementStatus =
  | "draft"
  | "in_review"
  | "ready_for_payroll"
  | "payroll_generated"
  | "released"
  | "void";

export type FinalSettlementClearanceStatus =
  | "pending"
  | "completed"
  | "waived";

export type FinalSettlementLoanPayoffRule =
  | "deduct_full_balance"
  | "deduct_scheduled_amount"
  | "waive"
  | "custom_amount";

export type FinalSettlementLineStatus = "pending" | "approved" | "waived";

export type FinalSettlementCustomDeductionType =
  | "loan"
  | "company_property"
  | "cash_advance"
  | "training_bond"
  | "other";

export type FinalSettlementBir2316Status =
  | "not_started"
  | "data_ready"
  | "document_generated"
  | "released";

export type FinalSettlementTaxReleaseStatus =
  | "pending"
  | "reviewed"
  | "released";

export type FinalSettlementClearanceItem = {
  id: string;
  label: string;
  ownerRole?: string;
  required: boolean;
  status: FinalSettlementClearanceStatus;
  completedBy?: unknown;
  completedAt?: number;
  waivedBy?: unknown;
  waivedAt?: number;
  notes?: string;
};

export type FinalSettlementLoanPayoff = {
  id: string;
  deductionId?: string;
  name: string;
  scheduledAmount?: number;
  payoffAmount: number;
  rule: FinalSettlementLoanPayoffRule;
  status: FinalSettlementLineStatus;
  notes?: string;
};

export type FinalSettlementCustomDeduction = {
  id: string;
  name: string;
  amount: number;
  type: FinalSettlementCustomDeductionType;
  taxable?: boolean;
  notes?: string;
};

export type FinalSettlementReleaseTracking = {
  status: FinalSettlementTaxReleaseStatus;
  reviewedBy?: unknown;
  reviewedAt?: number;
  releasedBy?: unknown;
  releasedAt?: number;
  calculationVersion?: number;
  annualTaxableIncome?: number;
  annualTaxDue?: number;
  taxAlreadyWithheld?: number;
  calculatedAdjustment?: number;
  appliedAdjustment?: number;
  variance?: number;
  overrideReason?: string;
  notes?: string;
};

export function validateFinalTaxReview(args: {
  calculatedAdjustment: number;
  appliedAdjustment: number;
  overrideReason?: string;
}): {
  calculatedAdjustment: number;
  appliedAdjustment: number;
  variance: number;
  overrideReason?: string;
} {
  const calculatedAdjustment = roundCurrency(args.calculatedAdjustment);
  const appliedAdjustment = roundCurrency(args.appliedAdjustment);
  const variance = roundCurrency(appliedAdjustment - calculatedAdjustment);
  const overrideReason = args.overrideReason?.trim() || undefined;
  if (variance !== 0 && !overrideReason) {
    throw new Error(
      "A final tax override reason is required when the applied amount differs from the calculated amount.",
    );
  }
  return {
    calculatedAdjustment,
    appliedAdjustment,
    variance,
    overrideReason,
  };
}

export type FinalSettlementBir2316Tracking = {
  status: FinalSettlementBir2316Status;
  documentId?: unknown;
  generatedAt?: number;
  releasedAt?: number;
  releasedBy?: unknown;
  notes?: string;
};

export type FinalSettlementLike = {
  status: FinalSettlementStatus;
  payrollRunId?: unknown;
  payslipId?: unknown;
  clearanceItems?: FinalSettlementClearanceItem[];
  loanPayoffs?: FinalSettlementLoanPayoff[];
  customDeductions?: FinalSettlementCustomDeduction[];
  bir2316?: FinalSettlementBir2316Tracking;
  finalTaxRelease?: FinalSettlementReleaseTracking;
};

export type EmployeeDeductionLike = {
  id: string;
  type: "government" | "loan" | "other";
  name: string;
  amount: number;
  frequency: "monthly" | "per-cutoff";
  isActive: boolean;
};

export type PayrollDeductionLine = {
  name: string;
  amount: number;
  type: string;
};

const DEFAULT_CLEARANCE_ITEMS: Array<{
  id: string;
  label: string;
  ownerRole: string;
}> = [
  { id: "hr-clearance", label: "HR Clearance", ownerRole: "hr" },
  { id: "manager-handover", label: "Manager Handover", ownerRole: "hr" },
  { id: "it-assets", label: "IT Assets", ownerRole: "hr" },
  { id: "finance-clearance", label: "Finance Clearance", ownerRole: "accounting" },
  { id: "company-property", label: "Company Property", ownerRole: "hr" },
  { id: "bir-2316-final-tax", label: "BIR 2316 / Final Tax", ownerRole: "accounting" },
];

function roundCurrency(amount: number): number {
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100;
}

export function createDefaultFinalSettlementChecklist(
  sequence = 0,
): FinalSettlementClearanceItem[] {
  return DEFAULT_CLEARANCE_ITEMS.map((item) => ({
    id: `${sequence}-${item.id}`,
    label: item.label,
    ownerRole: item.ownerRole,
    required: true,
    status: "pending",
  }));
}

export function createLoanPayoffsFromEmployeeDeductions(
  deductions: EmployeeDeductionLike[] | undefined,
): FinalSettlementLoanPayoff[] {
  return (deductions ?? [])
    .filter((deduction) => deduction.type === "loan" && deduction.isActive)
    .map((deduction) => ({
      id: deduction.id,
      deductionId: deduction.id,
      name: deduction.name,
      scheduledAmount: roundCurrency(deduction.amount),
      payoffAmount: 0,
      rule: "deduct_full_balance",
      status: "pending",
    }));
}

export function buildSeparationKey(
  employeeId: string,
  separationType: "resigned" | "terminated",
  separationDate: number,
): string {
  return `${employeeId}:${separationType}:${Math.trunc(separationDate)}`;
}

const EDITABLE_SETTLEMENT_STATUSES: ReadonlySet<FinalSettlementStatus> = new Set([
  "draft",
  "in_review",
  "ready_for_payroll",
]);

export function assertFinalSettlementEditable(
  status: FinalSettlementStatus,
): void {
  if (!EDITABLE_SETTLEMENT_STATUSES.has(status)) {
    throw new Error(`Final settlement in ${status} status cannot be edited.`);
  }
}

const ALLOWED_SETTLEMENT_TRANSITIONS: Record<
  FinalSettlementStatus,
  ReadonlySet<FinalSettlementStatus>
> = {
  draft: new Set(["in_review", "void"]),
  in_review: new Set(["ready_for_payroll", "void"]),
  ready_for_payroll: new Set(["in_review", "payroll_generated", "void"]),
  payroll_generated: new Set(["ready_for_payroll", "released", "void"]),
  released: new Set(),
  void: new Set(),
};

export function assertFinalSettlementTransition(
  currentStatus: FinalSettlementStatus,
  nextStatus: FinalSettlementStatus,
): void {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_SETTLEMENT_TRANSITIONS[currentStatus].has(nextStatus)) {
    throw new Error(
      `Final settlement cannot transition from ${currentStatus} to ${nextStatus}.`,
    );
  }
}

export function isFinalSettlementClearanceAndLoansResolved(
  settlement: Pick<FinalSettlementLike, "clearanceItems" | "loanPayoffs">,
): boolean {
  const requiredClearance = (settlement.clearanceItems ?? []).filter(
    (item) => item.required,
  );
  const clearanceDone = requiredClearance.every(
    (item) => item.status === "completed" || item.status === "waived",
  );
  const loansResolved = (settlement.loanPayoffs ?? []).every(
    (loan) =>
      loan.status === "waived" ||
      (loan.status === "approved" &&
        loan.rule !== "waive" &&
        roundCurrency(loan.payoffAmount) > 0),
  );

  return clearanceDone && loansResolved;
}

export function isFinalSettlementReadyForPayroll(
  settlement: Pick<
    FinalSettlementLike,
    "status" | "payrollRunId" | "payslipId" | "clearanceItems" | "loanPayoffs"
  >,
): boolean {
  if (settlement.status !== "ready_for_payroll") {
    return false;
  }
  if (settlement.payrollRunId || settlement.payslipId) return false;

  return isFinalSettlementClearanceAndLoansResolved(settlement);
}

export function buildFinalSettlementPayrollDeductions(
  settlement: Pick<FinalSettlementLike, "loanPayoffs" | "customDeductions">,
): PayrollDeductionLine[] {
  const loanLines = (settlement.loanPayoffs ?? [])
    .filter(
      (loan) =>
        loan.status === "approved" &&
        loan.rule !== "waive" &&
        roundCurrency(loan.payoffAmount) > 0,
    )
    .map((loan) => ({
      name: `Loan Payoff - ${loan.name}`,
      amount: roundCurrency(loan.payoffAmount),
      type: "loan",
    }));

  const customLines = (settlement.customDeductions ?? [])
    .filter((deduction) => roundCurrency(deduction.amount) > 0)
    .map((deduction) => ({
      name: `Separation Deduction - ${deduction.name}`,
      amount: roundCurrency(deduction.amount),
      type: "separation",
    }));

  return [...loanLines, ...customLines];
}

export function computeFinalSettlementSummary(settlement: FinalSettlementLike) {
  const required = (settlement.clearanceItems ?? []).filter(
    (item) => item.required,
  );
  const completedRequired = required.filter(
    (item) => item.status === "completed",
  ).length;
  const waivedRequired = required.filter((item) => item.status === "waived").length;
  const pendingRequired = required.length - completedRequired - waivedRequired;
  const payrollLines = buildFinalSettlementPayrollDeductions(settlement);
  const totalLoanPayoff = payrollLines
    .filter((line) => line.type === "loan")
    .reduce((sum, line) => sum + line.amount, 0);
  const totalCustomDeductions = payrollLines
    .filter((line) => line.type === "separation")
    .reduce((sum, line) => sum + line.amount, 0);
  const birReady =
    settlement.bir2316?.status === "data_ready" ||
    settlement.bir2316?.status === "document_generated" ||
    settlement.bir2316?.status === "released";
  const finalTaxReady =
    settlement.finalTaxRelease?.status === "reviewed" ||
    settlement.finalTaxRelease?.status === "released";

  return {
    clearance: {
      required: required.length,
      completedRequired,
      waivedRequired,
      pendingRequired,
    },
    totalLoanPayoff: roundCurrency(totalLoanPayoff),
    totalCustomDeductions: roundCurrency(totalCustomDeductions),
    totalSettlementDeductions: roundCurrency(
      totalLoanPayoff + totalCustomDeductions,
    ),
    readyForPayroll: isFinalSettlementReadyForPayroll(settlement),
    readyForRelease:
      (settlement.status === "payroll_generated" ||
        settlement.status === "released") &&
      isFinalSettlementClearanceAndLoansResolved(settlement) &&
      birReady &&
      finalTaxReady,
  };
}
