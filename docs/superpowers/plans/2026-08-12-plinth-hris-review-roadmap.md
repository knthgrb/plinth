# Plinth HRIS Hardening and Product Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plinth a secure, production-safe, configurable Philippine HRIS with correct organization-scoped access, reliable payroll compliance, safe data migrations, and role-appropriate experiences.

**Architecture:** Treat the Convex backend as the authorization boundary and move all tenant, lifecycle, role, resource, and field-scope decisions into one shared policy module. Separate global identity from organization membership and employment, snapshot effective-dated statutory rules into immutable payroll results, and evolve the production database through expand-backfill-verify-contract migrations. Product expansion follows only after the security and payroll correctness gates pass.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Convex, Better Auth, Vitest, ESLint, pnpm workspace.

## Global Constraints

- Preserve all existing production data until a read-only audit and post-backfill verification prove a field or row is removable.
- Use additive schema changes before reads or writes switch; remove deprecated fields only in a later deployment.
- Convex authorization is authoritative. Proxy, route, sidebar, and component checks are user-experience layers only.
- Never infer tenant access from `users.organizationId`, `users.role`, or `users.employeeId` after membership backfill is complete.
- A resigned employee receives organization-scoped `alumni` access: finalized or paid self payslips plus explicitly `alumni_visible` documents only.
- An inactive employee receives `suspended` access; a terminated employee receives `disabled` access.
- An organization owner who is also an employee cannot be separated until ownership is transferred or employment and ownership are explicitly decoupled.
- Payroll rules must be effective-dated, source-attributed, testable at boundary values, and snapshotted into finalized payroll data.
- Money uses integer centavos or a decimal type at calculation/storage boundaries; floating-point values must not be the long-term accounting representation.
- Every security or payroll correction starts with a failing regression test and ends with full test, lint, and production-build verification.
- Do not log secrets, reset tokens, PINs, compensation, bank details, or raw employee documents.
- This plan is an engineering roadmap, not legal advice; Philippine payroll and retention policies require review by qualified payroll/legal specialists before production rollout.

---

## Review Baseline

### Current modules

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Identity and organizations | Better Auth, multi-organization membership, owner/admin/HR/manager/accounting/employee roles | Good foundation; authorization is duplicated and legacy fallbacks bypass lifecycle state. |
| Employee records | Personal/employment/compensation, schedules, requirements, deductions, incentives, bulk import | Broad feature set; excessive record projection exposes confidential fields. |
| Employee lifecycle | Active/inactive/resigned/terminated, alumni access, final settlement workspace | Intended model is sound; legacy/missing membership links make enforcement incomplete. |
| Attendance | Manual/bulk entry, employee punch, shifts, overrides, holidays, payroll integration | Useful core; needs approval workflow, device/import reconciliation, immutable corrections, and stronger indexes. |
| Payroll | Regular, 13th-month, leave conversion, final pay, payslips, corrections, accounting sync | Ambitious implementation; withholding brackets are outdated and rules are hard-coded rather than effective-dated. |
| Leave | Types, policies, balances, approvals, tracker, cash conversion, PDF templates | Strong start; duplicate sources of truth and embedded balances need normalization. |
| Recruitment | Jobs, applicants, interviews, scorecards, offer approval, employee conversion | Solid ATS baseline; public upload/token abuse controls and onboarding handoff are missing. |
| Documents and requirements | Rich text, attachments, visibility, versions, employee requirements | Valuable; storage access control and rich-text rendering require urgent hardening. |
| Communication | Announcements, comments, reactions, chat, notifications, memos | Rich feature set; alumni access remains possible in several backend modules. |
| Assets | Custody and maintenance history | Useful offboarding input; needs formal clearance/return workflow and audit events. |
| Evaluations | Templates, reviewers, locking, history | Basic performance cycle; current accounting-role backend access conflicts with UI policy. |
| Accounting | Payroll-generated and manual cost items, reconciliation/repair | Useful but not a general ledger; access lifecycle and immutable financial audit controls need work. |

### Confirmed high-risk findings

1. `convex/demoRequests.ts:setSuperAdmin` is a public mutation with no authentication or authorization.
2. `convex/employees.ts:getEmployees` permits the employee role and returns full decrypted employee records, including compensation and bank details.
3. `convex/files.ts` generates upload URLs and storage download URLs without authentication, tenant ownership, or resource authorization.
4. The password-reset email route accepts an arbitrary recipient and arbitrary URL, allowing email relay/phishing abuse.
5. `organizations.getUserById`, invitation-by-ID, and `invitations.checkUserExists` expose user data or account existence without an adequate authorization boundary.
6. Invitation tokens use `Date.now()` plus `Math.random()` and are stored in plaintext.
7. Announcement and document previews interpolate unescaped text and link URLs into `dangerouslySetInnerHTML`, creating stored-XSS risk.
8. Payslip PINs use fast SHA-256 with a static prefix; the public query returns the hash to authorized clients, enabling cheap offline brute force for low-entropy PINs.
9. Custom payslip PDF passwords and `payrollTabPassword` are stored as plaintext; general encryption silently disables itself when `ENCRYPTION_KEY` is missing.
10. Role and membership logic is copied across at least 18 Convex modules. Most copies ignore `accessStatus`; client redirects do not prevent direct backend use by alumni, suspended, disabled, or removed memberships.
11. The proxy treats every `/api` path as public and its signed role cookie contains role and organization only, not lifecycle status. It must never be treated as an authorization decision.
12. `pnpm audit --prod` reports 85 vulnerable dependency paths: 3 critical, 39 high, 34 moderate, and 9 low. Directly relevant items include `jspdf@4.2.0`, `better-auth@1.4.19`, `next@16.1.6`, and transitive `kysely`, `dompurify`, `lodash`, and `picomatch` advisories.
13. The code claims 2025 TRAIN compliance but `lib/ph-withholding-tax.ts` implements the superseded annual rates. The BIR table effective January 1, 2023 onward uses 15%, 20%, 25%, 30%, and 35% marginal brackets.
14. The README is materially stale: it claims 2024 SSS, 3% PhilHealth, and Pag-IBIG capped at PHP 100, while the implementation uses newer values.
15. The app linter currently reports 2,634 errors and 231 warnings; marketing has no ESLint configuration. About 2,590 explicit `any` usages reduce the value of TypeScript at security and payroll boundaries.
16. The root pnpm lockfile and `apps/marketing/package-lock.json` create package-manager and workspace-root ambiguity.

