# Convex Full-Schema Cleanup Design

**Date:** 2026-08-12
**Status:** Approved architecture; implementation follows domain plans
**Supersedes:** The implementation boundary in
`2026-08-12-convex-schema-normalization-design.md`

## Objective

Review and disposition every Convex table, field, validator variant, and index;
normalize live data that is duplicated, misplaced, mutable, or unbounded; and
remove every verified legacy representation through a production-safe Release
1–3 program. The cleanup must preserve existing production data, tenant
isolation, payroll results, and immutable historical evidence.

The current schema contains 44 application and migration tables. Completion is
not measured by the number of tables split. Completion means every schema item
is machine-classified as canonical, normalized target, compatibility-only,
historical, migration-only, or removable, and every removal has production
evidence.

## Definition of full cleanup

Full cleanup includes all of the following:

1. Every table, top-level field, nested compatibility field, and index appears
   in the machine-readable inventory.
2. Every live source of truth has one documented owner.
3. Duplicate sources use expand, backfill, normalized-first reads, dual writes,
   monitoring, and contract removal.
4. Mutable collections that can grow without a practical document bound move
   to child tables with tenant and parent indexes.
5. Secrets and credentials move out of broadly projected business documents.
6. Old validator alternatives are removed when production reports zero rows.
7. Unused indexes are removed only after static reference scanning and a
   production observation report.
8. Cohesive value objects and immutable snapshots remain embedded when
   splitting them would reduce correctness or transactionality.

Full cleanup does not mechanically split every object. Employee names,
addresses, a seven-day weekly schedule, ordered evaluation-template sections,
and immutable financial snapshots are cohesive aggregates and remain embedded.

## Non-negotiable safety rules

- Production contraction never occurs in the same deployment that stops the
  final legacy read or write.
- All migrations are internal-only, idempotent, resumable, cursor-bounded, and
  preceded by a completed dry-run of the same key and version.
- A migration never guesses between conflicting non-empty sources.
- All child rows carry `organizationId` even when the parent implies it, so
  tenant invariants can be indexed and audited.
- Duplicate singleton or natural-key rows fail closed.
- Historical payroll, payslip, correction, settlement, accounting, and document
  snapshots are not rewritten merely to make the schema look uniform.
- Secrets, compensation values, bank account details, tokens, PINs, document
  bodies, and message bodies never appear in migration issues or logs.
- A field is physically removed only after zero production reads, zero writes,
  zero non-empty legacy values, complete destination equality, and a current
  backup or export.

## Complete current-table disposition

