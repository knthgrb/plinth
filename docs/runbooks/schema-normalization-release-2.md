# Schema Normalization Release 2 Runbook

Release 2 makes normalized organization payroll, attendance, department, and
requirement records canonical. Application reads prefer normalized records and
temporarily fall back to legacy fields. Existing mutations update both
representations in one transaction. This release does not delete or contract
the legacy schema.

## Production prerequisite

Release 1 must already have a completed conflict-free write and a completed
audit with `ready: true`. The verified Release 1 production write run for the
current deployment is:

```text
q579dkphgvjxf74kmfhkmfbzz58cadt0
```

Keep that run and its audit records. Release 2 reuses the write run ID for new
compatibility audits.

## Deploy

1. Confirm a current Convex production backup or export is available.
2. Deploy the application and Convex functions together.
3. Confirm the deployment completed without schema validation errors.
4. Do not clear legacy fields or normalized rows.

Run CLI commands below from the Plinth repository root. The `--prod` option
selects the linked production deployment even when local environment variables
point to development.

## Authenticated smoke tests

Use a production test organization or a low-risk organization with known
settings. Sign in as an authorized owner, admin, or HR user and complete all of
the following:

1. Open payroll settings, verify the displayed cadence and values, and save the
   existing values without changing the organization's policy.
2. Open attendance settings, verify the displayed values, and save them.
3. Open departments, verify department names and assigned heads, and save them.
4. Open default employee requirements, verify the list, and save it.
5. Reload each page and confirm the saved values remain unchanged.
6. Generate a payroll preview for a known cutoff and compare its employee
   count and totals with the expected pre-deployment result.
7. Confirm a finalized historical payroll and payslip remain readable.

Stop and roll back the application deployment if a normalized row is missing,
the UI shows an unexpected value, a save fails, payroll output changes, or a
historical snapshot cannot be read.

## Start a fresh compatibility audit

Start another audit against the completed Release 1 production write run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanupAudit \
  '{"runId":"q579dkphgvjxf74kmfhkmfbzz58cadt0","batchSize":5}'
```

Copy the returned `auditId`. The audit runs in bounded scheduled batches. Only
one audit for the write run can be queued or running at a time, but another can
be started after the latest audit completes or fails.

Poll the latest audit:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getSchemaCleanupAudit \
  '{"runId":"q579dkphgvjxf74kmfhkmfbzz58cadt0"}'
```

Release 2 is healthy only when the newest response has:

```json
{
  "status": "completed",
  "ready": true,
  "auditTruncated": false,
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

Also confirm `destination.matching` equals `destination.expected` and
`destination.totalRows` equals `destination.expected`.

## Compatibility monitoring window

Keep Release 2 dual writes and legacy fallbacks enabled for at least one full
production payroll cycle. During that window:

1. Repeat the compatibility audit after settings changes and after each payroll
   cutoff.
2. Record each returned `auditId`, completion time, and readiness result in the
   deployment record.
3. Check payroll previews, finalized totals, leave balances, and settings views
   for regressions.
4. Investigate any fallback-only organization, missing row, duplicate,
   mismatch, unexpected row, or source conflict before continuing.

Release 3 must not stop legacy reads or writes until the entire monitoring
window remains clean and its final audit reports `ready: true`.

## Interrupted or failed audit

If an audit remains queued or running with no `updatedAt` change for at least
five minutes, resume its saved cursor:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:resumeSchemaCleanupAudit \
  '{"runId":"q579dkphgvjxf74kmfhkmfbzz58cadt0"}'
```

An audit batch failure records `status: "failed"` and
`failureCode: "AUDIT_BATCH_FAILED"`. Diagnose the failure first. Resume the
failed audit to continue its saved phase, or start a new audit to scan again
from the beginning. Preserve previous audit records for comparison.

## Rollback

Rollback means redeploying the last verified Release 1 application and Convex
functions, which restores legacy-first reads. Keep both normalized and legacy
data in place for diagnosis. Do not delete rows, clear compatibility fields, or
attempt to reconstruct either representation manually.

After correcting the cause, redeploy Release 2, repeat every authenticated
smoke test, and start a new compatibility audit before restarting the
monitoring window.

## What Release 2 does not do

- It does not remove organization payroll or default-requirement fields.
- It does not remove payroll, attendance, cutoff, or department fields from
  `settings`.
- It does not stop legacy writes or fallbacks.
- It does not alter historical payroll, payslip, correction, settlement, or
  accounting snapshots.
- It does not authorize Release 3 without a clean monitored compatibility
  window.
