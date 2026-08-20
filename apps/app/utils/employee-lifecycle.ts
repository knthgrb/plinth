import {
  isEmployeeSeparated,
  normalizeEmploymentStatus,
  resolveSeparationType,
  type EmploymentStatus,
  type SeparationType,
} from "@/utils/employment-lifecycle";

export type EmployeeStatus = EmploymentStatus;

export type EmployeeLifecycleImpact = {
  status: EmployeeStatus;
  label: string;
  accessLabel: string;
  login: string;
  chat: string;
  leave: string;
  attendance: string;
  payroll: string;
  payslips: string;
  assets: string;
  documents: string;
  finalPay: string;
};

const LIFECYCLE_IMPACTS: Record<EmployeeStatus, EmployeeLifecycleImpact> = {
  active: {
    status: "active",
    label: "Active",
    accessLabel: "Full access",
    login: "Can sign in and use the organization normally.",
    chat: "Can use organization chat according to role permissions.",
    leave: "Can file and approve leave according to role permissions.",
    attendance: "Can record attendance and appear in attendance workflows.",
    payroll: "Included in regular payroll runs when eligible.",
    payslips: "Can view current and historical payslips.",
    assets: "Can hold assigned company assets.",
    documents: "Can access employee-visible documents.",
    finalPay: "No final pay action required.",
  },
  separated: {
    status: "separated",
    label: "Separated",
    accessLabel: "Alumni read-only",
    login: "Can only access alumni-allowed history for this organization.",
    chat: "Chat access is disabled for this organization.",
    leave: "Cannot file or approve leave.",
    attendance: "Attendance capture stops after separation.",
    payroll: "Excluded from regular payroll; use final pay when needed.",
    payslips: "Can keep read-only access to historical payslips.",
    assets: "Assigned assets should be returned or cleared.",
    documents:
      "Only documents marked alumni-visible should remain available to the employee.",
    finalPay: "Should be reviewed for final pay and clearance.",
  },
};

export function normalizeEmployeeStatus(
  status: string | null | undefined,
): EmployeeStatus {
  return normalizeEmploymentStatus(status);
}

export function getEmployeeLifecycleImpact(
  status: string | null | undefined,
  separationType?: SeparationType | null,
): EmployeeLifecycleImpact {
  const impact = LIFECYCLE_IMPACTS[normalizeEmployeeStatus(status)];
  const resolvedType = resolveSeparationType(status, separationType);
  if (resolvedType === "resignation") {
    return { ...impact, label: "Resigned" };
  }
  if (resolvedType === "termination") {
    return {
      ...impact,
      label: "Terminated",
      attendance: "Attendance capture stops after termination.",
      finalPay:
        "Should be reviewed for final pay, clearance, and offboarding records.",
    };
  }
  return impact;
}

export function canUseEmployeeSelfService(
  status: string | null | undefined,
): boolean {
  return normalizeEmployeeStatus(status) === "active";
}

export function canRehireEmployee(status: string | null | undefined): boolean {
  return isEmployeeSeparated(status);
}
