# Leave and Employee Children Release 1C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Additively normalize organization leave policy, leave types and balances, and mutable employee child collections without deleting or switching any production legacy source.

**Architecture:** New tenant-owned child tables receive deterministic, idempotent projections from `settings` and `employees`. A pure planner compares every natural key and payload, while cursor-bounded internal migration and audit functions persist redacted conflicts and block writes unless an exact completed dry-run is clean. Approved leave requests are evidence for balance reconciliation; discrepancies are reported and never guessed or overwritten.

**Tech Stack:** TypeScript, Convex schema/functions/scheduler, `convex-test`, Vitest.

## Global Constraints

- Preserve every existing production source field and historical snapshot in this release.
- Keep application reads and writes on existing compatibility paths until Release 2C.
- Never expose payment-account values, custom-field values, requirement files, or employee personal data in migration issues or logs.
- Every child row carries `organizationId` and validates its employee or settings tenant.
- Duplicate singleton and natural-key destinations fail closed.
- Write mode requires the exact completed, conflict-free dry-run for migration key `full-schema-leave-employee-children`, version `1`.
- All execution and audit phases are resumable and cursor-bounded.
- Do not introduce TypeScript `any` or Convex `v.any()` in new targets.

---

### Task 1: Add normalized target schemas and inventory ownership

**Files:**

- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Modify: `apps/app/tests/schema-inventory-coverage.test.ts`
- Create: `apps/app/tests/leave-employee-children-schema.test.ts`

**Interfaces:**

- Produces singleton `organizationLeaveSettings` keyed by `organizationId`.
- Produces natural-key child tables `employeeLeaveBalances`, `employeeRequirements`, `employeeDeductions`, `employeeIncentives`, `employeeScheduleOverrides`, `employeePaymentAccounts`, `organizationCustomFieldDefinitions`, and `employeeCustomFieldValues`.
- Enriches `leaveTypes` with optional migration policy fields and `by_organization_source_key`.
- Registers `leave_employee_children` as `implementation: "migration"`.

- [x] **Step 1: Write schema and inventory tests that require every target, tenant/natural-key index, migration metadata field, and migration registry mode.**
- [x] **Step 2: Run `pnpm --filter app test -- tests/leave-employee-children-schema.test.ts tests/schema-inventory-coverage.test.ts tests/full-schema-readiness.test.ts` and verify RED because targets and registry mode are absent.**
- [x] **Step 3: Add explicit validators for each target. Custom values use `{valueType, valueJson}` and payment accounts retain the existing strings verbatim in a private table.**
- [x] **Step 4: Add table policies/overrides, regenerate the reviewed schema digest, and set the cleanup registration to migration.**
- [x] **Step 5: Run focused tests, TypeScript, focused ESLint, and `git diff --check`; verify GREEN.**

### Task 2: Implement pure deterministic projection planners

**Files:**

- Create: `apps/app/convex/leaveEmployeeMigrationTypes.ts`
- Create: `apps/app/convex/leaveEmployeeMigrationPlanner.ts`
- Create: `apps/app/tests/leave-employee-migration-planner.test.ts`

**Interfaces:**

- Produces `LEAVE_EMPLOYEE_MIGRATION_KEY = "full-schema-leave-employee-children"` and version `1`.
- Produces redacted `LeaveEmployeeMigrationIssue` codes and `ProjectionPlan<T>` outcomes `create | unchanged | skipped | conflict`.
- Produces planners for organization leave policy, embedded leave types, employee child rows, custom-field definitions/values, current-year credits, and yearly/general tracker balances.
- Natural keys are `(organization)`, `(organization,sourceKey)` for leave types/definitions, `(employee,year,leaveTypeKey)` for balances, `(employee,sourceKey)` for requirements, `(employee,sourceId)` for deductions/incentives, `(employee,date)` for overrides, and `(employee)` for payment accounts.

- [x] **Step 1: Write failing tests for create/unchanged/duplicate/mismatch behavior and deterministic typed projections.**
- [x] **Step 2: Add reconciliation tests proving approved-days disagreement returns `LEAVE_BALANCE_RECONCILIATION_MISMATCH` and never changes source totals.**
- [x] **Step 3: Run `pnpm --filter app test -- tests/leave-employee-migration-planner.test.ts` and verify RED because the planner does not exist.**
- [x] **Step 4: Implement minimal typed planners and deterministic normalization/JSON serialization helpers.**
- [x] **Step 5: Run the focused tests and verify GREEN; run TypeScript and focused ESLint.**

