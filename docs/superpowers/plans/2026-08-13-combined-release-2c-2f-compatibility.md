# Combined Release 2C–2F Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch all four remaining cleanup domains to normalized-first reads and transactional dual writes in one deployable compatibility release.

**Architecture:** Four typed compatibility modules reconstruct existing public shapes from normalized child tables and synchronize legacy/normalized projections atomically. The modules fail closed on duplicates and tenant mismatches while keeping legacy fallbacks during the monitored rollback window.

**Tech Stack:** TypeScript, Convex, Vitest, Next.js.

## Global Constraints

- No Release 3 field clearing, schema contraction, validator removal, or index removal.
- No secret, compensation value, payment account, token, document body, or message body in compatibility reports.
- No new `any` type.
- All domain switches deploy together but retain independent audits and blockers.

---

### Task 1: Leave and employee-child compatibility

**Files:**
- Create: `apps/app/convex/leaveEmployeeCompatibility.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/leave.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/attendance.ts`
- Test: `apps/app/tests/leave-employee-compatibility.test.ts`

**Interfaces:**
- Produces normalized-first loaders for settings/employees/balances and mutation helpers that replace normalized child projections.

- [ ] Write behavior tests for normalized precedence, authoritative empty sets, legacy fallback, atomic dual writes, duplicates, and tenant mismatch.
- [ ] Run the focused test and verify the missing compatibility behavior fails.
- [ ] Implement typed loaders and replacement helpers using the natural-key indexes from `schema.ts`.
- [ ] Route all live leave/employee/settings/payroll/attendance consumers through the helpers.
- [ ] Run the focused and existing leave/payroll/employee suites.

### Task 2: Workflow compatibility

**Files:**
- Create: `apps/app/convex/workflowCompatibility.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/evaluations.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Test: `apps/app/tests/workflow-compatibility.test.ts`

**Interfaces:**
- Produces effective evaluation/applicant/settings loaders and transactional child-set replacement helpers.

- [ ] Write failing tests for reviewer/event/applicant/UI normalized precedence, fallback, empty sets, dual writes, and duplicate rejection.
- [ ] Implement the compatibility module using normalized table indexes and stable `sourceIndex` ordering.
- [ ] Route evaluation, recruitment, and settings mutations/readers through it.
- [ ] Run workflow, recruitment, evaluation, and settings tests.

### Task 3: Communications and documents compatibility

**Files:**
- Create: `apps/app/convex/communicationsCompatibility.ts`
- Modify: `apps/app/convex/announcements.ts`
- Modify: `apps/app/convex/memos.ts`
- Modify: `apps/app/convex/chat.ts`
- Modify: `apps/app/convex/documents.ts`
- Modify: `apps/app/convex/leave.ts`
- Test: `apps/app/tests/communications-compatibility.test.ts`

**Interfaces:**
- Produces effective memo/chat/document projections and atomic child/link synchronization helpers.

- [ ] Write failing tests for normalized precedence, membership/grant authorization, attachment links, receipts, pins, dual writes, and duplicate rejection.
- [ ] Implement typed projection/load/write helpers.
- [ ] Route memo, announcement, chat, document, and leave-attachment paths through them.
- [ ] Run communication, document, chat, lifecycle, and public-function tests.

### Task 4: Assets, accounting, and payroll compatibility

**Files:**
- Create: `apps/app/convex/assetsPayrollCompatibility.ts`
- Modify: `apps/app/convex/assets.ts`
- Modify: `apps/app/convex/accounting.ts`
- Modify: `apps/app/convex/payroll.ts`
- Test: `apps/app/tests/assets-payroll-compatibility.test.ts`

**Interfaces:**
- Produces effective asset/accounting/payroll projections and atomic event/link/note synchronization helpers.

- [ ] Write failing tests for event/note/link precedence, fallback, authoritative empty sets, dual writes, and tenant mismatch.
- [ ] Implement typed loaders and synchronization helpers.
- [ ] Route live asset, accounting, and payroll note consumers through them.
- [ ] Run asset, accounting, and payroll tests.

### Task 5: Combined readiness and operations

**Files:**
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/convex/leaveEmployeeMigrations.ts`
- Modify: `apps/app/convex/workflowMigrations.ts`
- Modify: `apps/app/convex/communicationsMigrations.ts`
- Modify: `apps/app/convex/assetsPayrollMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`
- Create: `docs/runbooks/combined-release-2c-2f-compatibility.md`

**Interfaces:**
- Produces independent domain compatibility evidence plus combined program readiness.

- [ ] Write failing readiness tests requiring all four domain switches while preserving `COMPATIBILITY_WINDOW_NOT_COMPLETED`.
- [ ] Add fail-closed compatibility status queries backed by the latest completed clean write/audit for each migration key.
- [ ] Mark the four switches deployed and retain the monitored-window blocker.
- [ ] Document one deployment, four audits/idempotency checks, smoke tests, observation window, and rollback.

### Task 6: Final verification

- [ ] Run `pnpm --filter app exec vitest run`.
- [ ] Run `pnpm --filter app exec tsc --noEmit`.
- [ ] Run focused ESLint on every new and modified compatibility path.
- [ ] Run `pnpm --filter app schema:inventory` and update the reviewed discovery baseline only for explained production references.
- [ ] Run `pnpm audit --prod`, `pnpm --filter app exec next build --webpack`, and `git diff --check`.
- [ ] Review authorization, secrets, tenant checks, normalized precedence, transaction boundaries, readiness, and runbook commands before committing.
