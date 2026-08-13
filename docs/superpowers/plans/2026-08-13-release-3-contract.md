# Release 3A/3B Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Release 3A commit that stops all legacy runtime use and safely clears legacy projections, followed by a Release 3B commit that removes the verified legacy physical schema.

**Architecture:** Typed normalized projection modules become the only live data source. A bounded Release 3 contract migration uses the existing migration control plane, requires a clean dry-run and export acknowledgement before writes, and produces a final audit that gates the second deployment. Release 3B then removes legacy validators, indexes, projection code, and completed migration entry points while preserving immutable history.

**Tech Stack:** TypeScript, Convex, Vitest, Next.js, pnpm.

## Global Constraints

- Release 3A and Release 3B are separate Convex deployments in one maintenance window.
- No legacy value is cleared without a clean dry-run and recorded export reference.
- No secret, token, compensation value, payment account, document body, or message body appears in an issue or audit report.
- Historical payroll, payslip, settlement, document-version, correction, and accounting snapshots are preserved.
- No new explicit `any` type.
- Every production behavior change follows red-green-refactor.

---

### Task 1: Freeze the Release 3 physical contract

**Files:**
- Create: `apps/app/convex/release3Contract.ts`
- Create: `apps/app/tests/release-3-contract-policy.test.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

**Interfaces:**
- Produces `RELEASE_3_CONTRACT_KEY`, `RELEASE_3_CONTRACT_VERSION`, `RELEASE_3_REMOVALS`, and `resolveRelease3ProgramReadiness`.

- [ ] Write a failing policy test asserting that the compatibility-window blocker is absent only when every domain is ready/switched and the contract cleanup audit is ready.
- [ ] Write a failing manifest test asserting every Release 3 removal is explicitly enumerated and no historical snapshot is removable.
- [ ] Run `pnpm --filter app exec vitest run tests/release-3-contract-policy.test.ts tests/full-schema-readiness.test.ts` and verify the new contract APIs are missing.
- [ ] Implement the typed contract registry and fail-closed readiness resolver:

```ts
export type Release3Removal = {
  table: CurrentSchemaTable;
  field: string;
  target?: string;
  clearStrategy: "unset" | "nested_unset";
};

export function resolveRelease3ProgramReadiness(input: {
  domainsReady: boolean;
  compatibilitySwitched: boolean;
  cleanupAuditReady: boolean;
}): { readyForRelease3B: boolean; blockers: string[] };
```

- [ ] Run the focused tests and commit `feat: define release 3 contract policy`.

### Task 2: Make runtime adapters normalized-only

**Files:**
- Modify: `apps/app/convex/organizationConfiguration.ts`
- Modify: `apps/app/convex/leaveEmployeeCompatibility.ts`
- Modify: `apps/app/convex/workflowCompatibility.ts`
- Modify: `apps/app/convex/communicationsCompatibility.ts`
- Modify: `apps/app/convex/assetsPayrollCompatibility.ts`
- Modify: `apps/app/convex/access.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/payslipPinResetDb.ts`
- Modify: `apps/app/convex/users.ts`
- Test: existing compatibility tests plus `apps/app/tests/release-3-normalized-only.test.ts`

**Interfaces:**
- Loaders throw `Normalized projection missing: <domain>` when an audited parent lacks its required normalized singleton/child projection.
- Replacement functions update only normalized target rows.

- [ ] Add failing tests where conflicting legacy data exists but normalized rows win, where missing normalized projections fail closed, and where normalized empty sets return empty values.
- [ ] Add failing tests proving new mutations leave removed parent projections unchanged/absent.
- [ ] Run the focused suite and verify it fails on current fallback/dual-write behavior.
- [ ] Remove every fallback from effective loaders and remove legacy arguments from normalized replacement helpers.
- [ ] Route identity membership, invitation token, payslip credential, organization configuration, employee/leave, workflow, communications/document/chat, and asset/accounting/payroll callers through normalized-only interfaces.
- [ ] Run focused compatibility, auth, payroll, leave, recruitment, chat, document, and security suites.
- [ ] Commit `feat: switch release 3 runtime to normalized only`.

### Task 3: Stop parent projection writes

**Files:**
- Modify live mutations discovered by the Release 3 forbidden-reference scan under `apps/app/actions`, `apps/app/convex`, `apps/app/helpers`, `apps/app/hooks`, `apps/app/lib`, `apps/app/services`, and `apps/app/utils`.
- Create: `apps/app/tests/release-3-forbidden-references.test.ts`
- Modify: `apps/app/tests/helpers/schema-reference-scan.ts`

**Interfaces:**
- Produces an exact allowlist that permits removed paths only in `schema.ts`, Release 3 migration code, historical decoders, and immutable snapshot validators during 3A.

- [ ] Write a failing static test for every field in `RELEASE_3_REMOVALS` and prove current live writes/references violate it.
- [ ] Remove legacy fields from inserts, patches, mutation validators, projections, and public service inputs while preserving existing API result shapes reconstructed from normalized rows.
- [ ] Replace parent-field cleanup-on-delete with direct normalized child deletion.
- [ ] Regenerate the reviewed reference baseline and require zero enforceable Release 3 runtime references.
- [ ] Run `pnpm --filter app schema:inventory` and focused behavior tests.
- [ ] Commit `refactor: stop release 3 legacy projections`.

### Task 4: Add resumable Release 3A cleanup

**Files:**
- Create: `apps/app/convex/release3Migrations.ts`
- Create: `apps/app/convex/release3MigrationPlanner.ts`
- Modify: `apps/app/convex/schema.ts` only to add optional control-plane metadata if existing migration tables cannot represent export acknowledgement.
- Create: `apps/app/tests/release-3-migration-planner.test.ts`
- Create: `apps/app/tests/release-3-migrations.test.ts`

**Interfaces:**
- Produces `startRelease3ContractCleanup`, `getRelease3ContractCleanupRun`, `listRelease3ContractCleanupIssues`, `acknowledgeRelease3ContractExport`, `resumeRelease3ContractCleanup`, `startRelease3ContractAudit`, `getRelease3ContractAudit`, and `listRelease3ContractAuditIssues`.

- [ ] Write planner tests for top-level unset, nested compensation/schedule/payroll-settings unset, already-clean rows, preserved snapshots, malformed values, and redacted issue output.
- [ ] Run planner tests and verify missing planner failures.
- [ ] Implement pure planners that return field names/counts only and never values.
- [ ] Write Convex integration tests proving bounded pagination, persisted cursors, failure state, resume, dry-run prerequisite, export-reference prerequisite, write idempotency, all-organization coverage, and immutable-history preservation.
- [ ] Run integration tests and verify missing orchestration failures.
- [ ] Implement the migration using `migrationRuns`, `migrationIssues`, `migrationAudits`, and scheduler continuation patterns already used by domain migrations.
- [ ] Run focused migration tests and commit `feat: add release 3 contract cleanup`.

### Task 5: Gate and document the first deployment

**Files:**
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`
- Create: `docs/runbooks/release-3a-contract-cleanup.md`