### Current verification

- `pnpm --filter app test`: 43 files and 179 tests passed.
- `pnpm --filter app build`: passed.
- `pnpm --filter marketing build`: passed with network access; warns about multiple lockfiles/workspace-root inference.
- `pnpm --filter app lint`: failed with 2,865 findings.
- `pnpm --filter marketing lint`: failed because no ESLint 9 configuration exists.

### Regulatory verification sources

- BIR revised withholding table effective January 1, 2023 onward: https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf
- BIR Form 1601-C filing guidance: https://efps.bir.gov.ph/efps-war/EFPSWeb_war/help/help1601c_v2.html
- BIR 1604-C alphalist format: https://bir-cdn.bir.gov.ph/local/pdf/1604C%20Alphalist%20Format%20-%20final.pdf
- SSS contribution schedule and January 2025 changes: https://www.sss.gov.ph/pay-contribution/
- PhilHealth 2025 premium advisory: https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf
- DOLE/NWPC Workers' Statutory Monetary Benefits Handbook, 2024 edition: https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf
- DOLE final-pay and certificate-of-employment timing reminder: https://dole.gov.ph/news/final-pay-coe-must-be-released-on-time-dole/
- National Privacy Commission Data Privacy Act, implementing rules, retention guidance, and breach procedures: https://privacy.gov.ph/data-privacy-act/, https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/, https://privacy.gov.ph/day-to-day/, and https://privacy.gov.ph/exercising-breach-reporting-procedures/

Regulatory values must be revalidated against current issuances before each rule version becomes effective. The implementation plan treats these sources as engineering inputs, not a substitute for payroll or legal review.

## Target File Structure

- Create `apps/app/convex/access.ts`: authenticated identity, membership resolution, lifecycle gates, capabilities, resource-scope assertions, and public-safe projections.
- Create `apps/app/utils/capabilities.ts`: shared capability names, role defaults, and route navigation mapping without database access.
- Create `apps/app/convex/auditEvents.ts`: append-only audit-event writer and authorized queries.
- Create `apps/app/convex/dataMigrations.ts`: internal, cursor-based expand/backfill/verify operations.
- Create `apps/app/convex/storageObjects.ts`: tenant-owned file metadata and authorized upload/download operations.
- Create `apps/app/lib/rich-text.ts`: safe Tiptap rendering helpers and URL-protocol validation.
- Create `apps/app/lib/security-headers.ts`: CSP and common response-header policy.
- Create `apps/app/lib/statutory-rules/`: effective-dated BIR, SSS, PhilHealth, Pag-IBIG, holiday, and special-benefit rule sets.
- Create `apps/app/tests/security/`: backend authorization, public-endpoint, token, XSS, and storage regression tests.
- Create `apps/app/tests/payroll/statutory-rules.test.ts`: official boundary-value fixtures and effective-date tests.
- Modify all public Convex modules to consume `convex/access.ts` and delete local `checkAuth` copies.
- Modify `apps/app/convex/schema.ts` additively first; contract deprecated fields only after verified migrations.

---

### Task 1: Establish security regression tests and an endpoint inventory

**Files:**
- Create: `apps/app/tests/security/public-functions.test.ts`
- Create: `apps/app/tests/security/tenant-isolation.test.ts`
- Create: `apps/app/tests/security/employee-field-projection.test.ts`
- Create: `apps/app/tests/security/lifecycle-access.test.ts`
- Modify: `apps/app/package.json`

**Interfaces:**
- Consumes: public Convex function exports and fixture builders.
- Produces: executable tests proving tenant, role, lifecycle, resource, and field-level denial behavior.

- [ ] **Step 1: Add a Convex test harness dependency and fixture factory**

Add a test-only fixture builder that creates two organizations, one user per role, active/alumni/suspended/disabled memberships, linked employees, payslips in every run status, and storage metadata belonging to both tenants.

- [ ] **Step 2: Write failing tenant and lifecycle tests**

Assert that an employee cannot list another employee's compensation, an alumni member cannot call chat/notifications/announcements/attendance/leave, a removed member cannot resolve the organization, and no role in organization A can read organization B resources.

- [ ] **Step 3: Write failing public-function tests**

