# Release 2B Identity and Credentials Compatibility Runbook

This release switches live identity and credential behavior. It does not remove
or clear legacy fields. Run all commands from the repository root and keep the
production Release 1B write run ID available.

## 1. Pre-deploy gate

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Before deploying Release 2B, all six additive domains must have `status:
"ready"`. On the Release 2B deployment, the same response must report:

- `readyForRelease2: true`;
- `readyForRelease3: false`;
- no additive domain blockers; and
- Release 3 blockers for Releases 2C–2F and the compatibility window.

`readyForRelease3: true` from an older deployment was the old additive-only
meaning. Do not use that old value to authorize legacy removal.

## 2. Deploy and smoke-test

Deploy the application and Convex functions normally. Then verify the behavior
contract and persisted equality evidence:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:getIdentityCredentialsCompatibilityStatus \
  '{}'
```

Expected immediately after deploy:

```text
normalizedReadsEnabled: true
dualWritesEnabled: true
legacyFallbacksEnabled: true
equalityEvidenceReady: true
blockers: []
```

If equality evidence is not ready, stop. Do not disable fallbacks or proceed to
Release 2C until the named migration/audit blocker is resolved.

Smoke-test these production flows with test accounts:

1. An active employee opens a finalized payslip and verifies the existing PIN.
2. The employee changes or resets the PIN and verifies it again.
3. An alumni employee can open only their former organization's historical
   payslips and cannot open settings, employee, payroll, or attendance pages.
4. HR creates an invitation and the recipient can preview and accept it.
5. HR resends a pending invitation; the new link works and the old link no
   longer works.
6. A removed or suspended membership cannot use a matching legacy
   `users.organizationId` or privileged `users.role` to enter the organization.

Never paste raw invitation tokens, PIN hashes, reset tokens, or email links into
logs, tickets, or migration issues.

## 3. Repeat equality audit after live traffic

Use the completed Release 1B write run ID, not a dry-run ID:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsAudit \
  '{"runId":"IDENTITY_WRITE_RUN_ID","batchSize":5}'
```

Poll the audit:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:getIdentityCredentialsAudit \
  '{"runId":"IDENTITY_WRITE_RUN_ID"}'
```

The audit must complete with `ready: true`, no source conflicts, and destination
missing/duplicate/mismatched/unexpected counts all zero. Review every paginated
issue row even when the summary is clean:

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:listIdentityCredentialsAuditIssues \
  '{"auditId":"AUDIT_ID","paginationOpts":{"numItems":100,"cursor":null}}'
```

Continue with each returned cursor until `isDone: true`.

## 4. Verify idempotency

```bash
pnpm --filter app exec convex run --prod \
  identityMigrations:startIdentityCredentialsMigration \
  '{"dryRun":true,"batchSize":20}'
```

Poll the returned run ID. It must complete with `canStartWrite: true`, zero
conflicts/errors, and `changed: 0`. Do not start another write run when the
idempotency dry-run is already zero-change.

## 5. Compatibility window

Keep normalized-first reads, legacy fallbacks, and dual writes enabled through
at least one complete production payroll cycle. Repeat the audit after PIN
changes/resets, invitation issue/resend/accept, membership role changes,
employee resignations, suspensions, removals, and organization switches.

Release 3 remains blocked until Releases 2C–2F are deployed and their own
compatibility evidence is clean. Release 2B alone never authorizes Release 3A
or 3B.

## Rollback

Redeploy the application revision immediately before Release 2B. Do not delete
normalized rows and do not copy data manually. Dual writes keep the legacy
credential and token projections usable by the previous revision. Investigate
and correct the cause, rerun the dry-run and audit, then redeploy Release 2B.
