import { describe, expect, it } from "vitest";
import { buildLeaveOccurrenceDrafts } from "@/lib/leave/duration-engine";

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const standardWeek = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

describe("buildLeaveOccurrenceDrafts", () => {
  it("charges only scheduled workdays but preserves calendar-day legal duration", () => {
    const result = buildLeaveOccurrenceDrafts({
      startLocalDate: "2026-08-14",
      endLocalDate: "2026-08-17",
      durationBasis: "calendar_days",
      requestedMinutesByDate: {},
      scheduleByWeekday: standardWeek,
      holidays: new Set(["2026-08-17"]),
    });

    expect(
      result.map((row) => [row.localDate, row.legalUnits, row.creditUnits]),
    ).toEqual([
      ["2026-08-14", 1, 1],
      ["2026-08-15", 1, 0],
      ["2026-08-16", 1, 0],
      ["2026-08-17", 1, 0],
    ]);
  });

  it("charges a half-day request as four hours on an eight-hour shift", () => {
    const [row] = buildLeaveOccurrenceDrafts({
      startLocalDate: "2026-08-14",
      endLocalDate: "2026-08-14",
      durationBasis: "scheduled_work",
      requestedMinutesByDate: { "2026-08-14": 240 },
      scheduleByWeekday: standardWeek,
      holidays: new Set(),
    });

    expect(row).toMatchObject({
      scheduledMinutes: 480,
      leaveMinutes: 240,
      creditUnits: 0.5,
    });
  });

  it("rejects requested minutes beyond the scheduled workday", () => {
    expect(() =>
      buildLeaveOccurrenceDrafts({
        startLocalDate: "2026-08-14",
        endLocalDate: "2026-08-14",
        durationBasis: "scheduled_work",
        requestedMinutesByDate: { "2026-08-14": 481 },
        scheduleByWeekday: standardWeek,
        holidays: new Set(),
      }),
    ).toThrow("Requested leave minutes cannot exceed scheduled minutes.");
  });

  it("rejects partial-day entries outside the requested date range", () => {
    expect(() =>
      buildLeaveOccurrenceDrafts({
        startLocalDate: "2026-08-14",
        endLocalDate: "2026-08-14",
        durationBasis: "scheduled_work",
        requestedMinutesByDate: { "2026-08-15": 240 },
        scheduleByWeekday: standardWeek,
        holidays: new Set(),
      }),
    ).toThrow("Requested leave minutes must be within the leave date range.");
  });
});
