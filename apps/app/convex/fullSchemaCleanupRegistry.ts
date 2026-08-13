import type { FullSchemaCleanupDomain as FullSchemaPolicyDomain } from "./fullSchemaInventory";

export type { FullSchemaCleanupDomain as FullSchemaPolicyDomain } from "./fullSchemaInventory";

export const FULL_SCHEMA_CLEANUP_PROGRAM_KEY =
  "convex-full-schema-cleanup" as const;
export const FULL_SCHEMA_CLEANUP_PROGRAM_VERSION = 1 as const;

type FullSchemaCleanupDomainRegistration = {
  domain: string;
  migrationKey: string;
  migrationVersion: number;
  implementation: "compatibility" | "migration" | "not_started";
  policyDomains: readonly FullSchemaPolicyDomain[];
};

export const FULL_SCHEMA_CLEANUP_DOMAINS = [
  {
    domain: "organization_configuration",
    migrationKey: "schema-normalization-release-1",
    migrationVersion: 1,
    implementation: "compatibility",
    policyDomains: [
      "organization_configuration",
      "migration_control",
      "marketing_intake",
    ],
  },
  {
    domain: "identity_credentials",
    migrationKey: "full-schema-identity-credentials",
    migrationVersion: 1,
    implementation: "migration",
    policyDomains: ["identity_membership", "employee_core_credentials"],
  },
  {
    domain: "leave_employee_children",
    migrationKey: "full-schema-leave-employee-children",
    migrationVersion: 1,
    implementation: "migration",
    policyDomains: ["leave", "time_holidays", "employee_children"],
  },
  {
    domain: "workflow_events",
    migrationKey: "full-schema-workflow-events",
    migrationVersion: 1,
    implementation: "migration",
    policyDomains: ["performance", "recruitment"],
  },
  {
    domain: "communications_documents",
    migrationKey: "full-schema-communications-documents",
    migrationVersion: 1,
    implementation: "not_started",
    policyDomains: [
      "storage",
      "notifications",
      "announcements_memos",
      "chat",
      "documents",
    ],
  },
  {
    domain: "assets_payroll_compatibility",
    migrationKey: "full-schema-assets-payroll",
    migrationVersion: 1,
    implementation: "not_started",
    policyDomains: ["payroll_offboarding", "accounting", "assets"],
  },
] as const satisfies readonly FullSchemaCleanupDomainRegistration[];

export type FullSchemaCleanupDomain =
  (typeof FULL_SCHEMA_CLEANUP_DOMAINS)[number]["domain"];

export type FullSchemaDomainReadiness = {
  domain: FullSchemaCleanupDomain;
  status: "ready" | "not_started" | "running" | "failed" | "blocked" | "stale";
  migrationKey: string;
  migrationVersion: number;
  blockers: string[];
  auditId?: string;
  auditedAt?: number;
};
