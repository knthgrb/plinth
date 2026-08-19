import { describe, expect, it } from "vitest";

import { filterPayslipsByMonth } from "../lib/employee-payslip-history";

describe("employee payslip history", () => {
  const payslips = [
    { id: "may-first", createdAt: new Date(2026, 4, 15).getTime() },
    { id: "june-first", createdAt: new Date(2026, 5, 15).getTime() },
    { id: "june-second", createdAt: new Date(2026, 5, 30).getTime() },
  ];

  it("filters payslips using only the selected month", () => {
    expect(filterPayslipsByMonth(payslips, "2026-06")).toEqual([
      payslips[1],
      payslips[2],
    ]);
  });

  it("returns every payslip when no month is selected", () => {
    expect(filterPayslipsByMonth(payslips, "")).toEqual(payslips);
  });
});
