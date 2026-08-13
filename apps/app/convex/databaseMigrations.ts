import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  type FullSchemaCleanupDomain,
  type FullSchemaDomainReadiness,
} from "./fullSchemaCleanupRegistry";
import {
  CURRENT_SCHEMA_TABLES,
  FULL_SCHEMA_TABLE_POLICIES,
} from "./fullSchemaInventory";
import { resolveRelease3ProgramReadiness } from "./release3Contract";

const MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK = 100;
const SCHEMA_CLEANUP_MIGRATION_KEY = "schema-normalization-release-1";
const SCHEMA_CLEANUP_VERSION = 1;

type FullSchemaCleanupReadinessRegistration = {
  domain: FullSchemaCleanupDomain;
  migrationKey: string;
  migrationVersion: number;
  implementation: "compatibility" | "migration" | "not_started";
  compatibility?: "switched" | "pending";
};

type FullSchemaCleanupReadinessMode =
  | "not_started"
  | "organization_configuration"
  | "identity_credentials"
  | "leave_employee_children"
  | "workflow_events"
  | "communications_documents"
  | "assets_payroll_compatibility"
  | "unsupported";

async function getLatestAudit(
  ctx: Pick<QueryCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (q) => q.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

function isCleanWriteRun(run: Doc<"migrationRuns">): boolean {
  return (
    !run.dryRun &&
    run.status === "completed" &&
    run.counters.errors === 0 &&
    run.counters.conflicts === 0
  );
}

function isCleanAudit(
  registration: FullSchemaCleanupReadinessRegistration,
  run: Doc<"migrationRuns">,
  audit: Doc<"migrationAudits">,
): boolean {
  return (
    run.key === registration.migrationKey &&
    run.version === registration.migrationVersion &&
    isCleanWriteRun(run) &&
    audit.status === "completed" &&
    !audit.auditTruncated &&
    audit.sourceConflicts === 0 &&
    audit.destination.missing === 0 &&
    audit.destination.duplicate === 0 &&
    audit.destination.mismatched === 0 &&
    audit.destination.unexpected === 0 &&
    audit.destination.matching === audit.destination.expected &&
    audit.destination.totalRows === audit.destination.expected
  );
}

async function getLatestWriteAttempt(
  ctx: Pick<QueryCtx, "db">,
  migrationKey: string,
) {
  const runs = await ctx.db
    .query("migrationRuns")
    .withIndex("by_key_started", (q) => q.eq("key", migrationKey))
    .order("desc")
    .take(MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK + 1);
  const run = runs
    .slice(0, MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK)
    .find((candidate) => !candidate.dryRun);
  if (run) return { status: "found" as const, run };
  if (runs.length > MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK) {
    return { status: "truncated" as const };
  }
  return { status: "not_found" as const };
}

function auditBlockers(audit: Doc<"migrationAudits">): string[] {
  const blockers: string[] = [];
  if (audit.auditTruncated) blockers.push("AUDIT_TRUNCATED");
  if (audit.sourceConflicts > 0) blockers.push("AUDIT_SOURCE_CONFLICTS");
  if (
    audit.destination.missing > 0 ||
    audit.destination.duplicate > 0 ||
    audit.destination.mismatched > 0 ||
    audit.destination.unexpected > 0 ||
    audit.destination.matching !== audit.destination.expected ||
    audit.destination.totalRows !== audit.destination.expected
  ) {
    blockers.push("AUDIT_DESTINATION_DISCREPANCIES");
  }
  return blockers;
}

async function getDomainReadiness(
  ctx: Pick<QueryCtx, "db">,
  registration: FullSchemaCleanupReadinessRegistration,
): Promise<FullSchemaDomainReadiness> {
  const runLookup = await getLatestWriteAttempt(ctx, registration.migrationKey);
  if (runLookup.status === "truncated") {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_RUN_HISTORY_TRUNCATED"],
    };
  }
  if (runLookup.status === "not_found") {
    return {
      domain: registration.domain,
      status: "not_started",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["COMPLETED_WRITE_RUN_NOT_FOUND"],
    };
  }

  const { run } = runLookup;
  if (run.version !== registration.migrationVersion) {
    return {
      domain: registration.domain,
      status: "stale",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_VERSION_STALE"],
    };
  }
  if (run.status === "failed") {
    return {
      domain: registration.domain,
      status: "failed",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_WRITE_FAILED"],
    };
  }
  if (run.status !== "completed") {
    return {
      domain: registration.domain,
      status: "running",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_WRITE_NOT_COMPLETED"],
    };
  }

  const writeBlockers = [
    ...(run.counters.errors > 0 ? ["MIGRATION_WRITE_ERRORS"] : []),
    ...(run.counters.conflicts > 0 ? ["MIGRATION_WRITE_CONFLICTS"] : []),
  ];
  if (writeBlockers.length > 0) {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: writeBlockers,
    };
  }

  const audit = await getLatestAudit(ctx, run._id);
  if (!audit) {
    return {
      domain: registration.domain,
      status: "not_started",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_NOT_FOUND"],
    };
  }

  const auditMetadata = {
    auditId: audit._id,
    auditedAt: audit.completedAt ?? audit.updatedAt,
  };
  if (audit.status === "queued" || audit.status === "running") {
    return {
      domain: registration.domain,
      status: "running",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_NOT_COMPLETED"],
      ...auditMetadata,
    };
  }
  if (audit.status === "failed") {
    return {
      domain: registration.domain,
      status: "failed",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_FAILED"],
      ...auditMetadata,
    };
  }
  if (!isCleanAudit(registration, run, audit)) {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: auditBlockers(audit),
      ...auditMetadata,
    };
  }
  return {
    domain: registration.domain,
    status: "ready",
    migrationKey: registration.migrationKey,
    migrationVersion: registration.migrationVersion,
    blockers: [],
    ...auditMetadata,
  };
}

