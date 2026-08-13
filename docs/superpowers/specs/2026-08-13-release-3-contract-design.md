# Release 3A/3B Contract Design

## Objective

Complete the Convex schema-normalization program in one controlled maintenance
window using two mandatory deployments. Release 3A makes normalized tables the
only live source and provides an audited destructive cleanup. Release 3B runs
only after that cleanup is proven complete and removes the legacy physical
contract from `schema.ts` and production code.

## Deployment boundary

Release 3 is one operational change with two Convex deployments because strict
schema validation cannot remove fields from documents before a deployed
function clears those fields.

### Deployment 1: Release 3A

- Remove `COMPATIBILITY_WINDOW_NOT_COMPLETED` after verifying all six domain
  registrations are switched and all current migration audits are ready.
- Make every compatibility loader normalized-only. A missing normalized row is
  an error, not permission to resurrect a legacy value.
- Stop every legacy projection write while preserving unrelated parent fields.
- Keep legacy fields optional in `schema.ts` so existing documents remain valid
  until cleanup succeeds.
- Add a versioned, resumable Release 3 cleanup with dry-run prerequisite,
  redacted issues, bounded batches, export acknowledgement, and final audit.
- Preserve rollback data until the cleanup command is explicitly authorized.

### Deployment 2: Release 3B

- Require a completed clean Release 3 cleanup audit.
- Remove the verified legacy fields and obsolete indexes from `schema.ts`.
- Remove compatibility fallbacks, dual-write branches, deprecated migration
  entry points, and legacy projection code.
- Retain normalized adapters where they provide stable public API projections.
- Retain migration/audit history and immutable historical decoders.

## Release 3A activation and cleanup gates

Release 3A readiness is fail-closed. The control plane validates the latest
write and audit for all six migration keys, requires every audit to be
completed, untruncated, conflict-free, and exact, and verifies all four final
idempotency dry-runs are completed with zero changes, conflicts, and errors.

The cleanup has separate commands:

1. `startRelease3ContractCleanup` with `dryRun: true` inventories every
   removable value and reports redacted counts.
2. `acknowledgeRelease3ContractExport` records an operator-supplied export
   reference without storing exported data or secrets.
3. `startRelease3ContractCleanup` with `dryRun: false` requires the clean
   dry-run ID and export acknowledgement.
4. `startRelease3ContractAudit` proves every approved legacy value is absent
   and every normalized target remains exact.
5. `getRelease3ContractReadiness` is the sole Release 3B deployment gate.

No function accepts an organization filter. The contract applies to all
organizations so a forgotten tenant cannot retain an invalid physical shape.

## Removed live projections

Release 3A stops reading and writing these parent projections; Release 3B
removes their validators after cleanup:

- `organizations`: `firstPayDate`, `secondPayDate`,
  `salaryPaymentFrequency`, `defaultRequirements`;
- `users`: `organizationId`, `role`, `employeeId`, `isActive`;
- `invitations`: plaintext `token` and its plaintext lookup index;
- `employees`: `compensation.paymentFrequency`,
  `compensation.bankDetails`, `schedule.scheduleOverrides`, `leaveCredits`,
  `requirements`, `deductions`, `incentives`, `customFields`,
  `payslipPinHash`, and `payslipPdfPassword`;
- `settings`: normalized payroll, attendance, department, leave, UI, and event
  projections plus deprecated `payrollFrequency`, `taxTable`, and
  `payrollSettings.payrollTabPassword`;
- `evaluations`: `frequencyMonths`, `assignedReviewerIds`, and `history`;
- `applicants`: stage history, notes, interviews, scorecards, offer approval,
  and custom fields;
- `memos`: reactions, acknowledgements, explicit audience arrays, attachments,
  and attachment content types;
- `conversations`: `participants`;
- `messages`: `readBy` and normalized attachment links;
- `userChatPreferences`: `pinnedConversations`;
- `leaveRequests`: `supportingDocuments`;
- `documents`: attachment and access arrays;
- `accountingCostItems`: `receipts`;
- `payrollRuns`: mutable `notes`;
- `assets`: custody fields and `maintenanceHistory`;
- `payslips`: mutable `editHistory` after its corrections are verified.

The existing attendance status field remains canonical. It is not removed
merely because older records used legacy status spellings; its normalization is
an in-place value contract rather than a child-table projection.

## Preserved data

Release 3 never clears or removes immutable business history, including
payroll-run draft/dependency/summary snapshots, final-settlement snapshots,
payslip employee and calculation snapshots, document versions, accounting
breakdowns, finalized payroll records, payslip corrections, migration runs,
migration audits, or redacted migration issues.

## Runtime behavior

Normalized rows are authoritative even when the logical child set is empty.
Where an empty collection cannot be represented by row presence alone, the
parent record remains as an identity shell and the normalized query returns an
empty collection; it never falls back to removed fields.

All mutations validate authorization, tenant ownership, natural-key
uniqueness, and referenced-resource ownership before updating normalized rows.
Parent mutations continue to update canonical non-projection fields in the
same transaction.

## Failure and rollback

- Before destructive cleanup, rollback redeploys the final Release 2 build.
- During cleanup, systemic errors fail the run; record conflicts are redacted
  and block continuation.
- After cleanup but before Release 3B, rollback requires the recorded export
  and the Release 2 schema-compatible application.
- After Release 3B, rollback requires both the export and a schema-restoration
  deployment. No code reconstructs deleted legacy values from guesses.

## Verification

Release 3A must pass normalized-only behavior tests, forbidden legacy write and
fallback reference tests, authorization/security tests, migration dry-run and
write prerequisite tests, resumability, export acknowledgement, idempotency,
and final audit tests. Release 3B must pass an exact reviewed schema inventory,
zero forbidden legacy fields/indexes, generated Convex bindings, the entire
application suite, TypeScript, focused ESLint, production dependency audit,
and a production webpack build.

