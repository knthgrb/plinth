import { describe, expect, it } from "vitest";
import {
  getActivePayrollEmployeeIds,
  getActivePayrollEmployees,
} from "@/utils/payroll-employee-filters";

describe("payroll employee filters", () => {
  const employees = [
    { _id: "active-a", employment: { status: "active" } },
    { _id: "resigned-a", employment: { status: "resigned" } },
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
});
