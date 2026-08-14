import type { Id } from "@/convex/_generated/dataModel";

export type EmployeeLeaveRequestStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "cancellation_requested"
  | "cancelled"
  | "corrected";

export interface EmployeeLeaveBalanceSummary {
  balanceId: string;
  policyId?: string;
  poolKey?: string;
  leaveTypeKey: string;
  granted: number;
  used: number;
  reserved: number;
  available: number;
}

export interface EmployeeLeavePolicySummary {
  policyId: string;
  name: string;
  category: "statutory" | "company" | "unpaid";
  confidentiality: "standard" | "restricted";
}

export interface EmployeeLeaveDashboardData {
  employee: {
    employeeId: string;
    displayName: string;
    employmentStatus: string;
  };
  year: number;
  balances: EmployeeLeaveBalanceSummary[];
  policies: EmployeeLeavePolicySummary[];
  pendingRequestCount: number;
}

export interface EmployeeLeaveRequestSummary {
  id: string;
  policyId?: string;
  status: EmployeeLeaveRequestStatus;
  startDate: number;
  endDate: number;
  filedDate: number;
  chargeableDuration?: number;
  reason?: string;
  payTreatment?: string;
  decisionReason?: string;
  reviewedAt?: number;
  cancellationReason?: string;
  isLocked?: boolean;
}

export interface EmployeeLeaveCardModel {
  id: string;
  label: string;
  available: number;
  reserved: number;
  projected: number;
  granted: number;
  used: number;
}

export interface EmployeeLeaveRequestViewModel
  extends EmployeeLeaveRequestSummary {
  policyLabel: string;
  isRestricted: boolean;
}

export function getEmployeePolicyDisplayName(
  policy: Pick<EmployeeLeavePolicySummary, "name" | "confidentiality">,
): string {
  return policy.confidentiality === "restricted"
    ? "Protected leave"
    : policy.name;
}

export function buildEmployeeLeaveDashboardModel(input: {
  dashboard: EmployeeLeaveDashboardData;
  requests: readonly EmployeeLeaveRequestSummary[];
  now: number;
}) {
  const policiesById = new Map(
    input.dashboard.policies.map((policy) => [policy.policyId, policy]),
  );
  const cards = input.dashboard.balances.map((balance) => {
    const policy = balance.policyId
      ? policiesById.get(balance.policyId)
      : undefined;
    return {
      id: balance.balanceId,
      label: policy
        ? getEmployeePolicyDisplayName(policy)
        : balance.poolKey || balance.leaveTypeKey,
      available: balance.available,
      reserved: balance.reserved,
      projected: balance.available,
      granted: balance.granted,
      used: balance.used,
      category: policy?.category ?? "company",
    };
  });
  const requestModels = [...input.requests]
    .sort((left, right) => right.filedDate - left.filedDate)
    .map((request) => {
      const policy = request.policyId
        ? policiesById.get(request.policyId)
        : undefined;
      return {
        ...request,
        policyLabel: policy
          ? getEmployeePolicyDisplayName(policy)
          : "Leave request",
        isRestricted: policy?.confidentiality === "restricted",
      };
    });

  return {
    employeeName: input.dashboard.employee.displayName,
    year: input.dashboard.year,
    pendingRequestCount: input.dashboard.pendingRequestCount,
    companyBalances: cards.filter((card) => card.category !== "statutory"),
    statutoryPolicies: cards.filter((card) => card.category === "statutory"),
    upcoming: requestModels
      .filter(
        (request) =>
          request.status === "approved" && request.endDate >= input.now,
      )
      .sort((left, right) => left.startDate - right.startDate),
    recent: requestModels.slice(0, 6),
  };
}

export type LeaveDurationMode = "day" | "half_day" | "hour";

export interface EmployeeLeavePolicyOption {
  policyId: Id<"leavePolicies">;
  name: string;
  category: "statutory" | "company" | "unpaid";
  confidentiality: "standard" | "restricted";
  allowHalfDay: boolean;
  allowHourly: boolean;
}

export interface LeavePreviewOccurrence {
  localDate: string;
  scheduledMinutes: number;
  leaveMinutes: number;
  creditAmount: number;
  isHoliday: boolean;
  isRestDay: boolean;
}

export interface LeaveRequestPreview {
  policy: {
    policyId: string;
    policyVersionId: string;
    name: string;
    payTreatment:
      | "company_paid"
      | "statutory_paid"
      | "government_paid"
      | "statutory_benefit_supported"
      | "unpaid";
  };
  requestedStart: number;
  requestedEnd: number;
  chargeableDuration: number;
  availableBalance?: number | null;
  remainingBalance?: number | null;
  requiredDocuments: string[];
  occurrences: LeavePreviewOccurrence[];
}

