export type EmployeeStatus =
  | "active"
  | "inactive"
  | "resigned"
  | "terminated";

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
  inactive: {
    status: "inactive",
    label: "Suspended",
    accessLabel: "Access suspended",
    login: "Cannot access this organization until reactivated.",
    chat: "Chat access is disabled for this organization.",
    leave: "Cannot file new leave requests.",
    attendance: "Attendance capture is disabled while suspended.",
    payroll:
      "Can remain in payroll history; include in new runs only when selected by payroll policy.",
    payslips: "Historical payslips remain preserved for admins.",
    assets: "Assigned assets should be reviewed but are not automatically removed.",
    documents: "Employee document access is disabled for this organization.",
    finalPay: "No final pay action required unless the employee separates.",
  },
  resigned: {
    status: "resigned",
    label: "Resigned",
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
  terminated: {
    status: "terminated",
    label: "Terminated",
    accessLabel: "Org access disabled",
    login: "Cannot access this organization.",
    chat: "Chat access is disabled for this organization.",
    leave: "Cannot file or approve leave.",
    attendance: "Attendance capture stops after termination.",
    payroll: "Excluded from regular payroll; use final pay when needed.",
    payslips: "Historical payroll data is preserved for admins.",
    assets: "Assigned assets should be returned or cleared.",
    documents: "Employee document access is disabled for this organization.",
    finalPay:
      "Should be reviewed for final pay, clearance, and offboarding records.",
  },
};

export function normalizeEmployeeStatus(
  status: string | null | undefined,
): EmployeeStatus {
  if (
    status === "active" ||
    status === "inactive" ||
    status === "resigned" ||
    status === "terminated"
  ) {
    return status;
  }

  return "active";
}

export function getEmployeeLifecycleImpact(
  status: string | null | undefined,
): EmployeeLifecycleImpact {
  return LIFECYCLE_IMPACTS[normalizeEmployeeStatus(status)];
}

export function canUseEmployeeSelfService(
  status: string | null | undefined,
): boolean {
  return normalizeEmployeeStatus(status) === "active";
}
