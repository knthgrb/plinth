# Payroll Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payroll calculation, lifecycle, accounting, security, and auditing safe enough for statutory and financial records while preserving existing draft regeneration behavior.

**Architecture:** Keep the payroll calculation mutation as the orchestrator, but move cross-cutting rules into focused pure modules: effective-dated statutory rules, lifecycle policy, journal construction, sensitive-field crypto, and append-only operational events. Drafts remain editable; posted runs gain stable identities, immutable history, reversible accounting, and independent archival metadata.

**Tech Stack:** TypeScript, Convex, Next.js, Vitest, `@noble/ciphers`, `@noble/hashes`

**Spec:** The approved user requirements in the 2026-08-20 conversation and the payroll audit findings referenced there.

## Global Constraints

- Implement every approved audit finding without another specification review.
- Preserve unrelated workspace changes and do not commit or push unless requested.
- Do not introduce `any`; replace `any` in touched boundaries with explicit Convex and domain types.
- Use failing behavior tests before each implementation change.
- Financial and audit records are append-only after posting; corrections and voids create new records.
- Sensitive writes fail closed in production if field encryption is unavailable.

---

### Task 1: Payroll calculation invariants

**Files:**
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/payrollUtils.ts`
- Test: `apps/app/tests/payroll-regeneration-behavior.test.ts`
- Test: `apps/app/tests/payroll-run-duplicates.test.ts`
- Test: `apps/app/tests/final-pay-payroll.test.ts`
- Test: `apps/app/tests/leave-benefit-payroll.test.ts`

**Interfaces:**
- Produces: validated payroll inputs, canonical employee deduplication, default-enabled tax recalculation, posted-only 13th-month sources, canonical separated-employee final-pay eligibility, and duplicate special-run prevention.

- [x] Add a test where an incentive-only `updatePayslip` edit changes taxable gross and therefore changes Withholding Tax.
- [x] Add a test where the run has no employee government setting and the edit still recalculates tax.
- [x] Run the focused tests and confirm both fail for the missing recalculation branches.
- [x] Recalculate withholding whenever taxable incentives or variable earnings change; treat an absent employee tax setting as enabled and an explicit disabled setting as disabled.
- [x] Add failing boundary tests for duplicate employee IDs, reversed cutoffs, negative/non-finite amounts, duplicate annual benefit runs, unposted 13th-month source runs, and canonical separated status.
- [x] Implement capped, normalized input validation and special-run uniqueness guards.
- [x] Run all focused payroll calculation tests.

### Task 2: Effective-dated statutory rules

**Files:**
- Create: `apps/app/lib/ph-statutory-rules.ts`
- Modify: `apps/app/utils/ph-statutory-contributions.ts`
- Modify: `apps/app/convex/sss.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/schema.ts`
- Test: `apps/app/tests/ph-statutory-contributions.test.ts`
- Test: `apps/app/tests/payroll-calculations.test.ts`

**Interfaces:**
- Produces: `resolvePhStatutoryRuleSet(effectiveAt)` and a persisted `statutoryRuleVersion` on each payroll run.

- [x] Add table-driven tests for the Pag-IBIG 1% employee tier at monthly compensation up to PHP 1,500, the 2% tier above it, PhilHealth floors/ceilings, and rule-set date selection.
- [x] Run tests and confirm the current global constants fail the Pag-IBIG and version-selection cases.
- [x] Define immutable rule sets keyed by `version` and `effectiveFrom`, and make contribution calculators consume a resolved rule set.
- [x] Resolve the version from cutoff end for new previews/runs and persist it when the run is created.
- [x] Ensure regeneration uses the run's stored version so a later rule release cannot rewrite historical drafts silently.
- [x] Run statutory and payroll calculation tests.

### Task 3: Operational event backbone

**Files:**
- Create: `apps/app/convex/operationalEvents.ts`
- Create: `apps/app/convex/operationalEventCrypto.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/attendance.ts`
- Modify: `apps/app/convex/attendanceIntegrity.ts`
- Modify: `apps/app/convex/employees.ts`
- Test: `apps/app/tests/operational-events.test.ts`

**Interfaces:**
- Produces: `appendOperationalEvent(ctx, event)` with actor, role, aggregate, timestamp, correlation/idempotency keys, changed fields, encrypted payload, and tamper-evident previous/current hashes; authorized audit queries return metadata and decrypted details.

- [x] Add tests proving events record who/when/what, preserve aggregate history after source deletion, reject duplicate idempotency keys, and form a valid hash chain.
- [x] Run the new tests and confirm the event API/table is absent.
- [x] Add the append-only schema, typed append helper, encryption boundary, hash-chain construction, and capped authorized query.
- [x] Emit events in the same mutation for payroll create/regenerate/review/finalize/pay/archive/void/discard/correct, centralized attendance audits, and employee create/update/separate/rehire/archive.
- [x] Run event, attendance, employee, and payroll tests.

### Task 4: Payroll lifecycle, authorization, archive, void, and correction history

**Files:**
- Create: `apps/app/lib/payroll-lifecycle.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/services/payroll-service.ts`
- Modify: `apps/app/actions/payroll.ts`
- Modify: `apps/app/app/[organizationId]/payroll/payroll-page-client.tsx`
- Modify: `apps/app/app/[organizationId]/payroll/_components/payroll-runs-table.tsx`
- Test: `apps/app/tests/payroll-lifecycle.test.ts`
- Test: `apps/app/tests/payroll-regeneration-overrides.test.ts`

**Interfaces:**
- Produces: independent `archivedAt`/`archivedBy`, terminal `voided` state with reason, maker-checker role policy, idempotent same-state requests, draft-only hard deletion, and encrypted append-only correction versions.

- [x] Add tests for allowed transitions and roles: HR/accounting may prepare/review, owner/admin finalize, owner/admin/accounting pay, paid cannot revert, and same-state requests create no duplicate side effects.
- [x] Add tests proving archive does not change financial status or remove accounting, only drafts can be discarded, and void requires a reason.
- [x] Run tests and confirm current transition and deletion behavior fails.
- [x] Add lifecycle metadata (`finalizedBy/At`, `paidBy/At`, `archivedBy/At`, `voidedBy/At/reason`) and enforce the policy in the mutation.
- [x] Replace archived-as-status UI actions with archive/unarchive metadata; retain read compatibility for legacy archived rows.
- [x] Preserve every posted payslip revision in an encrypted correction snapshot and route paid-run deltas to a pending adjustment rather than treating them as already paid.
- [x] Run lifecycle and regeneration tests.

### Task 5: Balanced payroll accounting

**Files:**
- Create: `apps/app/convex/payrollAccounting.ts`
- Create: `apps/app/lib/payroll-journal.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/accounting.ts`
- Test: `apps/app/tests/payroll-accounting-journal.test.ts`
- Test: `apps/app/tests/accounting-payroll-cost-groups.test.ts`

**Interfaces:**
- Produces: idempotent journal posting by stable source key, balanced debit/credit lines, payroll-payable settlement on employee payment, outstanding statutory liabilities, correction adjustments, and reversal journals for voids.

- [x] Add literal journal tests that independently prove debits equal credits and classify wages, employer contributions, net payroll payable, government payables, tax payable, and other deductions.
- [x] Add integration tests proving finalize posts once, pay settles only payroll payable, correction posts only a delta, void reverses instead of deleting, and display-name changes cannot duplicate sources.
- [x] Run tests and confirm current cost-item synchronization fails these contracts.
- [x] Add journal entry/line tables and typed posting helpers using `sourceType/sourceKey/sourceVersion` indexes.
- [x] Replace organization-wide display-name scans with indexed source lookups; retain cost items only as compatibility projections and encrypt their breakdowns.
- [x] Run accounting and payroll lifecycle tests.

### Task 6: Sensitive-data encryption and fail-closed behavior

**Files:**
- Modify: `apps/app/convex/appEncryption.ts`
- Modify: `apps/app/convex/fieldEncryption.ts`
- Modify: `apps/app/convex/payslipCrypto.ts`
- Modify: `apps/app/convex/payrollRunCrypto.ts`
- Create: `apps/app/convex/employeePaymentAccountCrypto.ts`
- Modify: `apps/app/convex/leaveEmployeeCompatibility.ts`
- Modify: `apps/app/convex/schema.ts`
- Test: `apps/app/tests/field-encryption.test.ts`
- Test: `apps/app/tests/payroll-sensitive-data-encryption.test.ts`

**Interfaces:**
- Produces: domain-separated string/number/JSON encryption, strict ciphertext decryption, production configuration assertion, encrypted payroll summaries, correction snapshots, journal metadata, audit payloads, and bank details.

- [x] Add tests proving sensitive database payloads do not contain plaintext and corrupted ciphertext throws rather than becoming zero/empty data.
- [x] Add environment tests proving production-sensitive writes reject a missing/weak key while legacy development reads remain supported.
- [x] Run tests and confirm current fail-open/fallback behavior fails.
- [x] Require a 32-byte production key, add string encryption helpers, remove catch-and-zero/empty fallbacks for encrypted financial fields, and encrypt all sensitive write boundaries.
- [x] Run encryption and payroll tests with and without a test encryption key.

### Task 7: Viewer authorization, UI disclosure, and scale safeguards

**Files:**
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/services/payroll-service.ts`
- Modify: `apps/app/app/[organizationId]/payroll/payroll-page-client.tsx`
- Test: `apps/app/tests/payroll-finalize-dialog.test.ts`
- Test: `apps/app/tests/payroll-regeneration-behavior.test.ts`
- Test: `apps/app/tests/payroll-employee-filters.test.ts`

