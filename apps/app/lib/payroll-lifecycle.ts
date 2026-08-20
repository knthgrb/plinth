export type PayrollFinancialStatus =
  | "draft"
  | "processing"
  | "finalized"
  | "paid"
  | "voided"
  | "cancelled"
  | "archived";

export type PayrollLifecycleAction =
  | "finalize"
  | "record_payment"
  | "cancel"
  | "void"
  | "archive"
  | "discard"
  | "review_overrides";

export type PayrollActorRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "employee"
  | "accounting";

const ALLOWED_TRANSITIONS: Record<
  PayrollFinancialStatus,
  ReadonlySet<PayrollFinancialStatus>
> = {
  draft: new Set(["finalized", "cancelled"]),
  processing: new Set(["draft", "cancelled"]),
  finalized: new Set(["paid", "voided"]),
  paid: new Set(["voided"]),
  voided: new Set(),
  cancelled: new Set(),
  archived: new Set(),
};

const ALLOWED_ROLES: Record<
  PayrollLifecycleAction,
  ReadonlySet<PayrollActorRole>
> = {
  finalize: new Set(["owner", "admin"]),
  record_payment: new Set(["owner", "admin", "accounting"]),
  cancel: new Set(["owner", "admin", "hr"]),
  void: new Set(["owner", "admin"]),
  archive: new Set(["owner", "admin", "hr", "accounting"]),
  discard: new Set(["owner", "admin", "hr"]),
  review_overrides: new Set(["owner", "admin", "hr", "accounting"]),
};

const ACTION_PERMISSION_MESSAGE: Record<PayrollLifecycleAction, string> = {
  finalize: "Only an owner or admin can finalize payroll.",
  record_payment:
    "Only an owner, admin, or accounting member can record payroll payment.",
  cancel: "Only an owner, admin, or HR member can cancel a draft payroll.",
  void: "Only an owner or admin can void posted payroll.",
  archive:
    "Only an owner, admin, HR, or accounting member can archive payroll.",
  discard: "Only an owner, admin, or HR member can discard draft payroll.",
  review_overrides:
    "Only an owner, admin, HR, or accounting member can review payroll overrides.",
};

export function assertPayrollLifecyclePermission(
  role: PayrollActorRole,
  action: PayrollLifecycleAction,
): void {
  if (!ALLOWED_ROLES[action].has(role)) {
    throw new Error(ACTION_PERMISSION_MESSAGE[action]);
  }
}

export function assertPayrollLifecycleTransition(
  currentStatus: PayrollFinancialStatus,
  nextStatus: PayrollFinancialStatus,
): "noop" | "transition" {
  if (currentStatus === nextStatus) return "noop";
  if (!ALLOWED_TRANSITIONS[currentStatus].has(nextStatus)) {
    throw new Error(
      `Payroll run cannot transition from ${currentStatus} to ${nextStatus}.`,
    );
  }
  return "transition";
}
