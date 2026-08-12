# Convex Full-Schema Manifest and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish machine-enforced coverage of every Convex table, schema field, and index, plus a fail-closed global readiness query that prevents Release 3 until every cleanup domain has current production evidence.

**Architecture:** A test-only TypeScript source parser inventories `schema.ts` without bundling Node APIs into Convex. A Convex-safe policy module explicitly classifies all 44 current tables, applies default field/index policies, and overrides every compatibility, historical, migration, or removable path. The global readiness query uses a fixed domain registry and reports missing domain audits as blockers rather than assuming readiness.

**Tech Stack:** TypeScript 5, Convex 1.32, Vitest 4, TypeScript compiler API, pnpm

## Global Constraints

- Production contraction never occurs in the same deployment that stops the final legacy read or write.
- All migrations are internal-only, idempotent, resumable, cursor-bounded, and preceded by a completed dry-run of the same key and version.
- A migration never guesses between conflicting non-empty sources.
- All child rows carry `organizationId` even when the parent implies it, so tenant invariants can be indexed and audited.
- Historical payroll, payslip, correction, settlement, accounting, and document snapshots are not rewritten merely to make the schema look uniform.
- Secrets, compensation values, bank account details, tokens, PINs, document bodies, and message bodies never appear in migration issues or logs.
- A field is physically removed only after zero production reads, zero writes, zero non-empty legacy values, complete destination equality, and a current backup or export.
- This plan is additive and must not remove or clear any production field, row, validator, or index.

---

### Task 1: Parse the complete schema source inventory

**Files:**

- Create: `apps/app/tests/helpers/schema-source-inventory.ts`
- Create: `apps/app/tests/schema-inventory-coverage.test.ts`

**Interfaces:**

- Produces `parseSchemaSourceInventory(source: string): SchemaSourceInventory`.
- Produces `SchemaSourceInventory = { tables: Array<{ name: string; fields: string[]; indexes: string[] }> }`.
- Field paths use dot notation for nested `v.object` properties and keep the parent path for scalar, union, and array leaves.
- Consumes only source text and the TypeScript compiler API; it never imports or evaluates the Convex schema.

- [ ] **Step 1: Write the failing inventory parser tests**

Create fixtures inside `schema-inventory-coverage.test.ts` proving the parser handles `v.optional`, `v.array`, nested `v.object`, object alternatives inside `v.union`, and chained indexes:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSchemaSourceInventory } from "./helpers/schema-source-inventory";

