export type SchemaFieldClassification =
  | "canonical"
  | "compatibility_read"
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

export const SCHEMA_FIELD_MANIFEST: readonly SchemaFieldManifestEntry[] = [
  {
    table: "organizations",
    field: "firstPayDate",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.firstPayDate",
    releaseGate: "release_2_read_switch_and_zero_fallbacks",
  },
  {
    table: "organizations",
    field: "secondPayDate",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.secondPayDate",
    releaseGate: "release_2_read_switch_and_zero_fallbacks",
  },
  {
    table: "organizations",
    field: "salaryPaymentFrequency",
    classification: "compatibility_read",
    target: "organizationPayrollSettings.salaryPaymentFrequency",
    releaseGate: "release_2_read_switch_and_zero_fallbacks",
  },
  {
    table: "organizations",
    field: "defaultRequirements",
    classification: "compatibility_read",
    target: "organizationRequirementDefinitions",
    releaseGate: "release_2_read_switch_and_zero_fallbacks",
  },
  {
    table: "settings",
    field: "attendanceSettings",
    classification: "compatibility_read",
    target: "organizationAttendanceSettings.attendanceSettings",
    releaseGate: "release_2_read_switch_and_zero_fallbacks",
  },
  {
    table: "settings",
    field: "departments",
    classification: "compatibility_read",
    target: "organizationDepartments",
    releaseGate: "release_2_stable_department_id_migration",
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
    field: "payrollTabPassword",
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
] as const;

