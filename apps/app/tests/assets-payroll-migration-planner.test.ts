import { describe, expect, it } from "vitest";
import {
  ASSETS_PAYROLL_MIGRATION_KEY,
  ASSETS_PAYROLL_MIGRATION_VERSION,
  buildAssetCustodyEvents,
  planAssetsPayrollProjection,
} from "../convex/assetsPayrollMigrationPlanner";

describe("assets and payroll migration planner", () => {
  it("uses the registered migration identity", () => {
    expect(ASSETS_PAYROLL_MIGRATION_KEY).toBe("full-schema-assets-payroll");
    expect(ASSETS_PAYROLL_MIGRATION_VERSION).toBe(1);
  });

  it("creates, preserves, and rejects conflicting projections", () => {
    const expected = { payrollRunId: "run-1", sourceIndex: 0, note: "ok" };
    const options = {
      expected,
      duplicateCode: "DUPLICATE_PAYROLL_NOTE" as const,
      mismatchCode: "PAYROLL_NOTE_MISMATCH" as const,
      field: "notes",
    };
    expect(planAssetsPayrollProjection({ ...options, destinations: [] })).toEqual(
      { outcome: "create", value: expected },
    );
    expect(
      planAssetsPayrollProjection({
        ...options,
        destinations: [{ ...expected, createdAt: 1, updatedAt: 2 }],
      }),
    ).toEqual({ outcome: "unchanged" });
    expect(
      planAssetsPayrollProjection({
        ...options,
        destinations: [{ ...expected, note: "changed" }],
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "PAYROLL_NOTE_MISMATCH", field: "notes" }],
    });
  });

  it("projects deterministic custody events", () => {
    expect(
      buildAssetCustodyEvents({
        assignedEmployeeId: "employee-1",
        assignedAt: 10,
        assignedBy: "user-1",
        custodyAcknowledgedAt: 20,
        returnDueDate: 30,
        returnedAt: 40,
      }),
    ).toEqual({
      outcome: "valid",
      events: [
        {
          sourceIndex: 0,
          eventType: "assigned",
          employeeId: "employee-1",
          actorUserId: "user-1",
          occurredAt: 10,
          returnDueDate: 30,
        },
        {
          sourceIndex: 1,
          eventType: "acknowledged",
          employeeId: "employee-1",
          occurredAt: 20,
        },
        {
          sourceIndex: 2,
          eventType: "returned",
          employeeId: "employee-1",
          occurredAt: 40,
        },
      ],
    });
  });

  it("rejects incomplete custody state rather than inventing data", () => {
    expect(
      buildAssetCustodyEvents({ assignedEmployeeId: "employee-1" }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "INVALID_ASSET_CUSTODY_STATE", field: "custody" }],
    });
    expect(buildAssetCustodyEvents({ custodyAcknowledgedAt: 20 })).toEqual({
      outcome: "conflict",
      issues: [{ code: "INVALID_ASSET_CUSTODY_STATE", field: "custody" }],
    });
  });
});
