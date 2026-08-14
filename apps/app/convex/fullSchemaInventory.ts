import { LEAVE_FIELD_MANIFEST } from "./schemaFieldManifest";

export type FullSchemaCleanupDomain =
  | "organization_configuration"
  | "migration_control"
  | "marketing_intake"
  | "identity_membership"
  | "storage"
  | "notifications"
  | "employee_core_credentials"
  | "employee_children"
  | "time_holidays"
  | "payroll_offboarding"
  | "performance"
  | "leave"
  | "recruitment"
  | "announcements_memos"
  | "chat"
  | "documents"
  | "accounting"
  | "assets";

export type SchemaItemClassification =
  | "canonical_row"
  | "canonical_embedded"
  | "normalized_target"
  | "compatibility_read"
  | "compatibility_write"
  | "historical_snapshot"
  | "migration_only"
  | "removable";

export type SchemaTablePolicy = {
  domain: FullSchemaCleanupDomain;
  disposition: "retain" | "normalize_children" | "contract_legacy";
  defaultFieldClassification: SchemaItemClassification;
  defaultIndexClassification: "retain" | "verify_usage" | "remove_after_gate";
  releaseGate: string;
};

export type SchemaFieldPolicy = {
  classification: SchemaItemClassification;
  target?: string;
  releaseGate: string;
};

export type SchemaFieldOverride = SchemaFieldPolicy & {
  table: CurrentSchemaTable;
  field: string;
};

export type SchemaIndexPolicy = {
  classification: SchemaTablePolicy["defaultIndexClassification"];
  releaseGate: string;
};

export type SchemaIndexOverride = SchemaIndexPolicy & {
  table: CurrentSchemaTable;
  index: string;
};

export const CURRENT_SCHEMA_TABLES = [
  "organizations",
  "organizationPayrollSettings",
  "organizationAttendanceSettings",
  "organizationDepartments",
  "organizationRequirementDefinitions",
  "migrationRuns",
  "migrationIssues",
  "migrationAudits",
  "demoRequests",
  "users",
  "userOrganizations",
  "storageUploadIntents",
  "applicantUploadIntents",
  "storageObjects",
  "storageObjectLinks",
  "notifications",
  "employees",
  "organizationLeaveSettings",
  "employeeLeaveBalances",
  "employeeLifecycleEvents",
  "employeeRequirements",
  "employeeRequirementEvents",
  "employeeDeductions",
  "employeeIncentives",
  "employeeScheduleOverrides",
  "employeePaymentAccounts",
  "organizationCustomFieldDefinitions",
  "employeeCustomFieldValues",
  "payslipCredentials",
  "payslipPinResets",
  "payslipPinAttempts",
  "employeeScheduleHistory",
  "attendance",
  "attendanceAuditLogs",
  "shifts",
  "holidays",
  "payrollRuns",
  "payrollRunNotes",
  "finalSettlements",
  "payslips",
  "payslipCorrections",
  "evaluationTemplates",
  "evaluationSchedules",
  "evaluations",
  "evaluationReviewers",
  "evaluationEvents",
  "leavePolicies",
  "leavePolicyVersions",
  "leaveLedgerEntries",
  "leaveMigrationRuns",
  "leaveMigrationBalanceSnapshots",
  "leaveMigrationRequestSnapshots",
  "leaveRequests",
  "leaveRequestOccurrences",
  "leaveRequestEvents",
  "employeeLeaveQualifications",
  "leaveBenefitEvents",
  "leaveBenefitPayrollReconciliations",
  "leaveBenefitPayrollAllocations",
  "leaveSensitiveAccessGrants",
  "leaveAdministrativeEvents",
  "leaveConversionRequests",
  "leaveTypes",
  "jobs",
  "applicants",
  "applicantStageEvents",
  "applicantNotes",
  "applicantInterviews",
  "applicantScorecards",
  "applicantOfferEvents",
  "applicantCustomFieldValues",
  "memoTemplates",
  "memos",
  "memoReactions",
  "memoAcknowledgements",
  "memoAudienceMembers",
  "announcementComments",
  "announcementLastSeen",
  "settings",
  "organizationUiSettings",
  "organizationSettingsEvents",
  "conversations",
  "conversationMembers",
  "messages",
  "messageReactions",
  "messageReceipts",
  "userChatPreferences",
  "userPinnedConversations",
  "userConversationPreferences",
  "invitations",
  "documents",
  "documentAccessGrants",
  "documentVersions",
  "accountingCostItems",
  "assets",
  "assetCustodyEvents",
  "assetMaintenanceEvents",
] as const;

