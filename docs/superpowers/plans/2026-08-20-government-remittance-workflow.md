# Government Remittance Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build an auditable government-remittance workflow that reconciles and settles payroll statutory liabilities independently from employee payroll payments.

**Architecture:** Add a pure remittance domain module for lifecycle and journal rules, normalized Convex remittance/allocation/advance-application tables, and a focused Convex API that owns authorization, reconciliation, encryption, evidence, accounting posting, and operational events. Expose it through a dedicated Accounting page with lifecycle-specific actions.

**Tech Stack:** TypeScript, Convex, Next.js App Router, React, Vitest, convex-test, Tailwind/shadcn UI

**Spec:** `docs/superpowers/specs/2026-08-20-government-remittance-design.md`

## Global Constraints

- Do not use `any`; use explicit interfaces and generated Convex document/id types.
- Keep filing separate from payment; filing never posts a journal.
- Never mutate or delete a paid remittance; correct it through reversal and replacement.
- Encrypt remittance references, bank labels, notes, failure details, and reversal reasons.
- Revalidate liability and advance availability at approval and payment.
- Preserve tenant isolation and require an active owner, admin, or accounting membership.
- Use failing tests before production changes and run each focused test after implementation.

---

### Task 1: Remittance domain rules

**Files:**
- Create: `apps/app/lib/government-remittance.ts`
- Test: `apps/app/tests/government-remittance-domain.test.ts`

**Interfaces:**
- Produces: `GovernmentAgency`, `GovernmentRemittanceStatus`, `assertGovernmentRemittanceTransition`, `getGovernmentLiabilityAccount`, `buildGovernmentRemittancePaymentJournal`, and currency validation helpers.

- [x] Write tests with hand-derived expectations for valid/invalid transitions and balanced liability, penalty, interest, overpayment, and applied-advance journals.
- [x] Run `pnpm --filter app test -- government-remittance-domain.test.ts` and confirm failure because the domain module does not exist.
- [x] Implement the minimal typed domain module and run the focused test to green.
- [x] Refactor shared account and currency logic while keeping the focused test green.

### Task 2: Persistent schema, encryption, and accounting posting

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/governmentRemittanceCrypto.ts`
- Create: `apps/app/convex/governmentRemittanceAccounting.ts`
- Modify: `apps/app/convex/_generated/api.d.ts`
- Test: `apps/app/tests/government-remittance-accounting.test.ts`
- Test: `apps/app/tests/field-encryption.test.ts`

**Interfaces:**
- Consumes: domain journal builder and agency account mapping from Task 1.
- Produces: remittance, allocation, and advance-application documents plus idempotent `postGovernmentRemittancePaymentJournal` and `reverseGovernmentRemittancePaymentJournal` helpers.

- [x] Write failing convex-test coverage for payment posting, stable source identity, reversal, encrypted sensitive fields, and source-entry preservation.
- [x] Add normalized schema tables and journal source/entry variants with indexes for organization, agency/status, remittance, payroll run, and source advance.
- [x] Add domain-separated crypto functions and typed journal posting helpers.
- [x] Run the focused accounting and encryption tests to green.

### Task 3: Reconciliation and lifecycle API

**Files:**
- Create: `apps/app/convex/governmentRemittances.ts`
- Modify: `apps/app/convex/_generated/api.d.ts`
- Test: `apps/app/tests/government-remittances.test.ts`

**Interfaces:**
- Produces queries `listGovernmentRemittances`, `getGovernmentLiabilityCandidates`, `getGovernmentRemittance` and mutations `createGovernmentRemittance`, `updateGovernmentRemittanceDraft`, `submitGovernmentRemittanceForReview`, `returnGovernmentRemittanceToDraft`, `approveGovernmentRemittance`, `recordGovernmentRemittanceFiling`, `recordGovernmentRemittancePayment`, `recordGovernmentRemittanceFailure`, `retryGovernmentRemittance`, `cancelGovernmentRemittance`, `attachGovernmentRemittanceEvidence`, and `reverseGovernmentRemittance`.

- [x] Write failing integration tests for role authorization, tenant isolation, liability calculation from journals, lifecycle guards, reservation conflicts, filing without a journal, payment revalidation, underpayment, advance reservation/application, reversal dependency ordering, and immutable terminal records.
- [x] Implement bounded query loaders and mutation guards with maximum allocation/evidence counts and validated strings, dates, reasons, and amounts.
- [x] Emit actor-rich operational events for every material transition using stable idempotency keys where retries are possible.
- [x] Run the focused lifecycle test to green, then rerun Tasks 1-2 tests.

### Task 4: Secure evidence integration

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/files.ts`
- Modify: `apps/app/services/files-service.ts`
- Modify: `apps/app/convex/governmentRemittances.ts`
- Test: `apps/app/tests/government-remittances.test.ts`

**Interfaces:**
- Adds storage purpose `government_remittance_evidence` and parent type `government_remittance`.

- [x] Add a failing test proving foreign-tenant, wrong-purpose, unregistered, and non-owned storage objects cannot be attached.
- [x] Extend upload validators and storage-link schema, then link evidence only after `requireRegisteredStorageObject` succeeds.
- [x] Return evidence metadata from detail queries without exposing another organization's storage IDs.
- [x] Run the focused integration test to green.

### Task 5: Government remittance UI

**Files:**
- Create: `apps/app/app/[organizationId]/accounting/remittances/page.tsx`
- Create: `apps/app/app/[organizationId]/accounting/remittances/remittances-page-client.tsx`
- Modify: `apps/app/components/layout/sidebar.tsx`
- Test: `apps/app/tests/government-remittance-ui.test.tsx`

**Interfaces:**
- Consumes the Task 3 Convex API and existing organization/file-upload helpers.

- [x] Write a failing UI test for the page's liability summary, creation form, valid action visibility, required filing/payment references, and reversal reason.
- [x] Implement an access-controlled page, agency/period candidate loader, allocation editor, status table, detail dialog, lifecycle dialogs, evidence upload, empty/loading/error states, and responsive layout.
- [x] Add a Finance sidebar entry for owner/admin/accounting roles.
- [x] Run the focused UI test to green and run TypeScript checking for the page/API boundary.

### Task 6: Schema contracts and final verification

**Files:**
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Modify: `apps/app/tests/fixtures/schema-contract-reference-baseline.json`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

**Interfaces:**
- Registers the three remittance tables as retained accounting canonical/historical records.

- [x] Add the remittance tables to the schema policy inventory and update exact table-count assertions.
- [x] Regenerate reviewed schema/reference baselines using their test-provided environment switches and inspect the diffs.
- [x] Run focused remittance, accounting, operational-event, encryption, and schema-contract tests.
- [x] Run `pnpm --filter app exec tsc --noEmit`, the full app test suite, and `pnpm --filter app build`.
- [x] Run focused ESLint/Prettier checks, `git diff --check`, and inspect `git diff --stat` plus `git status --short` before reporting completion.
