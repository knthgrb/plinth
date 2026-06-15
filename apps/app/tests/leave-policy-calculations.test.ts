import { describe, expect, it } from "vitest";
import {
  calculateAnnualLeaveBase,
  calculateAnniversaryLeave,
  getConvertibleLeaveDays,
  isEligibleForPaidLeave,
} from "@/utils/leave-policy-calculations";

describe("leave policy calculations", () => {
  it("blocks paid leave before regularization when the policy requires it", () => {
    const referenceDate = new Date(2026, 5, 15).getTime();
    const hireDate = new Date(2026, 0, 1).getTime();

    expect(
      isEligibleForPaidLeave({
        regularizationDate: undefined,
        referenceDate,
        paidLeaveRequiresRegularization: true,
      }),
    ).toBe(false);
    expect(
      calculateAnnualLeaveBase({
        annualLeave: 8,
        hireDate,
        referenceDate,
        paidLeaveRequiresRegularization: true,
      }),
    ).toBe(0);
  });

  it("calculates paid leave from the regularization date after regularization", () => {
    const referenceDate = new Date(2026, 11, 31).getTime();
    const hireDate = new Date(2026, 0, 1).getTime();
    const regularizationDate = new Date(2026, 6, 16).getTime();

    expect(
      calculateAnnualLeaveBase({
        annualLeave: 8,
        hireDate,
        regularizationDate,
        referenceDate,
        paidLeaveRequiresRegularization: true,
      }),
    ).toBe(3.33);
  });

  it("caps anniversary leave", () => {
    expect(
      calculateAnniversaryLeave({
        startDate: new Date(2000, 0, 1).getTime(),
        referenceDate: new Date(2026, 0, 1).getTime(),
        maxDays: 15,
      }),
    ).toBe(15);
  });

  it("caps convertible leave at the organization maximum", () => {
    expect(getConvertibleLeaveDays(8, 5)).toBe(5);
    expect(getConvertibleLeaveDays(3.5, 5)).toBe(3.5);
  });
});
