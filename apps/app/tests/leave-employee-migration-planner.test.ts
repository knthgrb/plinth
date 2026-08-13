import { describe, expect, it } from "vitest";
import {
  LEAVE_EMPLOYEE_MIGRATION_KEY,
  LEAVE_EMPLOYEE_MIGRATION_VERSION,
  buildCustomFieldProjection,
  normalizeMigrationSourceKey,
  planLeaveBalance,
  planUniqueProjection,
  reconcileLeaveCreditUsage,
} from "../convex/leaveEmployeeMigrationPlanner";

describe("leave and employee migration planner", () => {
  it("uses the registered migration identity", () => {
    expect(LEAVE_EMPLOYEE_MIGRATION_KEY).toBe(
      "full-schema-leave-employee-children",
    );
    expect(LEAVE_EMPLOYEE_MIGRATION_VERSION).toBe(1);
  });

  it("normalizes natural keys deterministically", () => {
    expect(normalizeMigrationSourceKey("  BIR  2316 / 2026 ")).toBe(
      "bir-2316-2026",
    );
    expect(normalizeMigrationSourceKey("***")).toBe("unnamed");
  });

  it("creates, preserves, and rejects unique projections without overwriting", () => {
    const expected = {
      organizationId: "organization-1",
      employeeId: "employee-1",
      sourceId: "loan-1",
      amount: 1_000,
    };

    expect(
      planUniqueProjection({
        expected,
        destinations: [],
        mismatchCode: "DEDUCTION_MISMATCH",
        duplicateCode: "DUPLICATE_DEDUCTION",
        field: "sourceId",
      }),
    ).toEqual({ outcome: "create", value: expected });
    expect(
      planUniqueProjection({
        expected,
        destinations: [{ ...expected }],
        mismatchCode: "DEDUCTION_MISMATCH",
        duplicateCode: "DUPLICATE_DEDUCTION",
        field: "sourceId",
      }),
    ).toEqual({ outcome: "unchanged" });
    expect(
      planUniqueProjection({
        expected,
        destinations: [{ ...expected, amount: 900 }],
        mismatchCode: "DEDUCTION_MISMATCH",
        duplicateCode: "DUPLICATE_DEDUCTION",
        field: "sourceId",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "DEDUCTION_MISMATCH", field: "sourceId" }],
    });
    expect(
      planUniqueProjection({
        expected,
        destinations: [expected, expected],
        mismatchCode: "DEDUCTION_MISMATCH",
        duplicateCode: "DUPLICATE_DEDUCTION",
        field: "sourceId",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "DUPLICATE_DEDUCTION", field: "sourceId" }],
    });
  });

  it("compares objects independently of property insertion order", () => {
    expect(
      planUniqueProjection({
        expected: { sourceId: "bonus-1", amount: 500 },
        destinations: [{ amount: 500, sourceId: "bonus-1" }],
        mismatchCode: "INCENTIVE_MISMATCH",
        duplicateCode: "DUPLICATE_INCENTIVE",
        field: "sourceId",
      }),
    ).toEqual({ outcome: "unchanged" });
  });

  it("reports leave usage disagreement instead of changing source totals", () => {
    const expected = {
      organizationId: "organization-1",
      employeeId: "employee-1",
      year: 2026,
      leaveTypeKey: "vacation",
      total: 8,
      used: 2,
      balance: 6,
      source: "employee_credits" as const,
      approvedDays: 3,
      reconciliationStatus: "mismatched" as const,
      migrationVersion: 1,
    };

    expect(
      planLeaveBalance({ expected, destinations: [], reconcileUsage: true }),
    ).toEqual({
      outcome: "conflict",
      issues: [
        {
          code: "LEAVE_BALANCE_RECONCILIATION_MISMATCH",
          field: "used",
        },
      ],
    });
    expect(expected.used).toBe(2);
    expect(expected.approvedDays).toBe(3);
  });

  it("creates a matching or non-applicable leave balance projection", () => {
    const matching = {
      organizationId: "organization-1",
      employeeId: "employee-1",
      year: 2026,
      leaveTypeKey: "sick",
      total: 5,
      used: 1,
      balance: 4,
      source: "employee_credits" as const,
      approvedDays: 1,
      reconciliationStatus: "matching" as const,
      migrationVersion: 1,
    };
    const tracker = {
      ...matching,
      leaveTypeKey: "general",
      source: "yearly_tracker" as const,
      approvedDays: 0,
      reconciliationStatus: "not_applicable" as const,
    };

    expect(
      planLeaveBalance({
        expected: matching,
        destinations: [],
        reconcileUsage: true,
      }),
    ).toEqual({ outcome: "create", value: matching });
    expect(
      planLeaveBalance({
        expected: tracker,
        destinations: [],
        reconcileUsage: false,
      }),
    ).toEqual({ outcome: "create", value: tracker });
  });

  it("reconciles a general leave pool against combined vacation and sick usage", () => {
    const generalKey = normalizeMigrationSourceKey("__plinth_general_leave__");

    expect(
      reconcileLeaveCreditUsage({
        mode: "general",
        credits: [
          { key: "vacation", used: 2 },
          { key: "sick", used: 1 },
        ],
        approvedDays: new Map([
          [generalKey, 2],
          ["vacation", 1],
        ]),
        generalKey,
      }),
    ).toEqual([]);
    expect(
      reconcileLeaveCreditUsage({
        mode: "general",
        credits: [
          { key: "vacation", used: 2 },
          { key: "sick", used: 1 },
        ],
        approvedDays: new Map([[generalKey, 2]]),
        generalKey,
      }),
    ).toEqual([
      {
        code: "LEAVE_BALANCE_RECONCILIATION_MISMATCH",
        field: "used",
      },
    ]);
  });

  it("still reconciles custom credits individually in general mode", () => {
    expect(
      reconcileLeaveCreditUsage({
        mode: "general",
        credits: [
          { key: "vacation", used: 0 },
          { key: "sick", used: 0 },
          { key: "bereavement", used: 1 },
        ],
        approvedDays: new Map([["bereavement", 0]]),
        generalKey: normalizeMigrationSourceKey("__plinth_general_leave__"),
      }),
    ).toEqual([
      {
        code: "LEAVE_BALANCE_RECONCILIATION_MISMATCH",
        field: "used",
      },
    ]);
  });

  it.each([
    ["text", "hello", "string", '"hello"'],
    ["count", 3, "number", "3"],
    ["enabled", true, "boolean", "true"],
    ["empty", null, "null", "null"],
    ["tags", ["one", "two"], "array", '["one","two"]'],
    ["profile", { level: 2 }, "object", '{"level":2}'],
  ] as const)(
    "serializes custom field %s without logging its value",
    (sourceKey, value, valueType, valueJson) => {
      expect(buildCustomFieldProjection(sourceKey, value)).toEqual({
        sourceKey,
        label: sourceKey,
        valueType,
        valueJson,
      });
    },
  );

  it("rejects unsupported custom field values", () => {
    expect(() => buildCustomFieldProjection("missing", undefined)).toThrow(
      "Unsupported custom field value",
    );
  });
});
