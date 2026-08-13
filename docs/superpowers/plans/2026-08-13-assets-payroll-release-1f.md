# Assets and Payroll Compatibility Release 1F

## Goal

Complete the final additive full-schema migration wave without deleting or changing any legacy production field.

## Scope

- Project `payrollRuns.notes` into `payrollRunNotes`.
- Project `accountingCostItems.receipts` into `storageObjectLinks` using the existing storage metadata contract.
- Project current asset custody timestamps into immutable `assetCustodyEvents`.
- Project `assets.maintenanceHistory` into `assetMaintenanceEvents`.
- Add resumable dry-run, write, verification, audit, issue paging, readiness, and production runbook operations.
- Keep all legacy fields as compatibility writes until Release 3B.

## Safety invariants

- Every projection has a stable source index and logical unique index.
- Tenant, parent, employee, user, and storage metadata mismatches are conflicts.
- Existing unequal or duplicate destination rows are conflicts and are never overwritten.
- Write mode requires a completed conflict-free dry-run.
- Audit reruns the planner, scans every owned destination, and rejects missing, duplicate, mismatched, or unexpected rows.
- Other domains sharing `storageObjectLinks` are ignored by this domain's audit.
- No legacy field or index is removed in this release.

## Verification

1. Planner unit tests.
2. Migration and persisted audit integration tests.
3. Full-schema readiness tests.
4. Schema inventory snapshot.
5. TypeScript, ESLint, full Vitest suite, production build, and dependency audit.