Assert unauthenticated calls cannot elevate a super admin, enumerate accounts, retrieve a user by ID, mint upload URLs, or retrieve storage URLs.

- [ ] **Step 4: Run the focused suite and preserve the failure output**

Run: `pnpm --filter app test -- tests/security`

Expected: failures matching the confirmed findings, with no unrelated runtime failure.

- [ ] **Step 5: Commit the red tests**

```bash
git add apps/app/tests/security apps/app/package.json pnpm-lock.yaml
git commit -m "test: cover tenant and lifecycle authorization boundaries"
```

### Task 2: Introduce a single backend authorization kernel

**Files:**
- Create: `apps/app/convex/access.ts`
- Create: `apps/app/utils/capabilities.ts`
- Modify: `apps/app/utils/role-access.ts`
- Modify: `apps/app/proxy.ts`
- Test: `apps/app/tests/security/tenant-isolation.test.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`
- Test: `apps/app/tests/role-access.test.ts`

**Interfaces:**
- Produces: `requireIdentity(ctx)`, `requireMembership(ctx, organizationId, options)`, `requireCapability(ctx, organizationId, capability)`, `requireSelfOrCapability(ctx, organizationId, employeeId, capability)`, and `assertResourceOrganization(resource, organizationId)`.
- Produces: `Capability` string union and `ROLE_CAPABILITIES: Record<OrganizationRole, ReadonlySet<Capability>>`.

- [ ] **Step 1: Define capabilities instead of page-level role checks**

Use explicit names including `employee.list.basic`, `employee.read.private`, `employee.read.compensation`, `attendance.read.self`, `attendance.manage`, `leave.request.self`, `leave.approve.team`, `payroll.manage`, `payslip.read.self`, `document.read.alumni`, `member.manage`, `settings.manage`, and `audit.read`.

- [ ] **Step 2: Implement membership resolution with fail-closed lifecycle semantics**

`requireMembership` must require a `userOrganizations` row, reject archived organizations, treat a missing `accessStatus` as active only during the migration window, and return `{ user, membership, role, employeeId, accessStatus }`.

- [ ] **Step 3: Express alumni access as a narrow allow-list**

Only `payslip.read.self` for finalized/paid runs and `document.read.alumni` for explicitly alumni-visible documents may accept `accessStatus: "alumni"`. All other capabilities require `active`.

- [ ] **Step 4: Make route/navigation policy derive from the same capability definitions**

Remove duplicated route-role arrays from `proxy.ts` and `role-access.ts`. Keep proxy behavior advisory and ensure an absent or stale cookie never grants backend access.

- [ ] **Step 5: Run policy tests**

Run: `pnpm --filter app test -- tests/security/tenant-isolation.test.ts tests/security/lifecycle-access.test.ts tests/role-access.test.ts`

Expected: policy-unit tests pass; backend tests remain red until module migration.

- [ ] **Step 6: Commit the authorization kernel**

```bash
git add apps/app/convex/access.ts apps/app/utils/capabilities.ts apps/app/utils/role-access.ts apps/app/proxy.ts apps/app/tests
git commit -m "feat: centralize organization capability policy"
```

### Task 3: Close critical privilege, data-exposure, and endpoint defects

**Files:**
- Modify: `apps/app/convex/demoRequests.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/app/api/auth/send-password-reset/route.ts`
- Modify: `apps/app/convex/auth.ts`
- Test: `apps/app/tests/security/public-functions.test.ts`
- Test: `apps/app/tests/security/employee-field-projection.test.ts`

**Interfaces:**
- Produces: `listEmployeeDirectory`, `listEmployeesPrivate`, and `getEmployeeCompensation` with distinct result projections.
- Produces: internal-only super-admin bootstrap and password-reset email requests authenticated by a shared webhook secret and validated app-origin URL.

- [ ] **Step 1: Make super-admin assignment internal-only**

Change `setSuperAdmin` to `internalMutation`; require invocation from the Convex dashboard/CLI and record an append-only audit event with actor, target email, timestamp, and source.

- [ ] **Step 2: Split employee list projections**

`listEmployeeDirectory` returns only ID, display name, work email when policy permits, position, department, and employment status. `listEmployeesPrivate` requires people-admin capability. `getEmployeeCompensation` requires payroll compensation capability. Never include bank details in list results.

- [ ] **Step 3: Protect user lookup and account-existence checks**

Make raw user-by-ID internal or require same-organization capability and return a public projection. Remove public account enumeration; the invitation flow should return one generic response for existing and non-existing email addresses.

- [ ] **Step 4: Authenticate password-reset email dispatch**

Require `AUTH_EMAIL_WEBHOOK_SECRET`, compare it in constant time, validate the reset URL origin against `SITE_URL`, validate body size/schema, and return a generic response. Configure Better Auth to send the secret header.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter app test -- tests/security/public-functions.test.ts tests/security/employee-field-projection.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit the critical endpoint fixes**

```bash
git add apps/app/convex/demoRequests.ts apps/app/convex/employees.ts apps/app/convex/organizations.ts apps/app/convex/invitations.ts apps/app/app/api/auth/send-password-reset/route.ts apps/app/convex/auth.ts apps/app/tests/security
git commit -m "fix: close critical privilege and employee data exposure"
```

### Task 4: Enforce lifecycle and capability checks in every backend module

