export type LeaveEmployeeMigrationIssueCode =
  | "DUPLICATE_LEAVE_SETTINGS"
  | "LEAVE_SETTINGS_MISMATCH"
  | "DUPLICATE_LEAVE_TYPE"
  | "LEAVE_TYPE_MISMATCH"
  | "DUPLICATE_LEAVE_BALANCE"
  | "LEAVE_BALANCE_MISMATCH"
  | "LEAVE_BALANCE_RECONCILIATION_MISMATCH"
  | "DUPLICATE_REQUIREMENT"
  | "REQUIREMENT_MISMATCH"
  | "DUPLICATE_DEDUCTION"
  | "DEDUCTION_MISMATCH"
  | "DUPLICATE_INCENTIVE"
  | "INCENTIVE_MISMATCH"
  | "DUPLICATE_SCHEDULE_OVERRIDE"
  | "SCHEDULE_OVERRIDE_MISMATCH"
  | "DUPLICATE_PAYMENT_ACCOUNT"
  | "PAYMENT_ACCOUNT_MISMATCH"
  | "DUPLICATE_CUSTOM_FIELD_DEFINITION"
  | "CUSTOM_FIELD_DEFINITION_MISMATCH"
  | "DUPLICATE_CUSTOM_FIELD_VALUE"
  | "CUSTOM_FIELD_VALUE_MISMATCH"
  | "CUSTOM_FIELD_VALUE_UNSUPPORTED"
  | "EMPLOYEE_ORGANIZATION_MISMATCH"
  | "TRACKER_EMPLOYEE_NOT_FOUND"
  | "TRACKER_EMPLOYEE_ORGANIZATION_MISMATCH"
  | "DUPLICATE_LEGACY_TRACKER_ROW"
  | "APPROVED_LEAVE_ORGANIZATION_MISMATCH"
  | "APPROVED_LEAVE_SCAN_LIMIT_EXCEEDED"
  | "SETTINGS_ORGANIZATION_NOT_FOUND"
  | "DUPLICATE_SETTINGS"
  | "LEAVE_TYPE_SCAN_LIMIT_EXCEEDED"
  | "DUPLICATE_REQUIREMENT_DEFINITION"
  | "UNEXPECTED_DESTINATION_ROW";

export type LeaveEmployeeMigrationIssue = {
  code: LeaveEmployeeMigrationIssueCode;
  field: string;
};

export type ProjectionPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "skipped" }
  | { outcome: "conflict"; issues: LeaveEmployeeMigrationIssue[] };

export type LeaveBalanceProjection = {
  organizationId: string;
  employeeId: string;
  year: number;
  leaveTypeKey: string;
  total: number;
  used: number;
  balance: number;
  source: "employee_credits" | "legacy_tracker" | "yearly_tracker";
  annualSilOverride?: number;
  overrideReason?: string;
  updatedBy?: string;
  approvedDays: number;
  reconciliationStatus: "matching" | "mismatched" | "not_applicable";
  migrationVersion: number;
};

export type CustomFieldValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export type CustomFieldProjection = {
  sourceKey: string;
  label: string;
  valueType: CustomFieldValueType;
  valueJson: string;
};