describe("schema source inventory", () => {
  it("collects nested field paths and chained indexes", () => {
    const source = `
      export default defineSchema({
        examples: defineTable({
          organizationId: v.id("organizations"),
          policy: v.optional(v.object({ enabled: v.boolean() })),
          variants: v.union(v.string(), v.object({ legacy: v.string() })),
        }).index("by_organization", ["organizationId"]),
      });
    `;
    expect(parseSchemaSourceInventory(source)).toEqual({
      tables: [
        {
          name: "examples",
          fields: [
            "organizationId",
            "policy.enabled",
            "variants",
            "variants.legacy",
          ],
          indexes: ["by_organization"],
        },
      ],
    });
  });

  it("finds all current Convex tables", () => {
    const schemaPath = fileURLToPath(
      new URL("../convex/schema.ts", import.meta.url),
    );
    const inventory = parseSchemaSourceInventory(
      readFileSync(schemaPath, "utf8"),
    );
    expect(inventory.tables).toHaveLength(44);
    expect(inventory.tables.map(({ name }) => name)).toContain("assets");
  });
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```bash
pnpm --filter app test -- tests/schema-inventory-coverage.test.ts
```

Expected: FAIL because `tests/helpers/schema-source-inventory.ts` does not exist.

- [ ] **Step 3: Implement the TypeScript AST parser**

Create `schema-source-inventory.ts` with these exported types and traversal boundaries:

```ts
import ts from "typescript";

export type SchemaSourceTable = {
  name: string;
  fields: string[];
  indexes: string[];
};

export type SchemaSourceInventory = { tables: SchemaSourceTable[] };

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function calledName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function collectValidatorPaths(
  expression: ts.Expression,
  path: string,
  paths: Set<string>,
): void {
  if (!ts.isCallExpression(expression)) {
    paths.add(path);
    return;
  }
  const name = calledName(expression.expression);
  if (
    name === "object" &&
    ts.isObjectLiteralExpression(expression.arguments[0])
  ) {
    for (const property of expression.arguments[0].properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const child = propertyName(property.name);
      if (child)
        collectValidatorPaths(property.initializer, `${path}.${child}`, paths);
    }
    return;
  }
  if (name === "optional" || name === "array") {
    const inner = expression.arguments[0];
    if (inner) collectValidatorPaths(inner, path, paths);
    else paths.add(path);
    return;
  }
  if (name === "union") {
    paths.add(path);
    for (const variant of expression.arguments) {
      if (
        ts.isCallExpression(variant) &&
        calledName(variant.expression) === "object"
      ) {
        collectValidatorPaths(variant, path, paths);
      }
    }
    return;
  }
  paths.add(path);
}
```

Add a visitor that recognizes property assignments whose initializer call chain contains `defineTable`, reads the first `defineTable` object argument, walks chained `.index("name", ...)` calls, sorts fields/indexes, and returns tables in source order. Reject duplicate table names and indexes with an error rather than silently collapsing them.

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run:

```bash
pnpm --filter app test -- tests/schema-inventory-coverage.test.ts
```

Expected: both tests pass and the real schema count is 44.

- [ ] **Step 5: Commit the source inventory parser**

```bash
git add apps/app/tests/helpers/schema-source-inventory.ts apps/app/tests/schema-inventory-coverage.test.ts
git commit -m "test: inventory complete Convex schema source"
```

### Task 2: Classify every current table, field, and index

**Files:**

- Create: `apps/app/convex/fullSchemaInventory.ts`
- Modify: `apps/app/convex/schemaFieldManifest.ts`
- Modify: `apps/app/tests/schema-inventory-coverage.test.ts`

**Interfaces:**

- Produces `FULL_SCHEMA_TABLE_POLICIES`, keyed by all 44 current table names.
- Produces `FULL_SCHEMA_FIELD_OVERRIDES`, containing every non-default or migration-sensitive field path.
- Produces `resolveSchemaFieldPolicy(table, field)` and `resolveSchemaIndexPolicy(table, index)`.
- Existing `ORGANIZATION_CONFIGURATION_FIELD_MANIFEST` remains exported for the deployed Release 2 audit response.

- [ ] **Step 1: Add failing full-coverage policy tests**

Extend `schema-inventory-coverage.test.ts`:

```ts
import {
  FULL_SCHEMA_TABLE_POLICIES,
  resolveSchemaFieldPolicy,
  resolveSchemaIndexPolicy,
} from "../convex/fullSchemaInventory";

it("classifies every current table, field, and index", () => {
  const schemaPath = fileURLToPath(
    new URL("../convex/schema.ts", import.meta.url),
  );
  const inventory = parseSchemaSourceInventory(
    readFileSync(schemaPath, "utf8"),
  );
  expect(Object.keys(FULL_SCHEMA_TABLE_POLICIES).sort()).toEqual(
    inventory.tables.map(({ name }) => name).sort(),
  );
  for (const table of inventory.tables) {
    for (const field of table.fields) {
      expect(resolveSchemaFieldPolicy(table.name, field)).not.toBeNull();
    }
    for (const index of table.indexes) {
      expect(resolveSchemaIndexPolicy(table.name, index)).not.toBeNull();
    }
  }
});

it("overrides every known compatibility and historical path", () => {
  expect(
    resolveSchemaFieldPolicy("users", "organizationId")?.classification,
  ).toBe("compatibility_read");
  expect(resolveSchemaFieldPolicy("employees", "requirements")?.target).toBe(
    "employeeRequirements",
  );
  expect(resolveSchemaFieldPolicy("messages", "readBy")?.target).toBe(
    "messageReceipts",
  );
  expect(
    resolveSchemaFieldPolicy("payslips", "employeeSnapshot")?.classification,
  ).toBe("historical_snapshot");
});
```

- [ ] **Step 2: Run coverage tests and verify RED**

Run:

```bash
pnpm --filter app test -- tests/schema-inventory-coverage.test.ts
```

Expected: FAIL because `convex/fullSchemaInventory.ts` does not exist.

- [ ] **Step 3: Implement the Convex-safe policy types and all-table map**

Create `fullSchemaInventory.ts` with:

```ts
export type SchemaItemClassification =
  | "canonical_row"
  | "canonical_embedded"
  | "normalized_target"
  | "compatibility_read"
  | "compatibility_write"
  | "historical_snapshot"
  | "migration_only"
  | "removable";

export type SchemaTablePolicy = {
  domain: FullSchemaCleanupDomain;
  disposition: "retain" | "normalize_children" | "contract_legacy";
  defaultFieldClassification: SchemaItemClassification;
  defaultIndexClassification: "retain" | "verify_usage" | "remove_after_gate";
  releaseGate: string;
};

export const CURRENT_SCHEMA_TABLES = [
  "organizations",
  "organizationPayrollSettings",
  "organizationAttendanceSettings",
  "organizationDepartments",
  "organizationRequirementDefinitions",
  "migrationRuns",
  "migrationIssues",
  "migrationAudits",
  "demoRequests",
  "users",
  "userOrganizations",
  "storageUploadIntents",
  "storageObjects",
  "notifications",
  "employees",
  "payslipPinResets",
  "payslipPinAttempts",
  "employeeScheduleHistory",
  "attendance",
  "shifts",
  "holidays",
  "payrollRuns",
  "finalSettlements",
  "payslips",
  "payslipCorrections",
  "evaluationTemplates",
  "evaluations",
  "leaveRequests",
  "leaveTypes",
  "jobs",
  "applicants",
  "memoTemplates",
  "memos",
  "announcementComments",
  "announcementLastSeen",
  "settings",
  "conversations",
  "messages",
  "userChatPreferences",
  "invitations",
  "documents",
  "documentVersions",
  "accountingCostItems",
  "assets",
] as const;

export type CurrentSchemaTable = (typeof CURRENT_SCHEMA_TABLES)[number];
```

Define `FULL_SCHEMA_TABLE_POLICIES` with one property for each tuple member. Use the exact domain/disposition matrix from `docs/superpowers/specs/2026-08-12-convex-full-schema-cleanup-design.md`. Cohesive row tables default to `canonical_row`; aggregate-heavy tables default to `canonical_embedded`; migration tables default to `migration_only`. Every current index defaults to `verify_usage` until a later production/static report explicitly retains or removes it.

- [ ] **Step 4: Add exact field overrides and resolvers**

Add exact/prefix overrides for every path listed below as compatibility,
normalized target, historical, migration-only, or removable:

| Table                                                 | Field path or prefix                                                                                                                                                                                                                                                                                                                                                                                                                           | Classification        | Target/gate                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `organizations`                                       | `firstPayDate`, `secondPayDate`, `salaryPaymentFrequency`                                                                                                                                                                                                                                                                                                                                                                                      | `compatibility_read`  | matching `organizationPayrollSettings` fields / `release_3b_organization_contract`                    |
| `organizations`                                       | `defaultRequirements`                                                                                                                                                                                                                                                                                                                                                                                                                          | `compatibility_read`  | `organizationRequirementDefinitions` / `release_3b_organization_contract`                             |
| `users`                                               | `organizationId`, `role`, `employeeId`, `isActive`                                                                                                                                                                                                                                                                                                                                                                                             | `compatibility_read`  | `userOrganizations` / `release_3b_identity_contract`                                                  |
| `invitations`                                         | `token`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `compatibility_read`  | `invitations.tokenHash` / `release_3b_identity_contract`                                              |
| `employees`                                           | `compensation.paymentFrequency`                                                                                                                                                                                                                                                                                                                                                                                                                | `removable`           | count/export / `release_3b_employee_contract`                                                         |
| `employees`                                           | `compensation.bankDetails`                                                                                                                                                                                                                                                                                                                                                                                                                     | `compatibility_write` | `employeePaymentAccounts` / `release_3b_employee_contract`                                            |
| `employees`                                           | `schedule.scheduleOverrides`                                                                                                                                                                                                                                                                                                                                                                                                                   | `compatibility_write` | `employeeScheduleOverrides` / `release_3b_employee_contract`                                          |
| `employees`                                           | `leaveCredits`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `compatibility_read`  | `employeeLeaveBalances` / `release_3b_leave_contract`                                                 |
| `employees`                                           | `requirements`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `compatibility_write` | `employeeRequirements` / `release_3b_employee_contract`                                               |
| `employees`                                           | `deductions`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `compatibility_write` | `employeeDeductions` / `release_3b_employee_contract`                                                 |
| `employees`                                           | `incentives`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `compatibility_write` | `employeeIncentives` / `release_3b_employee_contract`                                                 |
| `employees`                                           | `customFields`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `compatibility_write` | `employeeCustomFieldValues` / `release_3b_employee_contract`                                          |
| `employees`                                           | `payslipPinHash`                                                                                                                                                                                                                                                                                                                                                                                                                               | `compatibility_read`  | `payslipCredentials` / `release_3b_credentials_contract`                                              |
| `employees`                                           | `payslipPdfPassword`                                                                                                                                                                                                                                                                                                                                                                                                                           | `removable`           | zero-value report / `release_3b_credentials_contract`                                                 |
| `attendance`                                          | `status`                                                                                                                                                                                                                                                                                                                                                                                                                                       | `compatibility_read`  | same field without legacy `leave` literal / `release_3b_attendance_contract`                          |
| `payrollRuns`                                         | `notes`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `compatibility_write` | `payrollRunNotes` / `release_3b_payroll_contract`                                                     |
| `payrollRuns`                                         | `draftConfig`, `draftDependencySnapshot`, `summarySnapshot`                                                                                                                                                                                                                                                                                                                                                                                    | `historical_snapshot` | preserve                                                                                              |
| `finalSettlements`                                    | `clearanceItems`, `loanPayoffs`, `customDeductions`, `bir2316`, `finalTaxRelease`                                                                                                                                                                                                                                                                                                                                                              | `historical_snapshot` | preserve                                                                                              |
| `payslips`                                            | `employeeSnapshot`, `deductions`, `incentives`, `nightDiffBreakdown`, `employerContributions`                                                                                                                                                                                                                                                                                                                                                  | `historical_snapshot` | preserve                                                                                              |
| `payslips`                                            | `grossPay`, `basicPay`, `nonTaxableAllowance`, `netPay`, `daysWorked`, `absences`, `lateHours`, `undertimeHours`, `overtimeHours`, `holidayPay`, `regularHolidayPay`, `specialHolidayPay`, `restDayPay`, `nightDiffPay`, `overtimeRegular`, `overtimeRestDay`, `overtimeRestDayExcess`, `overtimeSpecialHoliday`, `overtimeSpecialHolidayExcess`, `overtimeLegalHoliday`, `overtimeLegalHolidayExcess`, `pendingDeductions`, `noWorkNoPayDays` | `historical_snapshot` | preserve encrypted numeric variants                                                                   |
| `payslips`                                            | `editHistory`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `compatibility_read`  | `payslipCorrections` / `release_3b_payroll_contract`                                                  |
| `evaluations`                                         | `frequencyMonths`                                                                                                                                                                                                                                                                                                                                                                                                                              | `removable`           | count/export / `release_3b_workflow_contract`                                                         |
| `evaluations`                                         | `assignedReviewerIds`                                                                                                                                                                                                                                                                                                                                                                                                                          | `compatibility_write` | `evaluationReviewers` / `release_3b_workflow_contract`                                                |
| `evaluations`                                         | `history`                                                                                                                                                                                                                                                                                                                                                                                                                                      | `compatibility_write` | `evaluationEvents` / `release_3b_workflow_contract`                                                   |
| `settings`                                            | `cutoffDates`, `payrollSettings`                                                                                                                                                                                                                                                                                                                                                                                                               | `compatibility_write` | `organizationPayrollSettings` / `release_3b_organization_contract`                                    |
| `settings`                                            | `attendanceSettings`                                                                                                                                                                                                                                                                                                                                                                                                                           | `compatibility_write` | `organizationAttendanceSettings` / `release_3b_organization_contract`                                 |
| `settings`                                            | `departments`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `compatibility_write` | `organizationDepartments` / `release_3b_organization_contract`                                        |
| `settings`                                            | `payrollFrequency`, `taxTable`, `payrollSettings.payrollTabPassword`                                                                                                                                                                                                                                                                                                                                                                           | `removable`           | count/export / `release_3b_organization_contract`                                                     |
| `settings`                                            | `leaveTypes`, `proratedLeave`, `leaveAccrualFrequency`, `leaveTrackerMode`, `enableAnniversaryLeave`, `anniversaryLeaveMaxDays`, `maxConvertibleLeaveDays`, `annualSil`, `grantLeaveUponRegularization`, `paidLeaveRequiresRegularization`, `leaveGuidelines`, `leaveRequestFormTemplate`, `leaveRequestPdfLayout`                                                                                                                             | `compatibility_write` | `organizationLeaveSettings` and `leaveTypes` / `release_3b_leave_contract`                            |
| `settings`                                            | `leaveTrackerRows`, `leaveTrackerByYear`                                                                                                                                                                                                                                                                                                                                                                                                       | `compatibility_write` | `employeeLeaveBalances` / `release_3b_leave_contract`                                                 |
| `settings`                                            | `evaluationColumns`, `recruitmentTableColumns`, `requirementsTableColumns`, `leaveTableColumns`                                                                                                                                                                                                                                                                                                                                                | `compatibility_write` | `organizationUiSettings` / `release_3b_ui_contract`                                                   |
| `settings`                                            | `settingsVersion`, `settingsChangeLog`                                                                                                                                                                                                                                                                                                                                                                                                         | `compatibility_write` | `organizationSettingsEvents` / `release_3b_ui_contract`                                               |
| `applicants`                                          | `pipelineStageHistory`, `notes`, `interviewSchedules`, `scorecards`, `offerApproval`                                                                                                                                                                                                                                                                                                                                                           | `compatibility_write` | corresponding applicant event tables / `release_3b_workflow_contract`                                 |
| `applicants`                                          | `customFields`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `compatibility_write` | `applicantCustomFieldValues` / `release_3b_workflow_contract`                                         |
| `memos`                                               | `reactions`, `acknowledgedBy`, `specificEmployees`                                                                                                                                                                                                                                                                                                                                                                                             | `compatibility_write` | `memoReactions`, `memoAcknowledgements`, `memoAudienceMembers` / `release_3b_communications_contract` |
| `memos`                                               | `attachments`, `attachmentContentTypes`                                                                                                                                                                                                                                                                                                                                                                                                        | `compatibility_write` | `storageObjectLinks` / `release_3b_storage_contract`                                                  |
| `conversations`                                       | `participants`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `compatibility_write` | `conversationMembers` / `release_3b_communications_contract`                                          |
| `messages`                                            | `readBy`                                                                                                                                                                                                                                                                                                                                                                                                                                       | `compatibility_write` | `messageReceipts` / `release_3b_communications_contract`                                              |
| `messages`                                            | `attachments`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `compatibility_write` | `storageObjectLinks` / `release_3b_storage_contract`                                                  |
| `userChatPreferences`                                 | `pinnedConversations`                                                                                                                                                                                                                                                                                                                                                                                                                          | `compatibility_write` | `userPinnedConversations` / `release_3b_communications_contract`                                      |
| `leaveRequests`                                       | `supportingDocuments`                                                                                                                                                                                                                                                                                                                                                                                                                          | `compatibility_write` | `storageObjectLinks` / `release_3b_storage_contract`                                                  |
| `documents`                                           | `attachments`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `compatibility_write` | `storageObjectLinks` / `release_3b_storage_contract`                                                  |
| `documents`                                           | `sharedWith`, `visibleDepartments`, `visibleEmployeeIds`                                                                                                                                                                                                                                                                                                                                                                                       | `compatibility_write` | `documentAccessGrants` / `release_3b_documents_contract`                                              |
| `documentVersions`                                    | `title`, `content`                                                                                                                                                                                                                                                                                                                                                                                                                             | `historical_snapshot` | preserve                                                                                              |
| `accountingCostItems`                                 | `breakdown`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `historical_snapshot` | preserve                                                                                              |
| `accountingCostItems`                                 | `receipts`                                                                                                                                                                                                                                                                                                                                                                                                                                     | `compatibility_write` | `storageObjectLinks` / `release_3b_storage_contract`                                                  |
| `assets`                                              | `maintenanceHistory`                                                                                                                                                                                                                                                                                                                                                                                                                           | `compatibility_write` | `assetMaintenanceEvents` / `release_3b_assets_contract`                                               |
| `migrationRuns`, `migrationIssues`, `migrationAudits` | all fields                                                                                                                                                                                                                                                                                                                                                                                                                                     | `migration_only`      | retain through Release 3B evidence retention                                                          |

Then define the overrides with the shared shape shown here:

```ts
export const FULL_SCHEMA_FIELD_OVERRIDES = [
  {
    table: "users",
    field: "organizationId",
    classification: "compatibility_read",
    target: "userOrganizations.organizationId",
    releaseGate: "release_3b_identity_contract",
  },
  {
    table: "users",
    field: "role",
    classification: "compatibility_read",
    target: "userOrganizations.role",
    releaseGate: "release_3b_identity_contract",
  },
  {
    table: "users",
    field: "employeeId",
    classification: "compatibility_read",
    target: "userOrganizations.employeeId",
    releaseGate: "release_3b_identity_contract",
  },
  {
    table: "users",
    field: "isActive",
    classification: "compatibility_read",
    target: "userOrganizations.accessStatus",
    releaseGate: "release_3b_identity_contract",
  },
  {
    table: "employees",
    field: "requirements",
    classification: "compatibility_write",
    target: "employeeRequirements",
    releaseGate: "release_3b_employee_contract",
  },
  {
    table: "employees",
    field: "deductions",
    classification: "compatibility_write",
    target: "employeeDeductions",
    releaseGate: "release_3b_employee_contract",
  },
  {
    table: "employees",
    field: "incentives",
    classification: "compatibility_write",
    target: "employeeIncentives",
    releaseGate: "release_3b_employee_contract",
  },
  {
    table: "employees",
    field: "leaveCredits",
    classification: "compatibility_read",
    target: "employeeLeaveBalances",
    releaseGate: "release_3b_leave_contract",
  },
  {
    table: "messages",
    field: "readBy",
    classification: "compatibility_write",
    target: "messageReceipts",
    releaseGate: "release_3b_communications_contract",
  },
  {
    table: "payslips",
    field: "employeeSnapshot",
    classification: "historical_snapshot",
    releaseGate: "preserve",
  },
] as const;
```

Merge the existing organization-configuration entries into this override set without changing their exported audit shape. `resolveSchemaFieldPolicy` chooses the longest exact/prefix override and otherwise returns the owning table's default. `resolveSchemaIndexPolicy` returns the table default plus a later override when present. Return `null` for an unknown table so coverage tests fail closed.

- [ ] **Step 5: Run policy tests and verify GREEN**

Run:

```bash
pnpm --filter app test -- tests/schema-inventory-coverage.test.ts tests/database-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: all inventory/manifest tests and TypeScript pass; the existing Release 2 manifest export remains compatible.

- [ ] **Step 6: Commit the complete classification policy**

```bash
git add apps/app/convex/fullSchemaInventory.ts apps/app/convex/schemaFieldManifest.ts apps/app/tests/schema-inventory-coverage.test.ts apps/app/tests/database-migration-planner.test.ts
git commit -m "feat: classify complete Convex schema"
```

### Task 3: Add the fail-closed cleanup-domain registry

**Files:**

- Create: `apps/app/convex/fullSchemaCleanupRegistry.ts`
- Create: `apps/app/tests/full-schema-readiness.test.ts`

**Interfaces:**

- Produces `FullSchemaCleanupDomain` and `FULL_SCHEMA_CLEANUP_DOMAINS`.
- Produces `FullSchemaDomainReadiness` with explicit status and blocker codes.
- The organization-configuration entry points to the deployed Release 1 migration key/version; future entries begin as `not_started` requirements and are activated by their domain plans.

- [ ] **Step 1: Write failing registry completeness tests**

Create `full-schema-readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
} from "../convex/fullSchemaCleanupRegistry";
import { FULL_SCHEMA_TABLE_POLICIES } from "../convex/fullSchemaInventory";

it("assigns every table to a registered cleanup domain", () => {
  const registered = new Set(
    FULL_SCHEMA_CLEANUP_DOMAINS.map(({ domain }) => domain),
  );
  for (const policy of Object.values(FULL_SCHEMA_TABLE_POLICIES)) {
    expect(registered.has(policy.domain)).toBe(true);
  }
});

it("uses a stable full-schema program identity", () => {
  expect(FULL_SCHEMA_CLEANUP_PROGRAM_KEY).toBe("convex-full-schema-cleanup");
  expect(FULL_SCHEMA_CLEANUP_PROGRAM_VERSION).toBe(1);
});
```

- [ ] **Step 2: Run the registry test and verify RED**

Run:

```bash
pnpm --filter app test -- tests/full-schema-readiness.test.ts
```

Expected: FAIL because `fullSchemaCleanupRegistry.ts` does not exist.

- [ ] **Step 3: Implement the stable domain registry**

Create the module with these exact domain names and states:

```ts
export const FULL_SCHEMA_CLEANUP_PROGRAM_KEY =
  "convex-full-schema-cleanup" as const;
export const FULL_SCHEMA_CLEANUP_PROGRAM_VERSION = 1 as const;

export const FULL_SCHEMA_CLEANUP_DOMAINS = [
  {
    domain: "organization_configuration",
    migrationKey: "schema-normalization-release-1",
    migrationVersion: 1,
    implementation: "compatibility",
  },
  {
    domain: "identity_credentials",
    migrationKey: "full-schema-identity-credentials",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "leave_employee_children",
    migrationKey: "full-schema-leave-employee-children",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "workflow_events",
    migrationKey: "full-schema-workflow-events",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "communications_documents",
    migrationKey: "full-schema-communications-documents",
    migrationVersion: 1,
    implementation: "not_started",
  },
  {
    domain: "assets_payroll_compatibility",
    migrationKey: "full-schema-assets-payroll",
    migrationVersion: 1,
    implementation: "not_started",
  },
] as const;

export type FullSchemaCleanupDomain =
  (typeof FULL_SCHEMA_CLEANUP_DOMAINS)[number]["domain"];

export type FullSchemaDomainReadiness = {
  domain: FullSchemaCleanupDomain;
  status: "ready" | "not_started" | "running" | "failed" | "blocked" | "stale";
  migrationKey: string;
  migrationVersion: number;
  blockers: string[];
  auditId?: string;
  auditedAt?: number;
};
```

Keep the registry free of database access. Later domain plans change only their own `implementation` state after their migration/audit functions exist and have tests.

- [ ] **Step 4: Run registry and inventory tests**

```bash
pnpm --filter app test -- tests/full-schema-readiness.test.ts tests/schema-inventory-coverage.test.ts
```

Expected: both files pass and every table policy references a registered domain.

- [ ] **Step 5: Commit the cleanup registry**

```bash
git add apps/app/convex/fullSchemaCleanupRegistry.ts apps/app/tests/full-schema-readiness.test.ts
git commit -m "feat: register full schema cleanup domains"
```

### Task 4: Expose fail-closed global readiness and inventory queries

**Files:**

- Modify: `apps/app/convex/databaseMigrations.ts`
- Modify: `apps/app/tests/full-schema-readiness.test.ts`
- Regenerate: `apps/app/convex/_generated/api.d.ts`

**Interfaces:**

- Produces internal query `databaseMigrations:getFullSchemaInventory({})`.
- Produces internal query `databaseMigrations:getFullSchemaCleanupReadiness({})`.
- Global readiness is false until every registered domain has a completed, non-truncated, discrepancy-free audit for the required migration key/version.

- [ ] **Step 1: Write failing internal-query tests**

Use `makeFunctionReference` in `full-schema-readiness.test.ts`:

```ts
const getFullSchemaInventory = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    programKey: string;
    programVersion: number;
    currentTableCount: number;
    tables: Array<{ table: string; domain: string; disposition: string }>;
  }