**Files:**
- Modify: `apps/app/convex/accounting.ts`
- Modify: `apps/app/convex/announcements.ts`
- Modify: `apps/app/convex/assets.ts`
- Modify: `apps/app/convex/attendance.ts`
- Modify: `apps/app/convex/chat.ts`
- Modify: `apps/app/convex/documents.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/evaluations.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Modify: `apps/app/convex/holidays.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/leave.ts`
- Modify: `apps/app/convex/memos.ts`
- Modify: `apps/app/convex/notifications.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/shifts.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`
- Test: `apps/app/tests/security/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: Task 2 authorization functions.
- Produces: no module-local `checkAuth` implementations and no legacy identity fallback.

- [ ] **Step 1: Replace read-path guards module by module**

For every query, resolve membership first, assert capability second, constrain the database query by organization/resource third, and project only authorized fields last.

- [ ] **Step 2: Replace mutation guards module by module**

Load the target resource, assert its organization matches the requested organization, require capability, validate state transition, then mutate and append an audit event.

- [ ] **Step 3: Add manager team scope**

Use department head/reporting-line data to limit managers to assigned departments or direct reports. Managers must not receive organization-wide compensation, bank, tax, payroll, or medical data.

- [ ] **Step 4: Resolve the evaluations/accounting mismatch**

Remove accounting from evaluation access unless the organization grants a custom capability. Keep UI routes and backend policy consistent.

- [ ] **Step 5: Prove all disabled lifecycle states fail at the backend**

Run: `pnpm --filter app test -- tests/security tests/role-access.test.ts tests/org-membership-lifecycle.test.ts tests/alumni-access-workflow.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Scan for duplicated legacy checks**

Run: `rg "async function checkAuth|Fallback to legacy organizationId|userRecord\.organizationId === organizationId" apps/app/convex`

Expected: no authorization fallback matches outside the temporary migration compatibility module.

- [ ] **Step 7: Commit backend enforcement**

```bash
git add apps/app/convex apps/app/tests/security
git commit -m "fix: enforce organization lifecycle across backend modules"
```

### Task 5: Fix resigned-employee access and backfill membership linkage safely

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/dataMigrations.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/invitations.ts`
- Test: `apps/app/tests/security/lifecycle-access.test.ts`
- Test: `apps/app/tests/org-membership-lifecycle.test.ts`

**Interfaces:**
- Produces: `userOrganizations.by_organization_employee` index.
- Produces: internal `auditMembershipLinks`, `backfillMembershipLinksBatch`, `backfillMembershipStatusBatch`, and `verifyMembershipMigration` operations with cursor, processed count, updated count, ambiguous count, and next cursor.

- [ ] **Step 1: Add migration state and membership indexes**

Add indexes without removing any field. Deploy and wait for Convex index completion before running a backfill.

- [ ] **Step 2: Implement a read-only preflight audit**

Classify every membership as linked, linkable from `users.employeeId`, linkable from a unique normalized employee email within the same organization, ambiguous, orphaned, duplicate, or owner-with-employment.

- [ ] **Step 3: Review the preflight counts before mutation**

Run the audit in production, export aggregate counts, and manually resolve ambiguous/duplicate rows. The migration must refuse to guess when multiple employees share an email.

- [ ] **Step 4: Backfill in cursor-sized batches**

Populate `userOrganizations.employeeId`, then derive `accessStatus` from the linked employee status. Never globally set `users.isActive` because a person may belong to multiple organizations.

- [ ] **Step 5: Make separation update exactly one canonical membership**

On employee status transition, look up `by_organization_employee`; fail the transaction if a non-owner employee account has zero or multiple linked memberships. For owners, require transfer/decoupling confirmation before separation.

- [ ] **Step 6: Verify the reported workflow**

Test active employee login, resign, immediate chat/leave/attendance denial, alumni payslip access for finalized/paid only, alumni-visible document access only, rehire/reactivation, and membership in a second active organization.

- [ ] **Step 7: Stop legacy writes and fallbacks after verification reaches zero unresolved rows**

Remove writes to `users.organizationId`, `users.role`, and `users.employeeId`; retain the columns for one release while metrics confirm no reads.

- [ ] **Step 8: Commit the lifecycle migration**

```bash
git add apps/app/convex/schema.ts apps/app/convex/dataMigrations.ts apps/app/convex/employees.ts apps/app/convex/organizations.ts apps/app/convex/invitations.ts apps/app/tests
git commit -m "fix: make employee separation organization scoped and reliable"
```

### Task 6: Secure storage, rich text, invitations, PINs, and sensitive fields

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/storageObjects.ts`
- Modify: `apps/app/convex/files.ts`
- Modify: `apps/app/actions/files.ts`
- Modify: `apps/app/services/files-service.ts`
- Create: `apps/app/lib/rich-text.ts`
- Modify: `apps/app/components/tiptap-viewer.tsx`
- Modify: `apps/app/app/[organizationId]/announcements/_components/announcement-card.tsx`
- Modify: `apps/app/app/[organizationId]/documents/page.tsx`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/payslipPin.ts`
- Modify: `apps/app/convex/payslipPinReset.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/appEncryption.ts`
- Test: `apps/app/tests/security/storage-access.test.ts`
- Test: `apps/app/tests/security/rich-text.test.ts`
- Test: `apps/app/tests/security/token-and-pin.test.ts`

