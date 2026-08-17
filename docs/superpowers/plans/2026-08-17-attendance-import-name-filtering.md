# Attendance Import Name Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require employee names in attendance files, omit non-actionable rest-day rows, and use accurate neutral processing copy.

**Architecture:** Enforce the name contract at both extraction paths, then perform exact normalized name matching in preview construction. Filter empty rest-day rows only after employee schedule resolution, while retaining named errors and punched rest days for review.

**Tech Stack:** TypeScript, React 19, Next.js 16, Zod, Vitest

## Global Constraints

- Do not accept blank, numeric, or ID-like employee values as attendance identities.
- Do not fuzzy-match names or guess an employee.
- Keep named-but-unmatched rows visible as errors.
- Do not use `any`; define exact types.

---

### Task 1: Employee-name extraction contract

**Files:**
- Modify: `apps/app/lib/attendance-import/gemini.ts`
- Modify: `apps/app/lib/attendance-import/template.ts`
- Test: `apps/app/tests/attendance-import-gemini.test.ts`
- Test: `apps/app/tests/attendance-import-template.test.ts`

**Interfaces:**
- Consumes: workbook candidates with an `employeeKey` string.
- Produces: normalized candidates whose employee identity contains a nonnumeric name.

- [x] **Step 1: Add failing tests**

Assert that Gemini response normalization drops numeric-only employee keys and that its request requires an exact workbook name. Assert that the template recognizes `Employee Name`, remains compatible with `Employee`, and drops numeric-only employee cells.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter app test -- tests/attendance-import-gemini.test.ts tests/attendance-import-template.test.ts`

Expected: FAIL because numeric employee keys are retained and `Employee Name` is not recognized.

- [x] **Step 3: Implement minimal extraction filtering**

Add a shared `hasEmployeeName(value: string): boolean` predicate that requires at least two letter-containing name parts and rejects digits. Use it in template parsing, Gemini response filtering, and the final preview boundary. Update the AI instruction to require the exact workbook employee name and forbid row numbers, ordinals, and employee IDs.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter app test -- tests/attendance-import-gemini.test.ts tests/attendance-import-template.test.ts`

Expected: PASS.

### Task 2: Name-only preview and empty rest-day filtering

**Files:**
- Modify: `apps/app/lib/attendance-import/preview.ts`
- Test: `apps/app/tests/attendance-import-preview.test.ts`

**Interfaces:**
- Consumes: normalized candidates, organization employees, and employee schedules.
- Produces: actionable preview rows matched by normalized employee names.

- [x] **Step 1: Add failing preview tests**

Assert that employee IDs no longer resolve, canonical full names are displayed after matching, empty rest-day rows are omitted, and a rest-day row with one or more punches remains visible.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter app test -- tests/attendance-import-preview.test.ts`

Expected: FAIL because IDs still resolve, source keys are displayed, and empty rest days remain.

- [x] **Step 3: Implement preview behavior**

Remove employee-ID matching, map candidates through preview construction, and filter only rows where `isRestDay` is true and both `actualIn` and `actualOut` are absent. Display the matched employee's trimmed `First Last` name.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter app test -- tests/attendance-import-preview.test.ts`

Expected: PASS.

### Task 3: Template and processing UI copy

**Files:**
- Modify: `apps/app/app/[organizationId]/attendance/_components/bulk-add-attendance-dialog.tsx`
- Modify: `apps/app/app/[organizationId]/attendance/_components/attendance-import-file-controls.tsx`
- Test: `apps/app/tests/attendance-import-client.test.ts`
- Test: `apps/app/tests/attendance-import-route.test.ts`

**Interfaces:**
- Consumes: the template fast path and transforming state.
- Produces: an `Employee Name` template and `Processing…` UI label.

- [x] **Step 1: Add failing copy tests**

Assert that the loading markup contains `Processing…` without `Gemini` and that a matching `Employee Name` CSV stays on the template fast path.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter app test -- tests/attendance-import-client.test.ts tests/attendance-import-route.test.ts`

Expected: FAIL on the old copy and old generated template header.

- [x] **Step 3: Update copy and template**

Change the processing label to `Processing…` and change the downloaded CSV header/example to `Employee Name` with a full-name example.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter app test -- tests/attendance-import-client.test.ts tests/attendance-import-route.test.ts`

Expected: PASS.

### Task 4: Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all completed changes.
- Produces: test, type, lint, and build evidence.

- [x] **Step 1: Run all attendance import tests**

Run: `pnpm --filter app test -- tests/attendance-import-archive.test.ts tests/attendance-import-client.test.ts tests/attendance-import-gemini.test.ts tests/attendance-import-payroll-correction.test.ts tests/attendance-import-preview.test.ts tests/attendance-import-route.test.ts tests/attendance-import-template.test.ts tests/attendance-import-time.test.ts tests/attendance-import-workbook.test.ts`

Expected: PASS.

- [x] **Step 2: Run TypeScript and touched-file lint**

Run: `pnpm --filter app exec tsc --noEmit`

Run ESLint for every touched source and test file. Expected: exit code 0.

- [x] **Step 3: Run the full test suite and build**

Run: `pnpm --filter app test`

Run: `pnpm --filter app build`

Expected: both commands exit 0.