### Task 3: Implement bounded dry-run and additive write orchestration

**Files:**

- Create: `apps/app/convex/leaveEmployeeMigrations.ts`
- Create: `apps/app/tests/leave-employee-migrations.test.ts`

**Interfaces:**

- Produces internal functions `startLeaveEmployeeMigration`, `processLeaveEmployeeMigrationBatch`, `continueLeaveEmployeeMigration`, `failLeaveEmployeeMigration`, `getLeaveEmployeeMigrationRun`, `listLeaveEmployeeMigrationIssues`, and `resumeLeaveEmployeeMigration`.
- Phases are `leave_organizations`, `leave_types`, `employee_children`, and `leave_balances`.
- Dry-runs write only migration control/evidence rows; writes insert normalized rows without patching legacy business fields.

- [x] **Step 1: Write a failing integration test with one organization, settings row, employee, approved leave, and every supported child source. Assert dry-run changes no business rows.**
- [x] **Step 2: Add failing tests for exact dry-run authorization, duplicate source/destination keys, redacted conflicts, and cursor-batched execution.**
- [x] **Step 3: Run `pnpm --filter app test -- tests/leave-employee-migrations.test.ts` and verify RED because functions are absent.**
- [x] **Step 4: Implement the bounded scheduler/mutation pipeline using pure planners; store only IDs, fields, and issue codes.**
- [x] **Step 5: Add write/idempotency tests proving the first write creates exact targets and the next dry-run reports `changed: 0`.**
- [x] **Step 6: Run focused tests, TypeScript, focused ESLint, and `git diff --check`; verify GREEN.**

### Task 4: Add persisted post-write audit and global readiness

**Files:**

- Modify: `apps/app/convex/leaveEmployeeMigrations.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/leave-employee-migrations.test.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

**Interfaces:**

- Produces internal functions `startLeaveEmployeeAudit`, `processLeaveEmployeeAuditBatch`, `continueLeaveEmployeeAudit`, `failLeaveEmployeeAudit`, `getLeaveEmployeeAudit`, `listLeaveEmployeeAuditIssues`, and `resumeLeaveEmployeeAudit`.
- Audit reports `expected`, `matching`, `missing`, `duplicate`, `mismatched`, `unexpected`, `totalRows`, `sourceConflicts`, and `auditTruncated`.
- Global readiness selects the newest non-dry-run attempt and only reports `leave_employee_children: ready` for its newest clean completed audit.

- [x] **Step 1: Write failing audit tests for clean equality, unexpected private rows, shared-definition counting, redacted paging, and target-row completeness.**
- [x] **Step 2: Write failing readiness tests for not-started, active, failed, conflicting, unaudited, stale/unsafe-newer-write, and newest-clean-audit states.**
- [x] **Step 3: Run focused tests and verify RED.**
- [x] **Step 4: Implement persisted cursor-bounded audit phases and the fail-closed readiness resolver.**
- [x] **Step 5: Run focused tests, `schema:inventory`, TypeScript, focused ESLint, and `git diff --check`; verify GREEN.**

### Task 5: Add the production runbook and final verification

**Files:**

- Create: `docs/runbooks/leave-employee-children-release-1c.md`
- Modify: `docs/runbooks/schema-normalization-release-1.md`

**Interfaces:**

- Documents exact `--prod` dry-run, issue paging, write, audit, audit paging, idempotency, readiness, resume, and rollback commands.
- Explicitly states that Release 3 remains blocked and legacy fields remain intact.

- [x] **Step 1: Write the runbook with exact function names and acceptance gates.**
- [x] **Step 2: Run focused migration/readiness/schema tests, full app tests, TypeScript, ESLint on changed files, production dependency audit, build, and `git diff --check`.**
- [x] **Step 3: Review the final diff for secrets, unbounded `.collect()` calls in migration/audit paths, non-redacted issues, tenant validation, and accidental legacy mutations.**
- [x] **Step 4: Record deployment order and production evidence fields; do not execute production commands before deployment.**

## Completion Gate

Release 1C is complete when every new target is additive and classified, planners and migration/audit flows are fully tested, global readiness recognizes only current clean evidence, a post-write idempotency dry-run is zero-change, and the runbook preserves the Release 2/3 compatibility boundary.