**Interfaces:**
- Produces: least-privilege payslip PDF context query, the approved regeneration disclosure, indexed lookups, bounded mutation inputs, and deterministic employee maps.

- [x] Add an employee-viewer test proving the employee can obtain only their own PDF context without the staff recipient query.
- [x] Add a UI behavior test for the complete regeneration disclosure and separate keep/discard edit semantics.
- [x] Run focused tests and confirm the authorization and disclosure gaps.
- [x] Add the scoped query and update PDF services; replace `(api as any)` in touched service methods with generated typed API calls.
- [x] Use indexed accounting/source queries, sets/maps for employee/line reconciliation, and explicit batch-size limits with actionable validation errors.
- [x] Run all focused tests, lint/type checks, and the complete app test suite.

### Task 8: Final verification and self-review

**Files:**
- Review: every file changed by Tasks 1-7
- Update: `apps/app/tests/fixtures/schema-inventory.reviewed.json` only if schema readiness tests require regenerated inventory through the repository's supported workflow.

**Interfaces:**
- Consumes: every preceding task's tests and public interfaces.
- Produces: a verified, reviewable workspace change set with no known skipped finding.

- [x] Run focused statutory, payroll, accounting, audit, encryption, attendance, employee, and UI tests.
- [x] Run `pnpm --filter app test` and `pnpm --filter app build`.
- [x] Run `pnpm --filter app lint` and inspect every new warning/error in changed files.
- [x] Review `git diff --check`, `git diff --stat`, and the complete diff for accidental secrets, plaintext financial snapshots, destructive accounting behavior, or introduced `any`.
- [x] Map every original finding to code and test evidence before reporting completion.