**Interfaces:**
- Produces: `storageObjects` rows containing `storageId`, `organizationId`, `ownerUserId`, `purpose`, `resourceType`, `resourceId`, `createdAt`, and lifecycle state.
- Produces: cryptographically random invitation tokens whose hashes alone are stored.
- Produces: internal PIN hash access and a slow password hash with attempt throttling.

- [ ] **Step 1: Introduce tenant-owned file metadata**

Upload intent requires organization plus purpose; download requires membership, lifecycle-compatible capability, and resource visibility. Reject unknown storage IDs even when Convex can generate a URL.

- [ ] **Step 2: Cover recruitment public uploads separately**

Issue a short-lived, single-purpose applicant upload intent with MIME allow-list, byte limit, rate limit, and automatic orphan cleanup. Never reuse authenticated employee upload functions for public applicants.

- [ ] **Step 3: Replace hand-built HTML rendering**

Use `TiptapViewer` or a renderer that escapes all text, restricts link protocols to `https`, `http`, and `mailto`, and adds `rel="noopener noreferrer"`. Add payloads containing `<img onerror>`, `<script>`, quote-breaking URLs, and `javascript:` links to the tests.

- [ ] **Step 4: Replace invitation token generation and storage**

Generate 32 random bytes, email the raw base64url token once, store SHA-256/HMAC hash only, and consume it atomically. Return a redacted public preview without raw token, inviter email, internal IDs, or account existence.

- [ ] **Step 5: Harden payslip PINs**

Move hash queries/mutations to internal functions, use scrypt/Argon2id with per-record random salt, compare in constant time, require at least six digits or an equivalent passphrase policy, throttle failures by user and employee, and invalidate reset tokens atomically.

- [ ] **Step 6: Make encryption fail closed in production**

Require a versioned 32-byte production key; encrypt bank details, custom PDF passwords, compensation, and other sensitive payroll fields. Implement key-version metadata and a rotation migration. Do not encrypt fields needed for indexed lookup; normalize and hash those separately when appropriate.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter app test -- tests/security/storage-access.test.ts tests/security/rich-text.test.ts tests/security/token-and-pin.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit storage and content hardening**

```bash
git add apps/app/convex apps/app/actions/files.ts apps/app/services/files-service.ts apps/app/lib/rich-text.ts apps/app/components/tiptap-viewer.tsx apps/app/app/[organizationId] apps/app/tests/security
git commit -m "fix: secure files tokens rich text and payslip credentials"
```

### Task 7: Patch dependencies and add platform security controls

**Files:**
- Modify: `package.json`
- Modify: `apps/app/package.json`
- Modify: `apps/marketing/package.json`
- Modify: `pnpm-lock.yaml`
- Remove after migration: `apps/marketing/package-lock.json`
- Modify: `apps/app/next.config.ts`
- Modify: `apps/marketing/next.config.ts`
- Create: `apps/app/lib/security-headers.ts`
- Modify: `.github/workflows/ci.yml` if present; otherwise create it.

**Interfaces:**
- Produces: one pnpm lockfile, supported dependency versions, CSP/security headers, and CI audit gates.

- [ ] **Step 1: Upgrade direct vulnerable packages in isolated groups**

Upgrade jsPDF to at least 4.2.1, Better Auth to at least 1.6.11 with its compatible Convex adapter, Next.js to at least 16.2.11, Vitest to at least 4.1.0, and resolve patched transitive versions for Kysely, DOMPurify, Lodash, Picomatch, Defu, and PostCSS.

- [ ] **Step 2: Run auth and PDF regression tests after each dependency group**

Run: `pnpm --filter app test -- tests/account-settings-password.test.ts tests/alumni-access-workflow.test.ts tests/payroll-finalize-dialog.test.ts`

Expected: all tests pass after each group.

- [ ] **Step 3: Standardize package management**

Delete the marketing npm lockfile only after `pnpm install --frozen-lockfile` succeeds and configure the Turbopack workspace root explicitly.

- [ ] **Step 4: Add response security headers**

Set CSP, HSTS in production, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame restrictions, and a minimal `Permissions-Policy`. Start CSP in report-only mode, collect violations, then enforce.

- [ ] **Step 5: Add CI dependency policy**

Run production audit on pull requests and fail on critical/high vulnerabilities, with a time-bounded documented exception file for non-exploitable transitive development paths.

- [ ] **Step 6: Verify**

Run: `pnpm audit --prod --audit-level high`

Expected: no critical or high advisory remains without a reviewed exception.

- [ ] **Step 7: Commit dependency and header hardening**

```bash
git add package.json apps/app/package.json apps/marketing/package.json pnpm-lock.yaml apps/app/next.config.ts apps/marketing/next.config.ts apps/app/lib/security-headers.ts .github/workflows/ci.yml
git add -u apps/marketing/package-lock.json
git commit -m "chore: patch dependencies and enforce platform security headers"
```

### Task 8: Correct Philippine withholding and version statutory rules

