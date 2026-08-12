# Convex Schema Normalization Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the normalized organization configuration schema and a safe, resumable all-organizations audit/backfill framework without deleting or switching any production data.

**Architecture:** Release 1 is expand-only. New domain tables coexist with the legacy organization and settings fields; internal Convex mutations audit and copy records in cursor-bounded batches, record redacted issues, and require a completed dry-run before a write run. Application reads and writes remain unchanged until a later release verifies production equality.

**Tech Stack:** TypeScript, Convex 1.30, `convex-test`, Vitest 4, Next.js 16, pnpm workspace.

## Global Constraints

- Do not remove, clear, or change a legacy production field in Release 1.
- Do not change application reads or writes to use the normalized tables yet.
- Every migration function is internal-only, idempotent, resumable, and bounded by a cursor and batch size.
- A write run requires a completed dry-run for the same migration key and version.
- Migration issues store IDs, field names, and reason codes only; never store secrets, compensation, bank data, or document content.
- Historical payroll, payslip, correction, settlement, and accounting snapshots are not rewritten.
- Use failing behavior tests before implementation changes.
- Do not edit generated Convex files manually; regenerate them with the Convex CLI.

---

## Target file structure

- `apps/app/convex/schema.ts`: additive target tables, migration tables, and indexes only.
- `apps/app/convex/databaseMigrationTypes.ts`: stable migration keys, version, statuses, counters, normalized department rules, and pure comparison helpers.
- `apps/app/convex/databaseMigrationPlanner.ts`: pure source-to-target projections and conflict classification; no database access.
- `apps/app/convex/databaseMigrations.ts`: internal start, process, status, and verification functions plus scheduler orchestration.
- `apps/app/tests/data-migrations.test.ts`: real Convex migration behavior and database side effects.
- `apps/app/tests/database-migration-planner.test.ts`: pure projection/default/conflict tests.
- `docs/runbooks/schema-normalization-release-1.md`: production commands, expected reports, stop conditions, and rollback posture.

### Task 1: Define projections and conflict rules

**Files:**
- Create: `apps/app/convex/databaseMigrationTypes.ts`
- Create: `apps/app/convex/databaseMigrationPlanner.ts`
- Test: `apps/app/tests/database-migration-planner.test.ts`

**Interfaces:**
- Produces: `SCHEMA_CLEANUP_MIGRATION_KEY`, `SCHEMA_CLEANUP_VERSION`, `normalizeDepartmentName(name)`, `defaultDepartmentColor(index)`, `planOrganizationNormalization({ organization, legacySettings })`.
- `planOrganizationNormalization` returns payroll settings, optional attendance settings, departments, requirement definitions, and redacted issues without mutating input values.

- [ ] **Step 1: Write failing tests for source precedence and defaults**

Create fixtures proving that organization payroll cadence wins over the unused settings frequency, missing cadence defaults to bimonthly/15/30, and existing payroll/attendance values are copied exactly.

