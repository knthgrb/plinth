export type OrganizationRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "employee"
  | "accounting";

export type LeaveAdminTab =
  | "approvals"
  | "balances"
  | "conversions"
  | "calendar";

export function getLeaveWorkspaceMode(
  canonicalEngineActive: boolean,
): "canonical" | "legacy_compatibility" {
  return canonicalEngineActive ? "canonical" : "legacy_compatibility";
}

export function getLeaveAdminTabs(role: OrganizationRole): LeaveAdminTab[] {
  return role === "owner" || role === "admin" || role === "hr"
    ? ["approvals", "balances", "conversions", "calendar"]
    : [];
}

export function shouldShowEmployeeLeaveWorkspace(input: {
  role: OrganizationRole | undefined;
  isEmployeeExperienceUI: boolean;
}): boolean {
  return (
    input.isEmployeeExperienceUI ||
    input.role === "employee" ||
    input.role === "manager"
  );
}

export interface AdminApprovalRow {
  id: string;
  status: "pending" | "cancellation_requested";
  employeeName: string;
  policyName: string;
  startDate: number;
  endDate: number;
  filedDate: number;
  requiredDocumentCount?: number;
  submittedDocumentCount?: number;
  hasConflict?: boolean;
  reason?: string;
  confidentiality?: "standard" | "restricted";
  hasSensitiveAccess?: boolean;
}

export function buildAdminApprovalQueues(rows: readonly AdminApprovalRow[]) {
  const newestFirst = [...rows].sort(
    (left, right) => right.filedDate - left.filedDate,
  );
  return {
    pending: newestFirst.filter((row) => row.status === "pending"),
    cancellations: newestFirst.filter(
      (row) => row.status === "cancellation_requested",
    ),
    evidence: newestFirst.filter(
      (row) =>
        (row.requiredDocumentCount ?? 0) > (row.submittedDocumentCount ?? 0),
    ),
    conflicts: newestFirst.filter((row) => row.hasConflict === true),
  };
}

export interface ApprovalColumnState {
  id: string;
  hidden: boolean;
}

const essentialApprovalColumns = ["employee", "status", "policy", "dates"];

export function normalizeApprovalColumns(
  columns: readonly ApprovalColumnState[],
): ApprovalColumnState[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const normalized = columns.map((column) => ({
    ...column,
    hidden: essentialApprovalColumns.includes(column.id)
      ? false
      : column.hidden,
  }));
  for (const id of essentialApprovalColumns) {
    if (!byId.has(id)) normalized.push({ id, hidden: false });
  }
  return normalized;
}

export function resolveAuthenticatedReviewer(input: {
  displayName: string;
  role: "owner" | "admin" | "hr";
}): { displayName: string; position: string } {
  return {
    displayName: input.displayName.trim() || "Authenticated reviewer",
    position:
      input.role === "hr"
        ? "HR"
        : `${input.role[0].toUpperCase()}${input.role.slice(1)}`,
  };
}

export function getAdminLeaveReason(input: {
  reason?: string;
  confidentiality: "standard" | "restricted";
  hasSensitiveAccess: boolean;
}): string {
  if (input.confidentiality === "restricted" && !input.hasSensitiveAccess) {
    return "Restricted leave details";
  }
  return input.reason?.trim() || "No reason provided";
}

export interface LeaveLedgerEntryInput {
  id: string;
  kind: string;
  amount: number;
  effectiveDate: number;
  actorName?: string;
  reason?: string;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function buildLedgerRows(entries: readonly LeaveLedgerEntryInput[]) {
  const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  return entries.map((entry) => ({
    ...entry,
    kindLabel: titleCase(entry.kind),
    unitsLabel: `${entry.amount > 0 ? "+" : ""}${entry.amount} days`,
    dateLabel: dateFormatter.format(entry.effectiveDate),
    actorLabel: entry.actorName?.trim() || "System",
    reasonLabel: entry.reason?.trim() || "No reason recorded",
  }));
}

export interface LeaveConversionInput {
  id: string;
  employeeName: string;
  policyName: string;
  requestedDays: number;
  status: "pending" | "approved" | "rejected" | "cancelled" | "paid";
  paymentStatus: string;
  settlementContext?: "payroll" | "final_settlement";
}

export function buildConversionQueueRows(
  rows: readonly LeaveConversionInput[],
) {
  return rows.map((row) => ({
    ...row,
    workflowLabel: titleCase(row.status),
    paymentLabel:
      row.settlementContext === "final_settlement"
        ? row.paymentStatus === "included" || row.paymentStatus === "paid"
          ? "Included in final settlement"
          : `Final settlement · ${titleCase(row.paymentStatus)}`
        : row.settlementContext === "payroll"
          ? `Payroll · ${titleCase(row.paymentStatus)}`
          : titleCase(row.paymentStatus),
  }));
}

export interface LeaveCalendarInput {
  id: string;
  employeeName: string;
  policyName: string;
  confidentiality: "standard" | "restricted";
  reason?: string;
  startDate: number;
  endDate: number;
  status: string;
}

export function buildCalendarRows(rows: readonly LeaveCalendarInput[]) {
  return rows
    .filter((row) => row.status === "approved")
    .map((row) => ({
      ...row,
      availabilityLabel: `${row.employeeName} is unavailable`,
      policyLabel:
        row.confidentiality === "restricted"
          ? "Protected leave"
          : row.policyName,
      reason: row.confidentiality === "restricted" ? undefined : row.reason,
    }));
}
