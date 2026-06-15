# Doc Request Bugs Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the next batch from the request doc: approved leave form download, approval proxy wording, payroll/attendance bugs, leave table polish, and build fixes.

**Architecture:** Prefer small helpers for behavior that can be tested without a browser, and keep UI changes inside the existing leave/payroll/attendance components. Reuse existing request form content, signature fields, payroll auth/password patterns, and table components where available.

**Tech Stack:** Next.js app router, React, Convex, Vitest, ESLint, TypeScript.

---

### Task 1: Establish Build Baseline

**Files:**
- Inspect only: app package scripts and current errors

- [ ] Run `pnpm --filter app exec tsc --noEmit --pretty false`.
- [ ] Run `pnpm --filter app build`.
- [ ] Record failures before editing.

### Task 2: Approved Leave Download and Proxy Wording

**Files:**
- Modify: `apps/app/app/[organizationId]/leave/_components/review-leave-dialog.tsx`
- Modify: `apps/app/components/leave/leave-request-template.ts`
- Create or modify helper if needed under `apps/app/utils/`

- [ ] Add a testable helper for reviewer display text if repeated.
- [ ] Add an approved leave download button that exports/prints the filled form with employee signature and reviewer approval metadata.
- [ ] Make reviewer/proxy wording explicit using existing `approvedByName`, `reviewerPosition`, and `reviewerSignatureDataUrl`.

### Task 3: Payroll Bugs

**Files:**
- Inspect and modify payroll UI components under `apps/app/app/[organizationId]/payroll/`
- Modify payroll backend only if active/resigned filtering is incomplete.

- [ ] Remove visible `+/-` controls/labels from payroll where the doc references them.
- [ ] Ensure resigned employees do not appear in payroll employee lists.
- [ ] Add or reuse payroll tab password gate, keeping password configurable if an existing settings path exists.
- [ ] Preserve existing payslip PDF employee-ID password behavior unless build shows otherwise.

### Task 4: Attendance Undertime and Bulk Scroll

**Files:**
- Modify: `apps/app/app/[organizationId]/attendance/page.tsx`
- Modify: `apps/app/utils/attendance-calculations.ts` if behavior is reusable/testable.
- Test: focused Vitest test if helper changes are made.

- [ ] Trace current AM/PM undertime highlight logic.
- [ ] Make morning undertime mark AM time red.
- [ ] Fix bulk attendance employee list scrolling by constraining the scroll container height.

### Task 5: Leave Table Polish and Verification

**Files:**
- Modify leave table components only where needed.

- [ ] Adjust wrapping, column sizing, or badges introduced by leave history pay/cutoff/manual entries.
- [ ] Run focused tests for changed helpers.
- [ ] Run `pnpm --filter app exec tsc --noEmit --pretty false`.
- [ ] Run `pnpm --filter app build`.
- [ ] Run focused ESLint on changed files and report any pre-existing app-wide lint issues separately.
