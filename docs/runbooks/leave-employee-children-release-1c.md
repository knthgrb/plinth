# Leave and Employee Children Release 1C Runbook

Release 1C additively backfills organization leave policy, embedded leave
types, employee leave balances, requirements, deductions, incentives, schedule
overrides, payment accounts, and employee custom fields into normalized
targets. It does not remove legacy fields, switch application reads, or rewrite
historical payroll and payslip records.

## Before running

1. Deploy the application and Convex schema/functions from this release.
2. Confirm the production deployment exposes the internal
   `leaveEmployeeMigrations` functions.
3. Confirm a current production Convex backup or export is available.
4. Run every command from the Plinth repository root and retain its output as
   migration evidence.
5. Confirm the Convex CLI is linked to the intended production project. Every
   command below uses `--prod`; local development URLs do not override it.

Migration issues contain IDs, fields, and redacted codes only. They do not
contain payment-account details, requirement files, employee names, custom
field values, or compensation data.

## 1. Start and review the dry-run

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:startLeaveEmployeeMigration \
  '{"dryRun":true,"batchSize":20}'
```

Copy the returned `runId` as `DRY_RUN_ID`. Poll until `run.status` is
`completed`:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:getLeaveEmployeeMigrationRun \
  '{"runId":"DRY_RUN_ID"}'
```

Page through every issue:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:listLeaveEmployeeMigrationIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

When `isDone` is `false`, replace `null` with the returned `continueCursor` and
repeat. Do not start write mode unless:

- `run.status` is `completed`;
- `run.counters.conflicts` is `0`;
- `run.counters.errors` is `0`;
- `canStartWrite` is `true`;
- `issuesTruncated` is `false` or every issue was reviewed through pagination;
- every reconciliation and tenant conflict has been resolved at its source.

`changed` is the number of additive rows the write would create. Dry-run does
not modify settings, employees, leave requests, or normalized business rows.

### Conflict handling

Never change production data merely to make a code disappear. Confirm the
intended business value with HR or the organization administrator.

- `LEAVE_BALANCE_RECONCILIATION_MISMATCH` means embedded `used` leave differs
  from paid, approved leave requests for the current Manila calendar year. In
  by-type mode this is checked per leave type; in general mode vacation and sick
  usage is reconciled as one pool. Review cancellations, manual adjustments,
  opening balances, and tracker history before correcting the authoritative
  source.
- Duplicate settings, tracker rows, child IDs, or normalized natural keys must
  be reduced to one intentional source/destination after export and review.
- Tenant or orphan conflicts require repairing the parent organization or
  employee relationship; never move a row between tenants by assumption.
- A normalized mismatch is never overwritten by the migration. Determine
  whether the legacy source or existing destination contains the intended value.

Legacy custom-field definitions are marked `mixed` because their source object
does not enforce one organization-wide value type. Each employee value retains
its exact type and JSON value in the private normalized value table.

After resolving any conflict, start a brand-new dry-run. Do not reuse a
conflicting dry-run ID.

## 2. Start the additive write

Use the exact reviewed conflict-free dry-run ID:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:startLeaveEmployeeMigration \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Copy the returned `runId` as `WRITE_RUN_ID`, then poll it:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:getLeaveEmployeeMigrationRun \
  '{"runId":"WRITE_RUN_ID"}'
```

Proceed only when the write has `status: "completed"`, `conflicts: 0`, and
`errors: 0`. `canStartWrite: false` is expected for a write run.

## 3. Run the persisted post-write audit

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:startLeaveEmployeeAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

Copy the returned `auditId` as `AUDIT_ID`. Poll by write-run ID:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:getLeaveEmployeeAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Page through every persisted audit issue:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:listLeaveEmployeeAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat with each returned `continueCursor` until `isDone` is `true`. The audit
is acceptable only when:

- `status` is `completed`;
- `ready` is `true`;
- `sourceConflicts` is `0`;
- `auditTruncated` is `false`;
- `destination.missing`, `duplicate`, `mismatched`, and `unexpected` are `0`;
- `destination.matching` equals `destination.expected`;
- `destination.totalRows` equals `destination.expected`;
- every issue page has been reviewed.

The audit replays a bounded verification dry-run and then cursor-pages every
normalized target table. Orphan or stale destination rows therefore block
readiness even when all current sources have matching rows.

## 4. Prove idempotency

Start one final dry-run after the clean audit:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:startLeaveEmployeeMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll it and page its issues. The completed verification dry-run must have:

- `changed: 0`;
- `conflicts: 0`;
- `errors: 0`;
- `canStartWrite: true`.

Do not run another write merely to prove idempotency.

## 5. Confirm global readiness

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Accept Release 1C only when `organization_configuration`,
`identity_credentials`, and `leave_employee_children` are `ready` with no
blockers and current audit IDs. The remaining cleanup waves should still be
`not_started` with `DOMAIN_IMPLEMENTATION_NOT_DEPLOYED`.

`readyForRelease3` must remain `false`. Do not remove legacy fields or indexes.

## Interruption and recovery

If an active migration has not updated for at least five minutes, resume its
saved phase and cursor:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:resumeLeaveEmployeeMigration \
  '{"runId":"ACTIVE_RUN_ID"}'
```

If an audit failed, or a queued/running audit has not updated for at least five
minutes, resume it by write-run ID:

```bash
pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:resumeLeaveEmployeeAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Preserve failed run, audit, and issue rows for diagnosis. Do not delete them or
manually edit counters.

## Rollback boundary

Before write mode, rollback is only an application/Convex redeployment because
dry-run creates no business rows. After write mode, redeploy the prior
application if necessary but leave normalized and legacy data in place. Reads
remain on compatibility sources in Release 1C, so copying normalized values
back or deleting additive rows is not an approved rollback.

Release 2C owns normalized-first reads and atomic dual writes. Release 3 remains
blocked until every cleanup domain has current clean audit evidence and has
completed its compatibility window.
