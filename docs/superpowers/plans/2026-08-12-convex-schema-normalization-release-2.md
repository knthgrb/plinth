# Convex Schema Normalization Release 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normalized organization payroll, attendance, department, and requirement records canonical while preserving the existing application API and transactionally maintaining legacy compatibility fields.

**Architecture:** A typed organization-configuration compatibility layer reads normalized rows first and falls back to legacy fields only when a normalized domain is unavailable. Existing Convex queries keep their response shapes by overlaying canonical values, while existing mutations update normalized and legacy locations in the same transaction. The Release 1 cursor-based equality audit becomes repeatable so production can measure missing rows and mismatches throughout the Release 2 compatibility window.

**Tech Stack:** TypeScript, Convex, convex-test, Vitest, Next.js 16

## Global Constraints

- Do not delete, clear, or make legacy schema fields required in Release 2.
- Preserve existing public Convex function names, arguments, authorization, and client response shapes.
- Never copy `settings.payrollSettings.payrollTabPassword` into normalized storage or return it through a new projection.
- Normalized and legacy writes must occur inside the same Convex mutation transaction.
- Duplicate normalized singleton rows or normalized key rows are errors; never select one arbitrarily.
- Historical payroll, payslip, correction, settlement, and accounting snapshots remain unchanged.
- Release 3 is blocked until a fresh production compatibility audit reports full equality after a monitored window.

---

### Task 1: Add the canonical configuration compatibility layer

**Files:**
- Create: `apps/app/convex/organizationConfiguration.ts`
- Create: `apps/app/tests/organization-configuration-release-2.test.ts`

**Interfaces:**
- Produces `getEffectiveOrganization(ctx, organizationId)` returning the organization with normalized `salaryPaymentFrequency`, `firstPayDate`, `secondPayDate`, and `defaultRequirements` overlaid when canonical rows exist.
- Produces `getEffectiveSettings(ctx, organizationId)` returning the legacy settings row/default shell with normalized `payrollSettings`, `attendanceSettings`, and `departments` overlaid.
- Produces `getEffectivePayrollSettings(ctx, organizationId)`, `getEffectiveAttendanceSettings(ctx, organizationId)`, and `getEffectiveRequirementDefinitions(ctx, organizationId)` for backend calculations.
- Produces typed source metadata using `"normalized" | "legacy" | "default"` without exposing sensitive values.

- [ ] **Step 1: Write failing canonical-read tests**

Create convex-test fixtures where normalized and legacy values intentionally differ. Assert normalized payroll, attendance, departments, and requirements win; assert absent normalized rows fall back to legacy values; assert an empty canonical legacy list remains empty; and assert duplicate singleton rows throw instead of choosing one.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter app test -- tests/organization-configuration-release-2.test.ts`

Expected: FAIL because `organizationConfiguration.ts` and its exported loaders do not exist.

- [ ] **Step 3: Implement normalized-first loaders**

Use indexed `.take(2)` singleton reads, indexed child collection reads, deterministic normalized-name ordering, and legacy projections from `planOrganizationNormalization`. Reconstruct `parentDepartmentName` from the canonical parent row where available. Return source metadata for every domain.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter app test -- tests/organization-configuration-release-2.test.ts`

Expected: all canonical-read and fallback tests pass.

- [ ] **Step 5: Commit the compatibility layer**

```bash
git add apps/app/convex/organizationConfiguration.ts apps/app/tests/organization-configuration-release-2.test.ts
git commit -m "feat: read normalized organization configuration"
```

### Task 2: Switch existing application queries and payroll calculations

**Files:**
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/shifts.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Modify: `apps/app/tests/organization-configuration-release-2.test.ts`

**Interfaces:**
- `settings.getSettings` retains its current settings-shaped result and adds only optional `_normalizationSources` telemetry.
- Organization queries retain their current organization-shaped results with canonical payroll fields overlaid.
- Payroll and shift calculations consume the same canonical settings loaders as the UI query.
- Employee creation and applicant conversion consume normalized requirement definitions.

