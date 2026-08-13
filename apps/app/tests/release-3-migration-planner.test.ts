import { describe, expect, it } from "vitest";
import { planRelease3ContractCleanup } from "../convex/release3MigrationPlanner";

describe("Release 3 contract cleanup planner", () => {
  it("unsets top-level and nested legacy projections without exposing values", () => {
    const plan = planRelease3ContractCleanup("employees", {
      personalInfo: { firstName: "Ada" },
      compensation: {
        salary: 100_000,
        paymentFrequency: "monthly",
        bankDetails: { accountNumber: "secret" },
      },
      schedule: { workDays: ["monday"], scheduleOverrides: [] },
      leaveCredits: { vacation: { total: 1, used: 0, balance: 1 } },
    });

    expect(plan.outcome).toBe("change");
    expect(plan.changedFields).toEqual([
      "compensation.paymentFrequency",
      "compensation.bankDetails",
      "schedule.scheduleOverrides",
      "leaveCredits",
    ]);
    expect(plan.patch).toEqual({
      compensation: { salary: 100_000 },
      schedule: { workDays: ["monday"] },
      leaveCredits: undefined,
    });
    expect(JSON.stringify(plan)).not.toContain("secret");
  });

  it("is idempotent and preserves immutable snapshots", () => {
    const plan = planRelease3ContractCleanup("payrollRuns", {
      draftConfig: { employeeIds: ["employee"] },
      summarySnapshot: { totalNetPay: 42 },
    });
    expect(plan).toEqual({ outcome: "unchanged", patch: {}, changedFields: [], issues: [] });
  });

  it("reports malformed nested parents by field name only", () => {
    const plan = planRelease3ContractCleanup("employees", {
      compensation: "encrypted",
    });
    expect(plan).toEqual({
      outcome: "conflict",
      patch: {},
      changedFields: [],
      issues: [{ code: "MALFORMED_NESTED_PARENT", field: "compensation" }],
    });
  });
});
