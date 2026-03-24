import { describe, expect, it } from "vitest";

import {
  calculateLate,
  calculateOvertime,
  calculateUndertime,
  clockOutIsNextCalendarDay,
  pairInOutGlobalMinutes,
  scheduleEndsNextCalendarDay,
} from "@/utils/attendance-calculations";

describe("pairInOutGlobalMinutes", () => {
  it("extends clock-out past midnight when out is at or before in on the clock", () => {
    const p = pairInOutGlobalMinutes("14:00", "00:00");
    expect(p).toEqual({ inGlobal: 14 * 60, outGlobal: 24 * 60 });
  });

  it("keeps same-day out after in", () => {
    const p = pairInOutGlobalMinutes("14:00", "23:00");
    expect(p).toEqual({ inGlobal: 14 * 60, outGlobal: 23 * 60 });
  });

  it("handles overnight scheduled span", () => {
    const p = pairInOutGlobalMinutes("18:00", "06:00");
    expect(p).toEqual({ inGlobal: 18 * 60, outGlobal: 24 * 60 + 6 * 60 });
  });
});

describe("clockOutIsNextCalendarDay / scheduleEndsNextCalendarDay", () => {
  it("detects next-day clock-out", () => {
    expect(clockOutIsNextCalendarDay("14:00", "00:00")).toBe(true);
    expect(clockOutIsNextCalendarDay("14:00", "14:00")).toBe(true);
    expect(clockOutIsNextCalendarDay("14:00", "15:00")).toBe(false);
  });

  it("detects overnight schedule", () => {
    expect(scheduleEndsNextCalendarDay("18:00", "06:00")).toBe(true);
    expect(scheduleEndsNextCalendarDay("14:00", "23:00")).toBe(false);
  });
});

describe("calculateUndertime", () => {
  it("does not treat midnight clock-out as same-day zero-duration (2pm–11pm sched)", () => {
    const h = calculateUndertime(
      "14:00",
      "23:00",
      "14:00",
      "00:00",
    );
    expect(h).toBe(0);
  });

  it("counts undertime for overnight shift when leaving before scheduled end", () => {
    const h = calculateUndertime(
      "18:00",
      "06:00",
      "18:00",
      "03:00",
    );
    expect(h).toBe(3);
  });

  it("subtracts same-day lunch overlap on global actual span", () => {
    const h = calculateUndertime(
      "14:00",
      "23:00",
      "14:00",
      "00:00",
      "22:00",
      "23:00",
    );
    expect(h).toBe(0);
  });
});

describe("calculateLate", () => {
  it("caps late at 60 minutes for policy", () => {
    expect(calculateLate("09:00", "10:30")).toBe(0);
  });
});

describe("calculateOvertime", () => {
  it("uses global timeline when actualIn is provided", () => {
    const ot = calculateOvertime("23:00", "00:00", "14:00", "14:00");
    expect(ot).toBe(1);
  });
});