- [ ] **Step 1: Write failing integration tests**

Add authenticated convex-test cases proving `settings.getSettings`, `organizations.getOrganization`, and `organizations.getDefaultRequirements` return normalized values when legacy values conflict. Add an employee-creation case proving new employee requirements come from normalized definitions.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter app test -- tests/organization-configuration-release-2.test.ts`

Expected: FAIL because existing queries and employee creation still read legacy documents directly.

- [ ] **Step 3: Switch read consumers**

Route settings and organization query results through the compatibility layer. Replace payroll and shift reads of `settings.payrollSettings`, `settings.attendanceSettings`, and organization pay cadence with the focused normalized-first loaders. Replace employee/recruitment default-requirement reads with `getEffectiveRequirementDefinitions`.

- [ ] **Step 4: Run focused payroll and Release 2 tests**

Run:

```bash
pnpm --filter app test -- tests/organization-configuration-release-2.test.ts tests/payroll-calculations.test.ts tests/payroll-preview-earnings-helpers.test.ts tests/attendance-calculations.test.ts
```

Expected: all focused tests pass with unchanged payroll expectations.

- [ ] **Step 5: Commit canonical read switching**

```bash
git add apps/app/convex/settings.ts apps/app/convex/organizations.ts apps/app/convex/payroll.ts apps/app/convex/shifts.ts apps/app/convex/employees.ts apps/app/convex/recruitment.ts apps/app/tests/organization-configuration-release-2.test.ts
git commit -m "feat: switch organization configuration reads"
```

### Task 3: Dual-write normalized and legacy configuration

**Files:**
- Modify: `apps/app/convex/organizationConfiguration.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/tests/organization-configuration-release-2.test.ts`

**Interfaces:**
- Produces `upsertPayrollConfiguration`, `upsertAttendanceConfiguration`, `replaceDepartmentConfiguration`, and `replaceRequirementConfiguration` for use only inside authorized mutations.
- Existing `settings.updatePayrollSettings`, `settings.updateAttendanceSettings`, `settings.updateDepartments`, `organizations.updateOrganization`, and `organizations.updateDefaultRequirements` remain client-compatible.
- `organizations.createOrganization` creates the default normalized payroll singleton in the same transaction as the organization.

- [ ] **Step 1: Write failing dual-write tests**

For each existing mutation, authenticate an authorized user, invoke the mutation, and assert normalized and legacy projections contain equal domain values. Prove department/requirement replacement preserves IDs for unchanged normalized keys, removes deleted keys, inserts new keys, rejects duplicate normalized keys, and rejects department heads without an active membership in the organization.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter app test -- tests/organization-configuration-release-2.test.ts`

Expected: FAIL because mutations currently update legacy fields only.

- [ ] **Step 3: Implement transactional dual writes**

Upsert singleton rows using indexed `.take(2)` checks. Patch child rows with matching normalized keys, insert new rows, and delete removed rows. Set `migrationVersion: 2`, preserve `createdAt`, update `updatedAt`, and reject duplicates or cross-tenant department heads before any write. Continue updating legacy fields in the same mutation.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter app test -- tests/organization-configuration-release-2.test.ts`

Expected: all dual-write and authorization-invariant tests pass.

- [ ] **Step 5: Commit dual writes**

```bash
git add apps/app/convex/organizationConfiguration.ts apps/app/convex/settings.ts apps/app/convex/organizations.ts apps/app/tests/organization-configuration-release-2.test.ts
git commit -m "feat: dual write normalized organization configuration"
```

### Task 4: Make compatibility telemetry repeatable

**Files:**
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/convex/schemaFieldManifest.ts`
- Modify: `apps/app/tests/data-migrations.test.ts`
- Modify: `apps/app/tests/database-migration-planner.test.ts`

