export type RequirementStatus = "pending" | "submitted" | "verified";

export interface RequirementPolicy {
  type: string;
  isRequired?: boolean;
  appliesToDepartments?: readonly string[];
  appliesToEmploymentTypes?: readonly string[];
  reminderDaysBeforeDue?: number;
  requiresVerification?: boolean;
  expiryDaysAfterSubmission?: number;
}

export interface EmployeeApplicability {
  department?: string;
  employmentType?: string;
}

export interface EmployeeRequirement extends RequirementPolicy {
  status: RequirementStatus;
  file?: string;
  submittedDate?: number;
  expiryDate?: number;
  verifiedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
}

export type RequirementState =
  | "missing"
  | "awaiting_review"
  | "rejected"
  | "expiring"
  | "expired"
  | "complete"
  | "optional";

export interface DerivedRequirementState {
  state: RequirementState;
  daysUntilExpiry?: number;
}

export interface RequirementSummary {
  total: number;
  required: number;
  complete: number;
  missing: number;
  awaitingReview: number;
  rejected: number;
  expiring: number;
  expired: number;
  completionPercent: number;
}

export interface RequirementWorkspaceEmployee {
  employeeId: string;
  requirements: readonly EmployeeRequirement[];
}

export interface RequirementWorkspaceSummary {
  employees: number;
  compliantEmployees: number;
  attentionEmployees: number;
  missing: number;
  awaitingReview: number;
  rejected: number;
  expiring: number;
  expired: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function matchesScope(
  allowedValues: readonly string[] | undefined,
  actualValue: string | undefined,
): boolean {
  if (!allowedValues?.length) return true;
  const normalizedActual = normalize(actualValue);
  return allowedValues.some((value) => normalize(value) === normalizedActual);
}

export function isRequirementApplicable(
  policy: RequirementPolicy,
  employee: EmployeeApplicability,
): boolean {
  return (
    matchesScope(policy.appliesToDepartments, employee.department) &&
    matchesScope(policy.appliesToEmploymentTypes, employee.employmentType)
  );
}

export function filterApplicableRequirementPolicies<
  Policy extends RequirementPolicy,
>(policies: readonly Policy[], employee: EmployeeApplicability): Policy[] {
  return policies.filter((policy) => isRequirementApplicable(policy, employee));
}

export function calculateSubmissionExpiry(
  policy: RequirementPolicy,
  submittedAt: number,
): number | undefined {
  const duration = policy.expiryDaysAfterSubmission;
  if (duration === undefined || duration <= 0) return undefined;
  return submittedAt + duration * DAY_IN_MS;
}

export function deriveRequirementState(
  requirement: EmployeeRequirement,
  now = Date.now(),
): DerivedRequirementState {
  if (requirement.expiryDate !== undefined) {
    const daysUntilExpiry = Math.ceil(
      (requirement.expiryDate - now) / DAY_IN_MS,
    );
    if (requirement.expiryDate <= now) {
      return { state: "expired", daysUntilExpiry };
    }
    if (
      requirement.status === "verified" &&
      requirement.reminderDaysBeforeDue !== undefined &&
      daysUntilExpiry <= requirement.reminderDaysBeforeDue
    ) {
      return { state: "expiring", daysUntilExpiry };
    }
  }

  if (requirement.rejectedAt !== undefined || requirement.rejectionReason) {
    return { state: "rejected" };
  }
  if (
    requirement.status === "verified" ||
    (requirement.status === "submitted" &&
      requirement.requiresVerification === false)
  ) {
    return { state: "complete" };
  }
  if (requirement.status === "submitted") {
    return { state: "awaiting_review" };
  }
  if (requirement.isRequired === false) {
    return { state: "optional" };
  }
  return { state: "missing" };
}

export function summarizeEmployeeRequirements(
  requirements: readonly EmployeeRequirement[],
  now = Date.now(),
): RequirementSummary {
  const summary: RequirementSummary = {
    total: requirements.length,
    required: 0,
    complete: 0,
    missing: 0,
    awaitingReview: 0,
    rejected: 0,
    expiring: 0,
    expired: 0,
    completionPercent: 100,
  };

  for (const requirement of requirements) {
    const derived = deriveRequirementState(requirement, now);
    if (requirement.isRequired !== false) summary.required += 1;
    if (derived.state === "complete" || derived.state === "expiring") {
      if (requirement.isRequired !== false) summary.complete += 1;
    }
    if (derived.state === "missing") summary.missing += 1;
    if (derived.state === "awaiting_review") summary.awaitingReview += 1;
    if (derived.state === "rejected") summary.rejected += 1;
    if (derived.state === "expiring") summary.expiring += 1;
    if (derived.state === "expired") summary.expired += 1;
  }

  summary.completionPercent =
    summary.required === 0
      ? 100
      : Math.round((summary.complete / summary.required) * 100);
  return summary;
}

export function summarizeRequirementWorkspace(
  employees: readonly RequirementWorkspaceEmployee[],
  now = Date.now(),
): RequirementWorkspaceSummary {
  const result: RequirementWorkspaceSummary = {
    employees: employees.length,
    compliantEmployees: 0,
    attentionEmployees: 0,
    missing: 0,
    awaitingReview: 0,
    rejected: 0,
    expiring: 0,
    expired: 0,
  };
  for (const employee of employees) {
    const summary = summarizeEmployeeRequirements(employee.requirements, now);
    result.missing += summary.missing;
    result.awaitingReview += summary.awaitingReview;
    result.rejected += summary.rejected;
    result.expiring += summary.expiring;
    result.expired += summary.expired;
    const isCompliant =
      summary.complete === summary.required &&
      summary.missing === 0 &&
      summary.awaitingReview === 0 &&
      summary.rejected === 0 &&
      summary.expired === 0;
    if (isCompliant) result.compliantEmployees += 1;
    if (
      summary.missing > 0 ||
      summary.awaitingReview > 0 ||
      summary.rejected > 0 ||
      summary.expiring > 0 ||
      summary.expired > 0
    ) {
      result.attentionEmployees += 1;
    }
  }
  return result;
}
