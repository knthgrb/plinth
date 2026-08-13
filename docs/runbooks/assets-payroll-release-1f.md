# Assets and Payroll Compatibility Release 1F Runbook

Release 1F is the final additive full-schema wave. It backfills payroll-run
notes, accounting receipt links, asset custody events, and asset maintenance
events. It does not switch application reads, remove legacy fields, or run the
Release 3 contract cleanup.

## Before running

1. Deploy this application and its Convex schema/functions to production.
2. Confirm a current production Convex backup/export exists.
3. Run every command from the Plinth repository root with `--prod` and retain
   the output as migration evidence.
4. Confirm `databaseMigrations:getFullSchemaCleanupReadiness` reports the first
   five domains as `ready` with no blockers.
5. Do not run write mode unless the exact dry-run is completed and clean.

Issues contain IDs, fields, and codes only. They do not contain payroll note
text, receipt contents, file names, or asset maintenance descriptions.

## 1. Dry-run

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:startAssetsPayrollMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll the returned `DRY_RUN_ID`:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:getAssetsPayrollMigrationRun \
  '{"runId":"DRY_RUN_ID"}'
```

Page every issue:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:listAssetsPayrollMigrationIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat issue paging with each `continueCursor` until `isDone` is `true`.
Proceed only when:

- `run.status` is `completed`.
- conflicts and errors are both `0`.
- inline and paged issues are empty and not truncated.
- `canStartWrite` is `true`.

Resolve tenant mismatches, missing or invalid storage metadata, incomplete
custody state, duplicate destination keys, or unequal destinations at their
authoritative source. Never edit migration evidence rows to bypass a conflict.

## 2. Additive write

Use the exact clean dry-run ID:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:startAssetsPayrollMigration \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Poll the returned `WRITE_RUN_ID`:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:getAssetsPayrollMigrationRun \
  '{"runId":"WRITE_RUN_ID"}'
```

Continue only after the write is `completed` with zero conflicts and errors.
All legacy arrays and scalar custody fields must remain present.

## 3. Persisted audit

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:startAssetsPayrollAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

Poll using the write run ID:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:getAssetsPayrollAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Page every audit issue using the returned `AUDIT_ID`:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:listAssetsPayrollAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

The audit is acceptable only when:

- `status` is `completed`, `ready` is `true`, and `auditTruncated` is false.
- `sourceConflicts` is `0`.
- missing, duplicate, mismatched, and unexpected are all `0`.
- matching, expected, and totalRows are equal.
- paged issues are empty and complete.

## 4. Idempotency and program readiness

Run one new dry-run and poll it:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:startAssetsPayrollMigration \
  '{"dryRun":true,"batchSize":20}'
```

It must complete with `changed: 0`, zero conflicts/errors, and
`canStartWrite: true`. Do not run a second write.

Then run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

All six domains must report `status: ready` with empty blockers, and
`readyForRelease3` must be `true`. This permits planning the global expansion
audit and Release 3B compatibility contract; it does not itself authorize
legacy deletion.

## Interruption and rollback

If an active migration has not updated for at least five minutes:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:resumeAssetsPayrollMigration \
  '{"runId":"ACTIVE_RUN_ID"}'
```

If an audit failed, or has not updated for at least five minutes:

```bash
pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:resumeAssetsPayrollAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Rollback means redeploying the prior application while retaining both legacy
and normalized rows. Do not delete target rows or clear legacy fields.
