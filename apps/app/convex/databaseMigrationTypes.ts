export const SCHEMA_CLEANUP_MIGRATION_KEY =
  "schema-normalization-release-1" as const;
export const SCHEMA_CLEANUP_VERSION = 1 as const;

export type SchemaCleanupIssueCode =
  | "PAYROLL_FREQUENCY_CONFLICT"
  | "UNSUPPORTED_PAYROLL_FREQUENCY"
  | "DUPLICATE_DEPARTMENT_NAME"
  | "DUPLICATE_REQUIREMENT_TYPE"
  | "DUPLICATE_SETTINGS_ROWS"
  | "DESTINATION_VALUE_CONFLICT"
  | "DUPLICATE_DESTINATION_ROWS"
  | "UNEXPECTED_DESTINATION_ROWS"
  | "INVALID_DEPARTMENT_HEAD_MEMBERSHIP";

export type SchemaCleanupIssue = {
  code: SchemaCleanupIssueCode;
  field: string;
};

export type SchemaCleanupCounters = {
  scanned: number;
  changed: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  errors: number;
};

export const EMPTY_SCHEMA_CLEANUP_COUNTERS: SchemaCleanupCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};
