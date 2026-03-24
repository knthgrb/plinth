import { describe, expect, it } from "vitest";

import {
  calculateNightDiffWorkHoursForAttendance,
  calculatePayrollBaseFromRecords,
  type ResolvedPayrollRates,
} from "@/lib/payroll-calculations";

function localDate(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
) {
  return new Date(year, monthIndex, day, hours, minutes).getTime();
}

const baseRates: ResolvedPayrollRates = {
  regularOt: 1.25,
  restDayPremiumRate: 1.3,
  restDayOt: 1.69,
  specialHolidayOt: 1.69,
  regularHolidayOt: 2.0,
  nightDiffRate: 1.1,
  nightDiffOnOtRate: 1.375,
  nightDiffRegularHolidayRate: 2.2,
  nightDiffSpecialHolidayRate: 1.43,
  nightDiffRegularHolidayOtRate: 2.86,
  nightDiffSpecialHolidayOtRate: 1.859,
  dailyRateIncludesAllowance: true,
  dailyRateWorkingDaysPerYear: 261,
  regularHolidayRate: 2.0, // 200% actual rate (2× daily)
  specialHolidayRate: 1.3, // 130% actual rate (1.3× daily)
};

function createEmployee(overrides: Record<string, unknown> = {}) {
  return {
    _id: "emp-1",
    organizationId: "org-1",
    compensation: {
      basicSalary: 24_000,
      allowance: 6_000,
      salaryType: "monthly",
      ...((overrides.compensation as object | undefined) ?? {}),
    },
    schedule: {
      defaultSchedule: {
        monday: { in: "09:00", out: "18:00", isWorkday: true },
        tuesday: { in: "09:00", out: "18:00", isWorkday: true },
        wednesday: { in: "09:00", out: "18:00", isWorkday: true },
        thursday: { in: "09:00", out: "18:00", isWorkday: true },
        friday: { in: "09:00", out: "18:00", isWorkday: true },
        saturday: { in: "09:00", out: "18:00", isWorkday: false },
        sunday: { in: "09:00", out: "18:00", isWorkday: false },
      },
      scheduleOverrides: [],
      ...((overrides.schedule as object | undefined) ?? {}),
    },
    ...overrides,
  };
}

function calculate({
  employee = createEmployee(),
  attendance = [],
  holidays = [],
  leaveRequests = [],
  leaveTypes = [],
  cutoffStart = localDate(2026, 1, 20),
  cutoffEnd = localDate(2026, 1, 20),
  payrollRates = baseRates,
}: {
  employee?: any;
  attendance?: any[];
  holidays?: any[];
  leaveRequests?: any[];
  leaveTypes?: any[];
  cutoffStart?: number;
  cutoffEnd?: number;
  payrollRates?: ResolvedPayrollRates;
}) {
  return calculatePayrollBaseFromRecords({
    employee,
    cutoffStart,
    cutoffEnd,
    payFrequency: "bimonthly",
    payrollRates,
    attendance,
    holidays,
    leaveRequests,
    leaveTypes,
  });
}

