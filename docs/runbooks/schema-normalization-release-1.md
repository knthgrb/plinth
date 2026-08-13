# Schema Normalization Release 1 Runbook

Release 1 adds normalized organization payroll settings, attendance settings,
departments, and requirement definitions. It does not delete legacy fields and
does not switch application reads or writes. The production backfill copies
existing values into the new tables in resumable batches.

## Before running

1. Deploy the Convex schema and functions from this release.
2. Confirm a current Convex production backup or export is available.
3. Run commands from the Plinth repository root.
4. Confirm the CLI is connected to the intended Convex project.

The `--prod` option selects the linked production deployment even when local
development environment variables contain a development Convex URL.

## Start the all-organizations dry-run

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanup \
  '{"dryRun":true,"batchSize":20}'
```

Copy the returned `runId`. The starter schedules bounded background batches, so
the command can return while the run is still queued or running.

## Inspect the dry-run

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupRun \
  '{"runId":"DRY_RUN_ID"}'
```

Repeat until `run.status` is `completed`. `getSchemaCleanupRun` returns only a
bounded preview. Page through every issue using the query below; issue records
contain organization identifiers and reason codes, not sensitive field values.

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:listSchemaCleanupIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

When `isDone` is false, repeat with the returned `continueCursor`. Continue
until `isDone` is true.

Do not start write mode when any of these conditions exist:

- `run.status` is not `completed`;
- `run.counters.errors` is greater than zero;
- the complete paginated issue list has not been reviewed;
- `DUPLICATE_SETTINGS_ROWS` exists;
- `DUPLICATE_DESTINATION_ROWS` exists;
- `DESTINATION_VALUE_CONFLICT` exists;
- `UNEXPECTED_DESTINATION_ROWS` exists;
- `INVALID_DEPARTMENT_HEAD_MEMBERSHIP` exists;
- `UNSUPPORTED_PAYROLL_FREQUENCY` exists;
- a source conflict has not been investigated and resolved.

A payroll-frequency conflict means the active cadence on `organizations` does
not match the unused legacy frequency on `settings`. The organization cadence
is the planned canonical source, but the discrepancy must still be reviewed
before the production write.

## Start the backfill

After the dry-run is completed and reviewed:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanup \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Copy the returned write `runId` and inspect it until it completes:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupRun \
  '{"runId":"WRITE_RUN_ID"}'
```

The migration never overwrites a non-matching destination row. It records a
conflict and leaves the existing row unchanged.

## Verify equality and readiness

Start the persisted, cursor-bounded audit after the write run completes:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanupAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

Then poll its status:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Release 1 is ready only when the response has:

```json
{
  "ready": true,
  "duplicateLegacySettings": 0,
  "sourceConflicts": 0,
  "destination": {
    "missing": 0,
    "duplicate": 0,
    "mismatched": 0,
    "unexpected": 0
  }
}
```

Also confirm `destination.matching` equals `destination.expected`,
`destination.totalRows` equals `destination.expected`, and `auditTruncated` is
false.

## Idempotency check

Start a second dry-run, review it, then start a second write run using that new
dry-run ID. The completed second write run must report `changed: 0`; normalized
row counts must remain unchanged.

## Interruption and recovery

Every migration and audit batch stores its continuation cursor and cumulative
counters. Scheduled batches continue automatically while the job remains
active. If a migration batch throws, the action wrapper marks the run `failed`,
sets `failureCode` to `BATCH_FAILED`, increments the error counter, and stops
scheduling. Preserve the failed run and issue rows for diagnosis. After fixing
the underlying cause, start a new dry-run; the migration is idempotent.

An infrastructure interruption can leave an otherwise valid job in `queued` or
`running` without a scheduled continuation. After confirming `updatedAt` has
not changed for at least five minutes, resume the saved migration cursor:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:resumeSchemaCleanup \
  '{"runId":"ACTIVE_RUN_ID"}'
```

Audit failures are marked with `AUDIT_BATCH_FAILED`. After diagnosing and
fixing the cause, resume the saved audit phase and cursor. This also resumes a
stale active audit after five minutes:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:resumeSchemaCleanupAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Because Release 1 does not switch application reads, rollback does not require
copying data back. Keep the legacy fields in place, stop before Release 2, and
inspect or correct the new rows. Do not delete normalized or legacy data as an
ad-hoc rollback.

## What Release 1 did not do at deployment time

- It does not remove organization payroll fields.
- It does not remove the legacy mixed `settings` fields.
- It does not change payroll calculations or historical snapshots.
- It does not normalize leave balances, user membership fallbacks, invitation
  tokens, or embedded histories.
- It does not make the application read from the new tables yet.

Those changes require later releases after this production audit reports full
equality. Releases 1B–1F have since completed their additive production gates.
Use
[`release-2b-identity-credentials-compatibility.md`](./release-2b-identity-credentials-compatibility.md)
for the first behavior-switch release; do not infer Release 3 approval from
this historical Release 1 runbook.

The returned field manifest covers Release 1 fields and preserved payroll
snapshots. Later normalization tranches extend it before their own contract
releases; it is not yet a classification of every field in the full schema.

The expanded cleanup waves now have separate operator runbooks. After the
identity/credentials release, use
[`leave-employee-children-release-1c.md`](./leave-employee-children-release-1c.md)
for the additive leave and employee-child migration. Do not reuse the Release 1
organization-configuration run IDs for a later domain.

After Release 1C is clean, use
[`workflow-events-release-1d.md`](./workflow-events-release-1d.md) for the
additive organization UI, evaluation, and recruitment workflow migration.
