export type SchemaFieldClassification =
  | "canonical"
  | "compatibility_read"
  | "compatibility_write"
  | "migration_only"
  | "historical_snapshot"
  | "removable";

export type SchemaFieldManifestEntry = {
  table: string;
  field: string;
  classification: SchemaFieldClassification;
  target?: string;
  releaseGate: string;
};

export const ORGANIZATION_CONFIGURATION_FIELD_MANIFEST = [
  {
    table: "organizations",
    field: "firstPayDate",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.firstPayDate",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "organizations",
    field: "secondPayDate",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.secondPayDate",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "organizations",
    field: "salaryPaymentFrequency",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.salaryPaymentFrequency",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "organizations",
    field: "defaultRequirements",
    classification: "compatibility_read",
    target: "organizationRequirementDefinitions",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "settings",
    field: "payrollSettings",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.payrollSettings",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "settings",
    field: "cutoffDates",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.cutoffDates",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "settings",
    field: "attendanceSettings",
    classification: "compatibility_read",
    target: "organizationAttendanceSettings.attendanceSettings",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "settings",
    field: "departments",
    classification: "compatibility_read",
    target: "organizationDepartments",
    releaseGate: "release_3_zero_legacy_fallbacks",
  },
  {
    table: "settings",
    field: "payrollFrequency",
    classification: "removable",
    releaseGate: "production_count_and_export",
  },
  {
    table: "settings",
    field: "taxTable",
    classification: "removable",
    releaseGate: "production_count_and_export",
  },
  {
    table: "settings",
    field: "payrollSettings.payrollTabPassword",
    classification: "removable",
    releaseGate: "production_count_and_export",
  },
  {
    table: "payslips",
    field: "employeeSnapshot",
    classification: "historical_snapshot",
    releaseGate: "preserve",
  },
  {
    table: "payrollRuns",
    field: "draftConfig",
    classification: "historical_snapshot",
    releaseGate: "preserve",
  },
  {
    table: "payrollRuns",
    field: "draftDependencySnapshot",
    classification: "historical_snapshot",
    releaseGate: "preserve",
  },
  {
    table: "payrollRuns",
    field: "summarySnapshot",
    classification: "historical_snapshot",
    releaseGate: "preserve",
  },
  {
    table: "migrationRuns",
    field: "cursor",
    classification: "migration_only",
    releaseGate: "retain_until_all_contract_releases_complete",
  },
] as const satisfies readonly SchemaFieldManifestEntry[];

export const LEAVE_FIELD_MANIFEST = [
  {
    table: "employees",
    field: "leaveCredits",
    classification: "compatibility_read",
    target: "employeeLeaveBalances",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "settings",
    field: "leaveTypes",
    classification: "compatibility_write",
    target: "leavePolicies",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "settings",
    field: "leaveTrackerRows",
    classification: "compatibility_write",
    target: "employeeLeaveBalances",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "settings",
    field: "leaveTrackerByYear",
    classification: "compatibility_write",
    target: "employeeLeaveBalances",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "sourceKey",
    classification: "compatibility_read",
    target: "leavePolicies.sourceKey",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "name",
    classification: "compatibility_read",
    target: "leavePolicies.name",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "maxDays",
    classification: "compatibility_read",
    target: "leavePolicyVersions.annualUnits",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "isPaid",
    classification: "compatibility_read",
    target: "leavePolicyVersions.payTreatment",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "accrualRate",
    classification: "compatibility_read",
    target: "leavePolicyVersions.accrualRate",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "defaultCredits",
    classification: "compatibility_read",
    target: "leavePolicyVersions.annualUnits",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "maxConsecutiveDays",
    classification: "compatibility_read",
    target: "leavePolicyVersions.maximumConsecutiveUnits",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "carryOver",
    classification: "compatibility_read",
    target: "leavePolicyVersions.carryoverMode",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveTypes",
    field: "maxCarryOver",
    classification: "compatibility_read",
    target: "leavePolicyVersions.carryoverCap",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "leaveType",
    classification: "compatibility_read",
    target: "leaveRequests.policyId",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "customLeaveType",
    classification: "compatibility_read",
    target: "leaveRequests.policyId",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "startDate",
    classification: "compatibility_read",
    target: "leaveRequests.requestedStart",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "endDate",
    classification: "compatibility_read",
    target: "leaveRequests.requestedEnd",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "numberOfDays",
    classification: "compatibility_read",
    target: "leaveRequests.chargeableDuration",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "isPaid",
    classification: "compatibility_read",
    target: "leaveRequests.payTreatment",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "filedDate",
    classification: "compatibility_read",
    target: "leaveRequests.createdAt",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "reviewedBy",
    classification: "compatibility_read",
    target: "leaveRequests.reviewerId",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "reviewedDate",
    classification: "compatibility_read",
    target: "leaveRequests.reviewedAt",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "remarks",
    classification: "compatibility_read",
    target: "leaveRequests.decisionReason",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "approvedByName",
    classification: "compatibility_read",
    target: "leaveRequests.reviewerSnapshot.displayName",
    releaseGate: "leave_v2_cutover_complete",
  },
  {
    table: "leaveRequests",
    field: "reviewerPosition",
    classification: "compatibility_read",
    target: "leaveRequests.reviewerSnapshot.position",
    releaseGate: "leave_v2_cutover_complete",
  },
] as const satisfies readonly SchemaFieldManifestEntry[];
