import { describe, expect, it } from "vitest";

import {
  getSSSContribution,
  getSSSContributionByEmployeeDeduction,
} from "@/convex/sss";

describe("sss contributions", () => {
  it("maps monthly basic pay to the 2025 SSS bracket", () => {
    const contribution = getSSSContribution(18_000);

    expect(contribution.employeeShare).toBe(900);
    expect(contribution.employerShare).toBe(1830);
    expect(contribution.total).toBe(2730);
    expect(contribution.monthlySalaryCredit).toBe(18_000);
  });

  it("maps employee deduction to employer share and total", () => {
    const contribution = getSSSContributionByEmployeeDeduction(900);

    expect(contribution.employeeShare).toBe(900);
    expect(contribution.employerShare).toBe(1830);
    expect(contribution.total).toBe(2730);
  });
});
