import { describe, expect, it } from "vitest";

import {
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
  specialHolidayOt: 1.69,
  regularHolidayOt: 2.0,
  restDayOt: 1.69,
  nightDiffRate: 0.1,
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

  it("uses attendance isHoliday/holidayType when set (from backfill or edit)", () => {
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

    // Attendance holiday type wins when set (from backfill/edit); regular = 100% premium
    expect(result.holidayPay).toBeCloseTo(1379.31, 2);
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

  it("calculates regular day overtime from the basic hourly rate", () => {
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

    expect(result.overtimeRegular).toBeCloseTo(344.83, 2);
  });

  it("calculates rest day work using the configured rest day rate", () => {
    // Use UTC so Feb 21 00:00 UTC is Saturday (payroll uses UTC for day-of-week)
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

    expect(result.overtimeRestDay).toBeCloseTo(2913.79, 2);
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
    expect(result.overtimeLegalHoliday).toBeCloseTo(551.72, 2);
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
    expect(result.overtimeSpecialHoliday).toBeCloseTo(466.21, 2);
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
    // 8 hrs in night window, hourlyRate ≈ 172.41, 10% = 110.34
    expect(result.nightDiffPay).toBeCloseTo(110.34, 2);
  });

  it("no night diff when scheduled 6am-3pm even if employee clocks in early at 5:40am", () => {
    const date = localDate(2026, 1, 23); // Friday
    const result = calculate({
      attendance: [
        {
          date,
          status: "present",
          actualIn: "05:40",
          actualOut: "15:00",
          scheduleIn: "06:00",
          scheduleOut: "15:00",
        },
      ],
      cutoffStart: date,
      cutoffEnd: date,
    });
    // Schedule 6am-3pm has no overlap with 10pm-6am → 0 night diff
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
    // 5:30-6:00 = 30 min in night window. basicHourlyRate = basic only ≈ 137.93, 0.5 * 137.93 * 0.1 ≈ 6.90
    expect(result.nightDiffPay).toBeCloseTo(6.9, 2);
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
