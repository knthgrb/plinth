# Combined Release 2C–2F Production Runbook

This release switches the remaining four schema-cleanup domains together. It
does not remove or clear legacy fields. Keep the previously audited migration
write-run IDs available throughout the rollout.

## 1. Pre-deployment gate

Run from the repository root:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Every domain must be `ready`, `readyForRelease2` must be `true`, and there must
be no migration, conflict, or audit blocker. Before this application release,
the four compatibility-switch blockers are expected.

## 2. Deploy once

Deploy the application and Convex functions from the same tested commit. Do
not deploy a subset of the four compatibility modules and do not run any
Release 3 clearing command.

## 3. Smoke-test all four switches

Use a production test organization and make one reversible change in each
domain:

1. Leave/employee: add and remove a test deduction or update a test leave
   configuration value.
2. Workflow: assign an evaluation reviewer or add an applicant note.
3. Communications: add/remove an announcement reaction and update a test
   document grant.
4. Assets/payroll: add a test asset maintenance row or a payroll-run note.

Confirm the UI immediately reflects each write. A mutation error must be
investigated before continuing; do not manually patch only one representation.

## 4. Repeat the six audits

Use the clean write-run ID for each domain:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanupAudit \
  '{"runId":"<organization-configuration-write-run-id>","batchSize":5}'

pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsAudit \
  '{"runId":"<identity-write-run-id>","batchSize":5}'

pnpm --filter app exec convex run --prod \
  leaveEmployeeMigrations:startLeaveEmployeeAudit \
  '{"runId":"<leave-employee-write-run-id>","batchSize":5}'

pnpm --filter app exec convex run --prod \
  workflowMigrations:startWorkflowAudit \
  '{"runId":"<workflow-write-run-id>","batchSize":5}'

pnpm --filter app exec convex run --prod \
  communicationsMigrations:startCommunicationsAudit \
  '{"runId":"<communications-write-run-id>","batchSize":5}'

pnpm --filter app exec convex run --prod \
  assetsPayrollMigrations:startAssetsPayrollAudit \
  '{"runId":"<assets-payroll-write-run-id>","batchSize":5}'
```

Poll each matching `get...Audit` function until `status: 'completed'`. Require
`ready: true`, zero source conflicts, zero missing/mismatched/duplicate/
unexpected destination rows, and `auditTruncated: false`. Page every audit's
issue query and require an empty result.

## 5. Verify idempotency

Run a fresh dry-run for each of the four newly switched domains:

```bash
pnpm --filter app exec convex run --prod leaveEmployeeMigrations:startLeaveEmployeeMigration '{"dryRun":true,"batchSize":20}'
pnpm --filter app exec convex run --prod workflowMigrations:startWorkflowMigration '{"dryRun":true,"batchSize":20}'
pnpm --filter app exec convex run --prod communicationsMigrations:startCommunicationsMigration '{"dryRun":true,"batchSize":20}'
pnpm --filter app exec convex run --prod assetsPayrollMigrations:startAssetsPayrollMigration '{"dryRun":true,"batchSize":20}'
```

Poll every run. Each must complete with zero `changed`, `conflicts`, and
`errors`; `canStartWrite` may remain `true` because the run is clean, but do not
start another write migration.

## 6. Confirm combined readiness

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Expected after deployment:

- all six domains are `ready`;
- `readyForRelease2: true`;
- no `COMPATIBILITY_SWITCH_PENDING:*` blockers;
- `readyForRelease3: false` with only
  `COMPATIBILITY_WINDOW_NOT_COMPLETED`.

## 7. Observation window and rollback

Observe one complete production payroll cycle. During the window, repeat the
audits after representative employee, leave, recruitment, communication,
document, accounting, asset, and payroll writes. Record the audit IDs and
timestamps.

If a normalized-first read or dual write is defective, redeploy the previous
Release 2B application commit. Do not delete normalized rows and do not copy
data backward manually. Fix the compatibility path, redeploy, repeat all
audits and idempotency checks, and restart the observation window.

Release 3A may begin only after the complete payroll-cycle window and repeated
clean evidence. Release 3B removal remains a separate later deployment.