| Domain                        | Current tables                                                                                                                                                | Disposition                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization configuration    | `organizations`, `organizationPayrollSettings`, `organizationAttendanceSettings`, `organizationDepartments`, `organizationRequirementDefinitions`, `settings` | Preserve the normalized tables as canonical. Finish moving leave policy and UI preferences out of `settings`. Release 3 removes organization payroll/default-requirement compatibility fields and the migrated `settings` fields.                                                                                                                                            |
| Migration control             | `migrationRuns`, `migrationIssues`, `migrationAudits`                                                                                                         | Retain through every contract wave. Preserve redacted reports after Release 3B; remove only compatibility-specific code that no longer runs.                                                                                                                                                                                                                                 |
| Marketing intake              | `demoRequests`                                                                                                                                                | Retain as a cohesive canonical table. Add retention/expiration reporting; no normalization required.                                                                                                                                                                                                                                                                         |
| Identity and membership       | `users`, `userOrganizations`, `invitations`                                                                                                                   | Make `userOrganizations` the sole organization role, lifecycle, and employee-link owner. Remove legacy organization/role/employee/isActive fields from `users`; global account suspension belongs to the authentication account, not one employment relationship. Hash invitation tokens and remove plaintext token storage/indexing.                                        |
| Storage                       | `storageUploadIntents`, `storageObjects`                                                                                                                      | Retain as canonical ownership metadata. Add resource-link rows for attachments so parent arrays do not serve as the only ownership relationship.                                                                                                                                                                                                                             |
| Notifications                 | `notifications`                                                                                                                                               | Retain as a cohesive event table. Verify foreign-resource tenant consistency and index usage.                                                                                                                                                                                                                                                                                |
| Employee core and credentials | `employees`, `payslipPinResets`, `payslipPinAttempts`, `employeeScheduleHistory`                                                                              | Keep employee identity/employment as cohesive current state. Move payment accounts and payslip credentials to private tables. Normalize mutable requirements, deductions, incentives, and schedule overrides. Preserve effective-dated schedule history. Remove deprecated payment-frequency, leave-credit, password, and credential fields after equality/zero-value gates. |
| Time and holidays             | `attendance`, `shifts`, `holidays`                                                                                                                            | Retain canonical rows. Migrate legacy attendance `status: "leave"` to `leave_with_pay` and contract that validator. Keep holiday province lists and weekly shift values embedded as bounded aggregates.                                                                                                                                                                      |
| Payroll and offboarding       | `payrollRuns`, `finalSettlements`, `payslips`, `payslipCorrections`                                                                                           | Preserve immutable calculation and correction snapshots. Normalize mutable draft notes. Reconcile old payslip edit history into the append-only correction/audit stream, then remove only the redundant history field. Keep encrypted historical validator forms needed to read finalized records.                                                                           |
| Performance                   | `evaluationTemplates`, `evaluations`                                                                                                                          | Keep ordered template sections embedded. Normalize evaluation reviewers and append-only evaluation events/history. Remove legacy `frequencyMonths` after production count and export.                                                                                                                                                                                        |
| Leave                         | `leaveRequests`, `leaveTypes`, `settings`, `employees`                                                                                                        | Add organization leave settings and employee leave balances. Enrich `leaveTypes` as the canonical policy rows. Normalize yearly balances/overrides and remove employee/settings legacy balance sources only after reconciliation with approved requests.                                                                                                                     |
| Recruitment                   | `jobs`, `applicants`                                                                                                                                          | Keep job requirements/qualifications as bounded ordered content. Normalize applicant stage events, notes, interviews, scorecards, and offer approval events. Replace unconstrained custom-field blobs with definition-backed values.                                                                                                                                         |
| Announcements and memos       | `memoTemplates`, `memos`, `announcementComments`, `announcementLastSeen`                                                                                      | Retain memo content/current state and existing comment/last-seen rows. Normalize reactions, acknowledgements, audience members, and attachment links.                                                                                                                                                                                                                        |
| Chat                          | `conversations`, `messages`, `userChatPreferences`                                                                                                            | Preserve encrypted message bodies. Normalize conversation membership, message receipts, attachment links, and pinned-conversation rows. Remove participant/read/pin arrays after equality.                                                                                                                                                                                   |
| Documents                     | `documents`, `documentVersions`                                                                                                                               | Preserve body/version snapshots. Normalize access grants and attachment links. Retain bounded visibility policy values while removing redundant shared-user arrays after grant equality.                                                                                                                                                                                     |
| Accounting                    | `accountingCostItems`                                                                                                                                         | Retain payroll breakdowns as immutable source snapshots and manual costs as cohesive rows. Normalize receipt links; audit source-key uniqueness and unused indexes.                                                                                                                                                                                                          |
| Assets                        | `assets`                                                                                                                                                      | Retain current asset state. Normalize custody and maintenance events; remove embedded maintenance history after equality.                                                                                                                                                                                                                                                    |

Every table in `schema.ts` is named in this matrix. The implementation manifest
expands this table-level disposition to every field and index.

## Target tables

The cleanup adds focused tables only where ownership, privacy, queryability, or
unbounded growth requires them.

