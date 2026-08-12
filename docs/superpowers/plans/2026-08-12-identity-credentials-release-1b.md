# Identity and Credentials Release 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unauthenticated legacy-role mutation, add the identity/credential/invitation target schema, and backfill production data through bounded dry-run, write, and audit gates without switching reads or removing legacy fields.

**Architecture:** Release 1B is an additive expand/backfill release. `userOrganizations` remains the future canonical owner of organization role, lifecycle, and employee linkage; `payslipCredentials` becomes the private PIN-credential target; invitations gain deterministic domain-separated token hashes. A dedicated identity migration module reuses `migrationRuns`, `migrationIssues`, and `migrationAudits`, but uses its own key/version, phases, scheduler loop, planner, issue codes, and operator commands.

**Tech Stack:** TypeScript, Convex internal mutations/actions/queries, Convex paginated queries, Vitest with `convex-test`, `@noble/hashes`, pnpm, Next.js 16.

## Global Constraints

- Work directly on `main`, as explicitly authorized by the user.
- This release is additive except for removing the unused unsafe public `users.syncUser` function.
- Do not remove or clear `users.organizationId`, `users.role`, `users.employeeId`, `users.isActive`, `employees.payslipPinHash`, `employees.payslipPdfPassword`, `invitations.token`, or their legacy indexes/validators.
- Do not switch application reads to normalized-first behavior in this plan. Release 2 owns read switches and dual writes.
- Do not rewrite historical payslip snapshots or run `clearLegacyPdfPasswords`.
- Every migration is internal-only, cursor-bounded, resumable, idempotent, and requires a conflict-free completed dry-run before write mode.
- Never guess between conflicting non-empty legacy and destination values.
- Migration issues and responses contain IDs, field names, and codes only—never email addresses, role-independent secrets, tokens, PINs, credential hashes, bank values, or source-line content.
- Duplicate membership, employee-link, credential, or token-hash natural keys fail closed using indexed `.take(2)` checks.
- `userOrganizations.employeeId` must reference an employee in the same organization.
- `users.isActive: false` is audit-only in this release; do not infer or change a membership unless an existing employee lifecycle already provides the organization-scoped state.
- A resigned employee remains an alumni member with historical self-payslip/document access; no global account deactivation is introduced.
- Existing organization-configuration migration APIs and production audit evidence must remain compatible.
- Production commands are documented but are not executed until the code is deployed.

---

### Task 1: Remove the unauthenticated legacy-role mutation

**Files:**

- Delete: `apps/app/convex/users.ts`
- Modify: `apps/app/tests/security/public-functions.test.ts`
- Regenerate: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**

- Removes the unused public function `users:syncUser`.
- Does not replace it; account creation remains owned by Better Auth and invitation acceptance.

- [ ] **Step 1: Add a failing public-boundary regression**

Use a literal function reference so the test remains valid after the generated public binding disappears:

```ts
const legacySyncUser = makeFunctionReference<
  "mutation",
  {
    email: string;
    organizationId?: Id<"organizations">;
    role?: "owner" | "admin" | "hr" | "manager" | "employee" | "accounting";
  },
  Id<"users">
>("users:syncUser");

it("does not expose the legacy user-role synchronization mutation", async () => {
  const t = convexTest(schema, modules);
  const organizationId = await t.run((ctx) =>
    ctx.db.insert("organizations", {
      name: "Protected organization",
      createdAt: 1,
      updatedAt: 1,
    }),
  );

  await expect(
    t.mutation(legacySyncUser, {
      email: "attacker@example.com",
      organizationId,
      role: "owner",
    }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Verify RED, then remove the function**

Run:

```bash
pnpm --filter app test -- tests/security/public-functions.test.ts
```

Expected RED: the current public mutation succeeds. Delete `convex/users.ts`; do not internalize an unused bypass.

- [ ] **Step 3: Regenerate bindings and verify security**

```bash
pnpm --dir apps/app exec convex codegen --typecheck disable
pnpm --filter app test -- tests/security/public-functions.test.ts tests/security/lifecycle-access.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: the public mutation cannot resolve; existing lifecycle tests pass; `api.d.ts` no longer exposes `users`.

- [ ] **Step 4: Commit**