**Files:**
- Create: `apps/app/lib/statutory-rules/types.ts`
- Create: `apps/app/lib/statutory-rules/bir.ts`
- Create: `apps/app/lib/statutory-rules/sss.ts`
- Create: `apps/app/lib/statutory-rules/philhealth.ts`
- Create: `apps/app/lib/statutory-rules/pagibig.ts`
- Create: `apps/app/lib/statutory-rules/index.ts`
- Modify: `apps/app/lib/ph-withholding-tax.ts`
- Modify: `apps/app/utils/sss.ts`
- Modify: `apps/app/utils/ph-statutory-contributions.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `README.md`
- Modify: `apps/app/docs/PAYROLL_CALCULATION.md`
- Create: `apps/app/tests/payroll/statutory-rules.test.ts`

**Interfaces:**
- Produces: `resolveStatutoryRules(asOf: number): StatutoryRuleSet`.
- Produces: `StatutoryRuleSnapshot` stored on every payroll run and payslip calculation snapshot.

- [ ] **Step 1: Add failing official boundary fixtures**

Cover BIR annual and semi-monthly thresholds effective January 1, 2023, SSS January 2025 brackets, PhilHealth 2025 5% with PHP 10,000 floor/PHP 100,000 ceiling and equal sharing, and the effective Pag-IBIG salary ceiling/rates confirmed by the current HDMF circular.

- [ ] **Step 2: Replace the incorrect annual tax brackets**

For 2023 onward use 15% above PHP 250,000 through PHP 400,000; PHP 22,500 plus 20% above PHP 400,000 through PHP 800,000; PHP 102,500 plus 25% above PHP 800,000 through PHP 2,000,000; PHP 402,500 plus 30% above PHP 2,000,000 through PHP 8,000,000; and PHP 2,202,500 plus 35% above PHP 8,000,000.

- [ ] **Step 3: Make rules effective-dated and source-attributed**

Each rule version includes `effectiveFrom`, optional `effectiveTo`, issuing agency, issuance identifier, source URL, and a stable version string. A payroll period resolves by the period end date.

- [ ] **Step 4: Snapshot rules into payroll data**

Finalized and paid payroll must never change when a later statutory version is deployed. Corrections preserve the original snapshot unless a privileged recalculation explicitly selects a new version and records the reason.

- [ ] **Step 5: Recalculate production impact without mutating payroll**

Add an internal report comparing stored tax deductions with corrected values for draft, finalized, and paid runs. Do not rewrite finalized/paid payroll automatically; export affected employees and periods for payroll/legal review.

- [ ] **Step 6: Update product documentation**

Remove stale claims and list exact effective dates and sources. Show a visible statutory rule version in payroll preview/finalization.

- [ ] **Step 7: Run payroll verification**

Run: `pnpm --filter app test -- tests/payroll tests/ph-withholding-tax.test.ts tests/sss.test.ts tests/ph-statutory-contributions.test.ts tests/payroll-calculations.test.ts`

Expected: boundary fixtures and the existing payroll suite pass.

- [ ] **Step 8: Commit statutory corrections**

```bash
git add apps/app/lib/statutory-rules apps/app/lib/ph-withholding-tax.ts apps/app/utils/sss.ts apps/app/utils/ph-statutory-contributions.ts apps/app/convex/payroll.ts apps/app/convex/schema.ts apps/app/tests README.md apps/app/docs/PAYROLL_CALCULATION.md
git commit -m "fix: version Philippine statutory payroll rules"
```

### Task 9: Add append-only audit, approvals, and financial immutability

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/auditEvents.ts`
- Modify: employee, membership, attendance, leave, payroll, settings, documents, assets, recruitment, and evaluations mutations.
- Create: `apps/app/app/[organizationId]/audit/page.tsx`
- Test: `apps/app/tests/security/audit-events.test.ts`

**Interfaces:**
- Produces: `writeAuditEvent(ctx, { organizationId, actorUserId, action, resourceType, resourceId, before, after, reason, correlationId })`.
- Produces: capability-controlled audit search/export with sensitive-field redaction.

- [ ] **Step 1: Add an append-only audit table**

Index by organization/time, actor/time, and resource. Store redacted before/after diffs and never permit client-side update or delete.

- [ ] **Step 2: Audit security and payroll-sensitive events first**

Cover membership/role/lifecycle changes, compensation changes, payroll preview/finalize/reopen/correct/pay, attendance overrides, leave adjustments/approvals, file visibility, settings, PIN resets, and admin bootstrap.

- [ ] **Step 3: Require reason and elevated approval for irreversible transitions**

Finalized/paid payroll changes, attendance changes after payroll lock, owner transfer, and offboarding completion require a reason and appropriate capability. Use reversal/correction records rather than destructive edits.

- [ ] **Step 4: Add an authorized audit viewer and CSV export**

Default to recent events, filter by actor/action/resource/date, and redact secrets and encrypted payloads.

- [ ] **Step 5: Verify audit coverage**

Run: `pnpm --filter app test -- tests/security/audit-events.test.ts tests/payroll-finalize-dialog.test.ts tests/accounting-repair-workflow.test.ts`

Expected: all tested sensitive mutations produce one immutable audit event.

- [ ] **Step 6: Commit audit support**

```bash
git add apps/app/convex/schema.ts apps/app/convex/auditEvents.ts apps/app/convex apps/app/app/[organizationId]/audit apps/app/tests/security/audit-events.test.ts
git commit -m "feat: add immutable HR and payroll audit trail"
```

### Task 10: Audit and contract the production schema