describe("payroll calculations", () => {
  it("pays regular holiday premium (basic+allowance when include allowance on daily rate is enabled)", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [
        {
          date,
          type: "regular",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // baseRates has dailyRateIncludesAllowance: true → holiday premium = (24k+6k)*12/261 * 100% = 1379.31
    expect(result.holidayPay).toBeCloseTo(1379.31, 2);
  });

  it("pays holiday premium and deducts holiday late using rate multiplier (image 2/3)", () => {
    const date = localDate(2026, 1, 20);
    // Late 5 mins on regular holiday (200%): deduction = 5/60 * hourlyRate * 2.0
    const result = calculate({
      employee: createEmployee({
        compensation: {
          basicSalary: 25_000,
          allowance: 10_000,
          salaryType: "monthly",
        },
      }),
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:05",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const fullPremium = (25_000 + 10_000) * (12 / 261); // 1609.20
    expect(result.holidayPay).toBeCloseTo(fullPremium, 2);
    // Per image 2: 5 mins × (P3.3525/min × 2.0) = P33.53
    const hourlyRate = ((25_000 + 10_000) * (12 / 261)) / 8; // 201.15
    const expectedRegularHolidayLate = (5 / 60) * hourlyRate * 2.0;
    expect(result.lateDeductionRegularHoliday).toBeCloseTo(
      expectedRegularHolidayLate,
      1,
    );
    expect(result.lateDeductionRegularDay).toBe(0);
  });

  it("categorizes late as Regular Holiday Late vs Late (regular day) with rate multiplier (image 2)", () => {
    const holidayDate = localDate(2026, 1, 20); // Monday - regular holiday
    const regularDate = localDate(2026, 1, 21); // Tuesday - regular day
    const result = calculate({
      employee: createEmployee({
        compensation: {
          basicSalary: 25_000,
          allowance: 10_000,
          salaryType: "monthly",
        },
      }),
      attendance: [
        {
          date: holidayDate,
          status: "present",
          actualIn: "09:05",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          isHoliday: true,
          holidayType: "regular",
        },
        {
          date: regularDate,
          status: "present",
          actualIn: "09:06",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
        },
      ],
      holidays: [
        { date: holidayDate, type: "regular", isRecurring: false, year: 2026 },
      ],
      cutoffStart: holidayDate,
      cutoffEnd: regularDate,
    });
    // Per image 2: 5 mins × (P3.3525/min × 2.0) = P33.53, 6 mins × P3.3525 = P20.12, total P53.65
    const hourlyRate = ((25_000 + 10_000) * (12 / 261)) / 8;
    expect(result.lateDeductionRegularHoliday).toBeCloseTo(
      (5 / 60) * hourlyRate * 2.0,
      1,
    );
    expect(result.lateDeductionRegularDay).toBeCloseTo(
      (6 / 60) * hourlyRate,
      1,
    );
    expect(result.lateDeductionSpecialHoliday).toBe(0);
    expect(result.lateDeduction).toBeCloseTo(
      result.lateDeductionRegularHoliday + result.lateDeductionRegularDay,
      1,
    );
  });

  it("uses employee-specific regular/special holiday rates for late deduction", () => {
    const date = localDate(2026, 1, 20);
    // Employee has custom rates: 250% regular, 150% special (vs org default 200%/130%)
    const customRates = {
      ...baseRates,
      regularHolidayRate: 2.5,
      specialHolidayRate: 1.5,
    };
    const result = calculate({
      employee: createEmployee({
        compensation: {
          basicSalary: 25_000,
          allowance: 10_000,
          salaryType: "monthly",
        },
      }),
      payrollRates: customRates,
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:05",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const hourlyRate = ((25_000 + 10_000) * (12 / 261)) / 8;
    // 5 mins × hourly × 2.5 (employee's rate, not org default 2.0)
    expect(result.lateDeductionRegularHoliday).toBeCloseTo(
      (5 / 60) * hourlyRate * 2.5,
      1,
    );
  });

  it("rounds 33.525 to 33.53 (not 33.52) per payslip spec", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      employee: createEmployee({
        compensation: {
          basicSalary: 25_000,
          allowance: 10_000,
          salaryType: "monthly",
        },
      }),
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:05",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // 5 mins × (P3.3525/min × 2.0) = P33.525 → must round to P33.53
    expect(result.lateDeductionRegularHoliday).toBe(33.53);
  });

  it("deducts special holiday late using 130% rate multiplier (image 3)", () => {
    const holidayDate = localDate(2026, 1, 20); // Special holiday
    const regularDate = localDate(2026, 1, 21); // Regular day
    const result = calculate({
      employee: createEmployee({
        compensation: {
          basicSalary: 25_000,
          allowance: 10_000,
          salaryType: "monthly",
        },
      }),
      attendance: [
        {
          date: holidayDate,
          status: "present",
          actualIn: "09:05",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          isHoliday: true,
          holidayType: "special",
        },
        {
          date: regularDate,
          status: "present",
          actualIn: "09:06",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
        },
      ],
      holidays: [
        { date: holidayDate, type: "special", isRecurring: false, year: 2026 },
      ],
      cutoffStart: holidayDate,
      cutoffEnd: regularDate,
    });
    // Per image 3: 5 mins × (P3.3525/min × 1.3) = P21.79, 6 mins × P3.3525 = P20.12, total P41.91
    const hourlyRate = ((25_000 + 10_000) * (12 / 261)) / 8;
    expect(result.lateDeductionSpecialHoliday).toBeCloseTo(
      (5 / 60) * hourlyRate * 1.3,
      1,
    );
    expect(result.lateDeductionRegularDay).toBeCloseTo(
      (6 / 60) * hourlyRate,
      1,
    );
    expect(result.lateDeductionRegularHoliday).toBe(0);
  });

  it("uses holiday list type when list has match (list is source of truth over attendance)", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [
        {
          date,
          type: "special",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    // List type wins so editing holiday (special ↔ regular) in settings applies to payroll; special = 30% premium
    expect(result.holidayPay).toBeCloseTo(413.79, 2);
  });

  it("uses holiday list type when attendance has no isHoliday/holidayType", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          // No isHoliday/holidayType — holiday list is used
        },
      ],
      holidays: [
        {
          date,
          type: "special",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    // Holiday list type used when attendance has no holiday info; special = 30% premium
    expect(result.holidayPay).toBeCloseTo(413.79, 2);
  });

  it("pays special holiday premium at 30% of the basic daily rate", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          isHoliday: true,
          holidayType: "special",
        },
      ],
      holidays: [
        {
          date,
          type: "special",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    // baseRates has dailyRateIncludesAllowance: true → special holiday 130% actual = 30% premium of (basic+allowance) daily
    expect(result.holidayPay).toBeCloseTo(413.79, 2);
  });

  it("pays holiday premium using basic only when include allowance on daily rate is disabled", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      payrollRates: { ...baseRates, dailyRateIncludesAllowance: false },
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date,
    });
    expect(result.holidayPay).toBeCloseTo(1103.45, 2);
  });

  it("calculates regular day overtime using same hourly rate as daily rate (basic+allowance when enabled)", () => {
    const date = localDate(2026, 1, 19);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          overtime: 2,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    expect(result.overtimeRegular).toBeCloseTo(431.03, 2);
  });

  it("calculates rest day work: premium (first 8h at 130%) and OT (excess at 169%)", () => {
    // Use UTC so Feb 21 00:00 UTC is Saturday. actualIn 09:00, actualOut 20:00 → 10h worked (minus 1h lunch).
    const date = Date.UTC(2026, 1, 21);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "20:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          overtime: 2,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    // 8h at 130% + 2h at 169%. Hourly ≈ 172.41 (30k×12/261/8).
    expect(result.restDayPremiumPay).toBeCloseTo(1793.06, 1);
    expect(result.overtimeRestDay).toBeCloseTo(582.76, 1);
  });

  it("calculates regular holiday overtime separately from the holiday premium", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          overtime: 2,
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [
        {
          date,
          type: "regular",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    expect(result.holidayPay).toBeCloseTo(1379.31, 2);
    expect(result.overtimeLegalHoliday).toBeCloseTo(689.66, 2);
  });

  it("calculates special holiday overtime separately from the holiday premium", () => {
    const date = localDate(2026, 1, 20);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          overtime: 2,
          isHoliday: true,
          holidayType: "special",
        },
      ],
      holidays: [
        {
          date,
          type: "special",
          isRecurring: false,
          year: 2026,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    expect(result.holidayPay).toBeCloseTo(413.79, 2);
    expect(result.overtimeSpecialHoliday).toBeCloseTo(582.76, 2);
  });

  it("calculates night differential only when scheduled shift overlaps 10pm-6am", () => {
    const date = localDate(2026, 1, 23); // Friday
    const employee = createEmployee({
      schedule: {
        defaultSchedule: {
          monday: { in: "22:00", out: "06:00", isWorkday: true },
          tuesday: { in: "22:00", out: "06:00", isWorkday: true },
          wednesday: { in: "22:00", out: "06:00", isWorkday: true },
          thursday: { in: "22:00", out: "06:00", isWorkday: true },
          friday: { in: "22:00", out: "06:00", isWorkday: true },
          saturday: { in: "22:00", out: "06:00", isWorkday: false },
          sunday: { in: "22:00", out: "06:00", isWorkday: false },
        },
        scheduleOverrides: [],
      },
    });
    const result = calculate({
      employee,
      attendance: [
        {
          date,
          status: "present",
          actualIn: "22:00",
          actualOut: "06:00",
          scheduleIn: "22:00",
          scheduleOut: "06:00",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // 8 hrs in night window, hourly (basic+allowance) ≈ 172.41, 10% = 137.93
    expect(result.nightDiffPay).toBeCloseTo(137.93, 2);
  });

  it("no night diff when actual work is 6am-3pm (no time in 10pm-6am window)", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "06:00",
          actualOut: "15:00",
          scheduleIn: "06:00",
          scheduleOut: "15:00",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // Actual 6am-3pm has no overlap with 10pm-6am → 0 night diff
    expect(result.nightDiffPay).toBe(0);
  });

  it("night diff when scheduled 5:30am (30 mins in night window)", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "05:30",
          actualOut: "14:30",
          scheduleIn: "05:30",
          scheduleOut: "14:30",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // 5:30-6:00 = 30 min in night window. hourly (basic+allowance) ≈ 172.41, 0.5 * 172.41 * 0.1 ≈ 8.62
    expect(result.nightDiffPay).toBeCloseTo(8.62, 2);
  });

  it("caps night diff at scheduled out when actual out is later without OT (2pm-11pm sched, actual midnight)", () => {
    const date = localDate(2026, 2, 18); // Mar 19 2026 = Thursday
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "14:00",
          actualOut: "00:00",
          scheduleIn: "14:00",
          scheduleOut: "23:00",
          overtime: 0,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    // Paid window ends 23:00 → 1h night (22:00-23:00), not 2h to midnight
    expect(result.nightDiffPay).toBeCloseTo(hourly * 0.1, 2);
    expect(
      calculateNightDiffWorkHoursForAttendance({
        date,
        actualIn: "14:00",
        actualOut: "00:00",
        scheduleIn: "14:00",
        scheduleOut: "23:00",
        overtime: 0,
      }),
    ).toBeCloseTo(1, 5);
  });

  it("extends night diff through scheduled out + recorded OT (2pm-11pm + 1h OT, actual midnight)", () => {
    const date = localDate(2026, 2, 18);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "14:00",
          actualOut: "00:00",
          scheduleIn: "14:00",
          scheduleOut: "23:00",
          overtime: 1,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    // 22:00-23:00 regular night (10%), 23:00-24:00 OT night (137.5% - 125%)
    const regNight = hourly * 0.1;
    const otNight = hourly * (1.375 - 1.25);
    expect(result.nightDiffPay).toBeCloseTo(regNight + otNight, 2);
  });

  it("night diff: early clock-in before scheduled morning start does not count pre-schedule minutes in 10pm–6am window", () => {
    const date = localDate(2026, 2, 18);
    expect(
      calculateNightDiffWorkHoursForAttendance({
        date,
        actualIn: "05:30",
        actualOut: "14:00",
        scheduleIn: "06:00",
        scheduleOut: "14:00",
      }),
    ).toBe(0);
  });

  it("night diff: morning window counts from scheduled start when employee is early (only 5:30–6:00 if sched 5:30)", () => {
    const date = localDate(2026, 2, 18);
    expect(
      calculateNightDiffWorkHoursForAttendance({
        date,
        actualIn: "05:10",
        actualOut: "14:00",
        scheduleIn: "05:30",
        scheduleOut: "14:00",
      }),
    ).toBeCloseTo(0.5, 5);
  });

  it("night diff: late clock-in after scheduled start reduces morning night minutes", () => {
    const date = localDate(2026, 2, 18);
    expect(
      calculateNightDiffWorkHoursForAttendance({
        date,
        actualIn: "05:45",
        actualOut: "14:00",
        scheduleIn: "05:30",
        scheduleOut: "14:00",
      }),
    ).toBeCloseTo(0.25, 5);
  });

  it("applies night diff on OT rate (137.5%) for OT hours in 10pm-6am", () => {
    const date = localDate(2026, 1, 23); // Friday
    // Schedule to 8pm, worked until 11pm → 3h OT. 8-10pm = 2h at 125%, 10-11pm = 1h at 137.5%
    // Night diff block adds premium (1.375 - 1.25) * hourly * 1h = 0.125 * 172.41 ≈ 21.55
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "20:00",
          actualOut: "23:00",
          scheduleIn: "09:00",
          scheduleOut: "20:00",
          overtime: 3,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    expect(result.nightDiffPay).toBeCloseTo(21.55, 2);
  });

  it("work until midnight with lunch 10pm-11pm: only 11pm-midnight counts as night diff (1h)", () => {
    const date = localDate(2026, 2, 18);
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "18:00",
          actualOut: "00:00",
          scheduleIn: "18:00",
          scheduleOut: "00:00",
          lunchStart: "22:00",
          lunchEnd: "23:00",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    expect(result.overtimeHours).toBe(0);
    expect(
      calculateNightDiffWorkHoursForAttendance({
        date,
        actualIn: "18:00",
        actualOut: "00:00",
        scheduleIn: "18:00",
        scheduleOut: "00:00",
        lunchStart: "22:00",
        lunchEnd: "23:00",
      }),
    ).toBeCloseTo(1, 5);
    expect(result.nightDiffPay).toBeCloseTo(hourly * 0.1, 2);
    expect(result.nightDiffBreakdown?.length).toBe(1);
    const brSum = result.nightDiffBreakdown!.reduce((s, r) => s + r.amount, 0);
    expect(brSum).toBeCloseTo(result.nightDiffPay, 2);
  });

  it("overnight shift 6pm-3am with lunch 11pm-12am: night diff on both calendar days (1h + 3h = 4h)", () => {
    const date = localDate(2026, 2, 18); // Mar 18 2026
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "18:00",
          actualOut: "03:00",
          scheduleIn: "18:00",
          scheduleOut: "03:00",
          lunchStart: "23:00",
          lunchEnd: "00:00",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date + 24 * 60 * 60 * 1000, // include Mar 19 so both segments count
    });
    const hourly = (30_000 * 12) / 261 / 8;
    const premiumPerHour = hourly * 0.1; // 10% night diff
    const nightHoursFirstDay = 1; // 22:00-23:00 (before lunch)
    const nightHoursNextDay = 3; // 00:00-03:00
    const expected = (nightHoursFirstDay + nightHoursNextDay) * premiumPerHour;
    expect(result.nightDiffPay).toBeCloseTo(expected, 1);
    expect(result.nightDiffPay).toBeGreaterThan(60); // must be > 1 day only (~17.24)
  });

  it("two days overnight 6pm-3am with lunch 11pm-12am: 8h night diff total (4h per day)", () => {
    const day1 = localDate(2026, 2, 18); // Mar 18
    const day2 = localDate(2026, 2, 19); // Mar 19
    const cutoffEnd = day2 + 24 * 60 * 60 * 1000 - 1; // end of Mar 19
    const result = calculate({
      attendance: [
        {
          date: day1,
          status: "present",
          actualIn: "18:00",
          actualOut: "03:00",
          scheduleIn: "18:00",
          scheduleOut: "03:00",
          lunchStart: "23:00",
          lunchEnd: "00:00",
        },
        {
          date: day2,
          status: "present",
          actualIn: "18:00",
          actualOut: "03:00",
          scheduleIn: "18:00",
          scheduleOut: "03:00",
          lunchStart: "23:00",
          lunchEnd: "00:00",
        },
      ],
      cutoffStart: day1,
      cutoffEnd,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    const premiumPerHour = hourly * 0.1; // 10% night diff
    const expected = 8 * premiumPerHour; // 4h + 4h
    expect(result.nightDiffPay).toBeCloseTo(expected, 1);
    expect(result.nightDiffPay).toBeCloseTo(137.93, 1); // 8 * 17.24
  });

  it("night diff uses schedule when actual is early in / late timeout (no night hours): second day still gets 4h", () => {
    const day1 = localDate(2026, 2, 18);
    const day2 = localDate(2026, 2, 19);
    const cutoffEnd = day2 + 24 * 60 * 60 * 1000 - 1;
    const result = calculate({
      attendance: [
        { date: day1, status: "present", actualIn: "18:00", actualOut: "03:00", scheduleIn: "18:00", scheduleOut: "03:00", lunchStart: "23:00", lunchEnd: "00:00" },
        // Second day: actual 11:00-12:00 (no night overlap); schedule 18:00-03:00 → fallback gives 4h night diff
        { date: day2, status: "present", actualIn: "11:00", actualOut: "12:00", scheduleIn: "18:00", scheduleOut: "03:00", lunchStart: "23:00", lunchEnd: "00:00" },
      ],
      cutoffStart: day1,
      cutoffEnd,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    const expected = 8 * hourly * 0.1; // 4h + 4h from schedule fallback
    expect(result.nightDiffPay).toBeCloseTo(expected, 1);
    expect(result.nightDiffPay).toBeCloseTo(137.93, 1);
  });

  it("applies holiday night rate (220%) only to hours on holiday calendar day", () => {
    const date = localDate(2026, 1, 20); // Feb 20 2026 = Friday (holiday); next day Feb 21 = Saturday = rest day
    // Shift 18:00-02:00: 18-24 on holiday (6h), 0-2 next day (2h). Night on holiday = 22-24 (2h), night on next day = 0-2 (2h).
    // Night diff on holiday = 220% - 200% = 20% of base. Next day is Saturday (rest day) so rest day night diff = 130%×110% - 130% = 13%.
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "18:00",
          actualOut: "02:00",
          scheduleIn: "18:00",
          scheduleOut: "02:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    const nightDiffPremiumOnHoliday = 2.2 - 2.0; // 20% on top of 200% holiday
    const nightOnHoliday = 2 * nightDiffPremiumOnHoliday * hourly;
    const nightDiffPremiumRestDay = 1.3 * 1.1 - 1.3; // 13% (rest day × night diff - rest day)
    const nightNextDay = 2 * nightDiffPremiumRestDay * hourly;
    expect(result.nightDiffPay).toBeCloseTo(nightOnHoliday + nightNextDay, 1);
  });

  it("regular holiday 6pm-3am with lunch 11pm-12am: only 10-11pm gets holiday night (20%), 12-3am next day gets regular/rest day rate", () => {
    const date = localDate(2026, 1, 20); // Feb 20 = Friday (holiday); Feb 21 = Saturday = rest day
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "18:00",
          actualOut: "03:00",
          scheduleIn: "18:00",
          scheduleOut: "03:00",
          lunchStart: "23:00",
          lunchEnd: "00:00",
          isHoliday: true,
          holidayType: "regular",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date + 24 * 60 * 60 * 1000 - 1,
    });
    const hourly = (30_000 * 12) / 261 / 8;
    const nightOnHoliday = 1 * (2.2 - 2.0) * hourly; // 1h 22:00-23:00 on holiday day only
    const nightDiffPremiumRestDay = 1.3 * 1.1 - 1.3; // 13% (next day is Saturday = rest day)
    const nightNextDay = 3 * nightDiffPremiumRestDay * hourly; // 3h 00:00-03:00 next day
    expect(result.nightDiffPay).toBeCloseTo(nightOnHoliday + nightNextDay, 1);
    expect(result.nightDiffPay).toBeCloseTo(101.72, 1);
  });

  it("regular holiday night diff: 1h at 20% + 3h at 10% = P100.58 (hourly P201.15, next day weekday)", () => {
    // Exact scenario from corrected breakdown: only 10–11pm holiday, 12–3am regular.
    const monthly = 201.15 * 8 * 261 / 12; // ~35k so hourly = 201.15
    const employee = createEmployee({
      compensation: {
        basicSalary: Math.round(monthly * 0.7),
        allowance: Math.round(monthly * 0.3),
        salaryType: "monthly",
      },
    });
    const date = localDate(2026, 1, 18); // Wed Feb 18 (holiday); Thu Feb 19 = weekday
    const result = calculate({
      employee,
      attendance: [
        {
          date,
          status: "present",
          actualIn: "18:00",
          actualOut: "03:00",
          scheduleIn: "18:00",
          scheduleOut: "03:00",
          lunchStart: "23:00",
          lunchEnd: "00:00",
        },
      ],
      holidays: [{ date, type: "regular", isRecurring: false, year: 2026 }],
      cutoffStart: date,
      cutoffEnd: date + 24 * 60 * 60 * 1000 - 1,
    });
    expect(result.nightDiffPay).toBeCloseTo(100.58, 2);
  });

  it("uses manual late overrides when present (late = basic+allowance hourly rate)", () => {
    const date = localDate(2026, 1, 23);
    // Employee: 24k basic + 6k allowance, dailyRateIncludesAllowance true → hourlyRate = (30k*12/261)/8 ≈ 172.41
    // 20 min late → (20/60) * 172.41 ≈ 57.47
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "09:00",
          actualOut: "18:00",
          scheduleIn: "09:00",
          scheduleOut: "18:00",
          late: 20,
          lateManualOverride: true,
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });

    expect(result.lateHours).toBeCloseTo(20 / 60, 5);
    expect(result.lateDeduction).toBeCloseTo(57.47, 2);
  });

  it("treats leave_without_pay as absent (deduction)", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "leave_without_pay",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // dailyRate ≈ 30000 * 12/261 ≈ 1379.31
    expect(result.absences).toBe(1);
    expect(result.absentDeduction).toBeCloseTo(1379.31, 2);
  });

  it("treats leave_with_pay as paid (no deduction)", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "leave_with_pay",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    expect(result.absences).toBe(0);
    expect(result.absentDeduction).toBe(0);
  });

  it("treats legacy leave as paid (no deduction)", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "leave",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    expect(result.absences).toBe(0);
    expect(result.absentDeduction).toBe(0);
  });
});