| Target table                         | Canonical responsibility                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `organizationLeaveSettings`          | Organization-wide accrual, regularization, conversion, guideline, form, and PDF policy.         |
| `organizationUiSettings`             | Evaluation, recruitment, requirements, and leave table presentation preferences.                |
| `organizationSettingsEvents`         | Append-only settings changes formerly embedded in `settingsChangeLog`.                          |
| `organizationCustomFieldDefinitions` | Typed employee/applicant custom-field definitions and lifecycle.                                |
| `employeeCustomFieldValues`          | Definition-backed employee custom values.                                                       |
| `applicantCustomFieldValues`         | Definition-backed applicant custom values.                                                      |
| `employeeLeaveBalances`              | Employee, leave type, and year balance/override state with reconciliation metadata.             |
| `employeeRequirements`               | Employee submissions and verification state linked to requirement definitions where applicable. |
| `employeeDeductions`                 | Mutable employee deduction schedules.                                                           |
| `employeeIncentives`                 | Mutable recurring or one-time employee incentives.                                              |
| `employeeScheduleOverrides`          | Date-specific schedule overrides; effective base schedule history remains separate.             |
| `employeePaymentAccounts`            | Private bank/payment account data with restricted projections.                                  |
| `payslipCredentials`                 | Versioned employee payslip PIN credential only; PDF passwords are removed rather than migrated. |
| `payrollRunNotes`                    | Mutable draft notes with author and timestamp.                                                  |
| `evaluationReviewers`                | Evaluation-to-reviewer assignments.                                                             |
| `evaluationEvents`                   | Append-only evaluation lifecycle history.                                                       |
| `applicantStageEvents`               | Applicant pipeline transitions.                                                                 |
| `applicantNotes`                     | Applicant notes with author and timestamp.                                                      |
| `applicantInterviews`                | Interview schedule and interviewer relationships.                                               |
| `applicantScorecards`                | Reviewer scorecards and criteria snapshots.                                                     |
| `applicantOfferEvents`               | Offer request, approval, rejection, and notes history.                                          |
| `memoReactions`                      | One reaction per memo/user/type natural key.                                                    |
| `memoAcknowledgements`               | Memo acknowledgement per employee.                                                              |
| `memoAudienceMembers`                | Materialized specific-employee or resolved department audience membership where needed.         |
| `conversationMembers`                | Conversation membership and join/leave metadata.                                                |
| `messageReceipts`                    | Per-message user delivery/read state.                                                           |
| `userPinnedConversations`            | Per-user organization conversation pin ordering.                                                |
| `documentAccessGrants`               | Explicit user/employee/department document grants.                                              |
| `storageObjectLinks`                 | Tenant-owned link from a storage object to its parent resource and purpose.                     |
| `assetCustodyEvents`                 | Assignment, acknowledgement, return, loss, and disposition history.                             |
| `assetMaintenanceEvents`             | Maintenance event history formerly embedded in assets.                                          |

Child tables use stable Convex IDs, explicit tenant and parent IDs, source-row
metadata during migration, creation/update timestamps where mutable, and the
indexes required by their actual query paths. Application code validates
natural-key uniqueness with indexed `.take(2)` checks because Convex indexes do
not enforce uniqueness.

## Fields intentionally retained as embedded values

- Organization identity and lifecycle fields.
- Employee personal and current employment value objects.
- Seven-day default schedule value objects.
- Ordered evaluation template sections.
- Job description requirements and qualifications.
- Holiday province applicability lists.
- Final-settlement bounded workflow aggregates and release evidence.
- Finalized payroll draft/dependency/summary snapshots.
- Payslip employee, calculation, contribution, and encrypted amount snapshots.
- Payslip correction before/after values.
- Accounting payroll breakdown snapshots.
- Document version bodies.

These fields still appear in the full manifest. Their classification is
`canonical_embedded` or `historical_snapshot`, not “unreviewed.”

## Full manifest and contract evidence