**Files:**
- Modify: `apps/app/convex/dataMigrations.ts`
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/payroll.ts`
- Test: `apps/app/tests/data-migrations.test.ts`

**Interfaces:**
- Consumes: verified production migration reports from Task 5.
- Produces: normalized canonical schema without live legacy reads.

- [ ] **Step 1: Inventory field reads and non-empty production counts**

Measure deprecated `users.organizationId`, `users.role`, `users.employeeId`, `users.isActive`, `employees.compensation.paymentFrequency`, `settings.payrollTabPassword`, `settings.taxTable`, `settings.payrollFrequency`, legacy `settings.leaveTrackerRows`, string-format departments, legacy attendance `leave`, string payroll snapshots, and missing payslip period ranges.

- [ ] **Step 2: Categorize instead of deleting blindly**

Mark each field as canonical, compatibility-read, migration-only, historical snapshot, or removable. Preserve historical payroll representations required to reproduce old payslips.

- [ ] **Step 3: Run expand-backfill-verify-contract per field family**

Use cursor batches and idempotency keys. Record scanned/changed/skipped/ambiguous/error counts. Verify row counts and business totals before and after each phase.

- [ ] **Step 4: Remove only confirmed dead fields**

Initial candidates are `employees.compensation.paymentFrequency`, `settings.payrollTabPassword`, `settings.taxTable`, and `settings.payrollFrequency`; each still requires a zero-use and production-data report. Do not remove `employees.leaveCredits` or `settings.leaveTrackerRows` yet because live payroll/leave code still reads them.

- [ ] **Step 5: Remove global organization/role/employee fallbacks in a later release**

After at least one monitored release with zero compatibility reads, remove the fields from validators and schema. Preserve global identity and master-admin state only on `users`.

- [ ] **Step 6: Verify data invariants**

Assert one membership per user/organization, at most one membership per organization/employee, all resources point to the same tenant as their parent, payslip totals are unchanged, finalized payroll snapshots remain readable, and every active employee login is linked.

- [ ] **Step 7: Commit each contract migration separately**

```bash
git add apps/app/convex apps/app/tests/data-migrations.test.ts
git commit -m "refactor: contract verified legacy organization fields"
```

### Task 11: Improve roles and role-specific experiences

**Files:**
- Modify: `apps/app/utils/capabilities.ts`
- Modify: `apps/app/components/layout/sidebar.tsx`
- Modify: `apps/app/components/layout/employee-sidebar.tsx`
- Modify: `apps/app/hooks/employee-view-context.tsx`
- Modify: organization settings/member management components.
- Create: `apps/app/app/[organizationId]/settings/access/page.tsx` or integrate the same controls into the existing settings modal.
- Test: `apps/app/tests/capability-matrix.test.ts`

**Interfaces:**
- Produces: role templates plus optional organization-defined capability overrides and scopes.

- [ ] **Step 1: Keep safe default role templates**

Owner controls ownership and billing-level settings; admin manages the organization; HR manages people/private HR data; manager manages assigned teams; accounting handles payroll/accounting without unrelated HR case data; employee uses self-service; alumni has the fixed narrow archive policy.

- [ ] **Step 2: Add data scopes**

Support `self`, `direct_reports`, `departments`, and `organization` scopes. A role name alone must not imply organization-wide record access.

- [ ] **Step 3: Add field-level privacy groups**

Separate directory, personal contact, government identifiers, compensation, bank details, health/leave evidence, performance notes, and disciplinary data.

- [ ] **Step 4: Generate navigation from capabilities**

Sidebar items, default landing page, quick actions, and settings sections use the same capability registry. Switching to employee experience can reduce visible capability but never increase backend access.

- [ ] **Step 5: Add an access-preview tool**

Owners/admins can select a member and see effective capabilities and scope, including why a feature is unavailable. Changes show before/after diff and require confirmation.

- [ ] **Step 6: Verify the complete matrix**

Run: `pnpm --filter app test -- tests/capability-matrix.test.ts tests/role-access.test.ts tests/organization-roles.test.ts`

Expected: every role/capability/scope combination has an explicit allow or deny expectation.

- [ ] **Step 7: Commit role experience improvements**

```bash
git add apps/app/utils/capabilities.ts apps/app/components/layout apps/app/hooks/employee-view-context.tsx apps/app/app/[organizationId] apps/app/tests
git commit -m "feat: add scoped capabilities and role-aware navigation"
```

### Task 12: Raise module value after correctness and security gates

**Files:**
- Create separate implementation plans under `docs/superpowers/plans/` for each approved workstream before code changes.

**Interfaces:**
- Consumes: secure capability kernel, audit events, normalized memberships, and versioned payroll rules.
- Produces: independently deployable product increments.

- [ ] **Step 1: Attendance workstream**

Plan timesheet correction requests, manager approval, overtime/rest-day approval, break punches, device/CSV import reconciliation, geofence evidence with consent/privacy controls, payroll locks, and exception dashboards. Add an organization-time range index to avoid full-organization scans.

- [ ] **Step 2: Payroll and compliance workstream**

Plan YTD ledgers, previous-employer compensation, retro pay, taxable/non-taxable earning classifications, loans/amortization schedules, minimum-wage/regional wage configuration, bank disbursement export, accounting journal export, BIR 1601-C/2316/1604-C alphalist outputs, and SSS/PhilHealth/Pag-IBIG remittance reports.

- [ ] **Step 3: Leave and benefits workstream**

Plan effective-dated policy assignments, statutory leave presets, accrual transactions as a ledger, carryover/expiry jobs, supporting-document privacy, delegates, multi-level approvals, and a single balance source of truth.

- [ ] **Step 4: Employee lifecycle workstream**

Plan onboarding/offboarding checklists, asset/document/account clearance, knowledge transfer, exit interview, final-pay 30-day deadline, COE request and three-day issuance tracking, BIR 2316 release, rehire, and alumni archive.

- [ ] **Step 5: Organization flexibility workstream**

Plan legal entities, branches, locations, cost centers, pay groups, calendars, shift policies, work arrangements, multiple approver chains, and configuration templates for SMEs, BPO/night-shift, retail, field teams, and distributed companies.

- [ ] **Step 6: Employee self-service workstream**

Plan profile-change requests, document/COE requests, tax and government-ID capture with field-level privacy, benefits statements, announcements acknowledgment, mobile-first clocking, and clear action/status timelines.

- [ ] **Step 7: Talent workstream**

Plan recruitment-to-onboarding handoff, requisition approvals, offer templates, goals/competencies, calibration, development plans, and training records. Keep highly sensitive interview/evaluation notes scoped and audited.

- [ ] **Step 8: Reporting workstream**

Plan headcount/turnover, attendance exceptions, leave liability, payroll variance, employer contribution liability, labor-cost by department/location, compliance deadlines, and privacy-safe exports.

- [ ] **Step 9: Prioritize increments by evidence**

Interview at least five target Philippine employers across different sizes/industries, tag requests by frequency and regulatory risk, measure workflow completion times, and select one testable increment per workstream.

### Task 13: Restore engineering quality gates and observability

**Files:**
- Modify: `apps/app/eslint.config.mjs`
- Create: `apps/marketing/eslint.config.mjs`
- Modify: root and app package scripts.
- Create or modify: `.github/workflows/ci.yml`
- Add error/analytics integration only after vendor and privacy review.

**Interfaces:**
- Produces: deterministic CI for install, generated types, tests, lint, build, audit, and migration checks.

- [ ] **Step 1: Baseline lint debt by category**

Keep existing errors visible but introduce a no-new-errors gate for changed files. Fix auth, payroll, migration, and public endpoint types first; never silence those areas with `any` or blanket rule disables.

- [ ] **Step 2: Add the missing marketing ESLint configuration**

Use the same TypeScript/Next policy as the app where applicable and include both apps in root lint.

- [ ] **Step 3: Replace `any` at trust boundaries**

Prioritize Convex contexts/results, server actions, request bodies, payroll snapshots, capability checks, and migration reports. Use generated Convex types and Zod at HTTP/form boundaries.

- [ ] **Step 4: Add operational telemetry**

Track authorization denials by capability/status without personal payloads, migration progress, payroll calculation version, failed email delivery, storage rejection, and background-job errors. Alert on privilege changes and repeated cross-tenant denials.

- [ ] **Step 5: Add disaster-recovery and incident runbooks**

Document backup/export verification, restore rehearsal, key rotation, session revocation, breach triage, affected-record estimation, and NPC notification decision flow.

- [ ] **Step 6: Run the complete gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter app test
pnpm lint
pnpm build
pnpm audit --prod --audit-level high
```

