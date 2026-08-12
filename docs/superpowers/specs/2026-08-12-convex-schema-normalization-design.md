# Convex Schema Normalization Design

**Date:** 2026-08-12
**Status:** Superseded by `2026-08-12-convex-full-schema-cleanup-design.md`

This document records the organization-configuration tranche that is already
deployed. The superseding design expands the same migration guarantees across
all 44 current Convex tables and reserves all physical legacy removal for the
Release 3 contract program.

## Objective

Make Plinth's Convex database cohesive and maintainable without losing existing
production data or changing historical payroll results. The migration uses an
expand, backfill, switch, verify, and contract sequence across multiple
deployments. No legacy field is removed in the same release that introduces its
replacement.

## Safety rules

1. Migrations are internal-only, idempotent, cursor-based, resumable, and scoped
   to bounded batches.
2. A dry-run across every organization must complete before any write run.
3. Existing values are copied before application reads or writes change.
4. Conflicting sources are reported and never resolved by guessing.
5. Contract migrations are blocked until value equality, row-count, tenant, and
   payroll invariants pass.
6. Historical payroll, payslip, correction, settlement, and accounting
   snapshots remain immutable and may intentionally stay denormalized.
7. Removal of a field requires both zero live code use and a production data
   report. Non-empty unused fields require an export or an explicit canonical
   destination before deletion.

## Audit baseline

The current schema contains 31 application tables and approximately 511
top-level fields. The first static usage scan identified these categories:

- Organization identity is mixed with payroll cadence and requirement policy.
- The `settings` row mixes payroll, attendance, leave, departments, document
  layout, and user-interface configuration.
- Global `users` rows still contain legacy single-organization membership
  fields even though `userOrganizations` is the many-to-many source of truth.
- Several mutable, growing collections are embedded in parent documents.
- Compatibility validators still accept old formats for departments,
  attendance leave status, payroll snapshots, and leave tracking.
- Some apparently unused indexes and fields need production telemetry before
  contraction because static absence does not prove external or dashboard use.

Each release generates a machine-readable field manifest for the fields in its
normalization scope, classifying them as `canonical`, `compatibility_read`,
`migration_only`, `historical_snapshot`, or `removable`. The manifests must
cover every schema field before the final contract release can begin.

## Target ownership boundaries

### Organization identity

`organizations` retains only company identity and lifecycle data:

- name, address, phone, email, tax ID
- active/archive status and archive audit fields
- created and updated timestamps

The following fields move out:

- `firstPayDate`, `secondPayDate`, and `salaryPaymentFrequency` move to
  `organizationPayrollSettings`.
- `defaultRequirements` moves to `organizationRequirementDefinitions`.

### Payroll configuration

Create one `organizationPayrollSettings` row per organization with a unique
organization index. It owns:

- pay frequency and pay dates
- cutoff dates
- statutory and premium-rate overrides
- daily-rate policy
- tax deduction timing
- holiday/no-work policy
- non-taxable benefit policy
- configuration version and timestamps

The current organization payroll cadence is the authoritative source during
backfill because it is actively read. Any non-empty legacy
`settings.payrollFrequency` value is compared and reported when it conflicts;
it is not allowed to overwrite active production behavior.

`settings.taxTable` and `settings.payrollSettings.payrollTabPassword` are
removal candidates. The password has no canonical destination. Both fields must
first be counted, exported when non-empty, cleared, and verified.

### Attendance configuration

Create one `organizationAttendanceSettings` row per organization. It owns lunch,
grace, rounding, shift, overnight, rest-day, geofence, import, and payroll-lock
policies currently embedded under `settings.attendanceSettings`.

### Leave configuration

Create one `organizationLeaveSettings` row per organization for organization-wide
leave policy, PDF layout, guidelines, accrual behavior, regularization rules,
and conversion limits.

Enhance the existing `leaveTypes` table to become the canonical per-type policy
source. Backfill the richer objects currently in `settings.leaveTypes` into
rows without overwriting an existing conflicting row. Conflicts are migration
issues requiring review.

Employee leave balances and yearly tracker rows are not contracted in the first
release. They remain live sources until a later tranche introduces canonical
`employeeLeaveBalances` rows and reconciles discrepancies between employee
credits, yearly tracker overrides, and approved leave requests.

### Organization structure and requirements

Create `organizationDepartments` rows with stable IDs rather than department
names as relationships. Rows own name, color, department head, cost center,
location, and optional parent department ID. Existing string departments are
assigned deterministic default colors. Duplicate normalized names are reported.

Create `organizationRequirementDefinitions` for reusable organization
requirements. Employee submissions later move from the embedded employee array
to `employeeRequirements`, referencing a definition where applicable while
preserving custom requirements and attachment IDs.

### Interface preferences

Create one `organizationUiSettings` row for configurable evaluation,
recruitment, requirement, and leave table columns. These are presentation
preferences and should not share a document with payroll rules.

### Identity and employment links

`userOrganizations` remains the canonical organization membership, role,
lifecycle access status, and employee link. Add and use an
organization/employee index before removing legacy user fields.

