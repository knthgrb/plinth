# Release 2B Identity and Credentials Compatibility Implementation Plan

> **For Codex:** Execute this plan in order with test-driven development. Do
> not contract the schema or clear legacy data in this release.

**Goal:** Make normalized organization memberships, payslip credentials, and
invitation token hashes authoritative while preserving transactional legacy
projections for rollback.

**Architecture:** Central typed access helpers resolve identity, membership,
organization, role, and employee linkage once and fail closed. Credential and
invitation adapters encapsulate normalized-first reads and atomic dual writes.
The readiness response separates completed additive migrations from the later
Release 3 contract gate.

**Stack:** TypeScript, Convex queries/mutations/actions, Vitest, Next.js.

---

## Task 1: Correct program readiness semantics

**Files:**

- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`

1. Add failing tests that expect `readyForRelease2: true` after all six clean
   additive audits and `readyForRelease3: false` while any compatibility wave
   or its monitored window is incomplete.
2. Add a typed compatibility state to each registry wave. Mark organization
   configuration switched, identity/credentials switched in this release, and
   Releases 2C–2F pending. Keep the monitored-window gate false.
3. Derive `readyForRelease2` from additive audit readiness and derive
   `readyForRelease3` fail-closed from every compatibility state plus the
   monitored-window gate. Return explicit `release3Blockers`.
4. Run:

   `pnpm --filter app exec vitest run tests/full-schema-readiness.test.ts`

## Task 2: Establish canonical typed organization access

**Files:**

- Modify: `apps/app/convex/access.ts`
- Modify: `apps/app/tests/security/lifecycle-access.test.ts`
- Modify: `apps/app/tests/role-access.test.ts`
- Modify: `apps/app/tests/alumni-access-workflow.test.ts`

1. Add failing tests for legacy-only access, removed and suspended
   memberships, alumni full-access denial, alumni own-payslip allowance,
   cross-tenant membership, legacy role disagreement, and membership employee
   linkage disagreement.
2. Define typed active and historical access contexts. Resolve the exact
   membership through `by_user_organization`; use only membership role and
   employee ID; require an active user and non-archived organization.
3. Keep alumni handling explicit and scoped rather than adding an option to
   general privileged access.
4. Run the three focused security test files.

## Task 3: Remove legacy membership authorization fallbacks

**Files:**

- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/convex/employees.ts`
- Modify: `apps/app/convex/settings.ts`
- Modify: `apps/app/convex/attendance.ts`
- Modify: `apps/app/convex/shifts.ts`
- Modify: `apps/app/convex/holidays.ts`
- Modify: `apps/app/convex/leave.ts`
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/accounting.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Modify: `apps/app/convex/evaluations.ts`
- Modify: `apps/app/convex/recruitment.ts`
- Modify: `apps/app/convex/memos.ts`
- Modify: `apps/app/convex/announcements.ts`
- Modify: `apps/app/convex/chat.ts`
- Modify: `apps/app/convex/documents.ts`
- Modify: `apps/app/convex/assets.ts`
- Modify: `apps/app/convex/invitations.ts`
- Modify: relevant focused tests in `apps/app/tests/`

1. Add source-level and behavior regressions proving protected functions do not
   use `users.organizationId`, `users.role`, or `users.employeeId` as an access
   fallback.
2. Replace local membership reconstruction with the shared access resolver.
   Keep domain-specific role allowlists at the call site.
3. Preserve legacy projection writes needed for rollback, but label them as
   compatibility writes and never read them for authorization.
4. Replace every `any` encountered in touched access paths with Convex `Doc`,
   `Id`, query-context, or explicit domain types.
5. Run lifecycle, role, membership, invitation, document, attendance, payroll,
   and public-function security tests.

## Task 4: Switch payslip PIN credentials

**Files:**

- Modify: `apps/app/convex/payslipPinResetDb.ts`
- Modify: `apps/app/convex/payslipPin.ts`
- Modify: `apps/app/convex/organizations.ts`
- Modify: `apps/app/tests/security/payslip-pin-access.test.ts`
- Modify: `apps/app/tests/security/payslip-pin-crypto.test.ts`
- Modify: `apps/app/tests/identity-migrations.test.ts`

1. Add failing tests proving normalized credentials win over conflicting legacy
   hashes, legacy-only rows fall back, normalized absence reports no PIN, and
   all set/reset/upgrade paths update both stores atomically.
2. Add typed helpers to load the unique normalized credential and to upsert it
   by employee. Reject duplicate or organization-mismatched destinations.
3. Use the normalized-first loader in PIN verification and the payslip setup
   query. Use the canonical membership employee ID for self-service.
4. Upsert `payslipCredentials` and patch `employees.payslipPinHash` in each
   credential mutation. Never return or log either hash.
5. Run all payslip PIN and identity migration tests.

## Task 5: Switch invitation token compatibility

**Files:**

- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/services/invitations-service.ts`
- Modify: `apps/app/actions/employees.ts`
- Modify: `apps/app/tests/invitation-token-compatibility.test.ts`
- Modify: `apps/app/tests/security/public-functions.test.ts`

1. Add failing tests for hash-first lookup, plaintext fallback only when
   `tokenHash` is absent, old-token invalidation after rotation, one-time raw
   token issuance, redacted administrative reads, and tenant-safe resend.
2. Add a typed token resolver that hashes input, queries `by_token_hash`, then
   queries `by_token` only for a row without `tokenHash`.
3. Return the freshly generated token from authorized create operations once;
   redact it from `getInvitationById`. Add an authorized resend mutation that
   rotates raw compatibility token and hash atomically and returns the new raw
   token once.
4. Update server email callers to consume only the one-time returned token.
   Replace `any` in every touched service/action path with generated API and
   domain types.
5. Run invitation compatibility and public-function security tests.

## Task 6: Compatibility evidence and operator runbook

**Files:**

- Modify: `apps/app/convex/identityMigrations.ts`
- Modify: `apps/app/tests/identity-migrations.test.ts`
- Create: `docs/runbooks/release-2b-identity-credentials-compatibility.md`
- Modify: `docs/runbooks/schema-normalization-release-1.md`

1. Add failing audit tests for live dual-written rows, legacy-only fallback
   detection, normalized mismatches, duplicate credentials/token hashes, and
   redacted issue output.
2. Ensure the repeatable Release 1B audit remains valid after Release 2B live
   traffic and exposes the exact blockers needed before disabling fallbacks.
3. Document deploy, smoke tests, repeat audit, idempotency, readiness,
   monitoring-window evidence, rollback, and the explicit prohibition on
   Release 3 cleanup.
4. Run focused identity migration tests and diff checks.

## Task 7: Final verification and review

1. Run:

   - `pnpm --filter app exec vitest run`
   - `pnpm --filter app exec tsc --noEmit`
   - `pnpm --filter app exec eslint` for every touched TypeScript file
   - `pnpm --filter app schema:inventory`
   - `pnpm --filter app build`
   - `git diff --check`

2. Review every changed authorization boundary, public return value, secret
   handling path, transaction boundary, migration gate, and runbook command.
3. Confirm no schema field/index removal, no destructive migration, no secret
   output, no new `any`, and `readyForRelease3` remains false.
