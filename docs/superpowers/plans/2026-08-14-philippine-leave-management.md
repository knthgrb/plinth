# Philippine Leave Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy leave-credit workflow with a policy-versioned, ledger-backed Philippine leave module for private-sector and government organizations while preserving every existing organization's settings, balances, and history.

**Architecture:** Effective-dated policies determine eligibility, duration, pay treatment, and account behavior. Append-only ledger entries are the audit source of truth while `employeeLeaveBalances` is updated atomically as the bounded read projection. Approved daily occurrences connect requests to schedules, attendance, calendars, payroll, cancellation, and corrections; organizations activate the new engine only after an idempotent comparison migration succeeds.

**Tech Stack:** TypeScript 5, Next.js 16, React 19, Convex 1.30, Vitest 4, convex-test, Tailwind CSS, Radix UI, date-fns.

## Global Constraints

- Preserve current settings, balances, request history, pooled/by-type mode, proration, accrual frequency, anniversary benefit, and conversion cap for every existing organization.
- Never assume an existing organization is private-sector or government; sector remains unconfirmed until an Owner selects it.
- New private-sector presets use a five-day SIL baseline after one year of service for covered employees.
- New government presets use separate 1.25-day monthly vacation and sick accruals and offer the 2026 Wellness Leave policy as an optional separate benefit.
- Owner, Admin, and HR make direct final decisions; managers cannot approve leave.
- Membership-to-employee linkage prevents self-approval, including privileged users.
- Statutory and confidential leave does not consume company credit unless an explicit policy version says it does.
- Server calculations use Asia/Manila local dates, employee work schedules, holidays, and the policy's calendar-day or scheduled-work duration basis.
- Ledger entries and request events are append-only; reversals use new entries.
- Migrations are additive, idempotent, organization-scoped, and non-destructive.
- Normal reads are indexed, bounded, and server-paginated.
- Do not add explicit `any`; remove explicit `any` from rewritten leave files and the new payroll integration boundary.
- Follow TDD: observe each focused test fail before implementing the corresponding behavior.

---

## File Structure

### Shared domain

- Create `apps/app/lib/leave/types.ts`: canonical policy, ledger, request, occurrence, and projection types.
- Create `apps/app/lib/leave/policy-engine.ts`: pure entitlement, proration, rounding, and projection math.
- Create `apps/app/lib/leave/duration-engine.ts`: Manila-local calendar/work-schedule occurrence calculation.
- Create `apps/app/lib/leave/presets.ts`: versioned private and government preset builders with legal-source metadata.
- Create `apps/app/lib/leave/client-state.ts`: typed UI view-model builders and status labels.
- Create `apps/app/lib/leave/payroll-integration.ts`: typed occurrence-to-payroll decisions.

### Convex domain

- Modify `apps/app/convex/schema.ts`: policy, ledger, occurrence, event, qualification, privacy, conversion, and compatibility fields/indexes.
- Modify `apps/app/convex/fullSchemaInventory.ts`: register every new canonical leave table.
- Modify `apps/app/convex/schemaFieldManifest.ts`: classify legacy leave fields and new canonical targets.
- Create `apps/app/convex/leaveAccess.ts`: reviewer, self-service, and restricted-detail authorization.
- Create `apps/app/convex/leaveLedger.ts`: idempotent append and atomic balance-projection helpers.
- Create `apps/app/convex/leavePolicies.ts`: policy queries, preset setup, versioning, archival, and impact previews.
- Create `apps/app/convex/leaveOccurrences.ts`: schedule/holiday loading and persisted occurrence construction.
- Create `apps/app/convex/leaveAccrual.ts`: idempotent accrual and year-end posting.
- Create `apps/app/convex/leaveQualifications.ts`: statutory qualification, protected event, sensitive grant, and evidence workflows.
- Create `apps/app/convex/leaveMigrationPlanner.ts`: pure legacy-to-policy/balance migration plans.
- Create `apps/app/convex/leaveMigration.ts`: batched execution, comparison, reporting, and activation.
- Create `apps/app/convex/leaveConversions.ts`: conversion decision and payroll linkage.
- Modify `apps/app/convex/leave.ts`: typed compatibility façade and new request lifecycle endpoints.
- Modify `apps/app/convex/settings.ts`: route leave configuration writes to policy versioning.
- Modify `apps/app/convex/organizationConfiguration.ts`: expose effective engine state without legacy fallback after activation.
- Create `apps/app/convex/crons.ts`: bounded daily accrual materialization.
- Modify `apps/app/convex/payroll.ts`: load approved occurrences for activated organizations and lock consumed occurrences.
- Modify `apps/app/convex/finalSettlements.ts`: attach approved conversion liabilities for separated employees.
- Modify `apps/app/convex/files.ts`: leave-request-scoped attachment URLs for restricted evidence.

### Server/client boundary and UI

- Rewrite `apps/app/services/leave-service.ts`: generated Convex API types without casts through `any`.
- Rewrite `apps/app/actions/leave.ts`: typed request/review/cancellation/adjustment/conversion actions.
- Rewrite `apps/app/components/settings/leave-types-settings-content.tsx`: new sector, company policy, statutory policy, and effective-date settings workflow.
- Create `apps/app/app/[organizationId]/leave/_components/leave-request-drawer.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/employee-leave-dashboard.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/leave-request-timeline.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/leave-approval-inbox.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/leave-review-drawer.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/employee-balance-ledger.tsx`.
- Create `apps/app/app/[organizationId]/leave/_components/leave-calendar.tsx`.
- Modify `apps/app/app/[organizationId]/leave/page.tsx`: compose the new employee/admin workspaces.
- Retire legacy leave dialogs/tabs only after the replacement routes pass compatibility tests.

---

### Task 1: Canonical Leave Contracts and Policy Math

**Files:**
- Create: `apps/app/lib/leave/types.ts`
- Create: `apps/app/lib/leave/policy-engine.ts`
- Test: `apps/app/tests/leave-policy-engine-v2.test.ts`

**Interfaces:**
- Produces: `LeavePolicyRules`, `LeaveLedgerEntryInput`, `LeaveBalanceProjection`, `calculateEntitlement()`, `projectLeaveBalance()`, `roundLeaveUnits()`, and `validatePolicyRules()`.
- Consumes: no new application interfaces.

- [ ] **Step 1: Write the failing policy and projection tests**

