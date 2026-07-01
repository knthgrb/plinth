import { describe, expect, it } from "vitest";
import {
  getActivePayrollEmployeeIds,
  getActivePayrollEmployees,
  getFinalPayEligibleEmployeeIds,
  getFinalPayEligibleEmployees,
} from "@/utils/payroll-employee-filters";

describe("payroll employee filters", () => {
  const employees = [
    { _id: "active-a", employment: { status: "active" } },
    { _id: "resigned-a", employment: { status: "resigned" } },
    { _id: "terminated-a", employment: { status: "terminated" } },
    { _id: "inactive-a", employment: { status: "inactive" } },
    { _id: "active-b", employment: { status: "active" } },
    { _id: "missing-status", employment: {} },
  ];

  it("keeps only active employees for payroll special tabs", () => {
    expect(getActivePayrollEmployees(employees).map((e) => e._id)).toEqual([
      "active-a",
      "active-b",
    ]);
  });

  it("returns active employee ids for compute queries and runs", () => {
    expect(getActivePayrollEmployeeIds(employees)).toEqual([
      "active-a",
      "active-b",
    ]);
  });

  it("returns separated employees for final pay runs", () => {
    expect(getFinalPayEligibleEmployees(employees).map((e) => e._id)).toEqual([
      "resigned-a",
      "terminated-a",
    ]);
    expect(getFinalPayEligibleEmployeeIds(employees)).toEqual([
      "resigned-a",
      "terminated-a",
    ]);
  });
});
