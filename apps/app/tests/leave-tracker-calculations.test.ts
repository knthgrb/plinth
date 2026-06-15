import { describe, expect, it } from "vitest";
import {
  calculateLeaveTrackerAccrual,
  getLeaveTrackerAccrualMonth,
} from "@/utils/leave-tracker-calculations";

describe("leave tracker calculations", () => {
  it("does not let rounded monthly accrual push accrued leave above total", () => {
    const result = calculateLeaveTrackerAccrual({
      total: 8,
      accrualMonth: 12,
    });

    expect(result.monthlyAccrual).toBe(0.67);
    expect(result.accrued).toBe(8);
  });

  it("can release leave on a semi-annual basis", () => {
    const firstHalf = calculateLeaveTrackerAccrual({
      total: 8,
      accrualMonth: 3,
      accrualFrequency: "semi_annual",
    });
    const secondHalf = calculateLeaveTrackerAccrual({
      total: 8,
      accrualMonth: 7,
      accrualFrequency: "semi_annual",
    });

    expect(firstHalf.accrued).toBe(4);
    expect(secondHalf.accrued).toBe(8);
  });

  it("can release the annual total at once", () => {
    const result = calculateLeaveTrackerAccrual({
      total: 8,
      accrualMonth: 1,
      accrualFrequency: "annual",
    });

    expect(result.accrued).toBe(8);
  });

  it("uses the actual current month for the selected current year", () => {
    const june15 = new Date(2026, 5, 15);

    expect(getLeaveTrackerAccrualMonth(2026, june15)).toBe(6);
    expect(getLeaveTrackerAccrualMonth(2025, june15)).toBe(12);
  });
});
