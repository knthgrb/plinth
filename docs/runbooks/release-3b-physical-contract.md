# Release 3B Physical Contract Runbook

Release 3B removes the legacy validators and plaintext invitation-token index.
It is intentionally a separate Convex deployment from Release 3A.

## Deployment gate

Immediately before deployment, run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

Do not deploy unless `readyForRelease3B` is true and `release3Blockers` is an
empty array. Retain the Release 3A backup/export reference for rollback.

## Deploy

Deploy the Release 3B commit using the normal production pipeline. This commit
contains the strict normalized schema and must not be deployed before the gate.

After deployment:

- Run critical authentication, organization switching, leave, payroll,
  payslip, invitation, document, chat, recruitment, and asset smoke tests.
- Run `databaseMigrations:getFullSchemaCleanupReadiness` again.
- Keep the maintenance window open until the application and Convex logs show
  no schema-validation or missing-normalized-projection errors.

## Rollback

Redeploy the Release 3A schema-compatible commit first. If a legacy application
must be restored, restore the recorded Release 3A export before deploying it.
