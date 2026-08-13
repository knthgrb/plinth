# Communications and Documents Release 1E Runbook

Release 1E additively backfills memo reactions, acknowledgements and audience
selectors; chat members, read receipts and pins; document access grants; and
memo, chat, document and leave-request storage links. It does not switch
application reads, dual-write application mutations, remove legacy fields, or
process accounting receipts and asset history.

## Before running

1. Deploy this application and its Convex schema/functions to production.
2. Confirm a current production Convex backup/export exists.
3. Run every command from the Plinth repository root with `--prod` and retain
   its output as migration evidence.
4. Do not run write mode unless the exact dry-run is completed and clean.
5. Confirm `getFullSchemaCleanupReadiness` reports the first four domains as
   `ready`; this wave relies on their clean identity and parent-link evidence.

Migration and audit issues contain IDs, fields and codes only. They never
contain memo titles/content, message content, document titles/content, leave
reasons, file names, MIME payloads or stored file contents.

## 1. Dry-run

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:startCommunicationsMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll the returned `DRY_RUN_ID`:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:getCommunicationsMigrationRun \
  '{"runId":"DRY_RUN_ID"}'
```

Page every dry-run issue:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:listCommunicationsMigrationIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat issue paging with each `continueCursor` until `isDone` is `true`.
Proceed only when all of these are true:

- `run.status` is `completed`.
- `run.counters.conflicts` and `run.counters.errors` are both `0`.
- `issues` is empty, `issuesTruncated` is `false`, and paged issues are empty.
- `canStartWrite` is `true`.

Resolve duplicate child keys, malformed memo reactions, tenant mismatches,
missing parents, attachment metadata mismatches, or unequal destinations at
their authoritative source. Do not edit production migration evidence rows to
bypass a conflict.

## 2. Additive write

Use the exact clean dry-run ID:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:startCommunicationsMigration \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Poll the returned `WRITE_RUN_ID`:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:getCommunicationsMigrationRun \
  '{"runId":"WRITE_RUN_ID"}'
```

Continue only after the write is `completed` with zero conflicts and errors.
Legacy parent arrays must remain present; this release only adds normalized
rows.

## 3. Persisted audit

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:startCommunicationsAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

Poll using the write run ID:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:getCommunicationsAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Page every audit issue using the returned `AUDIT_ID`:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:listCommunicationsAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat with each `continueCursor` until `isDone` is `true`. The audit is
acceptable only when:

- `status` is `completed` and `ready` is `true`.
- `sourceConflicts` is `0` and `auditTruncated` is `false`.
- `destination.missing`, `duplicate`, `mismatched`, and `unexpected` are all
  `0`.
- `destination.matching === destination.expected`.
- `destination.totalRows === destination.expected`.
- Audit issue paging is empty and complete.

## 4. Idempotency and global readiness

Run a new dry-run after the audit:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:startCommunicationsMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll it with `getCommunicationsMigrationRun`. It must be completed with
`changed: 0`, zero conflicts/errors, and `canStartWrite: true`. Do not run a
second write.

Then check the full program:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

The first five domains must report `status: ready` with no blockers.
`assets_payroll_compatibility` remains `not_started`, so
`readyForRelease3` must remain `false`.

## Interruption and rollback

If an active migration has not updated for at least five minutes:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:resumeCommunicationsMigration \
  '{"runId":"ACTIVE_RUN_ID"}'
```

If an audit fails, or an active audit has not updated for at least five
minutes:

```bash
pnpm --filter app exec convex run --prod \
  communicationsMigrations:resumeCommunicationsAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

After write mode, rollback means redeploying the prior application while
retaining both normalized and legacy rows. Do not delete target rows or clear
legacy arrays. The later communications compatibility release owns
normalized-first reads and atomic dual writes; Release 3 remains blocked until
the final payroll/assets domain and global audit are also clean.
