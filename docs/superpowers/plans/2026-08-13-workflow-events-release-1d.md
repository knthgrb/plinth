# Workflow Events Release 1D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Additively normalize evaluation and recruitment workflow collections, applicant custom values, organization UI preferences, and settings change events without switching or deleting legacy production sources.

**Architecture:** Tenant-owned child tables receive deterministic projections from cursor-paged `settings`, `evaluations`, and `applicants`. A pure planner rejects duplicate natural keys and unequal destinations; an internal scheduled migration requires an exact clean dry-run, while a persisted post-write audit replays sources and scans every normalized target before global readiness can become green.

**Tech Stack:** TypeScript, Convex schema/functions/scheduler, `convex-test`, Vitest.

## Global Constraints

- Work inline on `main`; do not create a worktree or delegate to subagents.
- Preserve legacy fields and application read/write behavior through Release 1D.
- Never include evaluation notes, applicant notes, interview remarks, scorecard notes, offer notes, or custom-field values in issues/logs.
- Every normalized row carries `organizationId` and validates its parent tenant.
- Duplicate source or destination natural keys fail closed.
- Write mode requires the exact clean dry-run for `full-schema-workflow-events`, version `1`.
- Migration and audit execution is cursor-bounded and resumable.
- Do not introduce TypeScript `any` or new `v.any()` validators.

---

### Task 1: Add workflow target schemas and inventory ownership

**Files:**

- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Create: `apps/app/tests/workflow-events-schema.test.ts`

- [x] **Step 1: Write failing schema tests for tenant/natural-key indexes and migration registration.**
- [x] **Step 2: Run the focused tests and verify RED because targets are absent.**
- [x] **Step 3: Add explicit target validators for UI/settings, evaluation, recruitment, and applicant custom rows.**
- [x] **Step 4: Update inventory classification, registry implementation, and reviewed schema digest.**
- [x] **Step 5: Run schema inventory, TypeScript, ESLint, and `git diff --check`.**

### Task 2: Add deterministic redacted workflow planners

**Files:**

- Create: `apps/app/convex/workflowMigrationTypes.ts`
- Create: `apps/app/convex/workflowMigrationPlanner.ts`
- Create: `apps/app/tests/workflow-migration-planner.test.ts`

- [x] **Step 1: Write failing tests for canonical equality, create, unchanged, duplicate, mismatch, and normalized custom values.**
- [x] **Step 2: Run the planner test and verify RED because the module is absent.**
- [x] **Step 3: Implement deterministic source keys, canonical JSON, and fail-closed projection planning.**
- [x] **Step 4: Run the focused tests, TypeScript, and ESLint.**

### Task 3: Add bounded dry-run/write migration

**Files:**

- Create: `apps/app/convex/workflowMigrations.ts`
- Create: `apps/app/tests/workflow-migrations.test.ts`

- [x] **Step 1: Write a failing end-to-end dry-run fixture covering settings, evaluation reviewers/history, all applicant child arrays, offer state, and custom fields.**
- [x] **Step 2: Add failing duplicate/redaction, exact dry-run, write, and idempotency tests.**
- [x] **Step 3: Implement cursor phases `workflow_settings`, `workflow_evaluations`, and `workflow_applicants`.**
- [x] **Step 4: Run focused tests and verify the first write creates exact rows while a second dry-run reports zero changes.**

### Task 4: Add persisted audit and global readiness

**Files:**

- Modify: `apps/app/convex/workflowMigrations.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/workflow-migrations.test.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

- [x] **Step 1: Write failing clean-audit, unexpected-row, issue-paging, and readiness tests.**
- [x] **Step 2: Implement verification replay plus cursor-scanned target audit phases.**
- [x] **Step 3: Register `workflow_events` readiness against its newest write and newest audit.**
- [x] **Step 4: Run focused migration/readiness tests and schema inventory.**

### Task 5: Document and verify production rollout

**Files:**

- Create: `docs/runbooks/workflow-events-release-1d.md`
- Modify: `docs/runbooks/schema-normalization-release-1.md`

- [x] **Step 1: Document exact production dry-run, paging, write, audit, idempotency, readiness, resume, and rollback commands.**
- [x] **Step 2: Regenerate Convex API types and run full tests, TypeScript, focused ESLint, dependency audit, production build, and `git diff --check`.**
- [x] **Step 3: Review for secrets, unbounded migration reads, tenant violations, accidental legacy mutation, and incomplete target scans.**
