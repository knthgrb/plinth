# Account, Membership, and Employee Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement explicit user–membership–employee linking, normalized user-email uniqueness, canonical separation categories, and complete membership access transitions without losing legacy data.

**Architecture:** Add small shared lifecycle helpers that normalize legacy documents to canonical states, then route Convex mutations and UI decisions through those helpers. Keep stored legacy validators during rollout, stop producing legacy values, and enforce relationship uniqueness transactionally at every write boundary.

**Tech Stack:** TypeScript, Convex, Next.js 16, React 19, Vitest

**Spec:** `docs/superpowers/specs/2026-08-20-account-membership-employee-lifecycle-design.md`

## Global Constraints

- Do not use `any`; introduce explicit interfaces for every touched value.
- Preserve existing payroll working-tree changes.
- Do not hard-delete employees or memberships with history.
- Names and employee contact emails never identify or automatically mutate user accounts.
- New writes use canonical states while legacy states remain readable during migration.

---

### Task 1: Canonical lifecycle domain helpers and schema compatibility

**Files:**

- Create: `apps/app/utils/employment-lifecycle.ts`
- Modify: `apps/app/utils/employee-lifecycle.ts`
- Modify: `apps/app/utils/org-membership-lifecycle.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/employeeLifecycle.ts`
- Test: `apps/app/tests/employee-lifecycle.test.ts`
- Test: `apps/app/tests/org-membership-lifecycle.test.ts`

**Interfaces:**

- Produces `SeparationType`, `EmploymentStatus`, `normalizeEmploymentStatus`, `resolveSeparationType`, and `isEmployeeSeparated`.
- Produces canonical membership normalization where legacy `disabled` resolves to `suspended`.

- [ ] Add failing tests proving legacy `resigned`/`terminated` normalize to `separated`, all separation categories are labeled, and `disabled` normalizes to `suspended`.
- [ ] Run `pnpm --filter app test -- tests/employee-lifecycle.test.ts tests/org-membership-lifecycle.test.ts` and confirm failures.
- [ ] Implement typed canonical lifecycle helpers and compatibility mappings.
- [ ] Extend employee and lifecycle-event schema validators with canonical `separated` and `separationType` fields while retaining legacy literals for existing documents.
- [ ] Update lifecycle event recording to emit `separated` plus category for new separation events.
- [ ] Run the focused tests and confirm they pass.

### Task 2: User-email and relationship uniqueness

**Files:**

- Modify: `apps/app/convex/userEmail.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/invitationCreation.ts`
- Test: `apps/app/tests/user-email-identity.test.ts`
- Test: `apps/app/tests/invitation-token-compatibility.test.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`

**Interfaces:**

- Produces `assertUserEmailAvailable(ctx, email, exceptUserId?)`.
- Produces transactional checks for unique `(userId, organizationId)` and `(organizationId, employeeId)` membership relationships.

- [ ] Add failing tests for case-insensitive duplicate account creation, duplicate membership insertion through invitation acceptance, and duplicate employee linking.
- [ ] Run the three focused suites and confirm failures.
- [ ] Implement normalized-email availability validation and call it from every user create/email-update path touched by organization and invitation flows.
- [ ] Replace membership `.first()` assumptions at write boundaries with conflict-aware checks that reject duplicate rows.
- [ ] Run the focused suites and confirm they pass.

### Task 3: Explicit invitation and employee-link behavior

**Files:**

- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/invitationCreation.ts`
- Modify: `apps/app/actions/invitations.ts`
- Modify: `apps/app/services/invitations-service.ts`
- Modify: `apps/app/app/[organizationId]/employees/_components/create-employee-dialog.tsx`
- Test: `apps/app/tests/employee-account-linking.test.ts`
- Test: `apps/app/tests/invitation-token-compatibility.test.ts`

**Interfaces:**

- Invitation acceptance consumes only explicit `employeeId` links.
- Existing account/employee name mismatches return preview information but never mutate either name.

- [ ] Add failing tests proving invitation creation never renames an employee and same-email records remain unlinked without an explicit employee ID.
- [ ] Run the focused suites and confirm failures.
- [ ] Remove account-display-name-to-employee mutation logic and return a neutral mismatch warning in recipient previews.
- [ ] Make existing-member, suspended, alumni, removed, and employee-link conflicts return dedicated actionable errors.
- [ ] Keep employee creation account choices explicit and ensure linking does not overwrite employee names or contact email.
- [ ] Run the focused suites and confirm they pass.

### Task 4: Canonical employee separation, archive, and rehire

**Files:**

- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/actions/employees.ts`
- Modify: `apps/app/services/employees-service.ts`
- Modify: `apps/app/app/[organizationId]/employees/_components/employee-form-validation.ts`
- Modify: `apps/app/app/[organizationId]/employees/_components/employee-detail-modal.tsx`
- Modify: `apps/app/app/[organizationId]/employees/_components/employee-lifecycle-timeline.tsx`
- Modify: `apps/app/app/[organizationId]/employees/_components/rehire-employee-dialog.tsx`
- Modify: `apps/app/app/[organizationId]/employees/_components/employees-table.tsx`
- Modify: `apps/app/app/[organizationId]/employees/_components/employees-filters.tsx`
- Modify: `apps/app/app/[organizationId]/employees/page.tsx`
- Test: `apps/app/tests/employee-lifecycle.test.ts`
- Test: `apps/app/tests/employee-status-drawer.test.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`

**Interfaces:**

- Separation writes `{ status: "separated", separationType, separationDate, lastWorkingDay, separationReason, separationNotes }`.
- Rehire consumes `restoreAccess: boolean` and optional authorized `role`; it never restores privileged access implicitly.

- [ ] Add failing mutation and UI tests for every separation category, archive eligibility, abandonment handling, and explicit rehire access restoration.
- [ ] Run focused tests and confirm failures.
- [ ] Replace new resignation/termination writes with canonical separation writes while retaining legacy reads.
- [ ] Update archive checks to use `isEmployeeSeparated`.
- [ ] Update rehire to reuse the employee, clear separation fields, and restore access only when requested with an explicitly authorized role.
- [ ] Update employee filters, labels, forms, impacts, and timeline to show separation category rather than legacy top-level statuses.
- [ ] Run focused tests and confirm they pass.

### Task 5: Membership access actions and role safety

**Files:**

- Modify: `apps/app/utils/organization-roles.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/actions/organizations.ts`
- Modify: `apps/app/services/organizations-service.ts`
- Modify: `apps/app/components/organization-management.tsx`
- Test: `apps/app/tests/organization-roles.test.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`
- Test: `apps/app/tests/org-membership-lifecycle.test.ts`

**Interfaces:**

- Produces mutations `suspendOrganizationMember`, `restoreOrganizationMemberAccess`, and canonical `removeUserFromOrganization` behavior.
- Removing an unlinked member writes `removed`; offboarding a linked employee writes canonical separation and alumni access.

- [ ] Add failing tests for suspend-without-separation, restoration derived from employee status, retained removed memberships, fixed alumni permissions, and last-owner protection.
- [ ] Run focused tests and confirm failures.
- [ ] Implement suspend and restore mutations with role and owner safeguards.
- [ ] Change unlinked removal from hard deletion to `removed`.
- [ ] Update offboarding to accept all canonical separation categories.
- [ ] Replace the ambiguous removal modal with Manage Access choices for suspend, offboard, and remove-non-employee.
- [ ] Restrict HR role assignment to manager and employee and run role tests.
- [ ] Run focused tests and confirm they pass.

### Task 6: Compatibility consumers, inventory, and full verification

**Files:**

- Modify: `apps/app/utils/payroll-employee-filters.ts`
- Modify: `apps/app/lib/evaluations/view.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/app/[organizationId]/leave/_components/resigned-leave-conversion-tab.tsx`
- Modify: `apps/app/components/ui/employee-select.tsx`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Modify: additional typed status consumers identified by TypeScript and tests
- Test: `apps/app/tests/schema-inventory-coverage.test.ts`
- Test: relevant payroll, leave, evaluation, and access suites

**Interfaces:**

- All consumers determine active versus separated through canonical helpers or normalized projections.

- [ ] Add or update compatibility tests proving legacy documents and canonical separated documents produce identical payroll/leave eligibility where appropriate.
- [ ] Run schema inventory and targeted consumer suites and confirm expected failures.
- [ ] Update remaining status consumers and the reviewed schema inventory.
- [ ] Run `pnpm --filter app test`.
- [ ] Run `pnpm --filter app lint`.
- [ ] Run `pnpm --filter app build`.
- [ ] Review `git diff --check` and `git status --short`, ensuring unrelated payroll changes remain untouched.
