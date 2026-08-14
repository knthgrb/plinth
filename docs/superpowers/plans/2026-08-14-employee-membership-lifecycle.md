# Employee Membership Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make employee creation, account linking, separation, alumni access, rehiring, and employment history follow one explicit organization-scoped lifecycle.

**Architecture:** The employee remains the source of truth for employment state while `userOrganizations` remains the source of truth for application access. A new append-only `employeeLifecycleEvents` table records hires, separations, and rehires. Mutations update the employee, membership, invitation, and lifecycle event in one Convex transaction; server actions send invitation email after the transaction.

**Tech Stack:** TypeScript, Convex mutations/queries and `convex-test`, Next.js 16 server actions, React 19, react-hook-form, Zod, Vitest.

## Global Constraints

- Employee status is limited to `active`, `resigned`, and `terminated`.
- A plain accepted organization invitation never creates an employee record.
- A linked employee can only lose active access by resignation or termination, which produces alumni access.
- A standalone member is deleted when removed from organization settings.
- Rehiring an alumni employee reactivates the existing membership without another invitation.
- Existing alumni access remains limited to historical payslips and alumni-visible documents.
- Do not introduce `any`; replace encountered `any` in modified code with generated or explicit types.
- Preserve all unrelated uncommitted workspace changes and do not create commits from the dirty shared worktree.

---

### Task 1: Simplify employee lifecycle states

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/utils/employee-lifecycle.ts`
- Modify: `apps/app/utils/org-membership-lifecycle.ts`
- Modify: employee filters, forms, actions, and service type declarations
- Test: `apps/app/tests/employee-lifecycle.test.ts`
- Test: `apps/app/tests/org-membership-lifecycle.test.ts`

**Interfaces:**
- Produces: `EmployeeStatus = "active" | "resigned" | "terminated"`.
- Produces: separation maps both `resigned` and `terminated` to membership `alumni`.

- [ ] Write failing unit tests showing there is no inactive employee state and terminated employees receive alumni access.
- [ ] Run the focused lifecycle tests and confirm failures against the current four-state model.
- [ ] Remove `inactive` from employee validators, types, filters, forms, and lifecycle helpers while leaving unrelated asset statuses unchanged.
- [ ] Update terminated lifecycle copy to describe alumni access.
- [ ] Run the focused lifecycle and employee status tests.

### Task 2: Enforce member removal and alumni visibility

**Files:**
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/components/organization-management.tsx`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`

**Interfaces:**
- Consumes: employee statuses from Task 1.
- Produces: `removeUserFromOrganization({ organizationId, userId, separation? })` where `separation` contains `type`, `effectiveAt`, and optional `reason` for linked employees.
- Produces: active organization member queries exclude alumni.

- [ ] Write failing Convex integration tests: standalone removal deletes the membership; linked removal requires separation; linked separation retains the membership as alumni; alumni are excluded from active member settings.
- [ ] Run the focused security tests and confirm the current soft-removal behavior fails.
- [ ] Implement transactional standalone deletion and linked employee separation.
- [ ] Replace the settings confirmation with a separation choice for linked employees and a normal destructive confirmation for standalone members.
- [ ] Run the focused security tests.

### Task 3: Add employee creation account-link modes

**Files:**
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/actions/employees.ts`
- Modify: `apps/app/services/employees-service.ts`
- Modify: `apps/app/app/[organizationId]/employees/_components/create-employee-dialog.tsx`
- Create: `apps/app/utils/employee-account-linking.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`
- Test: `apps/app/tests/employee-account-linking.test.ts`

**Interfaces:**
- Produces: `accountAccess` union with `employee_only`, `link_member`, and `invite_member` modes.
- Produces: `employees.getAvailableOrganizationMembers({ organizationId })` returning active unlinked memberships with canonical account email.
- `link_member` accepts a membership ID and always overrides employee email from its user account.
- `invite_member` accepts one invitation email, stores it as employee email, and creates a pending employee-linked invitation.

- [ ] Write failing tests for available-member filtering, canonical email inheritance, invitation linkage, and email editability rules.
- [ ] Run them and confirm missing mode/query behavior.
- [ ] Add the account-link input contract and backend validation.
- [ ] Add the three-mode first step to the create dialog; make employee email read-only for linked/invited modes.
- [ ] Send the employee-linked invitation email after the successful server action result.
- [ ] Run the focused creation and invitation tests.

### Task 4: Add append-only lifecycle history and explicit rehire

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/employees.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`

**Interfaces:**
- Produces table `employeeLifecycleEvents` indexed by organization/employee/effective date.
- Produces query `employees.getEmployeeLifecycleTimeline({ employeeId })`.
- Produces mutation `employees.rehireEmployee({ employeeId, hireDate, position, department, employmentType })`.

- [ ] Write failing integration tests for initial hire, resignation/termination events, automatic alumni membership, rehire events, and automatic membership reactivation.
- [ ] Run the focused tests and confirm the missing table/mutation behavior.
- [ ] Insert `hired` during employee creation and separation events during offboarding.
- [ ] Reject changing a separated employee back to active through generic `updateEmployee`.
- [ ] Implement explicit rehire validation and the atomic employee/membership/event update.
- [ ] Return synthetic legacy history when an existing employee has no stored events, and persist baseline history before its first lifecycle mutation.
- [ ] Run the focused lifecycle tests.

### Task 5: Add rehire and timeline UI

**Files:**
- Modify: `apps/app/app/[organizationId]/employees/_components/employee-detail-modal.tsx`
- Create: `apps/app/app/[organizationId]/employees/_components/employee-lifecycle-timeline.tsx`
- Create: `apps/app/app/[organizationId]/employees/_components/rehire-employee-dialog.tsx`
- Modify: `apps/app/actions/employees.ts`
- Modify: `apps/app/services/employees-service.ts`
- Test: `apps/app/tests/employee-lifecycle.test.ts`
- Test: `apps/app/tests/employee-status-drawer.test.ts`

**Interfaces:**
- Consumes: timeline query and rehire mutation from Task 4.
- Produces: separated employees display `Rehire Employee`; generic editing cannot choose active for a separated employee.
- Produces: chronological timeline with actor, effective date, role/department snapshot, and separation reason.

- [ ] Write failing tests for the rehire eligibility state and timeline presentation model.
- [ ] Run the focused tests and confirm failures.
- [ ] Add typed rehire action/service methods and focused UI components.
- [ ] Wire them into the employee detail modal and refresh the displayed employee after success.
- [ ] Run the focused UI/lifecycle tests.

### Task 6: Migration compatibility and verification

**Files:**
- Modify: `apps/app/convex/identityMigrationPlanner.ts`
- Modify: affected schema inventory tests if the new table requires registration
- Test: full `apps/app/tests` suite

**Interfaces:**
- Legacy inactive employees are treated as separated migration input but cannot be created or edited into that state.
- Legacy terminated employees map to alumni rather than disabled.

- [ ] Add or update migration tests for the simplified target lifecycle.
- [ ] Run focused migration and schema-inventory tests.
- [ ] Run focused ESLint on every modified file.
- [ ] Run `pnpm --filter app exec tsc --noEmit`.
- [ ] Run `pnpm --filter app test`.
- [ ] Run `pnpm --filter app build`.
- [ ] Run `git diff --check` and review the final diff for unrelated changes.