export interface LeaveDraftAttachment {
  storageObjectId: string;
  documentType: string;
  fileName: string;
}

export interface LeaveRequestDraft {
  policyId: string;
  startLocalDate: string;
  endLocalDate: string;
  requestedDurationMode: LeaveDurationMode;
  requestedMinutes?: number;
  reason: string;
  attachments: LeaveDraftAttachment[];
  allowHalfDay: boolean;
  allowHourly: boolean;
  preview: LeaveRequestPreview | null;
  previewFingerprint: string | null;
}

type EditableLeaveDraftField =
  | "policyId"
  | "startLocalDate"
  | "endLocalDate"
  | "requestedDurationMode"
  | "requestedMinutes"
  | "reason";

export function getEmployeePolicyLabel(
  policy: Pick<EmployeeLeavePolicyOption, "name" | "confidentiality">,
): string {
  return policy.confidentiality === "restricted"
    ? "Protected leave"
    : policy.name;
}

export function getAllowedDurationModes(config: {
  allowHalfDay: boolean;
  allowHourly: boolean;
}): LeaveDurationMode[] {
  return [
    "day",
    ...(config.allowHalfDay ? (["half_day"] as const) : []),
    ...(config.allowHourly ? (["hour"] as const) : []),
  ];
}

export function createLeaveRequestDraft(input?: {
  policyId?: string;
  startLocalDate?: string;
  endLocalDate?: string;
  allowHalfDay?: boolean;
  allowHourly?: boolean;
}): LeaveRequestDraft {
  return {
    policyId: input?.policyId ?? "",
    startLocalDate: input?.startLocalDate ?? "",
    endLocalDate: input?.endLocalDate ?? "",
    requestedDurationMode: "day",
    reason: "",
    attachments: [],
    allowHalfDay: input?.allowHalfDay ?? false,
    allowHourly: input?.allowHourly ?? false,
    preview: null,
    previewFingerprint: null,
  };
}

export function buildLeaveDraftFingerprint(
  draft: Pick<
    LeaveRequestDraft,
    | "policyId"
    | "startLocalDate"
    | "endLocalDate"
    | "requestedDurationMode"
    | "requestedMinutes"
  >,
): string {
  return JSON.stringify({
    policyId: draft.policyId,
    startLocalDate: draft.startLocalDate,
    endLocalDate: draft.endLocalDate,
    requestedDurationMode: draft.requestedDurationMode,
    requestedMinutes:
      draft.requestedDurationMode === "hour"
        ? draft.requestedMinutes ?? null
        : null,
  });
}

export function setLeaveDraftField(
  draft: LeaveRequestDraft,
  field: EditableLeaveDraftField,
  value: string | number | undefined,
): LeaveRequestDraft {
  const next = { ...draft, [field]: value } as LeaveRequestDraft;
  if (field === "reason") return next;
  return { ...next, preview: null, previewFingerprint: null };
}

export function applyLeavePreview(
  draft: LeaveRequestDraft,
  preview: LeaveRequestPreview,
  fingerprint: string,
): LeaveRequestDraft {
  if (fingerprint !== buildLeaveDraftFingerprint(draft)) return draft;
  return { ...draft, preview, previewFingerprint: fingerprint };
}

export function canSubmitLeaveDraft(draft: LeaveRequestDraft): boolean {
  if (
    !draft.policyId ||
    !draft.startLocalDate ||
    !draft.endLocalDate ||
    !draft.reason.trim() ||
    !draft.preview ||
    draft.previewFingerprint !== buildLeaveDraftFingerprint(draft)
  ) {
    return false;
  }
  const attachedTypes = new Set(
    draft.attachments.map((attachment) => attachment.documentType),
  );
  return draft.preview.requiredDocuments.every((type) =>
    attachedTypes.has(type),
  );
}

export type EmployeeRequestAction =
  | "withdraw"
  | "request_cancellation"
  | "read_only";

export function getEmployeeRequestAction(
  request: Pick<EmployeeLeaveRequestSummary, "status" | "endDate" | "isLocked">,
  now: number,
): EmployeeRequestAction {
  if (request.isLocked) return "read_only";
  if (request.status === "pending") return "withdraw";
  if (request.status === "approved" && request.endDate > now) {
    return "request_cancellation";
  }
  return "read_only";
}
