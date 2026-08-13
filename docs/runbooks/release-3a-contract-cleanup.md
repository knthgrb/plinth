# Release 3A Contract Cleanup Runbook

Release 3A stops all legacy reads and writes. It also deploys the cleanup
functions while the legacy schema fields remain optional. Release 3B must be a
separate deployment in the same maintenance window, after this runbook reports
`readyForRelease3B: true`.

## Prerequisites

- Deploy the Release 3A commit only. Do not deploy the Release 3B schema commit yet.
- Confirm the six domain migrations still report `status: "ready"`.
- Put write-heavy administrative operations in a maintenance window.
- Create a production Convex backup/export and retain its immutable reference.

All commands run from the repository root and target production explicitly.

## 1. Dry-run the physical cleanup

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:startRelease3ContractCleanup \
  '{"dryRun":true,"batchSize":20}'
```

Record the returned `runId`, then poll:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:getRelease3ContractCleanupRun \
  '{"runId":"DRY_RUN_ID"}'
```

Proceed only when `status` is `completed`, `conflicts` and `errors` are zero,
and `canAcknowledgeExport` is true. Page every issue until `isDone: true`:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:listRelease3ContractCleanupIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Use each returned `continueCursor` until the page is done. A non-empty issue
page blocks the write.

## 2. Record the production backup/export

After the backup/export completes, record its real immutable reference. The
command stores only the reference, never exported data or secrets.

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:acknowledgeRelease3ContractExport \
  '{"dryRunId":"DRY_RUN_ID","exportReference":"REAL_BACKUP_REFERENCE"}'
```

Poll the dry-run again. `canStartWrite` must now be true.

## 3. Clear legacy fields

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:startRelease3ContractCleanup \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Record `WRITE_RUN_ID` and poll it with
`getRelease3ContractCleanupRun`. Proceed only when it is completed with zero
conflicts and errors. If an active run becomes stale for more than five
minutes, resume it:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:resumeRelease3ContractCleanup \
  '{"runId":"WRITE_RUN_ID"}'
```

## 4. Audit the cleanup

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:startRelease3ContractAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":10}'
```

Poll:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:getRelease3ContractAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

The required result is `status: "completed"`, `ready: true`,
`sourceConflicts: 0`, and every destination problem count zero. Page all audit
issues:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:listRelease3ContractAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

If a failed/stale audit needs continuation:

```bash
pnpm --filter app exec convex run --prod \
  release3Migrations:resumeRelease3ContractAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

## 5. Prove idempotency and Release 3B readiness

Run a second dry-run exactly as in step 1. It must complete with `changed: 0`,
`conflicts: 0`, and `errors: 0`.

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Deploy Release 3B only when this returns `readyForRelease3B: true` and
`release3Blockers: []`.

## Rollback

- Before step 3, redeploy the final Release 2 build.
- After step 3 but before Release 3B, restore from the recorded export before
  running a legacy build that requires removed projections.
- After Release 3B, rollback requires both the Release 3A-compatible schema
  deployment and the recorded data export. Do not reconstruct deleted values
  from guesses.