>("databaseMigrations:getFullSchemaInventory");

const getFullSchemaCleanupReadiness = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    readyForRelease3: boolean;
    domains: Array<{ domain: string; status: string; blockers: string[] }>;
  }
>("databaseMigrations:getFullSchemaCleanupReadiness");

it("reports every table and blocks unimplemented domains", async () => {
  const t = convexTest(schema, modules);
  const inventory = await t.query(getFullSchemaInventory, {});
  expect(inventory.currentTableCount).toBe(44);
  expect(inventory.tables).toHaveLength(44);

  const readiness = await t.query(getFullSchemaCleanupReadiness, {});
  expect(readiness.readyForRelease3).toBe(false);
  expect(readiness.domains).toContainEqual(
    expect.objectContaining({
      domain: "identity_credentials",
      status: "not_started",
    }),
  );
});
```

Add a fixture with the completed organization-configuration write/audit and assert that domain is `ready` while the global result stays false because all other domains are not started.

- [ ] **Step 2: Run the readiness tests and verify RED**

Run:

```bash
pnpm --filter app test -- tests/full-schema-readiness.test.ts
```

Expected: FAIL because both internal queries are absent.

- [ ] **Step 3: Implement the inventory query**

Import `CURRENT_SCHEMA_TABLES`, `FULL_SCHEMA_TABLE_POLICIES`, and the registry. Return only policy metadata—never production row values:

```ts
export const getFullSchemaInventory = internalQuery({
  args: {},
  handler: async () => ({
    programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
    programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
    currentTableCount: CURRENT_SCHEMA_TABLES.length,
    tables: CURRENT_SCHEMA_TABLES.map((table) => ({
      table,
      ...FULL_SCHEMA_TABLE_POLICIES[table],
    })),
  }),
});
```

- [ ] **Step 4: Implement fail-closed readiness resolution**

For entries whose `implementation` is `not_started`, return that status and `blockers: ["DOMAIN_IMPLEMENTATION_NOT_DEPLOYED"]`. For `organization_configuration`, locate the latest completed conflict-free write run using `migrationRuns.by_key_started`, then the newest audit using `migrationAudits.by_run`. Reuse the same equality predicates as `getSchemaCleanupAudit`; return explicit blockers for missing run/audit, stale version, truncation, source conflicts, or destination discrepancies.

Return:

```ts
{
  programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  readyForRelease3: domains.every(({ status }) => status === "ready"),
  domains,
}
```

Do not infer readiness from an absent domain and do not select an arbitrary duplicate audit.

- [ ] **Step 5: Run focused and migration regression tests**

```bash
pnpm --filter app test -- tests/full-schema-readiness.test.ts tests/data-migrations.test.ts tests/database-migration-planner.test.ts
pnpm --filter app exec tsc --noEmit --pretty false
```

Expected: readiness, migration, and TypeScript checks pass; existing Release 1/2 status commands retain their response shapes.

- [ ] **Step 6: Regenerate Convex bindings**

```bash
pnpm --dir apps/app exec convex codegen --typecheck disable
```

Expected: `_generated/api.d.ts` includes both new internal queries and production data is unchanged.

- [ ] **Step 7: Commit global readiness**

```bash
git add apps/app/convex/databaseMigrations.ts apps/app/convex/_generated/api.d.ts apps/app/tests/full-schema-readiness.test.ts
git commit -m "feat: report full schema cleanup readiness"
```

### Task 5: Add static legacy-reference evidence

**Files:**

- Create: `apps/app/tests/helpers/schema-reference-scan.ts`
- Create: `apps/app/tests/schema-contract-references.test.ts`
- Modify: `apps/app/package.json`

**Interfaces:**

- Produces `scanSchemaReferences(root, symbols, exclusions): SchemaReferenceMatch[]`.
- A match contains only `symbol`, repository-relative `file`, and `line`; it never contains source-line content.
- The baseline report proves every compatibility/removable policy has a scan symbol. Release 3 changes the same test to enforce zero live references.

- [ ] **Step 1: Write failing redaction and coverage tests**

Create a temporary fixture directory using Vitest's test context or `mkdtempSync`, then assert:

```ts
expect(scanSchemaReferences(root, ["payrollTabPassword"], [])).toEqual([
  { symbol: "payrollTabPassword", file: "convex/settings.ts", line: 2 },
]);
expect(
  JSON.stringify(scanSchemaReferences(root, ["payrollTabPassword"], [])),
).not.toContain("super-secret-value");
```

For the repository scan, build symbols from every `compatibility_read`, `compatibility_write`, and `removable` override. Exclude `schema.ts`, manifest/policy modules, migrations, generated files, tests, and documentation. Assert every policy has a non-empty symbol and the scanner completes deterministically.

- [ ] **Step 2: Run the reference tests and verify RED**

```bash
pnpm --filter app test -- tests/schema-contract-references.test.ts
```

Expected: FAIL because the scanner helper is absent.

- [ ] **Step 3: Implement the redacted source scanner**

Use `readdirSync`, `readFileSync`, and recursive directory traversal limited to `apps/app/app`, `apps/app/components`, `apps/app/convex`, `apps/app/lib`, and `apps/app/utils`. Match symbols by escaped word/dotted-path segments, calculate line numbers from newline offsets, deduplicate `{symbol,file,line}`, sort results, and never retain the matching line content.

Export:

```ts
export type SchemaReferenceMatch = {
  symbol: string;
  file: string;
  line: number;
};