Create a schema inventory module and test that enumerate all 44 current tables,
all new target tables, all fields in migration scope, and every declared index.
The allowed classifications are:

- `canonical_row`
- `canonical_embedded`
- `normalized_target`
- `compatibility_read`
- `compatibility_write`
- `historical_snapshot`
- `migration_only`
- `removable`

Each compatibility/removable entry includes its canonical destination,
migration key, first compatible release, Release 3 gate, and whether a redacted
count/export is required. CI compares the manifest against `schema.ts` and
fails when a table or index is unclassified. Contract tests scan production
Convex and application code for forbidden legacy references.

Static absence is necessary but not sufficient for removing an index or field.
Each contract report also records production row counts, non-empty value
counts, destination equality, duplicate/orphan counts, and the audit timestamp.

## Release program

The already deployed organization-configuration work is Wave A. It remains in
Release 2 compatibility mode while the remaining domains advance.

### Release 1B: Inventory, identity, and credentials expansion

- Add the complete manifest and contract-report framework.
- Add membership/employee natural-key indexes and audit duplicate/orphan links.
- Add private employee payment/credential tables.
- Add hashed invitation token compatibility fields.
- Backfill without switching reads.

### Release 1C: Leave and employee-child expansion

- Add organization leave settings, leave balances, requirements, deductions,
  incentives, schedule overrides, and custom-field targets.
- Backfill every organization/employee in bounded pages.
- Reconcile balances with approved leave requests; report rather than guess.

### Release 1D: Workflow expansion

- Add recruitment and evaluation targets.
- Backfill parent documents and validate tenant/parent integrity.
- Preserve ordered timestamps and source IDs for deterministic idempotency.

### Release 1E: Communication and document expansion

- Add memo, chat, document-access, and storage-link targets.
- Backfill parent documents and validate tenant/parent integrity.
- Preserve ordered timestamps and source IDs for deterministic idempotency.
- Keep accounting receipt links and asset-event targets in the final
  payroll/assets wave.

### Release 1F: Global expansion audit

- Audit all legacy sources against every normalized destination.
- Verify source/destination and parent/tenant row counts.
- Run idempotency writes with zero changes.
- Resolve all conflicts before any remaining domain switches.

### Release 2B–2D: Domain compatibility switches

- Switch each expanded domain to normalized-first reads.
- Dual-write normalized and legacy locations in the same Convex transaction.
- Expose fallback-source telemetry and repeatable equality audits.
- Compare payroll, leave, employee, recruitment, communication, and document
  results before and after each switch.

Each Release 2 wave is independently deployable and reversible. A failure in a
later domain does not require rolling back domains that completed their audit.

### Release 2E: Full compatibility window

- Keep every remaining fallback and dual write active for at least one complete
  production payroll cycle.
- Repeat audits after settings changes, employee lifecycle changes, leave
  approvals, payroll finalization, invitations, recruitment actions, document
  sharing, chat usage, and asset updates.
- Block Release 3 on any fallback-only source, mismatch, duplicate, orphan,
  tenant violation, or unexpected row.

### Release 3A: Stop legacy use and clear approved data

- Stop every legacy write.
- Remove compatibility reads only after the final audit reports zero fallback.
- Clear confirmed deprecated secrets and removable values.
- Retain optional schema validators during the rollback window.
- Produce the final contract-readiness report and redacted export references.

### Release 3B: Physical contract

- Remove verified legacy fields and obsolete validator alternatives.
- Remove verified unused indexes.
- Remove compatibility adapters and completed backfill entry points.
- Retain redacted migration/audit history and historical decoders.

Release 3A and 3B are separate deployments within one Release 3 program. This
is required so the application that no longer reads a field is live before the
schema stops accepting that field. There is no Release 4.

## Migration orchestration

Each domain has a distinct migration key and version rather than one global
cursor. A domain run contains phases for source audit, destination backfill,
destination equality, unexpected-row scanning, and contract readiness.