**Interfaces:**
- `getFullSchemaCleanupReadiness` returns Release 3 cleanup state and explicit `readyForRelease3B` blockers.

- [ ] Add failing readiness tests for missing dry-run, missing export reference, incomplete write, conflicts/errors, missing audit, truncated audit, and clean contract readiness.
- [ ] Implement fail-closed readiness backed by the latest Release 3 contract run/audit.
- [ ] Document exact production dry-run, paging, export acknowledgement, write, audit, idempotency, rollback, and Release 3B gate commands.
- [ ] Run full Release 3A verification and create the deployable Release 3A commit `release: prepare release 3a contract cleanup`.

### Task 6: Remove the Release 3B physical contract

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/schemaFieldManifest.ts`
- Modify: normalized projection modules and callers whose types change after schema removal.
- Remove: completed compatibility-only and migration-only files after confirming no caller remains.
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Modify: `apps/app/tests/fixtures/schema-contract-reference-baseline.json`
- Create: `docs/runbooks/release-3b-physical-contract.md`

**Interfaces:**
- Produces the final strict Convex schema with normalized target rows and preserved historical snapshots only.

- [ ] Write failing schema inventory tests asserting every approved legacy field and obsolete index is absent while every preserved snapshot remains.
- [ ] Remove the fields and indexes from `schema.ts`, then update typed API projections so public UI behavior remains unchanged.
- [ ] Remove completed fallback/dual-write/migration code and regenerate Convex bindings with `pnpm --filter app exec convex codegen`.
- [ ] Regenerate reviewed schema/reference fixtures and require zero forbidden references.
- [ ] Document that deployment is allowed only when the Release 3A audit reports `readyForRelease3B: true`.
- [ ] Run full verification and commit `release: enforce release 3b physical contract`.

### Task 7: Final verification

- [ ] Run `pnpm --filter app exec vitest run`.
- [ ] Run `pnpm --filter app exec tsc --noEmit`.
- [ ] Run focused ESLint with zero errors on every new/modified Release 3 path.
- [ ] Run `pnpm --filter app schema:inventory`.
- [ ] Run `pnpm audit --prod`.
- [ ] Run `pnpm --filter app exec next build --webpack`.
- [ ] Run `git diff --check` for both deployment commits.
- [ ] Self-review authorization, tenant isolation, secret redaction, irreversible gates, historical preservation, deployment ordering, and runbook command accuracy.