export function resolveFullSchemaCleanupReadinessMode(
  registration: FullSchemaCleanupReadinessRegistration,
): FullSchemaCleanupReadinessMode {
  if (registration.implementation === "not_started") return "not_started";
  if (
    registration.domain === "organization_configuration" &&
    registration.migrationKey === SCHEMA_CLEANUP_MIGRATION_KEY &&
    registration.migrationVersion === SCHEMA_CLEANUP_VERSION
  ) {
    return "organization_configuration";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "identity_credentials" &&
    registration.migrationKey === "full-schema-identity-credentials" &&
    registration.migrationVersion === 1
  ) {
    return "identity_credentials";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "leave_employee_children" &&
    registration.migrationKey === "full-schema-leave-employee-children" &&
    registration.migrationVersion === 1
  ) {
    return "leave_employee_children";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "workflow_events" &&
    registration.migrationKey === "full-schema-workflow-events" &&
    registration.migrationVersion === 1
  ) {
    return "workflow_events";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "communications_documents" &&
    registration.migrationKey === "full-schema-communications-documents" &&
    registration.migrationVersion === 1
  ) {
    return "communications_documents";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "assets_payroll_compatibility" &&
    registration.migrationKey === "full-schema-assets-payroll" &&
    registration.migrationVersion === 1
  ) {
    return "assets_payroll_compatibility";
  }
  return "unsupported";
}

async function resolveDomainReadiness(
  ctx: Pick<QueryCtx, "db">,
  registration: FullSchemaCleanupReadinessRegistration,
): Promise<FullSchemaDomainReadiness> {
  const mode = resolveFullSchemaCleanupReadinessMode(registration);
  if (mode === "not_started") {
    return {
      domain: registration.domain,
      status: "not_started",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["DOMAIN_IMPLEMENTATION_NOT_DEPLOYED"],
    };
  }
  if (mode === "unsupported") {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["DOMAIN_IMPLEMENTATION_UNSUPPORTED"],
    };
  }
  return getDomainReadiness(ctx, registration);
}

export const getFullSchemaInventory = internalQuery({
  args: {},
  handler: async () => ({
    programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
    programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
    currentTableCount: CURRENT_SCHEMA_TABLES.length,
    tables: CURRENT_SCHEMA_TABLES.map((table) => ({
      table,
      ...FULL_SCHEMA_TABLE_POLICIES[table],
    })),
  }),
});

export function resolveFullSchemaProgramReadiness(
  domains: readonly FullSchemaDomainReadiness[],
  cleanupAuditReady = false,
): {
  readyForRelease2: boolean;
  readyForRelease3: boolean;
  readyForRelease3B: boolean;
  release3Blockers: string[];
} {
  const readyForRelease2 = domains.every(({ status }) => status === "ready");
  const compatibilitySwitched = FULL_SCHEMA_CLEANUP_DOMAINS.every(
    ({ compatibility }) => compatibility === "switched",
  );
  const contract = resolveRelease3ProgramReadiness({
    domainsReady: readyForRelease2,
    compatibilitySwitched,
    cleanupAuditReady,
  });
  return {
    readyForRelease2,
    readyForRelease3: contract.readyForRelease3B,
    readyForRelease3B: contract.readyForRelease3B,
    release3Blockers: contract.blockers,
  };
}

async function getRelease3ContractAuditReadiness(
  ctx: QueryCtx,
): Promise<boolean> {
  const runs = await ctx.db
    .query("migrationRuns")
    .withIndex("by_key_started", (q) =>
      q.eq("key", "full-schema-release-3-contract"),
    )
    .order("desc")
    .take(20);
  const writeRun = runs.find((run) => !run.dryRun);
  if (
    !writeRun ||
    writeRun.version !== 1 ||
    !isCleanWriteRun(writeRun)
  ) {
    return false;
  }
  const audit = await getLatestAudit(ctx, writeRun._id);
  return Boolean(
    audit &&
      audit.phase === "release3_contract" &&
      audit.status === "completed" &&
      !audit.auditTruncated &&
      audit.sourceConflicts === 0 &&
      audit.destination.missing === 0 &&
      audit.destination.duplicate === 0 &&
      audit.destination.mismatched === 0 &&
      audit.destination.unexpected === 0,
  );
}

export const getFullSchemaCleanupReadiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const domains = await Promise.all(
      FULL_SCHEMA_CLEANUP_DOMAINS.map((registration) =>
        resolveDomainReadiness(ctx, registration),
      ),
    );
    const cleanupAuditReady = await getRelease3ContractAuditReadiness(ctx);
    return {
      programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
      programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
      ...resolveFullSchemaProgramReadiness(domains, cleanupAuditReady),
      domains,
    };
  },
});
