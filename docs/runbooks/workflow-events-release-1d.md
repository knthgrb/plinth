# Workflow Events Release 1D Runbook

Release 1D additively backfills organization UI preferences and settings
events, evaluation reviewers/history, applicant stage events, notes, interviews,
scorecards, offer state, and applicant custom values. It does not switch reads,
dual-write application mutations, or remove legacy fields.

## Before running

1. Deploy this application and its Convex schema/functions to production.
2. Confirm a current production Convex backup/export exists.
3. Run every command from the Plinth repository root with `--prod` and retain
   its output as migration evidence.
4. Do not run write mode unless the exact dry-run is completed and clean.

Issues contain IDs, fields, and codes only. They never contain evaluation or
applicant notes, interview remarks, scorecard notes, offer notes, custom values,
or applicant personal data.

## 1. Dry-run

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:startWorkflowMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll the returned `DRY_RUN_ID`:

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:getWorkflowMigrationRun \
  '{"runId":"DRY_RUN_ID"}'
```

Page every issue:

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:listWorkflowMigrationIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat with each `continueCursor` until `isDone` is true. Proceed only when
`status` is `completed`, conflicts/errors are zero, issues are empty, and
`canStartWrite` is true. Resolve duplicate natural keys, parent/tenant
mismatches, and unequal destinations at their authoritative source.

## 2. Additive write

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:startWorkflowMigration \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Poll the returned `WRITE_RUN_ID` with `getWorkflowMigrationRun`. Continue only
after the write is completed with zero conflicts and errors.

## 3. Persisted audit

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:startWorkflowAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:getWorkflowAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:listWorkflowAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

The audit is acceptable only when `status` is completed, `ready` is true,
source conflicts and discrepancy counters are zero, matching equals expected,
total rows equals expected, and issue paging is empty and complete.

## 4. Idempotency and global readiness

Run another dry-run and poll it. It must report `changed: 0`, zero
conflicts/errors, and `canStartWrite: true`. Do not run another write.

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

The first four domains must be ready. Remaining domains stay not started, and
`readyForRelease3` remains false.

## Interruption and rollback

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:resumeWorkflowMigration \
  '{"runId":"ACTIVE_RUN_ID"}'
```

```bash
pnpm --filter app exec convex run --prod \
  workflowMigrations:resumeWorkflowAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Resume an active migration or audit only after five minutes without an update;
failed audits may be resumed immediately. After write mode, redeploy the prior
app if necessary but retain both normalized and legacy rows. Release 2D owns
normalized-first reads and atomic dual writes; Release 3 remains blocked until
every domain has current clean audit evidence.