**Interfaces:**
- `startSchemaCleanupAudit({ runId, batchSize? })` permits a new audit after the previous audit for that write run completed or failed, but rejects a second active audit.
- `getSchemaCleanupAudit({ runId })` returns the most recently created audit.
- The Release 2 manifest keeps legacy fields as `compatibility_read` with a Release 3 zero-fallback gate.

- [ ] **Step 1: Write failing repeat-audit tests**

Complete an audit, change both canonical and legacy configuration through the dual-write mutations, start another audit, and assert the latest audit completes ready. Assert a second audit cannot start while one is queued/running and `getSchemaCleanupAudit` returns the newest audit.

- [ ] **Step 2: Run migration tests and verify RED**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts`

Expected: FAIL because Release 1 currently permits exactly one audit per write run.

- [ ] **Step 3: Implement latest-audit selection and active guard**

Replace `.unique()` audit lookups with ordered indexed lookups, reject only active audits, and resume only the newest resumable audit. Do not modify prior completed audit records.

- [ ] **Step 4: Run migration tests and verify GREEN**

Run: `pnpm --filter app test -- tests/data-migrations.test.ts tests/database-migration-planner.test.ts`

Expected: all migration and manifest tests pass.

- [ ] **Step 5: Commit compatibility telemetry**

```bash
git add apps/app/convex/databaseMigrations.ts apps/app/convex/schemaFieldManifest.ts apps/app/tests/data-migrations.test.ts apps/app/tests/database-migration-planner.test.ts
git commit -m "feat: add repeatable configuration compatibility audits"
```

### Task 5: Document and verify Release 2

**Files:**
- Create: `docs/runbooks/schema-normalization-release-2.md`
- Modify: `docs/superpowers/plans/2026-08-12-convex-schema-normalization-release-2.md`
- Regenerate: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**
- Documents deployment, smoke tests, repeat-audit commands, stop conditions, rollback, and the monitored compatibility window.

- [ ] **Step 1: Write the Release 2 runbook**

Document deployment with legacy fields retained, authenticated smoke tests for payroll settings/attendance/departments/requirements, a fresh `startSchemaCleanupAudit` on the original production write run, polling `getSchemaCleanupAudit`, and rollback by redeploying Release 1 read behavior without deleting normalized rows.

- [ ] **Step 2: Regenerate Convex bindings**

Run: `pnpm --dir apps/app exec convex codegen --typecheck disable`

Expected: generated API types include every Release 2 function without changing production data.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm --filter app test
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/organizationConfiguration.ts convex/settings.ts convex/organizations.ts convex/payroll.ts convex/shifts.ts convex/employees.ts convex/recruitment.ts convex/databaseMigrations.ts tests/organization-configuration-release-2.test.ts tests/data-migrations.test.ts
pnpm audit --prod --audit-level moderate
git diff --check
pnpm --filter app exec next build --webpack
```

Expected: all tests, TypeScript, focused lint, dependency audit, diff hygiene, and production build pass.

- [ ] **Step 4: Review Release 2 invariants**

Confirm normalized-first reads, same-transaction dual writes, zero plaintext password projection, unchanged historical snapshots, unchanged client APIs, internal-only audit controls, and no schema contraction.

- [ ] **Step 5: Commit the Release 2 runbook and verification checkpoint**

```bash
git add apps/app/convex apps/app/tests docs/runbooks/schema-normalization-release-2.md docs/superpowers/plans/2026-08-12-convex-schema-normalization-release-2.md
git commit -m "docs: add schema normalization release 2 runbook"
```

## Release 2 completion boundary

Release 2 code is complete when the normalized-first compatibility switch and dual writes pass all verification. Production completion requires deployment, authenticated settings/payroll smoke tests, and a fresh cursor-based compatibility audit with `ready: true`. Release 3 must not stop legacy reads or writes until the compatibility window has produced no missing rows, mismatches, duplicate rows, source conflicts, or fallback-only organizations.