The existing `migrationRuns`, `migrationIssues`, and `migrationAudits` tables
remain the control plane. New runs use the same guarantees already proven in
production:

- bounded pagination;
- persisted cursor and counters;
- scheduled continuation;
- explicit failed state;
- stale-run resume;
- dry-run prerequisite for writes;
- paginated redacted issues;
- repeatable post-write audits.

A global readiness query aggregates the latest successful audit for every
required domain/version. It cannot report ready if a domain is absent, stale,
truncated, failed, conflicting, or has nonzero discrepancies.

## Read and write behavior

Release 1 additions do not change application behavior. Release 2 adapters
resolve a domain using normalized rows when the domain migration marker exists;
an intentionally empty normalized child collection remains empty rather than
resurrecting legacy values.

Release 2 mutations validate authorization, tenant ownership, duplicate natural
keys, and cross-resource references before either representation is modified.
Convex transaction rollback guarantees that normalized and legacy projections
cannot partially commit.

Release 3A makes normalized rows the only read/write source. Historical
decoders are not compatibility fallbacks: they remain only for immutable data
created under older encodings.

## Failure handling and rollback

- Release 1 rollback leaves additive target rows in place and restores no data.
- Release 2 rollback redeploys the prior domain adapter and retains both
  representations for diagnosis.
- Release 3A rollback is allowed only while legacy validators/data remain; it
  redeploys the final Release 2 compatibility build.
- Release 3B rollback requires the verified pre-contract backup/export and a
  schema-compatible restoration deployment. No automated code guesses deleted
  values.

Systemic errors fail the run. Record-level conflicts are redacted and paginated.
Destructive clearing stops on the first violated contract gate.

## Verification invariants

Every wave verifies:

1. Full manifest coverage for all current and target tables and indexes.
2. No duplicate singleton, membership, or domain natural keys.
3. Every child and referenced resource belongs to the same organization.
4. Source/destination equality and expected row counts.
5. No unexpected destination rows or orphaned storage links.
6. Every active employee login has exactly one active membership link.
7. Alumni access remains limited to finalized self payslips and explicitly
   alumni-visible documents.
8. Leave balances reconcile with policy, explicit overrides, and approved
   usage or produce a conflict.
9. Payroll preview/final totals and employee inclusion are unchanged.
10. Finalized payroll, payslip, correction, settlement, accounting, and document
    snapshots remain readable and byte/business-value stable.
11. A second write execution changes zero rows.
12. Every Release 3 removal has zero code references, zero non-empty legacy
    values, current audit evidence, and a backup/export reference.

## Test strategy

- Manifest coverage and forbidden-reference contract tests.
- Planner unit tests for every legacy variant, conflict, and empty collection.
- Convex integration tests for dry-run, pagination, resume, idempotency,
  duplicate rejection, tenant mismatch, and rollback-on-error.
- Authenticated query/mutation tests proving normalized-first reads and atomic
  dual writes for every domain.
- Security regression tests for inactive memberships and private credentials.
- Payroll and leave parity fixtures at production-relevant boundaries.
- Full application tests, TypeScript, focused lint, dependency audit, generated
  bindings, diff hygiene, and production Next.js build before every deployment.

## Implementation decomposition

This program is too large for one safe implementation plan. It will be executed
through independently reviewable plans in this order:

1. Full manifest and global readiness framework.
2. Identity, membership, credentials, and invitations.
3. Leave settings, balances, and employee child records.
4. Recruitment and evaluation event normalization.
5. Communication, document access, and storage links.
6. Asset events, payroll mutable histories, and remaining compatibility
   validators/indexes.
7. Release 2 domain switches and parity monitoring.
8. Release 3A stop/clear and Release 3B physical contract.

Each plan uses test-driven implementation, a code-review checkpoint, its own
production runbook, and an explicit deployment gate. No plan may remove a
legacy field before the Release 3 contract plans.