export type CurrentSchemaTable = (typeof CURRENT_SCHEMA_TABLES)[number];

const tablePolicy = (
  domain: FullSchemaCleanupDomain,
  disposition: SchemaTablePolicy["disposition"],
  defaultFieldClassification: SchemaItemClassification,
  releaseGate = "release_3b_full_schema_contract",
): SchemaTablePolicy => ({
  domain,
  disposition,
  defaultFieldClassification,
  defaultIndexClassification: "verify_usage",
  releaseGate,
});

export const FULL_SCHEMA_TABLE_POLICIES = {
  organizations: tablePolicy(
    "organization_configuration",
    "contract_legacy",
    "canonical_embedded",
  ),
  organizationPayrollSettings: tablePolicy(
    "organization_configuration",
    "retain",
    "canonical_embedded",
  ),
  organizationAttendanceSettings: tablePolicy(
    "organization_configuration",
    "retain",
    "canonical_embedded",
  ),
  organizationDepartments: tablePolicy(
    "organization_configuration",
    "retain",
    "canonical_row",
  ),
  organizationRequirementDefinitions: tablePolicy(
    "organization_configuration",
    "retain",
    "canonical_row",
  ),
  migrationRuns: tablePolicy(
    "migration_control",
    "retain",
    "migration_only",
    "retain_until_all_contract_releases_complete",
  ),
  migrationIssues: tablePolicy(
    "migration_control",
    "retain",
    "migration_only",
    "retain_until_all_contract_releases_complete",
  ),
  migrationAudits: tablePolicy(
    "migration_control",
    "retain",
    "migration_only",
    "retain_until_all_contract_releases_complete",
  ),
  demoRequests: tablePolicy("marketing_intake", "retain", "canonical_row"),
  users: tablePolicy("identity_membership", "contract_legacy", "canonical_row"),
  userOrganizations: tablePolicy(
    "identity_membership",
    "retain",
    "canonical_row",
  ),
  storageUploadIntents: tablePolicy("storage", "retain", "canonical_row"),
  applicantUploadIntents: tablePolicy("storage", "retain", "canonical_row"),
  storageObjects: tablePolicy("storage", "retain", "canonical_row"),
  storageObjectLinks: tablePolicy("storage", "retain", "normalized_target"),
  notifications: tablePolicy("notifications", "retain", "canonical_row"),
  employees: tablePolicy(
    "employee_core_credentials",
    "normalize_children",
    "canonical_embedded",
  ),
  organizationLeaveSettings: tablePolicy(
    "leave",
    "retain",
    "normalized_target",
  ),
  employeeLeaveBalances: tablePolicy("leave", "retain", "normalized_target"),
  employeeLifecycleEvents: tablePolicy(
    "employee_children",
    "retain",
    "historical_snapshot",
  ),
  employeeRequirements: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  employeeRequirementEvents: tablePolicy(
    "employee_children",
    "retain",
    "historical_snapshot",
  ),
  employeeDeductions: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  employeeIncentives: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  employeeScheduleOverrides: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  employeePaymentAccounts: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  organizationCustomFieldDefinitions: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  employeeCustomFieldValues: tablePolicy(
    "employee_children",
    "retain",
    "normalized_target",
  ),
  payslipCredentials: tablePolicy(
    "employee_core_credentials",
    "retain",
    "normalized_target",
  ),
  payslipPinResets: tablePolicy(
    "employee_core_credentials",
    "retain",
    "canonical_row",
  ),
  payslipPinAttempts: tablePolicy(
    "employee_core_credentials",
    "retain",
    "canonical_row",
  ),
  employeeScheduleHistory: tablePolicy(
    "employee_core_credentials",
    "retain",
    "canonical_embedded",
  ),
  attendance: tablePolicy("time_holidays", "contract_legacy", "canonical_row"),
  attendanceAuditLogs: tablePolicy(
    "time_holidays",
    "retain",
    "historical_snapshot",
  ),
  shifts: tablePolicy("time_holidays", "retain", "canonical_embedded"),
  holidays: tablePolicy("time_holidays", "retain", "canonical_embedded"),
  payrollRuns: tablePolicy(
    "payroll_offboarding",
    "normalize_children",
    "canonical_embedded",
  ),
  payrollRunNotes: tablePolicy(
    "payroll_offboarding",
    "retain",
    "normalized_target",
  ),
  finalSettlements: tablePolicy(
    "payroll_offboarding",
    "retain",
    "canonical_embedded",
  ),
  payslips: tablePolicy(
    "payroll_offboarding",
    "contract_legacy",
    "canonical_embedded",
  ),
  payslipCorrections: tablePolicy(
    "payroll_offboarding",
    "retain",
    "historical_snapshot",
  ),
  evaluationTemplates: tablePolicy(
    "performance",
    "retain",
    "canonical_embedded",
  ),
  evaluationSchedules: tablePolicy(
    "performance",
    "retain",
    "canonical_row",
  ),
  evaluations: tablePolicy(
    "performance",
    "normalize_children",
    "canonical_embedded",
  ),
  evaluationReviewers: tablePolicy(
    "performance",
    "retain",
    "normalized_target",
  ),
  evaluationEvents: tablePolicy("performance", "retain", "normalized_target"),
  leavePolicies: tablePolicy("leave", "retain", "canonical_row"),
  leavePolicyVersions: tablePolicy("leave", "retain", "canonical_row"),
  leaveLedgerEntries: tablePolicy("leave", "retain", "canonical_row"),
  leaveMigrationRuns: tablePolicy("leave", "retain", "migration_only"),
  leaveMigrationBalanceSnapshots: tablePolicy(
    "leave",
    "retain",
    "migration_only",
  ),
  leaveMigrationRequestSnapshots: tablePolicy(
    "leave",
    "retain",
    "historical_snapshot",
  ),
  leaveRequests: tablePolicy("leave", "normalize_children", "canonical_row"),
  leaveRequestOccurrences: tablePolicy("leave", "retain", "canonical_row"),
  leaveRequestEvents: tablePolicy("leave", "retain", "canonical_row"),
  employeeLeaveQualifications: tablePolicy(
    "leave",
    "retain",
    "canonical_row",
  ),
  leaveBenefitEvents: tablePolicy("leave", "retain", "canonical_row"),
  leaveBenefitPayrollReconciliations: tablePolicy(
    "leave",
    "retain",
    "canonical_row",
  ),
  leaveBenefitPayrollAllocations: tablePolicy(
    "leave",
    "retain",
    "canonical_row",
  ),
  leaveSensitiveAccessGrants: tablePolicy(
    "leave",
    "retain",
    "canonical_row",
  ),
  leaveAdministrativeEvents: tablePolicy("leave", "retain", "canonical_row"),
  leaveConversionRequests: tablePolicy("leave", "retain", "canonical_row"),
  leaveTypes: tablePolicy("leave", "retain", "canonical_embedded"),
  jobs: tablePolicy("recruitment", "retain", "canonical_embedded"),
  applicants: tablePolicy(
    "recruitment",
    "normalize_children",
    "canonical_embedded",
  ),
  applicantStageEvents: tablePolicy(
    "recruitment",
    "retain",
    "normalized_target",
  ),
  applicantNotes: tablePolicy("recruitment", "retain", "normalized_target"),
  applicantInterviews: tablePolicy(
    "recruitment",
    "retain",
    "normalized_target",
  ),
  applicantScorecards: tablePolicy(
    "recruitment",
    "retain",
    "normalized_target",
  ),
  applicantOfferEvents: tablePolicy(
    "recruitment",
    "retain",
    "normalized_target",
  ),
  applicantCustomFieldValues: tablePolicy(
    "recruitment",
    "retain",
    "normalized_target",
  ),
  memoTemplates: tablePolicy(
    "announcements_memos",
    "retain",
    "canonical_embedded",
  ),
  memos: tablePolicy(
    "announcements_memos",
    "normalize_children",
    "canonical_embedded",
  ),
  memoReactions: tablePolicy(
    "announcements_memos",
    "retain",
    "normalized_target",
  ),
  memoAcknowledgements: tablePolicy(
    "announcements_memos",
    "retain",
    "normalized_target",
  ),
  memoAudienceMembers: tablePolicy(
    "announcements_memos",
    "retain",
    "normalized_target",
  ),
  announcementComments: tablePolicy(
    "announcements_memos",
    "retain",
    "canonical_row",
  ),
  announcementLastSeen: tablePolicy(
    "announcements_memos",
    "retain",
    "canonical_row",
  ),
  settings: tablePolicy(
    "organization_configuration",
    "normalize_children",
    "canonical_embedded",
  ),
  organizationUiSettings: tablePolicy(
    "organization_configuration",
    "retain",
    "normalized_target",
  ),
  organizationSettingsEvents: tablePolicy(
    "organization_configuration",
    "retain",
    "normalized_target",
  ),
  conversations: tablePolicy(
    "chat",
    "normalize_children",
    "canonical_embedded",
  ),
  conversationMembers: tablePolicy("chat", "retain", "normalized_target"),
  messages: tablePolicy("chat", "normalize_children", "canonical_embedded"),
  messageReactions: tablePolicy("chat", "retain", "normalized_target"),
  messageReceipts: tablePolicy("chat", "retain", "normalized_target"),
  userChatPreferences: tablePolicy(
    "chat",
    "normalize_children",
    "canonical_embedded",
  ),
  userPinnedConversations: tablePolicy(
    "chat",
    "retain",
    "normalized_target",
  ),
  userConversationPreferences: tablePolicy(
    "chat",
    "retain",
    "normalized_target",
  ),
  invitations: tablePolicy(
    "identity_membership",
    "contract_legacy",
    "canonical_row",
  ),
  documents: tablePolicy(
    "documents",
    "normalize_children",
    "canonical_embedded",
  ),
  documentAccessGrants: tablePolicy("documents", "retain", "normalized_target"),
  documentVersions: tablePolicy("documents", "retain", "historical_snapshot"),
  accountingCostItems: tablePolicy(
    "accounting",
    "normalize_children",
    "canonical_embedded",
  ),
  assets: tablePolicy("assets", "normalize_children", "canonical_embedded"),
  assetCustodyEvents: tablePolicy("assets", "retain", "normalized_target"),
  assetMaintenanceEvents: tablePolicy("assets", "retain", "normalized_target"),
} as const satisfies Record<CurrentSchemaTable, SchemaTablePolicy>;

