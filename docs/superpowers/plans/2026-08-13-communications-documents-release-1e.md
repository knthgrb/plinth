# Communications and Documents Release 1E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Additively normalize memo, chat, document-access, and storage-link child data into canonical Convex tables, backfill it safely, and produce persisted production audit evidence without switching reads or removing legacy fields.

**Architecture:** A pure planner validates and compares deterministic source projections. A cursor-bounded migration writes eight new child/link tables only after a clean dry-run, while a separate persisted audit replays the planner and scans every destination table for missing, mismatched, duplicate, tenant-invalid, and unexpected rows. Release 1E keeps legacy arrays authoritative; normalized-first reads and atomic dual writes belong to the later compatibility wave.

**Tech Stack:** TypeScript, Convex, `convex-test`, Vitest, pnpm, Next.js.

## Global Constraints

- Work inline on `main`, as explicitly approved by the user.
- Preserve all existing production data and legacy fields in this release.
- Never log or return memo content, chat content, document content, file names, or other private payloads in migration issues.
- Process source and target tables with Convex pagination; use indexed `.take(2)` checks for natural-key uniqueness.
- Validate parent and tenant relationships before writing a projection.
- Do not use the TypeScript `any` type.
- Accounting receipts and asset maintenance remain owned by `assets_payroll_compatibility`.

---

### Task 1: Canonical tables and pure planner

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/communicationsMigrationTypes.ts`
- Create: `apps/app/convex/communicationsMigrationPlanner.ts`
- Create: `apps/app/tests/communications-migration-planner.test.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/tests/schema-inventory-coverage.test.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`

**Interfaces:**
- Produces `COMMUNICATIONS_MIGRATION_KEY = "full-schema-communications-documents"` and version `1`.
- Produces `parseMemoReaction(value: unknown)` for the legacy `{ userId, emoji, createdAt }` shape.
- Produces `planCommunicationsProjection<T>()`, which returns `create`, `unchanged`, or a redacted conflict.
- Produces the tables `memoReactions`, `memoAcknowledgements`, `memoAudienceMembers`, `conversationMembers`, `messageReceipts`, `userPinnedConversations`, `documentAccessGrants`, and `storageObjectLinks`.

- [x] **Step 1: Write failing planner and inventory tests**

  Cover the exact migration identity; supported/unsupported reaction parsing; metadata-insensitive equality; duplicate and mismatch outcomes; all eight target tables and their natural-key indexes; and the reviewed schema count increase from 64 to 72.

- [x] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm --filter app exec vitest run tests/communications-migration-planner.test.ts tests/schema-inventory-coverage.test.ts
  ```

  Expected: failure because the planner and target tables do not exist.

- [x] **Step 3: Implement the planner and schema**

  Use explicit validators and types. Store only identifiers and projection metadata in target rows. `storageObjectLinks.parentId` is a union of the four supported parent ID types, and memo attachment content type is aligned by source index. Add every new table to the schema inventory as a `normalized_target` in its owning domain.

- [x] **Step 4: Verify GREEN and regenerate the reviewed schema snapshot**

  Run the focused tests, update the digest fixture from the actual parsed schema inventory, then rerun until green.

---

### Task 2: Cursor-bounded migration and production-safe status API

**Files:**
- Create: `apps/app/convex/communicationsMigrations.ts`
- Create: `apps/app/tests/communications-migrations.test.ts`
- Modify: `apps/app/convex/schema.ts`

**Interfaces:**
- Produces `startCommunicationsMigration`, `getCommunicationsMigrationRun`, `listCommunicationsMigrationIssues`, and `resumeCommunicationsMigration`.
- Uses migration phases `communications_memos`, `communications_conversations`, `communications_messages`, `communications_preferences`, `communications_documents`, and `communications_leave_attachments`.
- Issues expose only code, field, parent ID, organization ID, and timestamps.

- [x] **Step 1: Write failing migration tests**

  A complete source fixture must project one row of every target kind. Tests must prove dry-run does not write, write mode requires its exact clean dry-run, write mode materializes all projections, a second dry-run reports zero changes, duplicate source keys and cross-tenant children block write mode, and status output contains no private payload.

- [x] **Step 2: Verify RED**

  ```bash
  pnpm --filter app exec vitest run tests/communications-migrations.test.ts
  ```

- [x] **Step 3: Implement migration orchestration**

  Page one parent table per phase. Validate membership, employee, conversation, and document tenant ownership. Conditionally validate existing `storageObjects` metadata, but allow legacy storage IDs that predate metadata rows. On scheduled action failure, persist a failed status and error counter. Permit resume only for stale active runs.

- [x] **Step 4: Verify GREEN**

  Run the planner and migration suites together and confirm idempotency.

---

### Task 3: Persisted full-destination audit and global readiness

**Files:**
- Modify: `apps/app/convex/communicationsMigrations.ts`
- Modify: `apps/app/tests/communications-migrations.test.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

**Interfaces:**
- Produces `startCommunicationsAudit`, `getCommunicationsAudit`, `listCommunicationsAuditIssues`, and `resumeCommunicationsAudit`.
- Readiness recognizes `communications_documents` only when the newest write is completed with zero errors/conflicts and its newest audit is complete, clean, and current.

- [x] **Step 1: Write failing audit and readiness tests**

  Prove a clean write audits all eight targets, every issue page is redacted, an unexpected target row blocks readiness, a newer unsafe write supersedes an older clean audit, and the fifth domain becomes `ready` while the final payroll/assets domain remains `not_started`.

- [x] **Step 2: Verify RED**

  ```bash
  pnpm --filter app exec vitest run tests/communications-migrations.test.ts tests/full-schema-readiness.test.ts
  ```

- [x] **Step 3: Implement audit and registry integration**

  Create a verification dry-run, persist discrepancies, then page every target table. Link each target back to its source parent and source index. Mark missing, mismatched, duplicate, tenant-invalid, and unexpected rows as blockers. Change the registry implementation from `not_started` to `migration` only after these tests pass.

- [x] **Step 4: Verify GREEN**

  Run the focused audit/readiness suites and TypeScript.

---

### Task 4: Runbook and release verification

**Files:**
- Create: `docs/runbooks/communications-documents-release-1e.md`
- Modify: `docs/superpowers/specs/2026-08-12-convex-full-schema-cleanup-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-communications-documents-release-1e.md`
- Regenerate if changed: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**
- Produces exact `--prod` dry-run, write, audit, issue pagination, idempotency, readiness, interruption, and rollback commands.

- [x] **Step 1: Write the operator runbook**

  State every gate numerically: completed status, zero conflicts/errors/source conflicts, zero duplicate/missing/mismatched/unexpected rows, `matching === expected === totalRows`, empty complete issue pagination, and an idempotency dry-run with `changed: 0`.

- [x] **Step 2: Run generated-code and static gates**

  ```bash
  pnpm --filter app exec convex codegen
  pnpm --filter app schema:inventory
  pnpm --filter app exec tsc --noEmit
  pnpm --filter app exec eslint convex/communicationsMigrationPlanner.ts convex/communicationsMigrationTypes.ts convex/communicationsMigrations.ts tests/communications-migration-planner.test.ts tests/communications-migrations.test.ts tests/full-schema-readiness.test.ts
  ```

- [x] **Step 3: Run full verification**

  ```bash
  pnpm --filter app test
  pnpm --filter app build
  git diff --check
  ```

- [x] **Step 4: Review the final diff and hand off deployment**

  Confirm there are no legacy removals, no normalized-first read switch, no unrelated source changes, and no private values in issue/report output. Commit only after all checks pass.
