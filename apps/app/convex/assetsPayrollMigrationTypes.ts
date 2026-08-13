export type AssetsPayrollMigrationIssueCode =
  | "ORGANIZATION_NOT_FOUND"
  | "PAYROLL_RUN_USER_TENANT_MISMATCH"
  | "PAYROLL_NOTE_EMPLOYEE_TENANT_MISMATCH"
  | "DUPLICATE_PAYROLL_NOTE"
  | "PAYROLL_NOTE_MISMATCH"
  | "STORAGE_OBJECT_NOT_FOUND"
  | "STORAGE_OBJECT_TENANT_MISMATCH"
  | "STORAGE_OBJECT_PURPOSE_MISMATCH"
  | "DUPLICATE_ACCOUNTING_RECEIPT_LINK"
  | "ACCOUNTING_RECEIPT_LINK_MISMATCH"
  | "ASSET_EMPLOYEE_TENANT_MISMATCH"
  | "ASSET_USER_TENANT_MISMATCH"
  | "INVALID_ASSET_CUSTODY_STATE"
  | "DUPLICATE_ASSET_CUSTODY_EVENT"
  | "ASSET_CUSTODY_EVENT_MISMATCH"
  | "DUPLICATE_ASSET_MAINTENANCE_EVENT"
  | "ASSET_MAINTENANCE_EVENT_MISMATCH"
  | "UNEXPECTED_DESTINATION_ROW";

export type AssetsPayrollMigrationIssue = {
  code: AssetsPayrollMigrationIssueCode;
  field: string;
};

export type AssetsPayrollProjectionPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "conflict"; issues: AssetsPayrollMigrationIssue[] };

export type AssetCustodyProjection = {
  sourceIndex: number;
  eventType: "assigned" | "acknowledged" | "returned";
  employeeId?: string;
  actorUserId?: string;
  occurredAt: number;
  returnDueDate?: number;
};

export type AssetCustodyPlan =
  | { outcome: "valid"; events: AssetCustodyProjection[] }
  | { outcome: "conflict"; issues: AssetsPayrollMigrationIssue[] };