```bash
git add apps/app/convex/users.ts apps/app/convex/_generated/api.d.ts apps/app/tests/security/public-functions.test.ts
git commit -m "fix: remove unsafe user role synchronization"
```

### Task 2: Add identity, credential, and invitation expansion schema

**Files:**

- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/tests/fixtures/schema-inventory.reviewed.json`
- Modify: `apps/app/tests/schema-inventory-coverage.test.ts`
- Create: `apps/app/tests/identity-credentials-schema.test.ts`

**Interfaces:**

- Adds table `payslipCredentials`.
- Adds `invitations.tokenHash?: string` and index `by_token_hash`.
- Adds `userOrganizations.by_organization_employee` on `organizationId, employeeId`.
- Adds optional `migrationIssues.auditId` plus `by_audit` so repeat audits have separate redacted issue pages.
- Extends migration phases for the identity wave while preserving existing rows.
- Keeps the `identity_credentials` release wave `not_started` until Task 5 deploys the run/audit implementation.

- [ ] **Step 1: Write failing schema integration tests**

Create `identity-credentials-schema.test.ts` and assert:

```ts
it("stores private payslip credentials and hashed invitation compatibility data", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Identity Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeId = await insertMinimalEmployee(ctx, organizationId);
    const userId = await ctx.db.insert("users", {
      email: "member@example.com",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      employeeId,
      role: "employee",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("payslipCredentials", {
      organizationId,
      employeeId,
      credentialHash: "redacted-fixture-hash",
      credentialVersion: 1,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
});
```

Also query the new membership and invitation indexes and prove `.take(2)` works.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter app test -- tests/identity-credentials-schema.test.ts tests/schema-inventory-coverage.test.ts
```

Expected: missing table/field/index failures.

- [ ] **Step 3: Extend the schema additively**

Add:

```ts
payslipCredentials: defineTable({
  organizationId: v.id("organizations"),
  employeeId: v.id("employees"),
  credentialHash: v.string(),
  credentialVersion: v.number(),
  migrationVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_employee", ["employeeId"])
  .index("by_organization", ["organizationId"]),
```

Extend:

```ts
userOrganizations.index("by_organization_employee", [
  "organizationId",
  "employeeId",
]);

invitations: {
  tokenHash: v.optional(v.string());
}
.index("by_token_hash", ["tokenHash"]);
```

Extend `migrationRuns.phase` with these literals:

```ts
"identity_users";
"identity_credentials";
"identity_invitations";
```

Extend `migrationAudits.phase` with:

```ts
"identity_users";
"identity_memberships";
"identity_credentials";
"identity_credential_targets";
"identity_invitations";
```

Extend `migrationIssues` additively:

```ts
auditId: v.optional(v.id("migrationAudits"));
```

and add `.index("by_audit", ["auditId", "createdAt"])`.

Do not weaken the validators to arbitrary strings.

- [ ] **Step 4: Extend the manifest and reviewed schema gate**

- Add `payslipCredentials` to `CURRENT_SCHEMA_TABLES` and `FULL_SCHEMA_TABLE_POLICIES` under `employee_core_credentials`, disposition `retain`, default classification `normalized_target`.
- Keep `employees.payslipPinHash` as `compatibility_read`, now targeting `payslipCredentials.credentialHash`.
- Keep `employees.payslipPdfPassword` removable with no target.
- Keep `invitations.token` as compatibility-read targeting `invitations.tokenHash`.
- Regenerate the reviewed inventory digest intentionally. The expected current count becomes 45 tables.
- Update all exact `44` assertions that represent current source schema to `45`; do not alter historical production evidence text for the already-run 44-table checkpoint without explaining the expansion.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter app test -- tests/identity-credentials-schema.test.ts tests/schema-inventory-coverage.test.ts tests/full-schema-readiness.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/schema.ts convex/fullSchemaInventory.ts convex/fullSchemaCleanupRegistry.ts tests/identity-credentials-schema.test.ts tests/schema-inventory-coverage.test.ts
git diff --check
git add apps/app/convex/schema.ts apps/app/convex/fullSchemaInventory.ts apps/app/convex/fullSchemaCleanupRegistry.ts apps/app/tests/fixtures/schema-inventory.reviewed.json apps/app/tests/schema-inventory-coverage.test.ts apps/app/tests/identity-credentials-schema.test.ts
git commit -m "feat: expand identity credential schema"
```

### Task 3: Implement pure identity migration planning and token hashing

**Files:**

- Create: `apps/app/convex/identityMigrationTypes.ts`
- Create: `apps/app/convex/identityMigrationPlanner.ts`
- Create: `apps/app/convex/invitationTokenHash.ts`
- Create: `apps/app/tests/identity-migration-planner.test.ts`

**Interfaces:**

- Produces `IDENTITY_CREDENTIALS_MIGRATION_KEY = "full-schema-identity-credentials"` and version `1`.
- Produces redacted issue codes and pure planners for users, credentials, and invitations.
- Produces `hashInvitationToken(token): string` using domain-separated SHA-256.

- [ ] **Step 1: Write failing planner/hash tests**

Cover at least:

```ts
expect(hashInvitationToken("raw-token")).toMatch(/^[a-f0-9]{64}$/);
expect(hashInvitationToken("raw-token")).toBe(hashInvitationToken("raw-token"));
expect(hashInvitationToken("raw-token")).not.toBe(
  sha256WithoutDomain("raw-token"),
);
```

User planner cases:

- legacy org + role and no membership → create membership;
- identical existing membership → unchanged;
- duplicate membership → conflict;
- existing role mismatch → conflict, never overwrite;
- legacy employee points outside organization → `EMPLOYEE_ORGANIZATION_MISMATCH`;
- absent legacy organization → skipped;
- `isActive: false` without unambiguous linked lifecycle → `AMBIGUOUS_GLOBAL_INACTIVE_USER`, no status mutation;
- invalid/orphan legacy organization or employee → issue only;
- invalid `lastActiveOrganizationId` → issue only in this release.

Credential planner cases:

- non-empty legacy hash + no destination → create exact hash;
- same destination → unchanged;
- duplicate or unequal destination → conflict;
- empty legacy hash → skipped;
- destination without legacy source → unexpected audit row.

Invitation planner cases:

- plaintext token + absent hash → add deterministic hash;
- matching hash → unchanged;
- mismatched hash or duplicate destination hash → conflict;
- no token → issue, never hash an empty string.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter app test -- tests/identity-migration-planner.test.ts
```

- [ ] **Step 3: Implement token hashing**

Use Convex-runtime-safe noble hashes:

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const INVITATION_TOKEN_DOMAIN = "plinth-invitation-token-v1:";

export function hashInvitationToken(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${INVITATION_TOKEN_DOMAIN}${token}`)));
}
```

Never log or return the input token from migration helpers.

- [ ] **Step 4: Implement planner result types**

Use a shared result shape:

```ts
type IdentityPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "skipped" }
  | { outcome: "conflict"; issues: IdentityMigrationIssue[] };
```

Issue objects contain only:

```ts
type IdentityMigrationIssue = {
  code: IdentityMigrationIssueCode;
  field: string;
};
```

No issue includes email, token, role value, credential, or hash.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter app test -- tests/identity-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/identityMigrationTypes.ts convex/identityMigrationPlanner.ts convex/invitationTokenHash.ts tests/identity-migration-planner.test.ts
git diff --check
git add apps/app/convex/identityMigrationTypes.ts apps/app/convex/identityMigrationPlanner.ts apps/app/convex/invitationTokenHash.ts apps/app/tests/identity-migration-planner.test.ts
git commit -m "feat: plan identity credential migration"
```

### Task 4: Dual-write invitation token hashes for newly issued invitations

**Files:**

- Modify: `apps/app/convex/invitations.ts`
- Modify: `apps/app/tests/security/public-functions.test.ts`
- Create: `apps/app/tests/invitation-token-compatibility.test.ts`

**Interfaces:**

- Every newly created invitation stores both legacy `token` and `tokenHash` atomically.
- Existing lookup and acceptance remain plaintext-first in Release 1B; hash-first lookup and plaintext retirement belong to Release 2/3.
- The raw token remains available only to the existing authorized server email path during this compatibility release.

- [ ] **Step 1: Add failing creation-path tests**

Cover both invitation creation paths (`createInvitation`/batch helper and `createUserForEmployee`) and assert:

```ts
expect(invitation.tokenHash).toBe(hashInvitationToken(invitation.token));
expect(invitation.tokenHash).not.toBe(invitation.token);
```

Also assert unauthenticated and inactive membership callers cannot create invitations.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter app test -- tests/invitation-token-compatibility.test.ts tests/security/public-functions.test.ts tests/security/lifecycle-access.test.ts
```

- [ ] **Step 3: Add atomic compatibility writes**

At every `ctx.db.insert("invitations", ...)` creation site:

```ts
const token = createInvitationToken();
const tokenHash = hashInvitationToken(token);

await ctx.db.insert("invitations", {
  ...fields,
  token,
  tokenHash,
});
```

Do not introduce a second mutation or post-insert patch that could leave half-written rows.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter app test -- tests/invitation-token-compatibility.test.ts tests/security/public-functions.test.ts tests/security/lifecycle-access.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/invitations.ts tests/invitation-token-compatibility.test.ts tests/security/public-functions.test.ts
git diff --check
git add apps/app/convex/invitations.ts apps/app/tests/invitation-token-compatibility.test.ts apps/app/tests/security/public-functions.test.ts
git commit -m "feat: hash newly issued invitation tokens"
```

### Task 5: Add bounded identity dry-run and write migration

**Files:**

- Create: `apps/app/convex/identityMigrations.ts`
- Modify: `apps/app/tests/data-migrations.test.ts`
- Create: `apps/app/tests/identity-migrations.test.ts`
- Regenerate: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**

- Produces internal functions:
  - `startIdentityCredentialsMigration({dryRun,dryRunId?,batchSize?})`
  - `processIdentityCredentialsBatch({runId})`
  - `continueIdentityCredentialsMigration({runId})`
  - `failIdentityCredentialsMigration({runId,failureCode})`
  - `resumeIdentityCredentialsMigration({runId})`
  - `getIdentityCredentialsMigrationRun({runId})`
  - `listIdentityCredentialsMigrationIssues({runId,paginationOpts})`
- Uses key `full-schema-identity-credentials`, version `1`.
- Phases execute in order: `identity_users`, `identity_credentials`, `identity_invitations`.

- [ ] **Step 1: Write failing orchestration tests**

Test:

- dry-run changes no business row but reports planned creates;
- write mode without a completed conflict-free dry-run is rejected;
- batch size accepts `1..50` only;
- a second active run for the key is rejected;
- phases advance with persisted cursor and reset cursor between phases;
- scheduler/action failure marks the run `failed` with `BATCH_FAILED`;
- stale queued/running run can resume; fresh or terminal run cannot;
- issue status is capped/redacted and full issues paginate;
- wrong migration key/version run IDs are rejected;
- write execution is idempotent; a second dry-run after write reports zero changes;
- any planner conflict blocks `canStartWrite`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter app test -- tests/identity-migrations.test.ts tests/data-migrations.test.ts
```

- [ ] **Step 3: Implement phase pagination and writes**

For `identity_users`, paginate `users`; load candidate membership rows with `by_user_organization.take(2)`, validate organization/employee tenant, and insert only when the planner returns `create` and `dryRun` is false.

For `identity_credentials`, paginate `employees`; load `payslipCredentials.by_employee.take(2)` and insert exact legacy hash only for `create` in write mode.

For `identity_invitations`, paginate `invitations`; compute the expected hash in memory, detect duplicate hash rows via `by_token_hash.take(2)`, and patch only `tokenHash` in write mode.

Every phase increments shared counters consistently:

- `scanned`: source rows examined;
- `changed`: planned/written creates or patches;
- `unchanged`: exact destination match;
- `skipped`: no applicable source;
- `conflicts`: redacted planner issues;
- `errors`: caught batch/system failures only.

- [ ] **Step 4: Implement safe issue persistence**

Persist only source IDs already safe for operator correlation:

```ts
await ctx.db.insert("migrationIssues", {
  runId,
  organizationId,
  entityType: "user" | "employee" | "invitation",
  entityId: String(sourceId),
  field: issue.field,
  code: issue.code,
  createdAt: Date.now(),
});
```

Never store email/token/hash/role/employee name in an issue.

- [ ] **Step 5: Regenerate, verify, and commit**

```bash
pnpm --dir apps/app exec convex codegen --typecheck disable
pnpm --filter app test -- tests/identity-migrations.test.ts tests/data-migrations.test.ts tests/identity-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/identityMigrations.ts tests/identity-migrations.test.ts tests/data-migrations.test.ts
git diff --check
git add apps/app/convex/identityMigrations.ts apps/app/convex/_generated/api.d.ts apps/app/tests/identity-migrations.test.ts apps/app/tests/data-migrations.test.ts
git commit -m "feat: backfill identity credential targets"
```

### Task 6: Add persisted identity audit and global readiness integration

**Files:**

- Modify: `apps/app/convex/identityMigrations.ts`
- Modify: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`
- Modify: `apps/app/tests/identity-migrations.test.ts`
- Regenerate: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**

- Produces internal functions:
  - `startIdentityCredentialsAudit({runId,batchSize?})`
  - `processIdentityCredentialsAuditBatch({auditId})`
  - `continueIdentityCredentialsAudit({auditId})`
  - `failIdentityCredentialsAudit({auditId,failureCode})`
  - `resumeIdentityCredentialsAudit({runId})`
  - `getIdentityCredentialsAudit({runId})`
  - `listIdentityCredentialsAuditIssues({auditId,paginationOpts})`
- Changes registry implementation for `identity_credentials` from `not_started` to `migration`.
- Global readiness reports identity as ready only for the newest safe write attempt and its newest clean audit.

- [ ] **Step 1: Extend registry typing with failing tests**

Change implementation union to:

```ts
implementation: "compatibility" | "migration" | "not_started";
```

Update dispatch tests so `identity_credentials` maps to an explicit supported identity migration mode; unknown migration implementations return `DOMAIN_IMPLEMENTATION_UNSUPPORTED`.

- [ ] **Step 2: Add failing audit tests**

Cover:

- only a conflict-free completed write can start audit;
- audit batch size accepts `1..10`;
- audit phases are bounded and persisted;
- users: duplicates, orphan user/org, mismatched role/employee, invalid last-active membership, ambiguous `isActive:false` count as source conflicts;
- memberships: duplicate `(user,org)`, duplicate `(org,employee)`, orphan references, employee tenant mismatch;
- credentials: missing, duplicate, mismatch, unexpected destination;
- invitations: missing/mismatched token hash and duplicate hash;
- destination counts satisfy expected/matching/missing/duplicate/mismatched/unexpected/totalRows;
- newest audit is selected deterministically;
- failed/stale audit resumes; active fresh/completed audit does not;
- second write produces zero changes and a repeat audit remains ready;
- audit/status output never contains token or credential material.

- [ ] **Step 3: Implement persisted audit**

Reuse `migrationAudits` with the identity phases. For compatibility with existing required fields:

- set `organizations: 0` and `duplicateLegacySettings: 0` for identity audits;
- use `sourceConflicts` for all identity invariant violations;
- use the existing aggregate `destination` counters across membership, credential, and invitation targets;
- store detailed redacted audit issue codes in `migrationIssues` with both `runId` and `auditId`, queryable through `by_audit` without mixing repeat audits;
- set `auditTruncated` only when a safety bound prevents a complete result.

Audit target rows in separate phases so unexpected destinations are counted without unbounded collection.

- [ ] **Step 4: Integrate fail-closed global readiness**

The `identity_credentials` readiness resolver must:

- inspect only the newest relevant non-dry-run attempt for the exact key/version within the existing bounded lookback;
- block on queued/running/failed/errors/conflicts before considering older evidence;
- load only the newest audit attached to that exact run;
- require completed, non-truncated, zero-source-conflict, zero-discrepancy audit with `matching === expected`;
- return `auditId` and `auditedAt` metadata only.

The other four undeployed waves remain `not_started`; global `readyForRelease3` remains false.

- [ ] **Step 5: Regenerate, verify, and commit**

```bash
pnpm --dir apps/app exec convex codegen --typecheck disable
pnpm --filter app test -- tests/identity-migrations.test.ts tests/full-schema-readiness.test.ts tests/data-migrations.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/identityMigrations.ts convex/fullSchemaCleanupRegistry.ts convex/databaseMigrations.ts tests/identity-migrations.test.ts tests/full-schema-readiness.test.ts
git diff --check
git add apps/app/convex/identityMigrations.ts apps/app/convex/fullSchemaCleanupRegistry.ts apps/app/convex/databaseMigrations.ts apps/app/convex/_generated/api.d.ts apps/app/tests/identity-migrations.test.ts apps/app/tests/full-schema-readiness.test.ts
git commit -m "feat: audit identity credential migration"
```

### Task 7: Document Release 1B identity production workflow and verify

**Files:**

- Create: `docs/runbooks/identity-credentials-release-1b.md`
- Modify: `docs/superpowers/plans/2026-08-12-identity-credentials-release-1b.md`

**Interfaces:**

- Documents deploy → dry-run → inspect all issues → write → audit → idempotency dry-run → readiness.
- Performs no production operation during implementation.

- [ ] **Step 1: Write the operator runbook**

Document exact `--prod` commands for:

```bash
identityMigrations:startIdentityCredentialsMigration
identityMigrations:getIdentityCredentialsMigrationRun
identityMigrations:listIdentityCredentialsMigrationIssues
identityMigrations:resumeIdentityCredentialsMigration
identityMigrations:startIdentityCredentialsAudit
identityMigrations:getIdentityCredentialsAudit
identityMigrations:listIdentityCredentialsAuditIssues
identityMigrations:resumeIdentityCredentialsAudit
databaseMigrations:getFullSchemaCleanupReadiness
```

Require:

1. Deploy code first.
2. Dry-run completes with zero conflicts/errors and all issue pages reviewed.
3. Write uses that exact dry-run ID.
4. Write completes with zero conflicts/errors.
5. Audit completes with zero source conflicts, no truncation, and zero destination discrepancies.
6. A post-write dry-run reports `changed: 0`.
7. Global readiness shows `organization_configuration: ready`, `identity_credentials: ready`, the other four waves `not_started`, and `readyForRelease3: false`.

Rollback is application redeployment only before write mode. After write mode, leave additive target rows in place and redeploy the prior application; do not delete backfilled data.

- [ ] **Step 2: Run the full release gate**

```bash
pnpm --filter app schema:inventory
pnpm --filter app test
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/users.ts convex/schema.ts convex/identityMigrationTypes.ts convex/identityMigrationPlanner.ts convex/invitationTokenHash.ts convex/identityMigrations.ts convex/invitations.ts convex/fullSchemaCleanupRegistry.ts convex/databaseMigrations.ts tests/identity-credentials-schema.test.ts tests/identity-migration-planner.test.ts tests/identity-migrations.test.ts tests/invitation-token-compatibility.test.ts tests/security/public-functions.test.ts tests/full-schema-readiness.test.ts
pnpm audit --prod --audit-level moderate
pnpm exec prettier --check docs/runbooks/identity-credentials-release-1b.md docs/superpowers/plans/2026-08-12-identity-credentials-release-1b.md
git diff --check
pnpm --filter app exec next build --webpack
```

If `convex/users.ts` was deleted, omit that path from the ESLint command rather than recreating an empty module.

- [ ] **Step 3: Review invariants and commit**

Confirm:

- no public role-synchronization function exists;
- 45 tables and every field/index match the reviewed schema inventory;
- no legacy identity/credential/invitation field or index was removed;
- no PDF password or historical snapshot was cleared;
- dry-run/write/audit orchestration is bounded and resumable;
- issues contain no secrets or business values;
- identity remains a backfill-only wave with current reads unchanged;
- Release 3 remains blocked.

Then:

```bash
git add docs/runbooks/identity-credentials-release-1b.md docs/superpowers/plans/2026-08-12-identity-credentials-release-1b.md
git commit -m "docs: add identity credentials release 1b runbook"
```

## Completion Boundary

This plan is complete when the unsafe mutation is gone; the additive identity targets and indexes are deployed; dry-run/write/audit functions are tested and documented; invitation creation stores hashes; production application reads still use their existing compatibility paths; and global readiness can recognize clean identity evidence without allowing Release 3. The next plan is Release 1C leave settings, balances, and employee child records.
