# Identity, Membership, and Credentials Release 1B Runbook

Release 1B additively backfills legacy organization memberships, payslip PIN
credentials, and invitation-token hashes into their normalized targets. It does
not remove legacy fields or indexes, clear PDF passwords, rewrite historical
snapshots, or switch application reads away from their current compatibility
paths.

## Before running

1. Deploy the application and Convex schema/functions from this release before
   invoking any command below.
2. Confirm the deployment includes the `identityMigrations` functions and the
   `payslipCredentials` table.
3. Confirm a current production Convex backup or export is available.
4. Run commands from the Plinth repository root and confirm the Convex CLI is
   linked to the intended production project.
5. Keep the raw command output as migration evidence. It contains identifiers,
   counters, and redacted issue codes—not invitation tokens, credential hashes,
   PINs, emails, or employee names.

Every command uses `--prod`, which selects the linked production deployment
even when local environment variables point to development.

## 1. Start the production dry-run

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsMigration \
  '{"dryRun":true,"batchSize":20}'
```

Copy the returned `runId` as `DRY_RUN_ID`. The command schedules bounded
background batches and can return while the run is still queued or running.

Poll the run until `run.status` is `completed`:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:getIdentityCredentialsMigrationRun \
  '{"runId":"DRY_RUN_ID"}'
```

The status response contains only a bounded issue preview. Page through every
issue before proceeding:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:listIdentityCredentialsMigrationIssues \
  '{"runId":"DRY_RUN_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

When `isDone` is `false`, replace `null` with the returned
`continueCursor` and repeat until `isDone` is `true`.

Do not start write mode unless all of these conditions are true:

- `run.status` is `completed`;
- `run.counters.conflicts` is `0`;
- `run.counters.errors` is `0`;
- `canStartWrite` is `true`;
- every issue page has been reviewed;
- the dry-run did not expose a role, employee, organization, membership,
  credential, lifecycle-status, or invitation-token-hash conflict.

`run.counters.changed` during dry-run is the number of planned additive writes.
Dry-run does not change memberships, credentials, invitations, or other
business rows.

If a queued or running dry-run has not updated for at least five minutes, resume
its saved phase and cursor:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:resumeIdentityCredentialsMigration \
  '{"runId":"DRY_RUN_ID"}'
```

If a run is `failed`, retain it for diagnosis and start a new dry-run after the
underlying issue is fixed. A failed or completed migration run cannot resume.

## 2. Start the additive write

Use the exact conflict-free dry-run ID reviewed above:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsMigration \
  '{"dryRun":false,"dryRunId":"DRY_RUN_ID","batchSize":20}'
```

Copy the returned ID as `WRITE_RUN_ID`, then poll it:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:getIdentityCredentialsMigrationRun \
  '{"runId":"WRITE_RUN_ID"}'
```

Proceed only when the write has `status: "completed"`, `conflicts: 0`, and
`errors: 0`. The migration never overwrites a conflicting membership or
credential and never replaces a mismatched invitation hash.

If an active write is stale for at least five minutes, resume it with:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:resumeIdentityCredentialsMigration \
  '{"runId":"WRITE_RUN_ID"}'
```

## 3. Run the persisted post-write audit

Start the audit only after the write completes cleanly:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsAudit \
  '{"runId":"WRITE_RUN_ID","batchSize":5}'
```

Copy the returned `auditId` as `AUDIT_ID`, then poll by write-run ID:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:getIdentityCredentialsAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

Page through every issue attached to this exact audit:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:listIdentityCredentialsAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Repeat with each returned `continueCursor` until `isDone` is `true`.

The audit is acceptable only when all of the following are true:

- `status` is `completed`;
- `ready` is `true`;
- `sourceConflicts` is `0`;
- `auditTruncated` is `false`;
- `destination.missing` is `0`;
- `destination.duplicate` is `0`;
- `destination.mismatched` is `0`;
- `destination.unexpected` is `0`;
- `destination.matching` equals `destination.expected`;
- every audit issue page has been reviewed.

If the audit is `failed`, or if a queued/running audit has not updated for at
least five minutes, resume its saved phase and cursor:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:resumeIdentityCredentialsAudit \
  '{"runId":"WRITE_RUN_ID"}'
```

## 4. Prove idempotency

Start another dry-run after the clean audit:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll the new run with `getIdentityCredentialsMigrationRun` and page through its
issues. The completed post-write dry-run must have:

- `changed: 0`;
- `conflicts: 0`;
- `errors: 0`;
- `canStartWrite: true`.

Do not start a second write merely to prove idempotency. The zero-change dry-run
is the required check.

## 5. Confirm global readiness remains fail-closed

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Accept this release only when:

- `organization_configuration` is `ready` with no blockers;
- `identity_credentials` is `ready` with no blockers and reports the clean
  audit ID;
- `leave_employee_children`, `workflow_events`,
  `communications_documents`, and `assets_payroll_compatibility` remain
  `not_started` with `DOMAIN_IMPLEMENTATION_NOT_DEPLOYED`;
- `readyForRelease3` is exactly `false`.

`readyForRelease3: false` is the correct result. Do not remove legacy fields or
indexes and do not begin Release 3 contraction.

## Rollback boundary

Before write mode, rollback is application and Convex redeployment only; the
dry-run has not changed business data.

After write mode, redeploy the prior application if necessary but leave the
additive `userOrganizations`, `payslipCredentials`, and invitation `tokenHash`
data in place. Do not delete backfilled rows, clear legacy values, restore
plaintext-only invitation state, clear PDF passwords, or rewrite payslip and
payroll snapshots as an ad-hoc rollback.

## Release boundary

This release backfills normalized targets and hashes newly issued invitation
tokens, while current application reads remain on their compatibility paths.
Release 2 owns normalized-first read switching and broader dual writes. Release
3 remains reserved for contraction only after every cleanup wave is deployed
and has current, clean production audit evidence.
