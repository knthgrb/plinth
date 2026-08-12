# Full-Schema Cleanup Release 1B Inventory Checkpoint Runbook

Release 1B deploys the full-schema inventory and global readiness queries. It
does not create target business tables, backfill data, clear legacy values,
remove fields, remove validators or indexes, or change application reads and
writes.

## Before running

1. Deploy the Release 1B application and Convex code first. Do not run these
   checks against a deployment that does not contain the inventory and readiness
   queries.
2. Run commands from the Plinth repository root and confirm the Convex CLI is
   linked to the intended production deployment.
3. This is an inventory checkpoint, not a migration. Do not start, resume, or
   otherwise invoke a migration from this runbook.
4. Run `pnpm --filter app schema:inventory`. The command must pass before
   deployment. It compares every parsed table field path and index name with
   the checked-in reviewed SHA-256 inventory. Any schema-item drift requires an
   intentional review and fixture update.

Every Convex command below uses `--prod`, which selects the linked production
deployment even if local environment variables point to development. Both
queries are read-only and return policy and audit metadata only; no business-row
values or secrets.

## Inspect the complete inventory

Run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaInventory \
  '{}'
```

Accept the checkpoint inventory only when all of the following are true:

- `currentTableCount` is exactly `44`.
- `tables` contains exactly `44` rows.
- Each current schema table has exactly one corresponding policy row: no table
  is missing and no table appears more than once.
- Every returned policy row includes its domain, disposition, default field
  classification, default index classification, and release gate.

Stop and investigate any count mismatch, duplicate table row, or missing table
policy before proceeding. The query intentionally returns table-policy
metadata; the static reviewed inventory check is the field/index review gate.

## Inspect global readiness

Run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

The response must contain exactly six domain rows. For the deployed Release 1B
checkpoint, accept only this safe readiness state:

- `organization_configuration` has `status: "ready"` and no blockers. This is
  the existing deployed organization-configuration audit API and evidence.
- `identity_credentials`, `leave_employee_children`, `workflow_events`,
  `communications_documents`, and `assets_payroll_compatibility` each have
  `status: "not_started"` with
  `DOMAIN_IMPLEMENTATION_NOT_DEPLOYED` as the blocker.
- `readyForRelease3` is exactly `false`.

`readyForRelease3: false` is the correct safe result. It must remain false
until every domain wave is deployed and has completed current, clean audit
evidence. Do not treat a false result as a failure to bypass; it blocks Release
3 contraction while domains remain undeployed.

If organization configuration is not `ready`, or any undeployed domain has a
status other than `not_started`, stop and investigate the reported blockers.
Statuses such as `running`, `failed`, `blocked`, or `stale` are not eligible
for Release 3.

## Checkpoint boundary and rollback

These commands perform no data writes. Release 1B does no backfill, clearing,
schema contraction, or production data mutation. There is therefore no
database rollback or data restoration procedure for this checkpoint.

If the deployed application needs to be reverted, redeploy the prior
application/Convex build only. Leave all production data untouched and retain
the returned policy and audit metadata evidence for diagnosis.

## Next plan

The next plan is the identity, membership, credentials, and invitation Release
1B migration. That plan owns its additive schema changes, bounded audit and
backfill workflow, and its own production gate. Do not begin those migrations
from this inventory checkpoint runbook.