const override = (
  table: CurrentSchemaTable,
  field: string,
  classification: SchemaItemClassification,
  target: string | undefined,
  releaseGate: string,
): SchemaFieldOverride => ({
  table,
  field,
  classification,
  target,
  releaseGate,
});

export const FULL_SCHEMA_FIELD_OVERRIDES = [
  ...LEAVE_FIELD_MANIFEST.map((entry) =>
    override(
      entry.table as CurrentSchemaTable,
      entry.field,
      entry.classification,
      entry.target,
      entry.releaseGate,
    ),
  ),
  override(
    "organizations",
    "firstPayDate",
    "compatibility_read",
    "organizationPayrollSettings.firstPayDate",
    "release_3b_organization_contract",
  ),
  override(
    "organizations",
    "secondPayDate",
    "compatibility_read",
    "organizationPayrollSettings.secondPayDate",
    "release_3b_organization_contract",
  ),
  override(
    "organizations",
    "salaryPaymentFrequency",
    "compatibility_read",
    "organizationPayrollSettings.salaryPaymentFrequency",
    "release_3b_organization_contract",
  ),
  override(
    "organizations",
    "defaultRequirements",
    "compatibility_read",
    "organizationRequirementDefinitions",
    "release_3b_organization_contract",
  ),
  override(
    "users",
    "organizationId",
    "compatibility_read",
    "userOrganizations.organizationId",
    "release_3b_identity_contract",
  ),
  override(
    "users",
    "role",
    "compatibility_read",
    "userOrganizations.role",
    "release_3b_identity_contract",
  ),
  override(
    "users",
    "employeeId",
    "compatibility_read",
    "userOrganizations.employeeId",
    "release_3b_identity_contract",
  ),
  override(
    "users",
    "isActive",
    "compatibility_read",
    "userOrganizations.accessStatus",
    "release_3b_identity_contract",
  ),
  override(
    "invitations",
    "token",
    "compatibility_read",
    "invitations.tokenHash",
    "release_3b_identity_contract",
  ),
  override(
    "employees",
    "compensation.paymentFrequency",
    "removable",
    undefined,
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "compensation.bankDetails",
    "compatibility_write",
    "employeePaymentAccounts",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "schedule.scheduleOverrides",
    "compatibility_write",
    "employeeScheduleOverrides",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "requirements",
    "compatibility_write",
    "employeeRequirements",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "deductions",
    "compatibility_write",
    "employeeDeductions",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "incentives",
    "compatibility_write",
    "employeeIncentives",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "customFields",
    "compatibility_write",
    "employeeCustomFieldValues",
    "release_3b_employee_contract",
  ),
  override(
    "employees",
    "payslipPinHash",
    "compatibility_read",
    "payslipCredentials.credentialHash",
    "release_3b_credentials_contract",
  ),
  override(
    "employees",
    "payslipPdfPassword",
    "removable",
    undefined,
    "release_3b_credentials_contract",
  ),
  override(
    "attendance",
    "status",
    "compatibility_read",
    "attendance.status",
    "release_3b_attendance_contract",
  ),
  override(
    "payrollRuns",
    "notes",
    "compatibility_write",
    "payrollRunNotes",
    "release_3b_payroll_contract",
  ),
  override(
    "assets",
    "assignedEmployeeId",
    "compatibility_write",
    "assetCustodyEvents.employeeId",
    "release_3b_assets_contract",
  ),
  override(
    "assets",
    "assignedAt",
    "compatibility_write",
    "assetCustodyEvents.occurredAt",
    "release_3b_assets_contract",
  ),
  override(
    "assets",
    "assignedBy",
    "compatibility_write",
    "assetCustodyEvents.actorUserId",
    "release_3b_assets_contract",
  ),
  override(
    "assets",
    "custodyAcknowledgedAt",
    "compatibility_write",
    "assetCustodyEvents.occurredAt",
    "release_3b_assets_contract",
  ),
  override(
    "assets",
    "returnDueDate",
    "compatibility_write",
    "assetCustodyEvents.returnDueDate",
    "release_3b_assets_contract",
  ),
  override(
    "assets",
    "returnedAt",
    "compatibility_write",
    "assetCustodyEvents.occurredAt",
    "release_3b_assets_contract",
  ),
  override(
    "payrollRuns",
    "draftConfig",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payrollRuns",
    "draftDependencySnapshot",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payrollRuns",
    "summarySnapshot",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "finalSettlements",
    "clearanceItems",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "finalSettlements",
    "loanPayoffs",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "finalSettlements",
    "customDeductions",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "finalSettlements",
    "bir2316",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "finalSettlements",
    "finalTaxRelease",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "employeeSnapshot",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "deductions",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "incentives",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "nightDiffBreakdown",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "employerContributions",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "grossPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "basicPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "nonTaxableAllowance",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override("payslips", "netPay", "historical_snapshot", undefined, "preserve"),
  override(
    "payslips",
    "daysWorked",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "absences",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "lateHours",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "undertimeHours",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeHours",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "holidayPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "regularHolidayPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "specialHolidayPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "restDayPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "nightDiffPay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeRegular",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeRestDay",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeRestDayExcess",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeSpecialHoliday",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeSpecialHolidayExcess",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeLegalHoliday",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "overtimeLegalHolidayExcess",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "pendingDeductions",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "noWorkNoPayDays",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "payslips",
    "editHistory",
    "compatibility_read",
    "payslipCorrections",
    "release_3b_payroll_contract",
  ),
  override(
    "evaluations",
    "frequencyMonths",
    "removable",
    undefined,
    "release_3b_workflow_contract",
  ),
  override(
    "evaluations",
    "assignedReviewerIds",
    "compatibility_write",
    "evaluationReviewers",
    "release_3b_workflow_contract",
  ),
  override(
    "evaluations",
    "history",
    "compatibility_write",
    "evaluationEvents",
    "release_3b_workflow_contract",
  ),
  override(
    "settings",
    "cutoffDates",
    "compatibility_write",
    "organizationPayrollSettings.cutoffDates",
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "payrollSettings",
    "compatibility_write",
    "organizationPayrollSettings.payrollSettings",
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "attendanceSettings",
    "compatibility_write",
    "organizationAttendanceSettings.attendanceSettings",
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "departments",
    "compatibility_write",
    "organizationDepartments",
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "payrollFrequency",
    "removable",
    undefined,
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "taxTable",
    "removable",
    undefined,
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "payrollSettings.payrollTabPassword",
    "removable",
    undefined,
    "release_3b_organization_contract",
  ),
  override(
    "settings",
    "proratedLeave",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "leaveAccrualFrequency",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "leaveTrackerMode",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "enableAnniversaryLeave",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "anniversaryLeaveMaxDays",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "maxConvertibleLeaveDays",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "annualSil",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "grantLeaveUponRegularization",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "paidLeaveRequiresRegularization",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "leaveGuidelines",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "leaveRequestFormTemplate",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "leaveRequestPdfLayout",
    "compatibility_write",
    "organizationLeaveSettings",
    "release_3b_leave_contract",
  ),
  override(
    "settings",
    "evaluationColumns",
    "compatibility_write",
    "organizationUiSettings",
    "release_3b_ui_contract",
  ),
  override(
    "settings",
    "recruitmentTableColumns",
    "compatibility_write",
    "organizationUiSettings",
    "release_3b_ui_contract",
  ),
  override(
    "settings",
    "requirementsTableColumns",
    "compatibility_write",
    "organizationUiSettings",
    "release_3b_ui_contract",
  ),
  override(
    "settings",
    "leaveTableColumns",
    "compatibility_write",
    "organizationUiSettings",
    "release_3b_ui_contract",
  ),
  override(
    "settings",
    "settingsVersion",
    "compatibility_write",
    "organizationSettingsEvents",
    "release_3b_ui_contract",
  ),
  override(
    "settings",
    "settingsChangeLog",
    "compatibility_write",
    "organizationSettingsEvents",
    "release_3b_ui_contract",
  ),
  override(
    "applicants",
    "pipelineStageHistory",
    "compatibility_write",
    "applicantStageEvents",
    "release_3b_workflow_contract",
  ),
  override(
    "applicants",
    "notes",
    "compatibility_write",
    "applicantNotes",
    "release_3b_workflow_contract",
  ),
  override(
    "applicants",
    "interviewSchedules",
    "compatibility_write",
    "applicantInterviews",
    "release_3b_workflow_contract",
  ),
  override(
    "applicants",
    "scorecards",
    "compatibility_write",
    "applicantScorecards",
    "release_3b_workflow_contract",
  ),
  override(
    "applicants",
    "offerApproval",
    "compatibility_write",
    "applicantOfferEvents",
    "release_3b_workflow_contract",
  ),
  override(
    "applicants",
    "customFields",
    "compatibility_write",
    "applicantCustomFieldValues",
    "release_3b_workflow_contract",
  ),
  override(
    "memos",
    "reactions",
    "compatibility_write",
    "memoReactions",
    "release_3b_communications_contract",
  ),
  override(
    "memos",
    "acknowledgedBy",
    "compatibility_write",
    "memoAcknowledgements",
    "release_3b_communications_contract",
  ),
  override(
    "memos",
    "specificEmployees",
    "compatibility_write",
    "memoAudienceMembers",
    "release_3b_communications_contract",
  ),
  override(
    "memos",
    "departments",
    "compatibility_write",
    "memoAudienceMembers",
    "release_3b_communications_contract",
  ),
  override(
    "memos",
    "attachments",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "memos",
    "attachmentContentTypes",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "conversations",
    "participants",
    "compatibility_write",
    "conversationMembers",
    "release_3b_communications_contract",
  ),
  override(
    "messages",
    "readBy",
    "compatibility_write",
    "messageReceipts",
    "release_3b_communications_contract",
  ),
  override(
    "messages",
    "attachments",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "userChatPreferences",
    "pinnedConversations",
    "compatibility_write",
    "userPinnedConversations",
    "release_3b_communications_contract",
  ),
  override(
    "leaveRequests",
    "supportingDocuments",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "documents",
    "attachments",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "documents",
    "sharedWith",
    "compatibility_write",
    "documentAccessGrants",
    "release_3b_documents_contract",
  ),
  override(
    "documents",
    "visibleDepartments",
    "compatibility_write",
    "documentAccessGrants",
    "release_3b_documents_contract",
  ),
  override(
    "documents",
    "visibleEmployeeIds",
    "compatibility_write",
    "documentAccessGrants",
    "release_3b_documents_contract",
  ),
  override(
    "documentVersions",
    "title",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "documentVersions",
    "content",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "accountingCostItems",
    "breakdown",
    "historical_snapshot",
    undefined,
    "preserve",
  ),
  override(
    "accountingCostItems",
    "receipts",
    "compatibility_write",
    "storageObjectLinks",
    "release_3b_storage_contract",
  ),
  override(
    "assets",
    "maintenanceHistory",
    "compatibility_write",
    "assetMaintenanceEvents",
    "release_3b_assets_contract",
  ),
] as const satisfies readonly SchemaFieldOverride[];

export const FULL_SCHEMA_INDEX_OVERRIDES: readonly SchemaIndexOverride[] = [];

const matchesPath = (path: string, override: string) =>
  path === override || path.startsWith(`${override}.`);

const longestMatchingFieldOverride = (
  table: CurrentSchemaTable,
  field: string,
) =>
  FULL_SCHEMA_FIELD_OVERRIDES.filter(
    (override) =>
      override.table === table && matchesPath(field, override.field),
  ).reduce<SchemaFieldOverride | undefined>(
    (longest, override) =>
      !longest || override.field.length > longest.field.length
        ? override
        : longest,
    undefined,
  );

export const resolveSchemaFieldPolicy = (
  table: string,
  field: string,
): SchemaFieldPolicy | null => {
  if (!Object.hasOwn(FULL_SCHEMA_TABLE_POLICIES, table)) {
    return null;
  }

  const currentTable = table as CurrentSchemaTable;
  const override = longestMatchingFieldOverride(currentTable, field);
  if (override) {
    return override;
  }

  const policy = FULL_SCHEMA_TABLE_POLICIES[currentTable];
  return {
    classification: policy.defaultFieldClassification,
    releaseGate: policy.releaseGate,
  };
};

export const resolveSchemaIndexPolicy = (
  table: string,
  index: string,
): SchemaIndexPolicy | null => {
  if (!Object.hasOwn(FULL_SCHEMA_TABLE_POLICIES, table)) {
    return null;
  }

  const currentTable = table as CurrentSchemaTable;
  const override = FULL_SCHEMA_INDEX_OVERRIDES.find(
    (candidate) =>
      candidate.table === currentTable && candidate.index === index,
  );
  if (override) {
    return override;
  }

  const policy = FULL_SCHEMA_TABLE_POLICIES[currentTable];
  return {
    classification: policy.defaultIndexClassification,
    releaseGate: policy.releaseGate,
  };
};
