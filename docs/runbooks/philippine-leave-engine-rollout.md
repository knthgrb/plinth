# Philippine Leave Engine Rollout

## Preview

For each organization, build a `planOrganizationLeaveMigration` preview from its retained leave settings, legacy balances, and approved-request count. Confirm that `employmentSector` is absent for existing organizations, general mode maps only to `__plinth_general_leave__`, and every opening-entry sum equals its legacy balance.

Do not select a private or government preset during migration. An Owner makes that sector decision after activation.

## Batch migration

Run `runOrganizationLeaveMigrationBatch` with a small employee-balance page (start with 50) and retain its cursor until it is absent. Re-run the same plan and cursor range to verify `createdRows` is zero. The executor only appends canonical policies, versions, balances, and append-only opening ledger entries; it does not edit legacy balances, settings, or requests.

## Compare

Run `compareOrganizationLeaveMigration` after the final batch. All of the following must be empty before activation:

- `policyMismatches`
- `requestMismatches`
- `balanceMismatches`

Any `migration_reconciliation` entry marks the organization `reconciliation_required`. Resolve it from the source evidence and produce a fresh zero-mismatch plan; do not activate it by accepting the discrepancy.

## Activate

Call `activateOrganizationLeaveEngine` only after comparison is clean and no reconciliation is required. The activation gate returns `activated: true` only in that case. Persist `migrationState: "active"` and `activePolicyEngineVersion: 2` in `organizationLeaveSettings`; normal leave reads must then use V2 policies and must not fall back to legacy settings or balances.

## Roll back before activation

Before activation, keep `migrationState` out of `active` and stop batch execution. Do not delete ledger entries or overwrite migration rows. Fix the preview input or add an offsetting, separately reviewed correction, then re-run compare. An active organization requires a forward migration or an append-only reversal plan, never a destructive rollback.

## Verification commands

```bash
pnpm --filter app exec vitest run tests/leave-v2-migration.test.ts tests/leave-employee-migration-planner.test.ts tests/leave-employee-children-schema.test.ts tests/full-schema-readiness.test.ts
pnpm --filter app exec tsc --noEmit
pnpm --filter app exec eslint convex/leaveMigration.ts convex/leaveMigrationPlanner.ts convex/organizationConfiguration.ts tests/leave-v2-migration.test.ts
git diff --check
```
