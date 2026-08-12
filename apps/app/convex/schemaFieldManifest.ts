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