The fields `users.organizationId`, `users.role`, `users.employeeId`, and
`users.isActive` cannot be contracted until every backend compatibility fallback
has been removed and production verifies that every active employee account has
exactly one valid membership link for that organization.

### Credentials and tokens

- Move `employees.payslipPinHash` into a private `payslipCredentials` table.
- Remove employee and payslip-snapshot PDF password compatibility fields after
  the existing cleanup reports zero rows.
- Replace invitation plaintext tokens with token hashes through a separate
  dual-read migration. Raw invitation tokens are shown only when created and
  are never stored after the switch.

### Embedded collections

Normalize mutable, potentially unbounded collections in later focused tranches:

- employee deductions and incentives
- employee requirements
- applicant notes, interviews, scorecards, and pipeline history
- memo acknowledgements and reactions
- message read receipts
- asset maintenance history
- settings change history and payroll edit history

Small immutable snapshots remain embedded where atomic historical reproduction
is more important than independent querying.

## Historical data that remains denormalized

The cleanup must not rewrite finalized historical representations merely to make
the dashboard look tidy. These remain snapshot-oriented:

- `payslips.employeeSnapshot` and encrypted payroll amounts
- finalized `payrollRuns.draftConfig`, dependency snapshots, and summary
  snapshots
- payslip correction before/after amounts
- final settlement release records
- accounting payroll breakdowns
- document versions and audit histories

Legacy string snapshot variants can be read through compatibility decoders, but
are not rewritten unless a separate checksum-verified migration proves byte and
business-value equivalence.

## Migration control plane

Create `migrationRuns` and `migrationIssues` tables plus internal functions in
`databaseMigrations.ts`.

Each run records a stable migration key, mode, phase, cursor, batch size,
status, scanned/changed/skipped/conflict/error counts, start/completion times,
and the deployed migration version. Only one active run per migration key is
allowed.

The CLI entry point starts one all-organizations run:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:startSchemaCleanup \
  '{"dryRun":true}'
```

The starter schedules bounded internal batches. Each batch checkpoints its
cursor before scheduling the next one. An interrupted run can resume from its
last successful cursor. A write run requires the ID and version of a completed
dry-run so production data cannot be modified without a matching audit.

`migrationIssues` contains identifiers and reason codes but excludes secrets,
compensation values, bank details, and document content.

## Release sequence

### Release 1: Expand and audit

- Add target tables, indexes, migration control tables, and optional compatibility
  fields.
- Add field classification and migration tests.
- Deploy without changing canonical application reads.
- Run the all-organizations dry-run and resolve duplicates or conflicts.
- Run idempotent backfills and verify them.

### Release 2: Switch with compatibility

- Read from normalized tables with a temporary legacy fallback.
- Dual-write normalized and legacy locations in the same mutation.
- Expose migration telemetry for fallback reads and mismatches.
- Compare payroll outputs, leave balances, and settings responses before and
  after the switch.

### Release 3: Stop legacy use

- Stop legacy writes.
- Remove compatibility reads after telemetry reaches zero.
- Run contract-readiness verification across every organization.
- Clear confirmed deprecated values while retaining validators for one release.

### Release 4: Contract

- Remove verified legacy fields and unused indexes from `schema.ts`.
- Remove compatibility branches and migration-only code.
- Retain migration reports and a redacted production export reference.

## Verification invariants

Every phase must verify:

1. Exactly one canonical settings row of each applicable domain per
   organization.
2. Source and destination setting values match after normalization.
3. Organization, employee, membership, payslip, payroll-run, and leave-request
   row counts do not unexpectedly change.
4. Every child row has the same organization as its parent resource.
5. At most one membership links a given organization/employee pair.
6. Every active employee login resolves to an active organization membership.
7. Payroll previews and stored finalized totals are unchanged.
8. Payslip and finalized payroll snapshots remain readable.
9. Employee leave balances and approved leave usage reconcile or are explicitly
   reported as conflicts.
10. A second execution of each completed backfill changes zero rows.

## Failure handling and rollback

Backfills only insert or copy during the expand phase, so rollback means
switching reads back to legacy sources while retaining new rows for inspection.
Contract deployment is prohibited until the monitored compatibility window has
passed. Migration batches stop on systemic errors but record individual data
conflicts and continue when doing so is safe.

Database backups or exports must be confirmed before each destructive contract
step. No automated rollback attempts to reconstruct deleted legacy fields from
application guesses.

## Testing

- Convex tests cover dry-run no-write behavior, cursor continuation,
  idempotency, all-organization coverage, conflict reporting, and resumability.
- Migration fixtures include missing settings, duplicate settings, old string
  departments, mixed leave formats, conflicting pay frequencies, alumni users,
  and historical encrypted payroll snapshots.
- Contract tests scan production-code references and reject removal when a
  legacy field remains live.
- Full application tests, TypeScript, focused lint, dependency audit, and a
  production build run before each release.

## Initial implementation boundary

The first implementation tranche delivers the migration control plane,
field-classification report, normalized organization payroll/attendance
settings, organization departments and requirement definitions, and the
all-organizations dry-run/backfill runner. High-risk identity, leave-balance,
invitation-token, and embedded-history contractions follow as separately
verified tranches using the same framework.
