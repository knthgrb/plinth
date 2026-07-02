import { describe, expect, it } from "vitest";

import {
  getPagibigContribution,
  getPhilHealthContribution,
} from "@/utils/ph-statutory-contributions";

describe("Philippine statutory contribution helpers", () => {
  it("computes PhilHealth at 5% with the 2025 floor and ceiling split equally", () => {
    expect(getPhilHealthContribution(8_000)).toMatchObject({
      monthlyPremiumBase: 10_000,
      employeeShare: 250,
      employerShare: 250,
      total: 500,
    });

    expect(getPhilHealthContribution(50_000)).toMatchObject({
      monthlyPremiumBase: 50_000,
      employeeShare: 1_250,
      employerShare: 1_250,
      total: 2_500,
    });

    expect(getPhilHealthContribution(125_000)).toMatchObject({
      monthlyPremiumBase: 100_000,
      employeeShare: 2_500,
      employerShare: 2_500,
      total: 5_000,
    });
  });

  it("computes Pag-IBIG at 2% up to the monthly fund salary cap", () => {
    expect(getPagibigContribution(8_000)).toMatchObject({
      monthlyFundSalary: 8_000,
      employeeShare: 160,
      employerShare: 160,
      total: 320,
    });

    expect(getPagibigContribution(30_000)).toMatchObject({
      monthlyFundSalary: 10_000,
      employeeShare: 200,
      employerShare: 200,
      total: 400,
    });
  });
});