export function scanSchemaReferences(
  root: string,
  symbols: readonly string[],
  exclusions: readonly RegExp[],
): SchemaReferenceMatch[];
```

- [ ] **Step 4: Add the repeatable package command**

Add to `apps/app/package.json`:

```json
"schema:inventory": "vitest run tests/schema-inventory-coverage.test.ts tests/schema-contract-references.test.ts tests/full-schema-readiness.test.ts"
```

- [ ] **Step 5: Run inventory and reference evidence tests**

```bash
pnpm --filter app schema:inventory
```

Expected: tests pass. Current legacy references are reported as evidence but do not fail the Release 1B expansion. The Release 3 plan will change the expected count to zero for contracted domains.

- [ ] **Step 6: Commit static contract evidence**

```bash
git add apps/app/tests/helpers/schema-reference-scan.ts apps/app/tests/schema-contract-references.test.ts apps/app/package.json
git commit -m "test: report legacy schema references"
```

### Task 6: Document and verify the Release 1B inventory checkpoint

**Files:**

- Create: `docs/runbooks/full-schema-cleanup-release-1b.md`
- Modify: `docs/superpowers/plans/2026-08-12-convex-full-schema-manifest-readiness.md`

**Interfaces:**

- Documents deployment, inventory/readiness commands, expected blockers, rollback, and the next identity-domain plan.
- Release 1B performs no backfill, clearing, or contraction.

- [ ] **Step 1: Write the operator runbook**

Document these exact production commands:

```bash
pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaInventory \
  '{}'

