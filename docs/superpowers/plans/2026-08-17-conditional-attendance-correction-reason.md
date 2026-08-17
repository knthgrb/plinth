# Conditional Attendance Correction Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the payroll correction reason in bulk attendance only when selected rows affect finalized payroll and the current member can submit a reason-based correction.

**Architecture:** Extend the exact employee/date import preflight into a batch review that returns conflicts, locked entries, and correction permission. Keep visibility derivation in a small pure client helper and retain mutation authorization as the security boundary.

**Tech Stack:** TypeScript, React 19, Next.js 16, Convex, Vitest

## Global Constraints

- Do not weaken or remove server-side finalized-payroll authorization.
- Do not use `any`; define exact interfaces for new data.
- Match payroll locks by employee ID and normalized Manila attendance date.
- Excluded file rows and excluded manual dates must not trigger the correction field.

---

### Task 1: Batch payroll-lock review

**Files:**
- Modify: `apps/app/convex/attendance.ts`
- Test: `apps/app/tests/attendance-hardening.test.ts`

**Interfaces:**
- Consumes: exact `{ employeeId, date }` pairs and existing attendance/payroll authorization helpers.
- Produces: `getAttendanceImportReview` returning `{ conflicts, lockedEntries, canCorrectWithReason }`.

- [ ] **Step 1: Write failing Convex tests**

Add tests that call `api.attendance.getAttendanceImportReview` for an owner and HR member. Assert that a July 2026 row in the finalized fixture is returned in `lockedEntries`, an August row is not, owners receive `canCorrectWithReason: true`, and HR receives `false`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter app test -- tests/attendance-hardening.test.ts`

Expected: FAIL because `getAttendanceImportReview` does not exist.

- [ ] **Step 3: Implement the review action**

Add an internal batch query that authenticates once, loads effective attendance policy, finds finalized payroll coverage for each unique employee/date pair, and returns conflict records plus normalized locked entries and permission. Add a public action that chunks up to 10,000 unique entries in batches of 100 and merges the results.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter app test -- tests/attendance-hardening.test.ts`

Expected: PASS.

### Task 2: Conditional bulk-dialog UI

**Files:**
- Create: `apps/app/lib/attendance-import/payroll-correction.ts`
- Modify: `apps/app/app/[organizationId]/attendance/_components/bulk-add-attendance-dialog.tsx`
- Test: `apps/app/tests/attendance-import-payroll-correction.test.ts`

**Interfaces:**
- Consumes: normalized locked entries returned by `getAttendanceImportReview` and selected rows shaped as `{ employeeId, date, included }`.
- Produces: `hasIncludedPayrollLockedRows(rows, lockedEntries): boolean`.

- [ ] **Step 1: Write failing helper tests**

Cover no locked rows, an included locked row, an excluded locked row, a different employee on the same date, and two timestamps on the same Manila calendar date.

- [ ] **Step 2: Run the helper test and verify RED**

Run: `pnpm --filter app test -- tests/attendance-import-payroll-correction.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the helper and wire the preflight**

Implement the pure helper without `any`. Replace `getAttendanceImportConflicts` usage with `getAttendanceImportReview`, pass `review.conflicts` into reconciliation, and derive locked state separately for file and manual modes. Render the textarea only when locked selected rows exist and `canCorrectWithReason` is true. Otherwise render a blocking notice for locked rows and disable submission. Keep ordinary imports free of payroll correction UI.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter app test -- tests/attendance-import-payroll-correction.test.ts tests/attendance-hardening.test.ts`

Expected: PASS.

### Task 3: Regression verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed backend and UI changes.
- Produces: verification evidence.

- [ ] **Step 1: Run attendance/import test suites**

Run: `pnpm --filter app test -- tests/attendance-hardening.test.ts tests/attendance-import-payroll-correction.test.ts tests/attendance-import-preview.test.ts tests/attendance-import-client.test.ts tests/attendance-import-route.test.ts`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run lint**

Run: `pnpm --filter app lint`

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run: `pnpm --filter app build`

Expected: exit code 0.
