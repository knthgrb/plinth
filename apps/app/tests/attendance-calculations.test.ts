import { describe, expect, it } from "vitest";

import {
  calculateLate,
  calculateOvertime,
  calculateUndertime,
  clockOutIsNextCalendarDay,
  isEarlyDeparture,
  pairInOutGlobalMinutes,
  scheduleEndsNextCalendarDay,
  shouldHighlightActualIn,
  shouldHighlightActualOut,
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

describe("attendance time highlight", () => {
  it("late arrival with on-schedule or later clock-out highlights in, not out", () => {
    const schedIn = "09:00";
    const schedOut = "18:00";
    const actualIn = "13:00";
    const actualOut = "18:25";
    const undertimeMins = Math.round(
      calculateUndertime(schedIn, schedOut, actualIn, actualOut) * 60,
    );
    expect(undertimeMins).toBeGreaterThan(0);
    expect(isEarlyDeparture(schedIn, schedOut, actualIn, actualOut)).toBe(
      false,
    );
    expect(
      shouldHighlightActualIn(
        schedIn,
        schedOut,
        actualIn,
        actualOut,
        0,
        undertimeMins,
      ),
    ).toBe(true);
    expect(
      shouldHighlightActualOut(
        schedIn,
        schedOut,
        actualIn,
        actualOut,
        undertimeMins,
      ),
    ).toBe(false);
  });

  it("early departure highlights out, not in when on-time arrival", () => {
    const schedIn = "09:00";
    const schedOut = "18:00";
    const actualIn = "09:00";
    const actualOut = "17:00";
    const undertimeMins = Math.round(
      calculateUndertime(schedIn, schedOut, actualIn, actualOut) * 60,
    );
    expect(undertimeMins).toBeGreaterThan(0);
    expect(
      shouldHighlightActualIn(
        schedIn,
        schedOut,
        actualIn,
        actualOut,
        0,
        undertimeMins,
      ),
    ).toBe(false);
    expect(
      shouldHighlightActualOut(
        schedIn,
        schedOut,
        actualIn,
        actualOut,
        undertimeMins,
      ),
    ).toBe(true);
  });
});
