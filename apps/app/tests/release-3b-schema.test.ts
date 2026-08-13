import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseSchemaSourceInventory,
  type SchemaSourceTable,
} from "./helpers/schema-source-inventory";

const schemaSource = readFileSync(
  fileURLToPath(new URL("../convex/schema.ts", import.meta.url)),
  "utf8",
);
const inventory = parseSchemaSourceInventory(schemaSource);
const tables = new Map<string, SchemaSourceTable>(
  inventory.tables.map((table) => [table.name, table]),
);

const removedFields: Record<string, string[]> = {
  accountingCostItems: ["receipts"],
  applicants: [
    "customFields",
    "interviewSchedules",
    "notes",
    "offerApproval",
    "pipelineStageHistory",
    "scorecards",
  ],
  assets: [
    "assignedAt",
    "assignedBy",
    "assignedEmployeeId",
    "custodyAcknowledgedAt",
    "maintenanceHistory",
    "returnedAt",
    "returnDueDate",
  ],
  conversations: ["participants"],
  documents: [
    "attachments",
    "sharedWith",
    "visibleDepartments",
    "visibleEmployeeIds",
  ],
  employees: [
    "compensation.bankDetails",
    "compensation.paymentFrequency",
    "customFields",
    "deductions",
    "incentives",
    "leaveCredits",
    "payslipPdfPassword",
    "payslipPinHash",
    "requirements",
    "schedule.scheduleOverrides",
  ],
  evaluations: ["assignedReviewerIds", "frequencyMonths", "history"],
  invitations: ["token"],
  leaveRequests: ["supportingDocuments"],
  memos: [
    "acknowledgedBy",
    "attachmentContentTypes",
    "attachments",
    "departments",
    "reactions",
    "specificEmployees",
  ],
  messages: ["attachments", "readBy"],
  organizations: [
    "defaultRequirements",
    "firstPayDate",
    "salaryPaymentFrequency",
    "secondPayDate",
  ],
  payrollRuns: ["notes"],
  payslips: ["editHistory"],
  settings: [
    "attendanceSettings",
    "cutoffDates",
    "departments",
    "leaveTypes",
    "payrollSettings",
  ],
  userChatPreferences: ["pinnedConversations"],
  users: ["employeeId", "isActive", "organizationId", "role"],
};

describe("Release 3B physical schema contract", () => {
  it("does not expose any approved legacy field or index", () => {
    for (const [tableName, fields] of Object.entries(removedFields)) {
      const table = tables.get(tableName);
      expect(table, `missing table ${tableName}`).toBeDefined();
      for (const field of fields) {
        expect(table?.fields, `${tableName}.${field}`).not.toContain(field);
      }
    }

    expect(tables.get("users")?.indexes).not.toEqual(
      expect.arrayContaining(["by_employee", "by_organization"]),
    );
    expect(tables.get("conversations")?.indexes).not.toContain("by_participant");
    expect(tables.get("invitations")?.indexes).not.toContain("by_token");
  });

  it("preserves immutable payroll and payslip snapshots", () => {
    const payrollRunFields = tables.get("payrollRuns")?.fields ?? [];
    const payslipFields = tables.get("payslips")?.fields ?? [];
    for (const snapshot of [
      "draftConfig",
      "draftDependencySnapshot",
      "summarySnapshot",
    ]) {
      expect(
        payrollRunFields.some(
          (field) => field === snapshot || field.startsWith(`${snapshot}.`),
        ),
      ).toBe(true);
    }
    expect(
      payslipFields.some(
        (field) =>
          field === "employeeSnapshot" || field.startsWith("employeeSnapshot."),
      ),
    ).toBe(true);
  });
});
