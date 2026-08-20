import { describe, expect, it } from "vitest";

import {
  getPagibigContribution,
  getPhilHealthContribution,
} from "@/utils/ph-statutory-contributions";
import {
  PH_STATUTORY_RULE_VERSION_2025,
  resolvePhStatutoryRuleSet,
} from "@/lib/ph-statutory-rules";

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

  it("computes the Pag-IBIG employee tier and 2% employer share up to the cap", () => {
    expect(getPagibigContribution(1_000)).toMatchObject({
      monthlyFundSalary: 1_000,
      rate: 0.01,
      employeeShare: 10,
      employerShare: 20,
      total: 30,
    });

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

  it("resolves an immutable statutory version by effective date or stored version", () => {
    const byDate = resolvePhStatutoryRuleSet(
      Date.parse("2026-08-15T00:00:00+08:00"),
    );
    const locked = resolvePhStatutoryRuleSet(
      Date.parse("2099-01-01T00:00:00+08:00"),
      PH_STATUTORY_RULE_VERSION_2025,
    );

    expect(byDate.version).toBe(PH_STATUTORY_RULE_VERSION_2025);
    expect(locked).toBe(byDate);
    expect(Object.isFrozen(byDate)).toBe(true);
  });
});