```ts
expect(plan.payroll).toMatchObject({
  salaryPaymentFrequency: "monthly",
  firstPayDate: 25,
  secondPayDate: 30,
});
expect(plan.issues).toContainEqual({
  code: "PAYROLL_FREQUENCY_CONFLICT",
  field: "salaryPaymentFrequency",
});
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `pnpm --filter app test -- tests/database-migration-planner.test.ts`

Expected: FAIL because `databaseMigrationPlanner.ts` does not exist.

- [ ] **Step 3: Implement stable types and pure projections**

Use migration key `schema-normalization-release-1` and version `1`. Normalize department names with `trim().toLocaleLowerCase("en-US")`. Assign legacy string departments colors from this fixed palette by original array position:

```ts
[
  "#9CA3AF", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#3B82F6", "#A855F7", "#EC4899",
]
```

Do not include source values in issue payloads. Requirement identities use normalized requirement type within the organization; duplicate types become `DUPLICATE_REQUIREMENT_TYPE` issues.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `pnpm --filter app test -- tests/database-migration-planner.test.ts`

Expected: all planner tests pass.

- [ ] **Step 5: Commit the pure planning boundary**

```bash
git add apps/app/convex/databaseMigrationTypes.ts apps/app/convex/databaseMigrationPlanner.ts apps/app/tests/database-migration-planner.test.ts
git commit -m "feat: define schema normalization projections"
```

### Task 2: Add normalized and migration-control tables

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Test: `apps/app/tests/data-migrations.test.ts`

**Interfaces:**
- Produces tables `organizationPayrollSettings`, `organizationAttendanceSettings`, `organizationDepartments`, `organizationRequirementDefinitions`, `migrationRuns`, and `migrationIssues`.
- Produces indexes `by_organization`, `by_organization_normalized_name`, `by_key_started`, `by_key_status`, and `by_run` where applicable.

- [ ] **Step 1: Write a failing Convex test that inserts every new row shape**

Use `convexTest(schema, modules)` and real `ctx.db.insert` calls. Include a payroll row, attendance row, department row, requirement row, migration run, and migration issue with literal values. Query each row using its intended index and assert the returned IDs and organization IDs.

- [ ] **Step 2: Run the test and verify schema validation fails**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: FAIL because the new table names do not exist in the data model/schema.

- [ ] **Step 3: Add the normalized tables additively**

`organizationPayrollSettings` stores organization ID, pay frequency, first/second pay date, optional cutoff dates, optional payroll-settings object copied from legacy settings, source settings ID, migration version, and timestamps.

`organizationAttendanceSettings` stores organization ID, the attendance-settings object, source settings ID, migration version, and timestamps.

`organizationDepartments` stores organization ID, name, normalized name, color, optional head/cost center/location/parent normalized name, source settings ID, migration version, and timestamps.

`organizationRequirementDefinitions` stores organization ID, type, normalized type, all current requirement policy properties, source `organization`, migration version, and timestamps.

`migrationRuns` stores key, version, dry-run mode, status, phase, cursor, batch size, counters, optional required dry-run ID, timestamps, and optional failure code. `migrationIssues` stores run ID, organization ID when known, entity type/ID, field, code, created time, and resolved time.

- [ ] **Step 4: Add uniqueness-oriented lookup indexes**

Add organization indexes to singleton setting tables and compound organization/normalized-name indexes to departments and requirement definitions. Add migration run key/status and issue run indexes. Convex cannot enforce uniqueness, so mutation logic must use `.unique()` and report duplicates.

- [ ] **Step 5: Run the schema behavior test and typecheck**

Run:

```bash
pnpm --filter app test -- tests/data-migrations.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: tests and TypeScript pass.

- [ ] **Step 6: Commit the additive schema**

```bash
git add apps/app/convex/schema.ts apps/app/tests/data-migrations.test.ts
git commit -m "feat: add normalized organization settings schema"
```

### Task 3: Implement one bounded normalization batch

