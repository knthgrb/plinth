# Release 2B Identity and Credentials Compatibility Design

**Date:** 2026-08-13

## Objective

Switch identity, organization membership, payslip PIN credentials, and
invitation bearer tokens to their normalized Release 1B representations while
retaining a reversible compatibility window. Release 2B changes application
behavior; it does not delete legacy fields, indexes, or data.

## Release boundary

Release 1B is complete when its write run, audit, issue review, and idempotency
run are clean. That proves the normalized targets contain a faithful copy. It
does not prove application traffic has stopped using legacy sources.

Release 2B therefore owns four behavior changes:

1. `userOrganizations` becomes the only authorization and organization-role
   source.
2. `payslipCredentials` becomes the preferred PIN credential source while PIN
   mutations update normalized and legacy storage atomically.
3. Invitation lookup becomes hash-first while issuance and resend maintain the
   hashed and legacy token representations atomically.
4. Readiness distinguishes additive migration readiness from Release 3
   contract-removal readiness.

## Canonical membership access

All organization-scoped authorization must resolve the signed-in user, the
exact `userOrganizations` row, its normalized access status, and the target
organization. The membership row supplies the role and employee identity.
Legacy `users.organizationId`, `users.role`, and `users.employeeId` remain a
rollback projection during Release 2B but cannot grant or broaden access.

Active access requires:

- an authenticated active user;
- an exact organization membership;
- membership status `active` (including legacy rows whose missing status
  normalizes to active); and
- a non-archived organization.

Alumni access is an explicit, narrow mode for the former employee's own
historical payslips and PIN reset flow. It does not grant organization admin,
employee-directory, payroll, attendance, settings, communication, or document
access. Removed, suspended, and unknown membership states fail closed.

Shared typed access helpers in `convex/access.ts` enforce these rules. Protected
modules must use them instead of reconstructing authorization with legacy user
columns.

## Payslip PIN credentials

Credential reads use this deterministic order:

1. Read the unique `payslipCredentials` row for the employee.
2. If that row exists, its `credentialHash` is authoritative.
3. Only if no normalized row exists may the reader use
   `employees.payslipPinHash` during the compatibility window.
4. If neither exists, the employee has no configured PIN.

An existing normalized row never falls back because of an empty or malformed
field. Such a row is a consistency error surfaced by tests and the repeatable
audit.

Setting, resetting, or upgrading a PIN writes both representations in the same
Convex transaction. The normalized row is upserted by employee with its
organization, credential version, and timestamps; the employee projection is
patched in that same mutation. No public query or mutation returns a PIN hash.
Self-service checks use `userOrganizations.employeeId`, never the legacy user
projection. Privileged PIN replacement remains outside the ordinary self-set
flow; administrative recovery must use the separately authorized reset flow.

## Invitation bearer tokens

Incoming raw tokens are domain-separated and hashed before lookup.

- A matching `tokenHash` row is authoritative.
- Plaintext `token` lookup is allowed only for a legacy row with no
  `tokenHash`.
- A row that has `tokenHash` can never be accepted through its plaintext token.
  This prevents an old raw token from remaining valid after rotation.

Creation generates a raw token, stores its raw compatibility value and hash in
one mutation, and returns the raw token once to the authorized server email
path. Administrative invitation reads redact the raw token. Resend rotates to
a fresh raw token and hash atomically and returns the new raw token once for
email delivery. Browser acceptance continues to submit the URL token without
storing it elsewhere.

## Compatibility evidence and readiness

`getFullSchemaCleanupReadiness` exposes two separate gates:

- `readyForRelease2`: every additive domain migration and audit is clean;
- `readyForRelease3`: every Release 2 compatibility switch is complete and the
  monitored compatibility window has produced the required zero-fallback,
  zero-conflict evidence.

Release 2B sets the identity/credentials compatibility domain to switched, but
the global Release 3 result remains false while Releases 2C–2F or the monitored
window are incomplete. The existing field remains in the response for API
compatibility, but its semantics become fail-closed.

The repeatable identity audit is the persisted equality and fallback evidence.
It must remain safe to run after live writes and report missing, mismatched,
duplicate, orphan, and unexpected normalized rows without exposing hashes or
tokens.

## Failure and rollback

Every authorization failure is explicit and fail-closed. Credential and token
dual writes are transactionally atomic, so partial compatibility state cannot
commit. Deploying the previous application revision is the Release 2B rollback;
legacy projections remain populated for that purpose. No destructive cleanup
is authorized until Release 3A.

## Verification

Release 2B requires regression coverage for:

- removed, suspended, alumni, cross-tenant, and legacy-only memberships;
- role and employee identity coming only from the exact membership;
- normalized-first credential reads, legacy-only fallback, and atomic dual
  writes for set/reset/upgrade;
- hash-first invitation lookup, legacy-only fallback, rotation invalidation,
  and token redaction;
- additive readiness remaining true while Release 3 readiness remains false;
- repeatable identity audit and idempotency after compatibility traffic; and
- the full test, typecheck, lint, schema inventory, and production build gates.
