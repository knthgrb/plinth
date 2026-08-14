# Requirements and Recruitment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make employee requirements and recruitment reliable operational workflows with server-enforced state rules, actionable dashboards, and complete HR controls.

**Architecture:** Put deterministic workflow decisions in small typed domain modules that can be tested without Convex or React. Convex mutations enforce those decisions at the data boundary, while focused UI components consume the same derived states for summaries, filters, and available actions. Reuse the normalized requirement and applicant child tables already in the codebase and avoid a schema migration.

**Tech Stack:** TypeScript, React 19, Next.js 16, Convex, Vitest, Tailwind CSS, shadcn/Radix primitives.

## Global Constraints

- Preserve tenant boundaries and require HR-level access for recruitment data.
- Do not introduce `any`; remove it from every changed path.
- Do not add a new database table or dependency.
- Keep existing normalized compatibility tables as the source of workflow history.
- Do not rely on `window.location.reload()` for successful mutations.

---

### Task 1: Requirements workflow domain

**Files:**

- Create: `apps/app/lib/requirements/workflow.ts`
- Create: `apps/app/tests/requirements-workflow-domain.test.ts`

**Interfaces:**

- Produces: `isRequirementApplicable(policy, employee)`, `deriveRequirementState(requirement, now)`, `summarizeEmployeeRequirements(requirements, now)`, and `filterApplicableRequirementPolicies(policies, employee)`.
- Consumes: Plain typed policy, employee profile, and requirement values only.

- [ ] **Step 1: Write failing applicability tests**

```ts
expect(
  isRequirementApplicable(policy, {
    department: "Engineering",
    employmentType: "regular",
  }),
).toBe(true);
expect(
  isRequirementApplicable(policy, {
    department: "Finance",
    employmentType: "regular",
  }),
).toBe(false);
```

- [ ] **Step 2: Run the domain test and verify missing-module failure**

Run: `pnpm --filter app test -- tests/requirements-workflow-domain.test.ts`

- [ ] **Step 3: Implement normalized, case-insensitive applicability**

```ts
export function isRequirementApplicable(
  policy: RequirementPolicy,
  employee: EmployeeApplicability,
): boolean;
```

- [ ] **Step 4: Add failing state and summary tests**

Cover optional requirements, pending/submitted/verified states, rejected submissions, expired documents, documents within their reminder window, and empty requirement lists.

- [ ] **Step 5: Implement derived operational states and summaries**

Return one of `missing`, `awaiting_review`, `rejected`, `expiring`, `expired`, `complete`, or `optional`, plus counts for the employee summary.

- [ ] **Step 6: Run the domain tests until green**

Run: `pnpm --filter app test -- tests/requirements-workflow-domain.test.ts`

### Task 2: Requirements server enforcement and UI

**Files:**

- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Modify: `apps/app/app/[organizationId]/requirements/page.tsx`
- Modify: `apps/app/app/[organizationId]/requirements/_components/dynamic-requirements-table.tsx`
- Modify: `apps/app/app/[organizationId]/requirements/_components/employee-requirements-modal.tsx`
- Modify: `apps/app/app/[organizationId]/requirements/_components/default-requirements-dialog.tsx`
- Modify: `apps/app/tests/requirements-workflow.test.ts`

**Interfaces:**

- Consumes: Task 1 domain helpers.
- Produces: Applicable default assignment, submission-based expiry, actionable overview/filter UI, and guarded verification/rejection actions.

- [ ] **Step 1: Add failing source-contract tests**

Assert that employee creation, configuration sync, and recruitment conversion call `filterApplicableRequirementPolicies`; file submission calls `calculateSubmissionExpiry`; and the page exposes `Awaiting review`, `Expiring`, and `Expired` operations.

- [ ] **Step 2: Verify the workflow test fails for missing enforcement**

Run: `pnpm --filter app test -- tests/requirements-workflow.test.ts`

- [ ] **Step 3: Enforce policy on writes**

Filter default policies with employee department and employment type at employee creation, configuration sync, and applicant conversion. Reconcile applicable defaults when employment changes. Set expiry from the submission timestamp and policy duration during upload instead of from assignment time.

- [ ] **Step 4: Harden requirement actions**

Reject invalid indexes, duplicate custom types, verification without a file when a file is required, and rejection without a reason. Preserve audit metadata consistently.

- [ ] **Step 5: Add actionable requirements UI**

Show summary cards, state filters, due/expiry copy, rejection reasons, and clear verify/reject controls. Remove the bulk completion shortcut that bypasses evidence review.

- [ ] **Step 6: Replace changed-path `any` types with shared interfaces**

Use generated Convex return types where practical and domain interfaces at React boundaries.

- [ ] **Step 7: Run requirements tests and lint changed files**

Run: `pnpm --filter app test -- tests/requirements-workflow-domain.test.ts tests/requirements-workflow.test.ts`

### Task 3: Recruitment workflow domain and server rules

**Files:**