**Files:**
- Create: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/data-migrations.test.ts`

**Interfaces:**
- Produces internal mutation `processSchemaCleanupBatch({ runId })`.
- Consumes one `migrationRuns` row, pages `organizations` using its cursor and batch size, reads at most the matching settings rows for each organization, and returns `{ done, cursor, counters }`.

- [ ] **Step 1: Write the failing dry-run behavior test**

Insert two organizations with organization cadence, default requirements, legacy attendance/payroll settings, string departments, and one conflicting settings frequency. Insert a running dry-run with batch size `1`. Invoke the internal mutation once and assert:

- exactly one organization is scanned;
- no normalized destination rows are written;
- a redacted conflict issue is written;
- the run cursor advances and status remains `running`.

- [ ] **Step 2: Run the focused test and verify the missing-export failure**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: FAIL because `databaseMigrations:processSchemaCleanupBatch` is missing.

- [ ] **Step 3: Implement the dry-run batch path**

Use `.paginate({ cursor, numItems: batchSize })` on `organizations`. For each organization, query `settings.by_organization`, report `DUPLICATE_SETTINGS_ROWS` when more than one exists, and project only the first row when there is exactly one. Dry-run records counters and issues but performs no normalized-table inserts.

- [ ] **Step 4: Run the dry-run test and verify it passes**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: dry-run batch behavior passes.

- [ ] **Step 5: Write failing write-mode and idempotency tests**

Create a completed dry-run and a running write run referencing it. Process all batches and assert one payroll settings row, one attendance row, one row per unique department, and one row per unique requirement. Invoke a second write run against the same sources and assert `changed` is zero and no duplicate destination rows exist.

- [ ] **Step 6: Implement insert-or-compare write behavior**

For each destination key:

- no row: insert the projected row and increment `changed`;
- one equal row: increment `unchanged`;
- one unequal row: record `DESTINATION_VALUE_CONFLICT`, increment `conflicts`, and do not overwrite;
- multiple rows: record `DUPLICATE_DESTINATION_ROWS`, increment `conflicts`, and do not write.

Mark the run `completed` when pagination reports `isDone`; otherwise persist the continuation cursor. Do not schedule the next batch in this mutation yet.

- [ ] **Step 7: Run batch tests and typecheck**

Run:

```bash
pnpm --filter app test -- tests/data-migrations.test.ts tests/database-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 8: Commit the bounded batch implementation**

```bash
git add apps/app/convex/databaseMigrations.ts apps/app/tests/data-migrations.test.ts
git commit -m "feat: backfill normalized settings in bounded batches"
```

### Task 4: Add the guarded all-organizations runner