```ts
import { describe, expect, it } from "vitest";
import {
  calculateEntitlement,
  projectLeaveBalance,
  validatePolicyRules,
} from "@/lib/leave/policy-engine";
import type { LeavePolicyRules } from "@/lib/leave/types";

const privateSil: LeavePolicyRules = {
  accountBehavior: "shared_pool",
  poolKey: "company_leave",
  payTreatment: "company_paid",
  durationBasis: "scheduled_work",
  entitlementMethod: "annual",
  annualUnits: 5,
  eligibility: { basis: "hire_date", completedServiceMonths: 12 },
  prorationMethod: "none",
  roundingIncrement: 0.5,
  carryover: { mode: "unlimited" },
  conversion: { allowed: true },
};

describe("leave policy engine v2", () => {
  it("grants private SIL only after twelve completed service months", () => {
    const periodStart = Date.UTC(2026, 0, 1);
    const periodEnd = Date.UTC(2026, 11, 31);
    expect(calculateEntitlement({ rules: privateSil, hireDate: Date.UTC(2025, 8, 1), periodStart, periodEnd, asOf: Date.UTC(2026, 7, 31) })).toBe(0);
    expect(calculateEntitlement({ rules: privateSil, hireDate: Date.UTC(2025, 7, 1), periodStart, periodEnd, asOf: Date.UTC(2026, 7, 31) })).toBe(5);
  });

  it("projects reservations without recording usage", () => {
    expect(projectLeaveBalance([
      { kind: "grant", amount: 8 },
      { kind: "reservation", amount: -2 },
      { kind: "usage", amount: -1 },
    ])).toMatchObject({ granted: 8, reserved: 2, used: 1, available: 5 });
  });

  it("rejects a pooled policy without a pool key", () => {
    expect(() => validatePolicyRules({ ...privateSil, poolKey: undefined })).toThrow("pool key");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `pnpm --filter app exec vitest run tests/leave-policy-engine-v2.test.ts`

Expected: FAIL because `@/lib/leave/policy-engine` and its types do not exist.

- [ ] **Step 3: Implement the typed domain and pure engine**

```ts
export type LeaveAccountBehavior = "shared_pool" | "individual_account" | "non_credit";
export type LeavePayTreatment = "company_paid" | "statutory_paid" | "government_paid" | "statutory_benefit_supported" | "unpaid";
export type LeaveDurationBasis = "scheduled_work" | "calendar_days" | "event_defined";
export type LeaveProrationMethod = "none" | "calendar_months" | "actual_days" | "legacy_15th_day";
export type LeaveLedgerKind = "opening_grant" | "opening_usage" | "grant" | "accrual" | "reservation" | "reservation_release" | "usage" | "restoration" | "adjustment" | "carryover" | "expiration" | "conversion" | "migration_reconciliation";

export interface LeaveLedgerEntryInput {
  kind: LeaveLedgerKind;
  amount: number;
}

export interface LeaveBalanceProjection {
  granted: number;
  used: number;
  reserved: number;
  converted: number;
  expired: number;
  available: number;
}

export interface LeavePolicyRules {
  accountBehavior: LeaveAccountBehavior;
  poolKey?: string;
  payTreatment: LeavePayTreatment;
  durationBasis: LeaveDurationBasis;
  entitlementMethod: "annual" | "monthly" | "semi_annual" | "anniversary" | "event_based" | "none";
  annualUnits?: number;
  eligibility: { basis: "hire_date" | "regularization_date" | "verified_qualification" | "event"; completedServiceMonths: number };
  prorationMethod: LeaveProrationMethod;
  roundingIncrement: 0.25 | 0.5 | 1;
  carryover: { mode: "none" | "capped" | "unlimited"; capUnits?: number };
  conversion: { allowed: boolean; maxUnits?: number };
}
```

Implement `calculateEntitlement` with completed-month eligibility, the four proration modes, and a single rounding boundary. Implement `projectLeaveBalance` as a total reducer where reservation affects `reserved` and `available`, usage affects `used` and `available`, and conversion/expiration remain separate totals. Reject negative annual units, invalid caps, non-credit conversion, and shared pools without `poolKey`.

- [ ] **Step 4: Run focused tests and lint**

Run: `pnpm --filter app exec vitest run tests/leave-policy-engine-v2.test.ts tests/leave-policy-calculations.test.ts`

Run: `pnpm --filter app exec eslint lib/leave/types.ts lib/leave/policy-engine.ts tests/leave-policy-engine-v2.test.ts`

Expected: all tests pass and ESLint exits zero.

- [ ] **Step 5: Commit the policy engine**

```bash
git add apps/app/lib/leave/types.ts apps/app/lib/leave/policy-engine.ts apps/app/tests/leave-policy-engine-v2.test.ts
git commit -m "feat: add canonical leave policy engine"
```

### Task 2: Schedule- and Calendar-Aware Duration Engine

**Files:**
- Create: `apps/app/lib/leave/duration-engine.ts`
- Test: `apps/app/tests/leave-duration-engine.test.ts`

**Interfaces:**
- Consumes: `LeaveDurationBasis` from Task 1.
- Produces: `buildLeaveOccurrenceDrafts(input): LeaveOccurrenceDraft[]` and `LeaveOccurrenceDraft`.

- [ ] **Step 1: Write failing duration tests**

```ts
const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const standardWeek = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

it("charges only scheduled workdays but preserves calendar-day legal duration", () => {
  const result = buildLeaveOccurrenceDrafts({
    startLocalDate: "2026-08-14",
    endLocalDate: "2026-08-17",
    durationBasis: "calendar_days",
    requestedMinutesByDate: {},
    scheduleByWeekday: standardWeek,
    holidays: new Set(["2026-08-17"]),
  });
  expect(result.map((row) => [row.localDate, row.legalUnits, row.creditUnits])).toEqual([
    ["2026-08-14", 1, 1],
    ["2026-08-15", 1, 0],
    ["2026-08-16", 1, 0],
    ["2026-08-17", 1, 0],
  ]);
});

