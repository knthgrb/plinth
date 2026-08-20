# Leave Policy Model Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the enforced organization leave model, anniversary benefit, statutory synchronization, canonical balances, scheduled entitlement, and qualifying-event request workflows.

**Architecture:** Make the effective-dated organization model authoritative for active company entitlement policies while preserving immutable historical policy versions and ledgers. Synchronize protected statutory presets idempotently, route anniversary grants according to the active model, and connect event-based statutory requests to auditable benefit-event verification.

**Tech Stack:** TypeScript, React, Next.js, Convex, Vitest, convex-test.

**Spec:** `docs/superpowers/specs/2026-08-20-leave-policy-model-completion-design.md`

## Global Constraints

- Preserve legacy settings, balances, and request history.
- Private defaults to pooled; government is fixed to by-type.
- Exactly one company leave model governs new entitlement periods.
- Model transitions never delete or rewrite historical balances.
- Private Vacation and Sick Leave are opt-in company policies.
- Statutory synchronization is idempotent and cannot overwrite organization versions.
- SIL coverage cannot produce an additive grant.
- Ledger postings are effective-dated and idempotent.
- Do not add explicit `any`.
- Follow test-first red-green-refactor for each behavior.

---

### Task 1: Enforced Organization Company Model

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/leavePolicies.ts`
- Modify: `apps/app/lib/leave/client-state.ts`
- Test: `apps/app/tests/leave-policy-administration.test.ts`
- Test: `apps/app/tests/leave-settings-ui.test.ts`

**Interfaces:**
- Produces an effective organization model and a future-dated transition mutation.
- Company policy writes validate account behavior against the model effective on the version start date.

- [ ] Write tests for private pooled default, government by-type enforcement, conflicting policy rejection, future transition, and preserved historical rows.
- [ ] Run focused tests and observe expected failures.
- [ ] Add the schema field, setup defaults, query fallback, and mutation with operational audit event.
- [ ] Run focused tests until green and refactor duplicated default resolution.

### Task 2: Statutory Synchronization and SIL Coverage

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/leavePolicies.ts`
- Modify: `apps/app/convex/leaveMigration.ts`
- Modify: `apps/app/convex/leaveAccrual.ts`
- Test: `apps/app/tests/leave-policy-administration.test.ts`
- Test: `apps/app/tests/leave-v2-migration.test.ts`
- Test: `apps/app/tests/leave-accrual.test.ts`

**Interfaces:**
- Produces idempotent `synchronizeStatutoryPolicies` and optional `coveredByPolicyId` on statutory policies.
- Migration activation and new setup invoke the same synchronizer.

- [ ] Write tests for missing preset insertion, replay, migrated general-policy SIL coverage, and non-additive shared-pool grants.
- [ ] Run focused tests and observe expected failures.
- [ ] Add coverage validation, statutory synchronization, and activation integration.
- [ ] Run focused tests until green and preserve statutory baseline/version protections.

### Task 3: Canonical Active Balance Query

**Files:**
- Modify: `apps/app/convex/leave.ts`
- Test: `apps/app/tests/leave-ledger-review.test.ts`

**Interfaces:**
- `getLeaveBalanceAdministration` returns only canonical V2 balance projections.

- [ ] Add a fixture containing canonical and legacy rows and assert only canonical rows are returned.
- [ ] Run the test and observe the duplicate-row failure.
- [ ] Filter through a canonical indexed field contract while preserving pagination behavior.
- [ ] Run focused ledger and migration tests until green.

### Task 4: Complete Scheduled Entitlement Materialization

**Files:**
- Modify: `apps/app/lib/leave/policy-engine.ts`
- Modify: `apps/app/convex/leaveAccrual.ts`
- Test: `apps/app/tests/leave-policy-engine-v2.test.ts`
- Test: `apps/app/tests/leave-accrual.test.ts`

**Interfaces:**
- Materializes monthly, annual, semiannual, and anniversary postings.
- Anniversary amount equals completed service years capped by `annualUnits`.

- [ ] Add literal expected-value tests for each schedule, eligibility boundary, cap, replay, and service window.
- [ ] Run tests and observe failures for non-monthly methods.
- [ ] Generalize scheduled posting periods and stable idempotency keys.
- [ ] Run focused tests until green and verify cumulative rounding never exceeds the cap.

### Task 5: Model-aware Anniversary Configuration

**Files:**
- Modify: `apps/app/components/settings/leave-types-settings-content.tsx`
- Modify: `apps/app/components/settings/leave-policy-create-dialog.tsx`
- Modify: `apps/app/components/settings/leave-policy-editor.tsx`
- Modify: `apps/app/lib/leave/client-state.ts`
- Test: `apps/app/tests/leave-settings-ui.test.ts`

**Interfaces:**
- Enforced organization model; organization anniversary enablement, cap, and basis.
- Anniversary is pooled under the shared model and individual under by-type.

- [ ] Add mutation, accrual, and view-model tests for enabling, disabling, cap, basis, and model-aware routing.
- [ ] Run tests and observe expected failures.
- [ ] Implement accessible model-transition and anniversary controls with mutation feedback.
- [ ] Run focused UI tests and TypeScript until green.

### Task 6: Event-based Statutory Filing

**Files:**
- Modify: `apps/app/convex/leaveQualifications.ts`
- Modify: `apps/app/convex/leave.ts`
- Modify: `apps/app/convex/leaveOccurrences.ts`
- Modify: `apps/app/app/[organizationId]/leave/_components/leave-request-drawer.tsx`
- Modify: `apps/app/lib/leave/employee-workspace.ts`
- Test: `apps/app/tests/leave-request-lifecycle-v2.test.ts`
- Test: `apps/app/tests/employee-leave-workspace.test.ts`

**Interfaces:**
- Event policies create or select a benefit event and link it to the request.
- HR verification advances the linked request; rejection closes it with an audit trail.

- [ ] Write failing tests for maternity variants, event/request linkage, authorization, tenant isolation, verification, and rejection.
- [ ] Run focused tests and observe the missing end-to-end workflow.
- [ ] Implement typed draft fields, atomic pending-event request creation, verification transitions, and statutory duration ceilings.
- [ ] Wire the employee drawer to collect event details and evidence.
- [ ] Run focused lifecycle, privacy, payroll-reconciliation, and UI tests until green.

### Task 7: Verification and Review

**Files:**
- Update generated Convex types if required.
- Update schema inventory fixtures only through the repository's inventory command.

- [ ] Run all focused leave tests.
- [ ] Run the full app test suite.
- [ ] Run TypeScript and schema inventory checks.
- [ ] Run the production build.
- [ ] Review the final diff against every design requirement and fix all critical or important findings.
