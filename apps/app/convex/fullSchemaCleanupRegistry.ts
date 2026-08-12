import type { FullSchemaCleanupDomain } from "./fullSchemaInventory";

export type { FullSchemaCleanupDomain } from "./fullSchemaInventory";

export const FULL_SCHEMA_CLEANUP_PROGRAM_KEY =
  "convex-full-schema-cleanup" as const;
export const FULL_SCHEMA_CLEANUP_PROGRAM_VERSION = 1 as const;

type FullSchemaCleanupReleaseWave =
  | "identity_credentials"
  | "leave_employee_children"
  | "workflow_events"
  | "communications_documents"
  | "assets_payroll_compatibility";

type FullSchemaCleanupRegistryDomain =
  | FullSchemaCleanupDomain
  | FullSchemaCleanupReleaseWave;

type FullSchemaCleanupDomainRegistration = {
  domain: FullSchemaCleanupRegistryDomain;
  migrationKey: string;
  migrationVersion: number;
  implementation: "compatibility" | "not_started";
};

export const FULL_SCHEMA_CLEANUP_DOMAINS = [
  {
    domain: "organization_configuration",
    migrationKey: "schema-normalization-release-1",
    migrationVersion: 1,
    implementation: "compatibility",
  },
  {
    domain: "identity_credentials",
    migrationKey: "full-schema-identity-credentials",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "leave_employee_children",
    migrationKey: "full-schema-leave-employee-children",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "workflow_events",
    migrationKey: "full-schema-workflow-events",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "communications_documents",
    migrationKey: "full-schema-communications-documents",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "assets_payroll_compatibility",
    migrationKey: "full-schema-assets-payroll",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "migration_control",
    migrationKey: "full-schema-migration-control",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "marketing_intake",
    migrationKey: "full-schema-marketing-intake",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "identity_membership",
    migrationKey: "full-schema-identity-membership",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "storage",
    migrationKey: "full-schema-storage",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "notifications",
    migrationKey: "full-schema-notifications",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "employee_core_credentials",
    migrationKey: "full-schema-employee-core-credentials",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "time_holidays",
    migrationKey: "full-schema-time-holidays",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "payroll_offboarding",
    migrationKey: "full-schema-payroll-offboarding",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "performance",
    migrationKey: "full-schema-performance",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "leave",
    migrationKey: "full-schema-leave",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "recruitment",
    migrationKey: "full-schema-recruitment",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "announcements_memos",
    migrationKey: "full-schema-announcements-memos",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "chat",
    migrationKey: "full-schema-chat",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "documents",
    migrationKey: "full-schema-documents",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "accounting",
    migrationKey: "full-schema-accounting",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "assets",
    migrationKey: "full-schema-assets",
    migrationVersion: 1,
    implementation: "not_started",
  },
] as const satisfies readonly FullSchemaCleanupDomainRegistration[];

export type FullSchemaDomainReadiness = {
  domain: FullSchemaCleanupDomain;
  status: "ready" | "not_started" | "running" | "failed" | "blocked" | "stale";
  migrationKey: string;
  migrationVersion: number;
  blockers: string[];
  auditId?: string;
  auditedAt?: number;
};