**Files:**
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/data-migrations.test.ts`

**Interfaces:**
- Produces internal mutation `startSchemaCleanup({ dryRun, dryRunId?, batchSize? })` returning `{ runId, key, version, dryRun }`.
- Produces internal mutation `continueSchemaCleanup({ runId })` that processes one batch and schedules itself with `ctx.scheduler.runAfter(0, ...)` until completion.
- Produces internal query `getSchemaCleanupRun({ runId })` returning the run plus aggregated issues.

- [ ] **Step 1: Write failing guard tests**

Prove that start rejects batch sizes outside `1..50`, rejects a second active run for the same key/version/mode, rejects write mode without `dryRunId`, and rejects a dry-run ID that is incomplete, wrong-version, or has systemic errors.

- [ ] **Step 2: Run tests and verify the guard behavior is missing**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: FAIL on missing exports or missing validation.

- [ ] **Step 3: Implement start and continuation orchestration**

Default `batchSize` to `20`. Store a new run before scheduling continuation. Construct internal function references explicitly with `makeFunctionReference` so checked-in generated API types are not a dependency during TDD. `continueSchemaCleanup` calls shared batch logic and schedules another continuation only when the run is still active.

- [ ] **Step 4: Write and run the all-organizations scheduler test**

Start a dry-run with three organizations and batch size `1`, call `t.finishAllScheduledFunctions(() => vi.runAllTimers())`, and assert the completed run scanned all three organizations without writing normalized rows.

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: all runner tests pass.

- [ ] **Step 5: Add read-only status reporting**

`getSchemaCleanupRun` returns counters and issues ordered by creation time. It must never return legacy field values. Include `canStartWrite: true` only when the dry-run is completed, version-matched, and has no systemic error.

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm --filter app test -- tests/data-migrations.test.ts tests/database-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: focused tests and TypeScript pass.

- [ ] **Step 7: Commit the all-organizations runner**

```bash
git add apps/app/convex/databaseMigrations.ts apps/app/tests/data-migrations.test.ts
git commit -m "feat: orchestrate resumable schema cleanup runs"
```

### Task 5: Add contract-readiness verification and field classification

**Files:**
- Create: `apps/app/convex/schemaFieldManifest.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/data-migrations.test.ts`

**Interfaces:**
- Produces internal query `getSchemaCleanupAudit({ runId })` with field classifications, source/destination counts, mismatch counters, and Release 1 readiness.
- Produces `SCHEMA_FIELD_MANIFEST` entries with table, field, classification, target, and release gate.

- [ ] **Step 1: Write failing verification tests**

Assert readiness is false when a destination row is missing, duplicated, or unequal and true when every Release 1 source projection has exactly one equal destination. Assert `payslips.employeeSnapshot`, `payrollRuns.draftConfig`, and `payrollRuns.summarySnapshot` are classified `historical_snapshot`; assert organization pay cadence is `compatibility_read`; assert `settings.taxTable`, `settings.payrollFrequency`, and `settings.payrollTabPassword` are `removable` with a production-count gate.

- [ ] **Step 2: Run the tests and verify the missing audit failure**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: FAIL because the audit query and manifest do not exist.

- [ ] **Step 3: Implement the manifest and read-only audit**

The audit scans normalized Release 1 keys, never modifies data, and returns aggregate counts only. It must report duplicate legacy settings separately from destination conflicts and must not report readiness when the referenced write run is not completed.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --filter app test -- tests/data-migrations.test.ts tests/database-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 5: Commit audit reporting**

```bash
git add apps/app/convex/schemaFieldManifest.ts apps/app/convex/databaseMigrations.ts apps/app/tests/data-migrations.test.ts
git commit -m "feat: report schema cleanup readiness"
```

### Task 6: Document and verify Release 1

**Files:**
- Create: `docs/runbooks/schema-normalization-release-1.md`
- Modify: `docs/superpowers/plans/2026-08-12-convex-schema-normalization-release-1.md`

**Interfaces:**
- Documents exact production commands for dry-run start, run-status inspection, write-run start, audit verification, rerun idempotency, and stop conditions.

- [ ] **Step 1: Write the production runbook**

Document this sequence:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanup \
  '{"dryRun":true,"batchSize":20}'

pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupRun \
  '{"runId":"DRY_RUN_ID"}'

pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanup \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'

pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

State that `--prod` selects the linked production deployment even when local development environment variables point elsewhere. Require stopping before write mode when the dry-run has duplicate settings, destination conflicts, or systemic errors.

- [ ] **Step 2: Regenerate Convex types**

Run: `pnpm --filter app exec convex codegen`

Expected: generated API/data-model files include all new tables and functions without deployment writes.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm --filter app test
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/databaseMigrationTypes.ts convex/databaseMigrationPlanner.ts convex/databaseMigrations.ts convex/schemaFieldManifest.ts tests/database-migration-planner.test.ts tests/data-migrations.test.ts
pnpm audit --prod --audit-level moderate
git diff --check
pnpm --filter app exec next build --webpack
```

Expected: all tests pass, TypeScript and focused ESLint have no errors, audit reports no known vulnerabilities, diff check is clean, and the production build exits zero.

- [ ] **Step 4: Review the final diff against Release 1 constraints**

Confirm no legacy field is removed or cleared, no application read/write path changed, historical snapshots are untouched, functions are internal-only, issues contain no sensitive values, and write mode requires a completed dry-run.

- [ ] **Step 5: Commit Release 1 runbook and verification checkpoint**

```bash
git add apps/app/convex apps/app/tests docs/runbooks/schema-normalization-release-1.md docs/superpowers/plans/2026-08-12-convex-schema-normalization-release-1.md
git commit -m "docs: add schema normalization release 1 runbook"
```

## Release 1 completion boundary

Release 1 is complete when the expand-only code passes all verification and the production dry-run is available. Production backfill execution and its report are an explicit operator step. Release 2 must not begin until every production conflict is resolved and `getSchemaCleanupAudit` reports Release 1 readiness after the write run.