- Create: `apps/app/lib/recruitment/workflow.ts`
- Create: `apps/app/tests/recruitment-workflow-domain.test.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Modify: `apps/app/services/recruitment-service.ts`
- Modify: `apps/app/actions/recruitment.ts`
- Modify: `apps/app/tests/recruitment-workflow.test.ts`

**Interfaces:**

- Produces: `ApplicantStage`, `allowedApplicantTransitions`, `assertApplicantTransition`, `getApplicantStageAge`, and typed action/service methods for rejection, interviews, scorecards, offers, and conversion.
- Consumes: Existing applicant stage, offer state, scorecards, and converted employee link.

- [ ] **Step 1: Write failing stage-transition tests**

```ts
expect(allowedApplicantTransitions("screening")).toEqual([
  "interview",
  "assessment",
  "rejected",
]);
expect(() => assertApplicantTransition("new", "hired", context)).toThrow(
  "cannot move",
);
```

- [ ] **Step 2: Run the domain test and verify missing-module failure**

Run: `pnpm --filter app test -- tests/recruitment-workflow-domain.test.ts`

- [ ] **Step 3: Implement transition rules and stage aging**

Permit forward progression, explicit rejection, and controlled reopening. Require an approved offer and employee conversion for `hired`; disallow status changes after conversion.

- [ ] **Step 4: Add failing server source-contract tests**

Assert HR authorization on job queries, job ownership checks, normalized inputs, duplicate candidate protection, mandatory rejection reasons, offer approval guards, conversion idempotency, and orphan-safe job deletion.

- [ ] **Step 5: Enforce recruitment invariants in Convex**

Validate job fields, tenant linkage, transition context, interview dates/interviewers, score ranges, pending offer state, approved offer before conversion, unique employee IDs, and no duplicate conversion. Prevent deletion of jobs with applicants and archive instead.

- [ ] **Step 6: Make services and actions fully typed**

Call generated Convex references directly and expose a single typed API for every UI operation without casts to `any`.

- [ ] **Step 7: Run recruitment domain and server contract tests**

Run: `pnpm --filter app test -- tests/recruitment-workflow-domain.test.ts tests/recruitment-workflow.test.ts`

### Task 4: Recruitment operations UI

**Files:**

- Create: `apps/app/app/[organizationId]/recruitment/_components/applicant-workflow-panel.tsx`
- Create: `apps/app/app/[organizationId]/recruitment/_components/recruitment-overview.tsx`
- Modify: `apps/app/app/[organizationId]/recruitment/page.tsx`
- Modify: `apps/app/app/[organizationId]/recruitment/[jobId]/page.tsx`
- Modify: `apps/app/app/[organizationId]/recruitment/_components/dynamic-applicants-table.tsx`
- Modify: `apps/app/tests/recruitment-workflow.test.ts`

**Interfaces:**

- Consumes: Task 3 domain rules and typed actions.
- Produces: Pipeline summary/filtering and usable interview, scorecard, offer approval, rejection, and conversion flows.

- [ ] **Step 1: Add failing UI contract tests**

Assert that the recruitment overview has open-position and stage counts, the detail page filters by stage/search, and the workflow panel calls `scheduleInterview`, `addApplicantScorecard`, `requestOfferApproval`, `approveOffer`, and `convertApplicantToEmployee`.

- [ ] **Step 2: Verify UI contract failure**

Run: `pnpm --filter app test -- tests/recruitment-workflow.test.ts`

- [ ] **Step 3: Build the operational overview**

Add active/opening/applicant metrics, job search and status filters, filled-opening progress, closing-date risk, required title/department validation, and an explicit on-hold/archive lifecycle.

- [ ] **Step 4: Build the applicant workflow panel**

Use stage-specific primary actions. Add forms for rejection reason, interview scheduling, scorecard submission, offer request/decision, and employee conversion. Disable invalid actions and explain the prerequisite inline.

- [ ] **Step 5: Improve the applicant workspace**

Add pipeline summary cards, search/stage filters, stage-age signals, richer empty states, and toast-based success/error feedback. Remove successful `window.location.reload()` calls so Convex reactivity updates the view.

- [ ] **Step 6: Run recruitment tests and lint changed files**

Run: `pnpm --filter app test -- tests/recruitment-workflow-domain.test.ts tests/recruitment-workflow.test.ts`

### Task 5: Verification and integration readiness

**Files:**

- Modify only files required by verification findings.

**Interfaces:**

- Consumes: All prior tasks.
- Produces: A clean, reviewable feature branch ready to merge after concurrent main work completes.

- [ ] **Step 1: Run the complete app test suite**

Run: `pnpm --filter app test`

- [ ] **Step 2: Run lint and production build**

Run: `pnpm --filter app lint`

Run: `pnpm --filter app build`

- [ ] **Step 3: Review changed paths for `any`, reloads, alerts, and tenant leaks**

Run: `rg -n "\\bany\\b|window\\.location\\.reload|alert\\(" <changed-files>`

- [ ] **Step 4: Inspect the diff and commit intentional units**

Run: `git diff --check && git status --short && git diff --stat`

- [ ] **Step 5: Rebase or merge current main only after the other workspace has finished**

Resolve shared-file conflicts by preserving both normalized schema work and this branch's workflow invariants, rerun all verification, then fast-forward or merge into `main`.