Expected: all commands pass, or the audit contains only explicitly reviewed, time-bounded exceptions.

- [ ] **Step 7: Commit quality gates**

```bash
git add apps/app/eslint.config.mjs apps/marketing/eslint.config.mjs package.json apps/app/package.json apps/marketing/package.json .github/workflows/ci.yml
git commit -m "chore: enforce quality security and build gates"
```

## Recommended Delivery Order

1. **Immediate containment:** Tasks 1–4. Treat the privilege elevation, employee data projection, files, reset email, XSS, and lifecycle backend bypasses as production security incidents until disproven by access logs.
2. **Reported resignation bug and identity cleanup:** Task 5. Backfill linkage and enforce the alumni policy without deleting the global account or history.
3. **Sensitive-data and supply-chain hardening:** Tasks 6–7.
4. **Payroll correctness:** Task 8. Run a non-mutating impact assessment for prior payroll periods and coordinate remediation with a payroll/legal specialist.
5. **Accountability and safe schema contraction:** Tasks 9–10.
6. **Role experience:** Task 11.
7. **Customer value expansion:** Task 12, one separately planned workstream at a time.
8. **Ongoing engineering health:** Task 13 begins early as a no-regression gate and finishes after the critical modules are typed.

## Release Gates

- Gate A: No unauthenticated privilege/data/storage endpoint remains; critical security tests pass.
- Gate B: Every Convex module uses the central policy; active/alumni/suspended/disabled/removed tests pass.
- Gate C: Production membership audit has zero ambiguous/duplicate unresolved links; resigned workflow passes end to end.
- Gate D: Corrected statutory fixtures pass and production payroll impact report has been reviewed.
- Gate E: No schema field is removed without zero-use evidence, backup/export verification, and post-migration invariants.
- Gate F: CI test/build/lint/audit policy passes before product expansion ships.

## Self-Review

- Spec coverage: modules, configuration, UX/value, missing features, authentication, roles/capabilities, resigned-member behavior, security, database cleanup, production-data safety, and ordered implementation are covered.
- Placeholder scan: no deferred implementation placeholder is used; later product work is explicitly routed into separate approved plans with defined scope.
- Type consistency: authorization, migration, statutory-rule, storage, and audit interfaces are defined once and reused by later tasks.