pnpm --filter app exec convex run --prod \
  databaseMigrations:getFullSchemaCleanupReadiness \
  '{}'
```

The runbook must require `currentTableCount: 44`, exactly one row per current table policy, organization configuration `status: "ready"`, all undeployed domains `status: "not_started"`, and `readyForRelease3: false`. Explain that false is the correct safe result until every domain wave is deployed and audited. Rollback is application redeployment only because this checkpoint changes no production rows.

- [ ] **Step 2: Run full verification**

```bash
pnpm --filter app schema:inventory
pnpm --filter app test
pnpm --filter app exec tsc --noEmit --pretty false
pnpm --filter app exec eslint convex/fullSchemaInventory.ts convex/fullSchemaCleanupRegistry.ts convex/databaseMigrations.ts tests/schema-inventory-coverage.test.ts tests/full-schema-readiness.test.ts tests/schema-contract-references.test.ts
pnpm audit --prod --audit-level moderate
pnpm exec prettier --check docs/runbooks/full-schema-cleanup-release-1b.md docs/superpowers/plans/2026-08-12-convex-full-schema-manifest-readiness.md
git diff --check
pnpm --filter app exec next build --webpack
```

Expected: inventory, all application tests, TypeScript, focused lint, dependency audit, formatting, diff hygiene, and production build pass.

- [ ] **Step 3: Review checkpoint invariants**

Confirm the implementation:

- inventories exactly 44 current tables;
- fails when a new table/field/index has no resolvable policy;
- preserves the deployed organization audit API;
- reports all undeployed domains as blockers;
- exposes no production row values or secrets;
- makes no schema contraction or data mutation;
- leaves Release 3 readiness false.

- [ ] **Step 4: Commit the Release 1B checkpoint**

```bash
git add docs/runbooks/full-schema-cleanup-release-1b.md docs/superpowers/plans/2026-08-12-convex-full-schema-manifest-readiness.md
git commit -m "docs: add full schema cleanup release 1b runbook"
```

## Completion boundary

This plan is complete when all current schema items resolve to a policy, the internal inventory query reports 44 tables, and global readiness accurately recognizes the deployed organization-configuration audit while blocking every undeployed domain. It intentionally creates no target business tables and changes no production data. The next plan is the identity, membership, credentials, and invitation Release 1B migration.