it("charges a half-day request as four hours on an eight-hour shift", () => {
  const [row] = buildLeaveOccurrenceDrafts({
    startLocalDate: "2026-08-14",
    endLocalDate: "2026-08-14",
    durationBasis: "scheduled_work",
    requestedMinutesByDate: { "2026-08-14": 240 },
    scheduleByWeekday: standardWeek,
    holidays: new Set(),
  });
  expect(row).toMatchObject({ scheduledMinutes: 480, leaveMinutes: 240, creditUnits: 0.5 });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter app exec vitest run tests/leave-duration-engine.test.ts`

Expected: FAIL because the duration engine is absent.

- [ ] **Step 3: Implement Manila-local date iteration and occurrence drafts**

Use `YYYY-MM-DD` strings as the domain boundary. Iterate with UTC date parts to avoid browser/server timezone drift, resolve the employee weekday schedule, exclude organization holidays from credit charging, preserve calendar-day `legalUnits`, and validate requested minutes against scheduled minutes. Export:

```ts
export interface LeaveOccurrenceDraft {
  localDate: string;
  legalUnits: number;
  scheduledMinutes: number;
  leaveMinutes: number;
  creditUnits: number;
  isHoliday: boolean;
  isRestDay: boolean;
}
```

- [ ] **Step 4: Run duration and legacy conflict tests**

Run: `pnpm --filter app exec vitest run tests/leave-duration-engine.test.ts tests/leave-request-conflicts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the duration engine**

```bash
git add apps/app/lib/leave/duration-engine.ts apps/app/tests/leave-duration-engine.test.ts
git commit -m "feat: calculate schedule-aware leave duration"
```

### Task 3: Versioned Philippine Leave Presets

**Files:**
- Create: `apps/app/lib/leave/presets.ts`
- Test: `apps/app/tests/leave-presets.test.ts`

**Interfaces:**
- Consumes: `LeavePolicyRules` from Task 1.
- Produces: `buildPrivateSectorPreset()`, `buildGovernmentPreset()`, and `LeavePresetPolicy`.

- [ ] **Step 1: Write failing preset contract tests**

```ts
it("builds the protected five-day private SIL baseline", () => {
  expect(buildPrivateSectorPreset().policies.find((p) => p.sourceKey === "private_sil")).toMatchObject({
    category: "statutory",
    complianceRole: "private_sil_minimum",
    rules: { annualUnits: 5, durationBasis: "scheduled_work", conversion: { allowed: true } },
  });
});

it("keeps government vacation, sick, and wellness separate", () => {
  const preset = buildGovernmentPreset();
  expect(preset.policies.find((p) => p.sourceKey === "government_vacation")?.rules.annualUnits).toBe(15);
  expect(preset.policies.find((p) => p.sourceKey === "government_sick")?.rules.annualUnits).toBe(15);
  expect(preset.policies.find((p) => p.sourceKey === "government_wellness")?.enabledByDefault).toBe(false);
});
```

- [ ] **Step 2: Run the preset tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-presets.test.ts`

Expected: FAIL because the preset builders do not exist.

- [ ] **Step 3: Implement immutable preset builders**

Define and return fresh objects using this contract:

```ts
export interface LeavePresetPolicy {
  sourceKey: string;
  name: string;
  category: "company" | "statutory" | "unpaid";
  confidentiality: "standard" | "restricted";
  complianceRole?: "private_sil_minimum";
  enabledByDefault: boolean;
  rules: LeavePolicyRules;
  sourceUrl: string;
  sourceEffectiveDate: string;
}
```

Include private SIL, maternity, paternity, solo-parent, VAWC, and special leave for women. Include government vacation, sick, forced, special privilege, maternity, paternity, solo-parent, VAWC, special leave for women, study, rehabilitation, emergency, adoption, and optional wellness policies.

- [ ] **Step 4: Run policy and preset tests**

Run: `pnpm --filter app exec vitest run tests/leave-policy-engine-v2.test.ts tests/leave-presets.test.ts`

Expected: PASS with no shared-object mutation between builder calls.

- [ ] **Step 5: Commit the presets**

```bash
git add apps/app/lib/leave/presets.ts apps/app/tests/leave-presets.test.ts
git commit -m "feat: add Philippine leave policy presets"
```

### Task 4: Canonical Schema, Indexes, and Inventory Contracts

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/schemaFieldManifest.ts`
- Test: `apps/app/tests/leave-v2-schema.test.ts`
- Test: `apps/app/tests/schema-inventory-coverage.test.ts`

**Interfaces:**
- Consumes: table contracts from the design specification.
- Produces: generated `Doc` and `Id` types for all later Convex tasks.

- [ ] **Step 1: Write a failing schema insertion/index test**

Create a convex-test fixture that inserts an organization, employee, `leavePolicies` row, `leavePolicyVersions` row, extended `employeeLeaveBalances` projection, `leaveLedgerEntries` row, `leaveRequests` row, `leaveRequestOccurrences` row, and `leaveRequestEvents` row. Query the ledger with `by_balance_effective`, occurrences with `by_employee_local_date`, and events with `by_request_created` and assert one result from each.

- [ ] **Step 2: Run schema tests and confirm missing-table failures**

Run: `pnpm --filter app exec vitest run tests/leave-v2-schema.test.ts tests/schema-inventory-coverage.test.ts`

Expected: FAIL because the canonical tables and inventory policies are absent.

- [ ] **Step 3: Add compatibility-safe schemas and indexes**

Add the nine canonical tables from the spec. Extend `employeeLeaveBalances` with optional policy engine fields during migration:

```ts
policyId: v.optional(v.id("leavePolicies")),
policyVersionId: v.optional(v.id("leavePolicyVersions")),
poolKey: v.optional(v.string()),
periodStart: v.optional(v.number()),
periodEnd: v.optional(v.number()),
granted: v.optional(v.number()),
reserved: v.optional(v.number()),
converted: v.optional(v.number()),
expired: v.optional(v.number()),
projectionVersion: v.optional(v.number()),
lastLedgerEntryId: v.optional(v.id("leaveLedgerEntries")),
engineStatus: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("reconciliation_required"))),
```

Extend `leaveRequests` with optional policy, duration, pay-treatment, cancellation, reviewer snapshot, engine version, and cutover fields while retaining legacy fields. Expand its status validator with `draft`, `cancellation_requested`, and `corrected`. Register new tables as canonical leave rows and map legacy request/type/credit fields to their targets in the manifest.

- [ ] **Step 4: Generate Convex types and run schema gates**

Run: `pnpm --filter app exec convex codegen`

Run: `pnpm --filter app exec vitest run tests/leave-v2-schema.test.ts tests/schema-inventory-coverage.test.ts tests/schema-contract-references.test.ts tests/full-schema-readiness.test.ts`

Expected: codegen succeeds and all schema gates pass.

- [ ] **Step 5: Commit the canonical contract**

```bash
git add apps/app/convex/schema.ts apps/app/convex/fullSchemaInventory.ts apps/app/convex/schemaFieldManifest.ts apps/app/convex/_generated apps/app/tests/leave-v2-schema.test.ts
git commit -m "feat: add canonical leave policy and ledger schema"
```

### Task 5: Leave Authorization and Confidential Access

**Files:**
- Create: `apps/app/convex/leaveAccess.ts`
- Test: `apps/app/tests/security/leave-v2-access.test.ts`

**Interfaces:**
- Produces: `requireLeaveSelfService()`, `requireFinalLeaveReviewer()`, `requireSensitiveLeaveAccess()`, and `canReviewLeave()`.
- Consumes: active membership and membership-to-employee linkage from `convex/access.ts`.

- [ ] **Step 1: Write failing authorization tests**

Test the pure authorization decisions before request endpoints consume them:

```ts
expect(canReviewLeave({ role: "manager", reviewerEmployeeId: "e1", requestEmployeeId: "e2" })).toEqual({ allowed: false, reason: "Owner, Admin, or HR approval is required" });
expect(canReviewLeave({ role: "hr", reviewerEmployeeId: "e1", requestEmployeeId: "e1" })).toEqual({ allowed: false, reason: "You cannot approve your own leave request" });
expect(canReviewLeave({ role: "admin", reviewerEmployeeId: "e1", requestEmployeeId: "e2" })).toEqual({ allowed: true });
expect(canViewSensitiveLeave({ isRequestEmployee: false, hasActiveGrant: false })).toBe(false);
expect(canViewSensitiveLeave({ isRequestEmployee: false, hasActiveGrant: true })).toBe(true);
```

- [ ] **Step 2: Run the security test and confirm failure**

Run: `pnpm --filter app exec vitest run tests/security/leave-v2-access.test.ts`

Expected: FAIL because the V2 endpoints/access helpers are absent.

- [ ] **Step 3: Implement role and linkage checks**

Export pure `canReviewLeave` and `canViewSensitiveLeave` functions with the tested inputs, then implement `requireFinalLeaveReviewer` by calling `requireActiveMembership`, accepting only `owner | admin | hr`, loading the request, and rejecting when `membership.employeeId === request.employeeId`. `requireSensitiveLeaveAccess` accepts the requesting employee or an active indexed `leaveSensitiveAccessGrants` row for the membership. Do not authorize by email.

- [ ] **Step 4: Run security and role-route tests**

Run: `pnpm --filter app exec vitest run tests/security/leave-v2-access.test.ts tests/role-access.test.ts tests/org-membership-lifecycle.test.ts`

Expected: PASS; manager retains self-service route access but has no review mutation access.

- [ ] **Step 5: Commit leave authorization**

```bash
git add apps/app/convex/leaveAccess.ts apps/app/tests/security/leave-v2-access.test.ts
git commit -m "feat: enforce leave review and privacy access"
```

### Task 6: Immutable Ledger and Atomic Projection Updates

**Files:**
- Create: `apps/app/convex/leaveLedger.ts`
- Test: `apps/app/tests/leave-ledger.test.ts`

**Interfaces:**
- Consumes: Task 1 projection math and Task 4 schema.
- Produces: `getOrCreateBalanceProjection()`, `appendLedgerEntry()`, `reserveUnits()`, `releaseReservation()`, `consumeReservation()`, `restoreUsage()`, and `rebuildBalanceProjection()`.

- [ ] **Step 1: Write failing ledger transaction tests**

Test that an eight-unit grant plus two-unit reservation yields six available; approval atomically removes two reserved and adds two used while availability stays six; cancellation restores used and availability to eight; replaying the same idempotency key creates no second entry; a competing reservation beyond available throws `Insufficient leave balance`.

- [ ] **Step 2: Run ledger tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-ledger.test.ts`

Expected: FAIL because ledger helpers do not exist.

- [ ] **Step 3: Implement append-only helpers**

Use `by_organization_idempotency_key` to return the existing entry on replay. Validate the resulting projection before insert/patch. Update `employeeLeaveBalances` and insert the ledger row in the same mutation transaction. `consumeReservation` writes `reservation_release` and `usage` entries with distinct deterministic keys. `rebuildBalanceProjection` reads only `by_balance_effective` for one balance row and period.

- [ ] **Step 4: Run ledger and schema tests**

Run: `pnpm --filter app exec vitest run tests/leave-ledger.test.ts tests/leave-v2-schema.test.ts`

Expected: PASS with exact ledger counts and projections.

- [ ] **Step 5: Commit the ledger**

```bash
git add apps/app/convex/leaveLedger.ts apps/app/tests/leave-ledger.test.ts
git commit -m "feat: add auditable leave ledger projections"
```

### Task 7: Legacy Migration Planner, Executor, and Activation Gate

**Files:**
- Create: `apps/app/convex/leaveMigrationPlanner.ts`
- Create: `apps/app/convex/leaveMigration.ts`
- Modify: `apps/app/convex/organizationConfiguration.ts`
- Test: `apps/app/tests/leave-v2-migration.test.ts`
- Create: `docs/runbooks/philippine-leave-engine-rollout.md`

**Interfaces:**
- Consumes: presets, schema, and ledger helpers.
- Produces: `planOrganizationLeaveMigration()`, `runOrganizationLeaveMigrationBatch`, `compareOrganizationLeaveMigration`, and `activateOrganizationLeaveEngine`.

- [ ] **Step 1: Write failing preservation and idempotency tests**

Use fixtures for general and by-type organizations. Assert that:

```ts
expect(plan.employmentSector).toBeUndefined();
expect(plan.policyMappings).toContainEqual(expect.objectContaining({ sourceKey: "__plinth_general_leave__", accountBehavior: "shared_pool" }));
expect(plan.openingEntries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(existingBalance);
expect(secondRun.createdRows).toBe(0);
expect(comparison.balanceMismatches).toEqual([]);
```

Include an inconsistent `{ total: 8, used: 3, balance: 6 }` fixture and assert a `migration_reconciliation` entry of `1` plus `reconciliation_required`.

- [ ] **Step 2: Run migration tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-v2-migration.test.ts`

Expected: FAIL because the planner/executor is absent.

- [ ] **Step 3: Implement staged migration**

Map existing general settings to one shared pool and by-type settings to individual policies. Create opening grant, opening usage, and reconciliation entries without replaying historical approved requests. Store the cutover candidate timestamp, page employee balances with a cursor, write per-organization counts/mismatches, and refuse activation until policy counts, request counts, and balance invariants pass or an Owner explicitly accepts listed discrepancies.

Document preview, batch, compare, activate, rollback-before-activation, and verification commands in the runbook.

- [ ] **Step 4: Run migration and existing normalization gates**

Run: `pnpm --filter app exec vitest run tests/leave-v2-migration.test.ts tests/leave-employee-migration-planner.test.ts tests/leave-employee-children-schema.test.ts tests/full-schema-readiness.test.ts`

Expected: PASS and repeated runs create no duplicate policies, versions, balances, or entries.

- [ ] **Step 5: Commit migration tooling**

```bash
git add apps/app/convex/leaveMigrationPlanner.ts apps/app/convex/leaveMigration.ts apps/app/convex/organizationConfiguration.ts apps/app/tests/leave-v2-migration.test.ts docs/runbooks/philippine-leave-engine-rollout.md
git commit -m "feat: migrate leave policies without balance changes"
```

### Task 8: Policy Administration and Effective-Dated Settings

**Files:**
- Create: `apps/app/convex/leavePolicies.ts`
- Modify: `apps/app/convex/settings.ts`
- Test: `apps/app/tests/leave-policy-administration.test.ts`

**Interfaces:**
- Consumes: Task 3 presets, Task 4 schema, and Task 5 review authorization.
- Produces: `getLeaveConfiguration`, `configureLeaveSector`, `createLeavePolicyVersion`, `archiveLeavePolicy`, `previewLeavePolicyImpact`, and compatibility behavior for `settings.updateLeaveTypes`.

- [ ] **Step 1: Write failing policy-version tests**

Assert that a new private organization receives a five-day SIL policy, a government organization receives separate vacation/sick versions, an edit creates version 2 without patching version 1, an archive closes the active version but preserves linked requests, and a manager cannot write settings.

- [ ] **Step 2: Run the administration test and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-policy-administration.test.ts`

Expected: FAIL because the policy API is absent.

- [ ] **Step 3: Implement policy queries and mutations**

Use `by_organization_source_key` for stable policy identity and `by_policy_version` for immutable versions. Require an effective date and change reason. Prevent overlapping effective ranges. Protect statutory baseline fields from reductions while allowing more generous values and configurable evidence/notice fields. For non-activated organizations, keep the current normalized settings writer unchanged except for recording a pending policy comparison.

- [ ] **Step 4: Run settings, policy, and release-contract tests**

Run: `pnpm --filter app exec vitest run tests/leave-policy-administration.test.ts tests/release-3-forbidden-references.test.ts tests/leave-policy-calculations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit policy administration**

```bash
git add apps/app/convex/leavePolicies.ts apps/app/convex/settings.ts apps/app/tests/leave-policy-administration.test.ts
git commit -m "feat: version organization leave policies"
```

### Task 9: Statutory Qualifications, Benefit Events, and Restricted Evidence

**Files:**
- Create: `apps/app/convex/leaveQualifications.ts`
- Modify: `apps/app/convex/files.ts`
- Modify: `apps/app/convex/communicationsCompatibility.ts`
- Test: `apps/app/tests/leave-qualifications-privacy.test.ts`

**Interfaces:**
- Consumes: policy confidentiality/evidence rules and Task 5 access helpers.
- Produces: `submitLeaveQualification`, `verifyLeaveQualification`, `recordLeaveBenefitEvent`, `grantSensitiveLeaveAccess`, `revokeSensitiveLeaveAccess`, `getRestrictedLeaveDetails`, and `getLeaveAttachmentUrl`.

- [ ] **Step 1: Write failing qualification and privacy tests**

Create convex-test fixtures proving an employee can submit their own qualification/evidence, only Owner/Admin/HR can verify it, manager verification fails, qualification validity is effective-dated, maternity allocation cannot exceed seven days, VAWC administrative reads return a neutral label without a sensitive grant, and an active grant exposes details. Insert an unrelated storage link and assert `getLeaveAttachmentUrl` rejects it even for a granted HR user.

- [ ] **Step 2: Run privacy tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-qualifications-privacy.test.ts`

Expected: FAIL because qualification/event APIs and request-scoped file access do not exist.

- [ ] **Step 3: Implement verified eligibility and scoped files**

Store ongoing eligibility in `employeeLeaveQualifications` and event-specific facts in `leaveBenefitEvents`. Return only `{ qualificationType, validFrom, validUntil, verificationStatus }` from ordinary leave queries. Store protected reason/event metadata behind `requireSensitiveLeaveAccess`. `getLeaveAttachmentUrl` must verify organization access, request ownership or sensitive grant, and that the requested storage ID belongs to that leave request's normalized attachment links before returning a URL. Grant/revoke mutations require Owner and append request/administrative events.

- [ ] **Step 4: Run privacy and storage authorization suites**

Run: `pnpm --filter app exec vitest run tests/leave-qualifications-privacy.test.ts tests/security/storage-access.test.ts tests/security/storage-upload.test.ts tests/leave-employee-compatibility.test.ts`

Expected: PASS with no generic organization-file URL bypass.

- [ ] **Step 5: Commit qualification and privacy workflows**

```bash
git add apps/app/convex/leaveQualifications.ts apps/app/convex/files.ts apps/app/convex/communicationsCompatibility.ts apps/app/tests/leave-qualifications-privacy.test.ts
git commit -m "feat: secure statutory leave eligibility evidence"
```

### Task 10: Idempotent Accrual, Carryover, and Year-End Processing

**Files:**
- Create: `apps/app/convex/leaveAccrual.ts`
- Create: `apps/app/convex/crons.ts`
- Test: `apps/app/tests/leave-accrual.test.ts`

**Interfaces:**
- Consumes: policy engine and ledger helpers.
- Produces: `materializeEmployeeAccruals()`, `materializeOrganizationAccrualBatch`, and `closeLeavePolicyPeriod()`.

- [ ] **Step 1: Write failing accrual tests**

Test monthly private company accrual, government 1.25 vacation and 1.25 sick accrual, employee separation stopping future accrual, rehire starting a new service window, capped carryover, protected SIL conversion liability, noncumulative solo-parent expiration, and two invocations producing the same ledger count.

- [ ] **Step 2: Run accrual tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-accrual.test.ts`

Expected: FAIL because accrual posting is absent.

- [ ] **Step 3: Implement bounded materialization and daily scheduling**

Generate stable keys in the form `accrual:<balanceId>:<periodStart>:<periodEnd>`. Use employee lifecycle events as service windows. Page active organizations and employees; never collect all organizations or employees in one transaction. Year-end writes explicit carryover, expiration, or conversion-liability entries. Schedule the internal organization batch daily from `crons.ts`.

- [ ] **Step 4: Run accrual and employee lifecycle tests**

Run: `pnpm --filter app exec vitest run tests/leave-accrual.test.ts tests/employee-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit accrual processing**

```bash
git add apps/app/convex/leaveAccrual.ts apps/app/convex/crons.ts apps/app/tests/leave-accrual.test.ts
git commit -m "feat: post idempotent leave accruals"
```

### Task 11: Request Preview, Submission, and Reservation

**Files:**
- Create: `apps/app/convex/leaveOccurrences.ts`
- Modify: `apps/app/convex/leave.ts`
- Test: `apps/app/tests/leave-request-lifecycle-v2.test.ts`

**Interfaces:**
- Consumes: duration engine, policy API, access helpers, and ledger reservations.
- Produces: `previewLeaveRequestV2`, `createLeaveRequestV2`, `getMyLeaveDashboard`, and paginated `getMyLeaveRequests`.

- [ ] **Step 1: Write failing submission tests**

Test a Friday-to-Monday request with Monday as an applicable holiday, a half-day request, calendar-day maternity duration, insufficient availability, missing qualification, missing required evidence, overlap, separated employee denial, and two concurrent pending requests that cannot reserve beyond availability.

Assert employees cannot send a pay-treatment override in the V2 argument validator.

- [ ] **Step 2: Run lifecycle tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-request-lifecycle-v2.test.ts`

Expected: FAIL because V2 request endpoints are absent.

- [ ] **Step 3: Implement server-authoritative preview and submission**

Load one active policy version, the employee schedule/shift, only holidays in the requested range, qualification/event evidence, and the matching balance projection. Build occurrence drafts on the server. On submit, repeat validation and atomically insert the pending request, occurrences, reservation entries, request event, attachment links, and approver notifications. Store local dates plus schedule/holiday/pay snapshots.

- [ ] **Step 4: Run lifecycle, conflict, attachment, and notification tests**

Run: `pnpm --filter app exec vitest run tests/leave-request-lifecycle-v2.test.ts tests/leave-request-conflicts.test.ts tests/leave-employee-compatibility.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit request submission**

```bash
git add apps/app/convex/leaveOccurrences.ts apps/app/convex/leave.ts apps/app/tests/leave-request-lifecycle-v2.test.ts
git commit -m "feat: submit schedule-aware leave requests"
```

### Task 12: Final Review, Rejection, Cancellation, and Corrections

**Files:**
- Modify: `apps/app/convex/leave.ts`
- Test: `apps/app/tests/leave-review-lifecycle-v2.test.ts`

**Interfaces:**
- Consumes: reviewer access, ledger transitions, occurrences, payroll locks, and notifications.
- Produces: `getLeaveApprovalInbox`, `getLeaveReviewContext`, `approveLeaveRequestV2`, `rejectLeaveRequestV2`, `withdrawPendingLeaveRequest`, `requestApprovedLeaveCancellation`, `approveLeaveCancellation`, `recordManualLeaveV2`, `adjustLeaveBalance`, and `correctProcessedLeave`.

- [ ] **Step 1: Write failing decision tests**

Assert approval consumes the reservation exactly once, rejection releases it, pending withdrawal releases it, approved future cancellation requires a second actor and restores usage, HR direct cancellation requires a reason, payroll-locked leave rejects ordinary cancellation, correction creates reversing entries, manual balance adjustment requires an effective date and reason, reviewer identity comes from the authenticated user, and manager/self-approval are denied.

- [ ] **Step 2: Run review tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-review-lifecycle-v2.test.ts`

Expected: FAIL because final-review endpoints are absent.

- [ ] **Step 3: Implement atomic workflow transitions**

Guard each transition by its exact current state. Reload policy, occurrence, balance, overlap, qualification, and payroll lock before approval. Append request events for every terminal or cancellation transition. Use authenticated `user._id`, name snapshot, and membership role; remove manual approver-name input. Keep legacy endpoints only for organizations whose engine is not activated.

- [ ] **Step 4: Run lifecycle, access, and review-action tests**

Run: `pnpm --filter app exec vitest run tests/leave-review-lifecycle-v2.test.ts tests/security/leave-v2-access.test.ts tests/leave-review-actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit final review workflow**

```bash
git add apps/app/convex/leave.ts apps/app/tests/leave-review-lifecycle-v2.test.ts
git commit -m "feat: complete audited leave review lifecycle"
```

### Task 13: Conversion Requests and Final-Settlement Linkage

**Files:**
- Create: `apps/app/convex/leaveConversions.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Test: `apps/app/tests/leave-conversion-workflow.test.ts`

**Interfaces:**
- Consumes: ledger, policy conversion rule, payroll `leave_conversion` run type, and final settlements.
- Produces: `requestLeaveConversion`, `approveLeaveConversion`, `getLeaveConversionQueue`, and payroll/final-settlement linking helpers.

- [ ] **Step 1: Write failing conversion tests**

Test policy cap enforcement, daily-rate snapshot, conversion as a separate ledger kind, no `used` increment, draft payroll linkage for active employees, final-settlement linkage for separated employees, payroll finalization locking the conversion, cancellation before payroll restoring availability, and separation closing future accrual while placing unlocked future approved leave into the audited cancellation/correction flow.

- [ ] **Step 2: Run conversion tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-conversion-workflow.test.ts`

Expected: FAIL because conversion requests are not ledger/payroll linked.

- [ ] **Step 3: Implement conversion decision and payable linkage**

Create `leaveConversionRequests` before deducting availability. Approval appends a `conversion` entry, snapshots the applicable daily rate, and links to the existing `leave_conversion` payroll workflow or the employee's final settlement. Replace payroll's hard-coded first-five-days computation with approved conversion rows for activated organizations. Do not mutate `used`.

- [ ] **Step 4: Run conversion and payroll calculation tests**

Run: `pnpm --filter app exec vitest run tests/leave-conversion-workflow.test.ts tests/payroll-calculations.test.ts`

Expected: PASS for legacy and activated organizations.

- [ ] **Step 5: Commit conversion integration**

```bash
git add apps/app/convex/leaveConversions.ts apps/app/convex/payroll.ts apps/app/convex/finalSettlements.ts apps/app/tests/leave-conversion-workflow.test.ts
git commit -m "feat: link leave conversion to payroll"
```

### Task 14: Occurrence-Based Attendance and Payroll Decisions

**Files:**
- Create: `apps/app/lib/leave/payroll-integration.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/attendance.ts`
- Test: `apps/app/tests/leave-attendance-payroll-integration.test.ts`

**Interfaces:**
- Consumes: approved occurrence rows and `LeavePayTreatment`.
- Produces: `resolveLeavePayrollDay()`, indexed occurrence loaders, attendance conflict records, and payroll occurrence locks.

- [ ] **Step 1: Write failing integration tests**

```ts
expect(resolveLeavePayrollDay({ scheduledMinutes: 480, leaveMinutes: 480, payTreatment: "company_paid" })).toEqual({ paidFraction: 1, unpaidFraction: 0 });
expect(resolveLeavePayrollDay({ scheduledMinutes: 480, leaveMinutes: 240, payTreatment: "unpaid" })).toEqual({ paidFraction: 0, unpaidFraction: 0.5 });
expect(resolveLeavePayrollDay({ scheduledMinutes: 480, leaveMinutes: 480, payTreatment: "statutory_benefit_supported" })).toEqual({ paidFraction: 1, unpaidFraction: 0, requiresBenefitBreakdown: true });
```

Add convex-test cases proving actual clock work creates a leave conflict, a holiday added before an unlocked future occurrence restores the charge, and finalized payroll prevents silent occurrence mutation.

- [ ] **Step 2: Run integration tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-attendance-payroll-integration.test.ts`

Expected: FAIL because payroll still interprets request ranges and `isPaid`.

- [ ] **Step 3: Implement the typed integration boundary**

For activated organizations, query `leaveRequestOccurrences` by employee/local-date range, calculate paid and unpaid fractions from explicit pay treatment, and lock consumed rows to the payroll run. Attendance returns an overlay/conflict state rather than inserting a fake punch. Reconciliation after schedule/holiday changes is allowed only for unlocked future occurrences and writes request events plus ledger reversals/charges.

- [ ] **Step 4: Run attendance and payroll suites**

Run: `pnpm --filter app exec vitest run tests/leave-attendance-payroll-integration.test.ts tests/payroll-calculations.test.ts tests/attendance-hardening.test.ts tests/attendance-service.test.ts`

Expected: PASS with legacy fallback only for non-activated organizations.

- [ ] **Step 5: Commit attendance/payroll integration**

```bash
git add apps/app/lib/leave/payroll-integration.ts apps/app/convex/payroll.ts apps/app/convex/attendance.ts apps/app/tests/leave-attendance-payroll-integration.test.ts
git commit -m "feat: integrate approved leave occurrences with payroll"
```

### Task 15: Typed Service, Actions, and Paginated Query Boundary

**Files:**
- Rewrite: `apps/app/services/leave-service.ts`
- Rewrite: `apps/app/actions/leave.ts`
- Modify: `apps/app/convex/leave.ts`
- Test: `apps/app/tests/leave-client-contract.test.ts`

**Interfaces:**
- Consumes: V2 Convex endpoints from Tasks 8-14.
- Produces: `previewLeaveRequest`, `submitLeaveRequest`, `approveLeaveRequest`, `rejectLeaveRequest`, `requestLeaveCancellation`, `approveLeaveCancellation`, `recordManualLeave`, `adjustLeaveBalance`, and `requestLeaveConversion` server actions.

- [ ] **Step 1: Write a failing typed-client and pagination behavior test**

Add a compile-time fixture that assigns each server action's input and output to the canonical request/response interfaces. Add a convex-test query that inserts 55 requests, requests `numItems: 20`, and asserts 20 rows plus a continuation cursor without reading attachments for rows outside the page. Enforce explicit-`any` removal through the focused ESLint command in Step 4.

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-client-contract.test.ts`

Expected: FAIL because the service and page query use `any` and unbounded organization reads.

- [ ] **Step 3: Rewrite the boundary with generated types**

Import `api` and `Id` directly, call `convex.mutation(api.leave.createLeaveRequestV2, args)` and the corresponding generated query references without function casts, and export named request/response interfaces from `lib/leave/types.ts`. Use Convex pagination validators and indexed status/employee/date queries. Resolve attachments only for the returned page.

- [ ] **Step 4: Run codegen, contract tests, and lint**

Run: `pnpm --filter app exec convex codegen`

Run: `pnpm --filter app exec vitest run tests/leave-client-contract.test.ts tests/release-3-forbidden-references.test.ts`

Run: `pnpm --filter app exec eslint services/leave-service.ts actions/leave.ts convex/leave.ts`

Expected: all commands pass with no explicit `any` in rewritten leave boundary files.

- [ ] **Step 5: Commit the typed boundary**

```bash
git add apps/app/services/leave-service.ts apps/app/actions/leave.ts apps/app/convex/leave.ts apps/app/convex/_generated apps/app/tests/leave-client-contract.test.ts
git commit -m "refactor: type and paginate leave APIs"
```

### Task 16: Leave Settings UI

**Files:**
- Rewrite: `apps/app/components/settings/leave-types-settings-content.tsx`
- Create: `apps/app/components/settings/leave-policy-editor.tsx`
- Create: `apps/app/components/settings/leave-policy-impact-dialog.tsx`
- Modify: `apps/app/lib/leave/client-state.ts`
- Test: `apps/app/tests/leave-settings-ui.test.ts`

**Interfaces:**
- Consumes: `getLeaveConfiguration`, sector configuration, preset setup, version creation, and impact preview.
- Produces: guided sector/preset setup and effective-dated policy editing.

- [ ] **Step 1: Write failing settings view-model behavior tests**

Test the settings view-model functions: unconfirmed migrated organizations return `Confirm organization sector` without changing policy values, private new organizations expose pooled/by-type company leave, government new organizations expose vacation/sick separately, statutory policies are grouped separately from company policies, and save validation rejects a missing effective date or reason. Enforce explicit-`any` removal through the focused ESLint command in Step 4.

- [ ] **Step 2: Run UI contract tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/leave-settings-ui.test.ts`

Expected: FAIL against the legacy settings component.

- [ ] **Step 3: Build the guided settings workflow**

Use four sections: Organization type, Company leave, Statutory leave, and Workflow/requests. Show protected baseline fields read-only, operational fields editable, and an impact dialog before creating a new effective-dated version. Archived policies remain visible in history. Preserve the form-template and PDF-layout entry points.

- [ ] **Step 4: Run settings tests and focused lint**

Run: `pnpm --filter app exec vitest run tests/leave-settings-ui.test.ts tests/leave-policy-administration.test.ts`

Run: `pnpm --filter app exec eslint components/settings/leave-types-settings-content.tsx components/settings/leave-policy-editor.tsx components/settings/leave-policy-impact-dialog.tsx lib/leave/client-state.ts`

Expected: PASS.

- [ ] **Step 5: Commit the settings UI**

```bash
git add apps/app/components/settings/leave-types-settings-content.tsx apps/app/components/settings/leave-policy-editor.tsx apps/app/components/settings/leave-policy-impact-dialog.tsx apps/app/lib/leave/client-state.ts apps/app/tests/leave-settings-ui.test.ts
git commit -m "feat: redesign leave policy settings"
```

### Task 17: Employee Leave Workspace

**Files:**
- Create: `apps/app/app/[organizationId]/leave/_components/employee-leave-dashboard.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/leave-request-drawer.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/leave-request-timeline.tsx`
- Modify: `apps/app/app/[organizationId]/leave/page.tsx`
- Test: `apps/app/tests/employee-leave-workspace.test.ts`

**Interfaces:**
- Consumes: dashboard, preview, submit, history, withdrawal, and cancellation actions.
- Produces: the employee credits/request/history experience.

- [ ] **Step 1: Write failing employee workspace tests**

Test view-model output for available, reserved, projected, statutory, upcoming, and recent sections. Test request-form state transitions proving pay treatment comes only from the server preview, preview workdays/holidays are retained, half-day is enabled only when configured, returned evidence rules block submission until satisfied, and restricted policies use neutral labels.

- [ ] **Step 2: Run employee workspace tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/employee-leave-workspace.test.ts`

Expected: FAIL because the legacy dialog and credit tabs do not meet the contract.

- [ ] **Step 3: Implement the employee dashboard and guided drawer**

Compose summary cards, upcoming requests, and timeline history. The drawer stages are policy, duration, preview, evidence/reason, and confirmation. Disable submit until the latest server preview matches the input fingerprint. Pending requests expose Withdraw; approved future requests expose Request cancellation; past/locked requests show read-only details.

- [ ] **Step 4: Run employee tests and lint**

Run: `pnpm --filter app exec vitest run tests/employee-leave-workspace.test.ts tests/leave-history-columns.test.ts`

Run: `pnpm --filter app exec eslint 'app/[organizationId]/leave/_components/employee-leave-dashboard.tsx' 'app/[organizationId]/leave/_components/leave-request-drawer.tsx' 'app/[organizationId]/leave/_components/leave-request-timeline.tsx' 'app/[organizationId]/leave/page.tsx'`

Expected: PASS with no explicit `any` in the new workspace.

- [ ] **Step 5: Commit the employee workspace**

```bash
git add 'apps/app/app/[organizationId]/leave' apps/app/tests/employee-leave-workspace.test.ts
git commit -m "feat: redesign employee leave workspace"
```

### Task 18: Administrative Inbox, Review, Ledger, Conversion, and Calendar UI

**Files:**
- Create: `apps/app/app/[organizationId]/leave/_components/leave-approval-inbox.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/leave-review-drawer.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/employee-balance-ledger.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/leave-conversion-queue.tsx`
- Create: `apps/app/app/[organizationId]/leave/_components/leave-calendar.tsx`
- Modify: `apps/app/app/[organizationId]/leave/page.tsx`
- Test: `apps/app/tests/admin-leave-workspace.test.ts`

**Interfaces:**
- Consumes: paginated approval/review/balance/event/conversion APIs.
- Produces: Owner/Admin/HR operational workspace.

- [ ] **Step 1: Write failing administrative UI tests**

Assert typed view models provide pending, cancellation, evidence, and conflict queues; essential review columns cannot be hidden; reviewer identity is rendered from the returned authenticated snapshot; managers receive no admin tabs; restricted reasons are redacted without a sensitive grant; ledger rows explain kind, units, effective date, actor, and reason; conversion rows show payroll/final-settlement status; calendar rows expose employee availability and neutral restricted labels without protected reasons.

- [ ] **Step 2: Run admin workspace tests and confirm failure**

Run: `pnpm --filter app exec vitest run tests/admin-leave-workspace.test.ts`

Expected: FAIL because the legacy tracker/review dialogs do not meet the contract.

- [ ] **Step 3: Implement the professional administrative workspace**

Make Approval inbox the default admin tab. Add server pagination, search, status/policy/date filters, review context, decision reason, cancellation confirmation, and conflict presentation. Add a balance ledger drawer, adjustment action, conversion queue, and approved-absence calendar. Do not require a typed reviewer name; render the authenticated reviewer and policy-controlled signature input.

- [ ] **Step 4: Run admin UI tests and lint**

Run: `pnpm --filter app exec vitest run tests/admin-leave-workspace.test.ts tests/leave-review-lifecycle-v2.test.ts tests/leave-conversion-workflow.test.ts`

Run: `pnpm --filter app exec eslint 'app/[organizationId]/leave/_components/leave-approval-inbox.tsx' 'app/[organizationId]/leave/_components/leave-review-drawer.tsx' 'app/[organizationId]/leave/_components/employee-balance-ledger.tsx' 'app/[organizationId]/leave/_components/leave-conversion-queue.tsx' 'app/[organizationId]/leave/_components/leave-calendar.tsx' 'app/[organizationId]/leave/page.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit the admin workspace**

```bash
git add 'apps/app/app/[organizationId]/leave' apps/app/tests/admin-leave-workspace.test.ts
git commit -m "feat: add professional leave administration workspace"
```

### Task 19: Compatibility Cutover, Legacy Retirement, and Full Verification

**Files:**
- Modify: `apps/app/convex/leave.ts`
- Modify: `apps/app/convex/leaveCalculations.ts`
- Modify: `apps/app/utils/leave-policy-calculations.ts`
- Modify: `apps/app/utils/leave-tracker-calculations.ts`
- Remove after replacement verification: legacy leave request/review/manual/credit/conversion components under `apps/app/app/[organizationId]/leave/_components/`
- Modify: `docs/runbooks/philippine-leave-engine-rollout.md`
- Test: `apps/app/tests/leave-engine-cutover.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one active engine per organization and zero policy-engine writes to legacy employee credit projections.

- [ ] **Step 1: Write failing cutover invariants**

Use convex-test fixtures to assert activated organizations do not change legacy employee credit rows, non-activated organizations still return identical balances, activated organizations use occurrence payroll reads, and migration comparison is required before activation. Verify removed-symbol cleanup separately with the `rg` command in Step 4 rather than encoding source text as product behavior.

- [ ] **Step 2: Run cutover tests and confirm legacy-reference failure**

Run: `pnpm --filter app exec vitest run tests/leave-engine-cutover.test.ts tests/release-3-forbidden-references.test.ts`

Expected: FAIL while legacy active-path references remain.

- [ ] **Step 3: Gate compatibility and retire replaced code**

Route reads and writes by `activePolicyEngineVersion`. Keep legacy functions in a clearly named compatibility module only for non-activated organizations during rollout. Remove replaced UI components after their imports reach zero. Update the runbook with migration preview, batch, comparison, owner sector confirmation, activation, monitoring, and pre-activation rollback steps.

- [ ] **Step 4: Run complete verification**

Run: `pnpm --filter app exec convex codegen`

Run: `pnpm --filter app exec vitest run tests/leave-policy-engine-v2.test.ts tests/leave-duration-engine.test.ts tests/leave-presets.test.ts tests/leave-v2-schema.test.ts tests/security/leave-v2-access.test.ts tests/leave-ledger.test.ts tests/leave-v2-migration.test.ts tests/leave-policy-administration.test.ts tests/leave-qualifications-privacy.test.ts tests/leave-accrual.test.ts tests/leave-request-lifecycle-v2.test.ts tests/leave-review-lifecycle-v2.test.ts tests/leave-conversion-workflow.test.ts tests/leave-attendance-payroll-integration.test.ts tests/leave-client-contract.test.ts tests/leave-settings-ui.test.ts tests/employee-leave-workspace.test.ts tests/admin-leave-workspace.test.ts tests/leave-engine-cutover.test.ts`

Run: `pnpm --filter app exec vitest run tests/payroll-calculations.test.ts tests/employee-lifecycle.test.ts tests/org-membership-lifecycle.test.ts tests/release-3-forbidden-references.test.ts tests/schema-inventory-coverage.test.ts tests/schema-contract-references.test.ts tests/full-schema-readiness.test.ts`

Run: `pnpm --filter app exec eslint convex/leave.ts convex/leaveAccess.ts convex/leaveLedger.ts convex/leavePolicies.ts convex/leaveOccurrences.ts convex/leaveAccrual.ts convex/leaveQualifications.ts convex/leaveMigrationPlanner.ts convex/leaveMigration.ts convex/leaveConversions.ts convex/files.ts convex/communicationsCompatibility.ts services/leave-service.ts actions/leave.ts lib/leave components/settings/leave-types-settings-content.tsx components/settings/leave-policy-editor.tsx components/settings/leave-policy-impact-dialog.tsx 'app/[organizationId]/leave'`

Run: `pnpm --filter app exec tsc --noEmit`

Run: `if rg -n 'GENERAL_LEAVE_CREDIT_KEY|deductCreditsGeneralPool' apps/app/convex/leave.ts apps/app/app/'[organizationId]'/leave; then exit 1; fi`

Expected: all focused and regression tests pass, ESLint and TypeScript exit zero, and codegen produces no unexpected diff.

- [ ] **Step 5: Commit the cutover-ready module**

```bash
git add apps/app/convex/leave.ts apps/app/convex/leaveCalculations.ts apps/app/utils/leave-policy-calculations.ts apps/app/utils/leave-tracker-calculations.ts apps/app/tests/leave-engine-cutover.test.ts docs/runbooks/philippine-leave-engine-rollout.md
git add -u -- 'apps/app/app/[organizationId]/leave/_components'
git commit -m "refactor: complete Philippine leave engine cutover"
```

## Completion Gate

Before declaring the module complete:

- Run `git diff --check`.
- Confirm no unrelated dirty-worktree changes are staged.
- Confirm migration fixtures preserve exact legacy balances.
- Confirm private and government preset source metadata matches the approved design references.
- Confirm managers and self-reviewers fail authorization tests.
- Confirm sensitive attachments require request ownership plus an active sensitive-access grant.
- Confirm paid, unpaid, partial, statutory-supported, and government leave payroll cases pass.
- Confirm conversion creates a payroll/final-settlement payable and never increments leave usage.
- Confirm all new and rewritten leave code contains no explicit `any`.
