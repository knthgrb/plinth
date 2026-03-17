export type DailyRateOptions = {
  includeAllowance: boolean;
  workingDaysPerYear: number;
};

export type PayFrequency = "monthly" | "bimonthly";
export type HolidayType = "regular" | "special" | "special_working";

export type PayrollRates = {
  regularOt: number;
  restDayPremiumRate: number;
  restDayOt: number;
  specialHolidayOt: number;
  regularHolidayOt: number;
  nightDiffRate: number;
  /** Night diff on top of OT (default 1.375 = 137.5%). Optional for backward compat. */
  nightDiffOnOtRate?: number;
  nightDiffRegularHolidayRate?: number;
  nightDiffSpecialHolidayRate?: number;
  nightDiffRegularHolidayOtRate?: number;
  nightDiffSpecialHolidayOtRate?: number;
  /** Night diff on rest day (first 8h): restDayPremium × nightDiff. Optional for backward compat. */
  nightDiffRestDayRate?: number;
  /** Night diff on rest day OT (excess of 8h): restDayOt × nightDiff. Optional for backward compat. */
  nightDiffRestDayOtRate?: number;
  dailyRateIncludesAllowance: boolean;
  dailyRateWorkingDaysPerYear: number;
};

export type ResolvedPayrollRates = PayrollRates & {
  regularHolidayRate: number;
  specialHolidayRate: number;
};

export type PayrollBaseResult = {
  basicPay: number;
  daysWorked: number;
  absences: number;
  lateHours: number;
  undertimeHours: number;
  overtimeHours: number;
  holidayPay: number;
  /** When holidayPay > 0, which type produced it so the payslip can show "Legal" vs "Special Holiday". */
  holidayPayType?: "regular" | "special";
  nightDiffPay: number;
  restDayPremiumPay: number;
  overtimeRegular: number;
  overtimeRestDay: number;
  overtimeRestDayExcess: number;
  overtimeSpecialHoliday: number;
  overtimeSpecialHolidayExcess: number;
  overtimeLegalHoliday: number;
  overtimeLegalHolidayExcess: number;
  lateDeduction: number;
  /** Late on regular (non-holiday) days only */
  lateDeductionRegularDay: number;
  /** Late on special nonworking holiday — portion of holiday premium lost */
  lateDeductionSpecialHoliday: number;
  /** Late on regular holiday — portion of holiday premium lost */
  lateDeductionRegularHoliday: number;
  undertimeDeduction: number;
  absentDeduction: number;
  dailyRate: number;
  hourlyRate: number;
  salaryType: "monthly" | "daily" | "hourly";
  payDivisor: number;
  payrollRates: ResolvedPayrollRates;
};

// Asia/Manila (UTC+8) — payroll dates and rest day use Manila so local and prod match
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Round to nearest hundredths (2 decimal places) for payslip display. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getManilaDateParts(date: number): {
  y: number;
  m: number;
  d: number;
  dayOfWeek: number;
} {
  const d = new Date(date + MANILA_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

/** Start of calendar day in Manila (UTC+8) as timestamp. */
function getManilaDayStart(ts: number): number {
  const { y, m, d } = getManilaDateParts(ts);
  return Date.UTC(y, m, d) - MANILA_OFFSET_MS;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NIGHT_START_MIN = 22 * 60; // 10:00 PM
const NIGHT_END_MIN = 6 * 60; // 6:00 AM (same calendar day: 0–360; next day in next segment)
const MIDNIGHT_MIN = 24 * 60; // 1440

function getDayName(date: number): string {
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const { dayOfWeek } = getManilaDateParts(date);
  return dayNames[dayOfWeek];
}

function isRestDay(date: number, employeeSchedule: any): boolean {
  if (!employeeSchedule?.defaultSchedule) return false;
  const dayName = getDayName(date);
  const daySchedule =
    employeeSchedule.defaultSchedule[
      dayName as keyof typeof employeeSchedule.defaultSchedule
    ];
  if (!daySchedule || typeof daySchedule.isWorkday !== "boolean") return false;

  if (employeeSchedule.scheduleOverrides) {
    const { y: dY, m: dM, d: dD } = getManilaDateParts(date);
    const override = employeeSchedule.scheduleOverrides.find((o: any) => {
      const oParts = getManilaDateParts(new Date(o.date).getTime());
      return oParts.y === dY && oParts.m === dM && oParts.d === dD;
    });
    if (override) {
      return false;
    }
  }

  return !daySchedule.isWorkday;
}

function getDailyRateForEmployee(
  employee: any,
  options?: DailyRateOptions,
): number {
  const salaryType = employee.compensation.salaryType || "monthly";
  const basicSalary = employee.compensation.basicSalary || 0;
  const allowance = employee.compensation.allowance ?? 0;

  if (salaryType === "daily") {
    return basicSalary;
  }

  if (salaryType === "hourly") {
    return basicSalary * 8;
  }

  if (options) {
    const monthlyBase =
      basicSalary + (options.includeAllowance ? allowance : 0);
    return monthlyBase * (12 / options.workingDaysPerYear);
  }

  return basicSalary / 22;
}

function getPerCutoffAmount(
  monthlyAmount: number,
  payFrequency: PayFrequency,
): number {
  return payFrequency === "bimonthly" ? monthlyAmount / 2 : monthlyAmount;
}

/** Normalize to calendar day in Asia/Manila so local and production match. */
function toLocalDayTimestamp(date: number): number {
  const { y, m, d } = getManilaDateParts(date);
  return Date.UTC(y, m, d);
}

export function holidayMatchesDate(holiday: any, date: number): boolean {
  const effectiveTimestamp = holiday.offsetDate ?? holiday.date;
  const targetParts = getManilaDateParts(date);
  const holidayParts = getManilaDateParts(
    new Date(effectiveTimestamp).getTime(),
  );

  if (holiday.isRecurring) {
    return holidayParts.m === targetParts.m && holidayParts.d === targetParts.d;
  }

  if (holiday.year != null && holiday.year !== targetParts.y) {
    return false;
  }

  return (
    holidayParts.y === targetParts.y &&
    holidayParts.m === targetParts.m &&
    holidayParts.d === targetParts.d
  );
}

/** Returns matching holiday for a date (Manila timezone). Used for backfilling attendance isHoliday/holidayType. */
export function getMatchingHolidayForDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
  }[],
): { type: "regular" | "special" | "special_working" } | null {
  const holiday = holidays.find((entry) => holidayMatchesDate(entry, dateTs));
  if (
    holiday &&
    (holiday.type === "regular" ||
      holiday.type === "special" ||
      holiday.type === "special_working")
  ) {
    return { type: holiday.type as "regular" | "special" | "special_working" };
  }
  return null;
}

export function holidayAppliesToEmployee(holiday: any, employee: any): boolean {
  if (holiday.applyToAll !== false) return true;
  const provinces = holiday.provinces as string[] | undefined;
  if (!provinces || provinces.length === 0) return true;
  const empProvince = (employee?.personalInfo?.province ?? "").trim();
  if (!empProvince) return false;
  return provinces.some(
    (p) => String(p).trim().toLowerCase() === empProvince.toLowerCase(),
  );
}

function getHolidayInfo(
  date: number,
  holidays: any[],
  attendanceRecord?: any,
  employee?: any,
): {
  isHoliday: boolean;
  holidayType?: HolidayType;
  appliesToEmployee?: boolean;
} {
  const holiday = holidays.find((entry) => holidayMatchesDate(entry, date));
  if (holiday) {
    const appliesToEmployee = holidayAppliesToEmployee(holiday, employee ?? {});
    if (!appliesToEmployee) return { isHoliday: false };
    // Use holiday list type as source of truth when user edits holiday (special ↔ regular).
    // Attendance records are only synced when we update the holiday or backfill; list reflects latest.
    const type = (holiday.type as HolidayType) ?? undefined;
    return {
      isHoliday: true,
      holidayType: type,
      appliesToEmployee: true,
    };
  }
  // No list match: use attendance if it was manually set (e.g. one-off or list out of date).
  const attType = attendanceRecord?.holidayType;
  const attHasType =
    attType === "regular" ||
    attType === "special" ||
    attType === "special_working";
  if (attendanceRecord?.isHoliday && attHasType) {
    return {
      isHoliday: true,
      holidayType: attType as HolidayType,
      appliesToEmployee: true,
    };
  }
  return { isHoliday: false };
}

function timeStringToMinutes(time: string | undefined): number | null {
  if (!time || typeof time !== "string") return null;
  const [hourPart, minutePart = "0"] = time.trim().split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Calculate night diff hours: actual worked time that falls in the 10pm–6am window.
 * (Used for backward compatibility / total hours; pay uses calculateNightDiffPay.)
 */
function calculateNightDiffHours(
  actualIn: string | undefined,
  actualOut: string | undefined,
  _scheduleIn?: string,
  _scheduleOut?: string,
): number {
  const actualStart = timeStringToMinutes(actualIn);
  const actualEnd = timeStringToMinutes(actualOut);
  if (actualStart === null || actualEnd === null) return 0;
  const nightStart = 22 * 60;
  const nightEnd = 24 * 60 + 6 * 60;
  let s = actualStart;
  let e = actualEnd;
  if (s < 6 * 60) {
    s += 24 * 60;
    e += 24 * 60;
  } else if (e <= s) {
    e += 24 * 60;
  }
  const actNightStart = Math.max(s, nightStart);
  const actNightEnd = Math.min(e, nightEnd);
  if (actNightEnd <= actNightStart) return 0;
  return (actNightEnd - actNightStart) / 60;
}

/** Segment of work on one calendar day: startMin/endMin in 0..1440 for that day. */
type DaySegment = { dayTimestamp: number; startMin: number; endMin: number };

/** Subtract lunch window from segments so night diff is not paid for break time. Handles same-day and cross-midnight lunch. */
function subtractLunchFromSegments(
  segments: DaySegment[],
  lunchStart: string,
  lunchEnd: string,
  attDayStart: number,
): DaySegment[] {
  const ls = timeStringToMinutes(lunchStart) ?? 0;
  const le = timeStringToMinutes(lunchEnd) ?? 0;
  const lunchCrossesMidnight = le <= ls;
  const out: DaySegment[] = [];
  for (const seg of segments) {
    if (lunchCrossesMidnight) {
      if (seg.dayTimestamp === attDayStart) {
        // Lunch on first day: [ls, 1440)
        if (seg.startMin < ls) {
          out.push({
            dayTimestamp: seg.dayTimestamp,
            startMin: seg.startMin,
            endMin: Math.min(seg.endMin, ls),
          });
        }
        if (seg.endMin > ls && seg.startMin < seg.endMin) {
          // After lunch on same segment (segment spans across 24:00): we already ended at ls, no second part on this day
        }
      } else {
        // Next day: lunch [0, le]. When le=0 (lunch 11pm–12am) nothing to cut; keep full segment so night diff after midnight is paid.
        if (le > 0) {
          if (seg.endMin > le) {
            out.push({
              dayTimestamp: seg.dayTimestamp,
              startMin: Math.max(seg.startMin, le),
              endMin: seg.endMin,
            });
          }
        } else {
          if (seg.endMin > seg.startMin) {
            out.push({ dayTimestamp: seg.dayTimestamp, startMin: seg.startMin, endMin: seg.endMin });
          }
        }
      }
    } else {
      // Same-day lunch [ls, le]
      if (seg.endMin <= ls || seg.startMin >= le) {
        out.push(seg);
      } else {
        if (seg.startMin < ls) {
          out.push({
            dayTimestamp: seg.dayTimestamp,
            startMin: seg.startMin,
            endMin: ls,
          });
        }
        if (seg.endMin > le) {
          out.push({
            dayTimestamp: seg.dayTimestamp,
            startMin: le,
            endMin: seg.endMin,
          });
        }
      }
    }
  }
  return out;
}

/** Split actualIn–actualOut into segments by Manila midnight (each segment = one calendar day). */
function getSegmentsByManilaDay(
  attDate: number,
  actualIn: string,
  actualOut: string,
): DaySegment[] {
  const inM = timeStringToMinutes(actualIn);
  const outM = timeStringToMinutes(actualOut);
  if (inM === null || outM === null) return [];
  const dayStart = getManilaDayStart(attDate);
  let outGlobal = outM <= inM ? MIDNIGHT_MIN + outM : outM;
  const segments: DaySegment[] = [];
  let curStart = inM;
  let curDay = dayStart;
  while (curStart < outGlobal) {
    const segEnd = Math.min(MIDNIGHT_MIN, outGlobal);
    if (segEnd > curStart) {
      segments.push({
        dayTimestamp: curDay,
        startMin: curStart,
        endMin: segEnd,
      });
    }
    curStart = 0;
    curDay += ONE_DAY_MS;
    outGlobal -= MIDNIGHT_MIN;
    if (outGlobal <= 0) break;
  }
  return segments;
}

/**
 * Night diff pay with segmented rates. Applies:
 * - Regular night (no OT, non-holiday): nightDiffRate (110%)
 * - Night on top of OT (regular day): nightDiffOnOtRate (137.5%)
 * - Night on regular holiday (same calendar day only): nightDiffRegularHolidayRate (220%)
 * - Night on special holiday (same day only): nightDiffSpecialHolidayRate (143%)
 * - Regular holiday + OT + night (same day only): nightDiffRegularHolidayOtRate (286%)
 * - Special holiday + OT + night (same day only): nightDiffSpecialHolidayOtRate (185.9%)
 * - Rest day + night: nightDiffRestDayRate (rest day premium × 110%)
 * - Rest day OT + night: nightDiffRestDayOtRate (rest day OT × 110%)
 * Hours after midnight on a holiday use regular 110% (next day is not the holiday).
 */
function calculateNightDiffPay(
  att: {
    date: number;
    actualIn?: string;
    actualOut?: string;
    scheduleIn?: string;
    scheduleOut?: string;
    overtime?: number;
    isHoliday?: boolean;
    holidayType?: string;
    lunchStart?: string;
    lunchEnd?: string;
  },
  holidays: any[],
  employee: any,
  hourlyRate: number,
  rates: ResolvedPayrollRates,
): number {
  // Prefer actual in/out; if missing or they yield no night hours, use schedule so "early in / late timeout" days still get night diff.
  const actualIn = att.actualIn;
  const actualOut = att.actualOut;
  const scheduleIn = att.scheduleIn;
  const scheduleOut = att.scheduleOut;

  const payFromActual =
    actualIn && actualOut
      ? computeNightDiffPayFromTimes(
          att,
          actualIn,
          actualOut,
          holidays,
          employee,
          hourlyRate,
          rates,
        )
      : 0;

  if (payFromActual > 0) return payFromActual;
  if (!scheduleIn || !scheduleOut) return 0;

  return computeNightDiffPayFromTimes(
    att,
    scheduleIn,
    scheduleOut,
    holidays,
    employee,
    hourlyRate,
    rates,
  );
}

/** Compute night diff pay for one record using given in/out times (actual or schedule). */
function computeNightDiffPayFromTimes(
  att: {
    date: number;
    overtime?: number;
    lunchStart?: string;
    lunchEnd?: string;
  },
  inStr: string,
  outStr: string,
  holidays: any[],
  employee: any,
  hourlyRate: number,
  rates: ResolvedPayrollRates,
): number {
  let segments = getSegmentsByManilaDay(att.date, inStr, outStr);
  if (segments.length === 0) return 0;

  // Exclude lunch break from segments so night diff is not paid for break time (e.g. 6pm–3am shift, lunch 11pm–12am).
  if (att.lunchStart != null && att.lunchEnd != null) {
    const attDayStart = getManilaDayStart(att.date);
    segments = subtractLunchFromSegments(
      segments,
      att.lunchStart,
      att.lunchEnd,
      attDayStart,
    );
  }

  const actualOutM = timeStringToMinutes(outStr);
  const actualInM = timeStringToMinutes(inStr);
  const inGlobal = actualInM ?? 0;
  const outGlobal =
    actualOutM !== null && actualOutM <= (actualInM ?? 0)
      ? MIDNIGHT_MIN + actualOutM
      : (actualOutM ?? 0);
  const otMinutes = (att.overtime ?? 0) * 60;
  const otStartGlobal = Math.max(inGlobal, outGlobal - otMinutes);

  const nightDiffRate = rates.nightDiffRate ?? 1.1;
  const nightDiffOnOt = rates.nightDiffOnOtRate ?? 1.375;
  const nightDiffRegHol = rates.nightDiffRegularHolidayRate ?? 2.2;
  const nightDiffSpecHol = rates.nightDiffSpecialHolidayRate ?? 1.43;
  const nightDiffRegHolOt = rates.nightDiffRegularHolidayOtRate ?? 2.86;
  const nightDiffSpecHolOt = rates.nightDiffSpecialHolidayOtRate ?? 1.859;
  const restDayPremiumRate = rates.restDayPremiumRate ?? 1.3;
  const restDayOt = rates.restDayOt ?? 1.69;
  const nightDiffRestDay =
    rates.nightDiffRestDayRate ?? restDayPremiumRate * nightDiffRate;
  const nightDiffRestDayOt =
    rates.nightDiffRestDayOtRate ?? restDayOt * nightDiffRate;

  let pay = 0;
  const attDayStart = getManilaDayStart(att.date);
  // Holiday rate only for night hours on the attendance calendar day. Resolve holiday once from attendance date.
  const holidayOnAttDay = getMatchingHolidayForDate(attDayStart, holidays);
  const holEntryAttDay = holidays.find((h) =>
    holidayMatchesDate(h, attDayStart),
  );
  const holidayAppliesOnAttDay =
    holidayOnAttDay &&
    employee &&
    holEntryAttDay &&
    holidayAppliesToEmployee(holEntryAttDay, employee);

  segments.forEach((seg, segmentIndex) => {
    // Only the first segment is on the attendance calendar day (segments are in chronological order).
    // 12am–6am is always the next segment = regular night only, never holiday.
    const segmentIsOnAttendanceDay = segmentIndex === 0;
    const isRegHol =
      segmentIsOnAttendanceDay &&
      holidayAppliesOnAttDay &&
      holidayOnAttDay?.type === "regular";
    const isSpecHol =
      segmentIsOnAttendanceDay &&
      holidayAppliesOnAttDay &&
      holidayOnAttDay?.type === "special";
    const isRestDaySeg =
      !isRegHol &&
      !isSpecHol &&
      isRestDay(seg.dayTimestamp, employee?.schedule ?? null);

    const segStartGlobal =
      segmentIndex === 0 ? seg.startMin : MIDNIGHT_MIN + seg.startMin;
    const segEndGlobal =
      segmentIndex === 0 ? seg.endMin : MIDNIGHT_MIN + seg.endMin;

    // Night on this calendar day: 22:00–24:00 (1320–1440) and 0:00–6:00 (0–360)
    const nightRanges: [number, number][] = [];
    if (seg.startMin < NIGHT_END_MIN) {
      const a = seg.startMin;
      const b = Math.min(seg.endMin, NIGHT_END_MIN);
      if (b > a) nightRanges.push([a, b]);
    }
    if (seg.endMin > NIGHT_START_MIN) {
      const a = Math.max(seg.startMin, NIGHT_START_MIN);
      const b = Math.min(seg.endMin, MIDNIGHT_MIN);
      if (b > a) nightRanges.push([a, b]);
    }

    const regularOt = rates.regularOt ?? 1.25;
    const regularHolidayOt = rates.regularHolidayOt ?? 2.0;
    const specialHolidayOt = rates.specialHolidayOt ?? 1.69;
    const regularHolidayRate = rates.regularHolidayRate ?? 2.0;
    const specialHolidayRate = rates.specialHolidayRate ?? 1.3;

    for (const [nStart, nEnd] of nightRanges) {
      const rangeStartGlobal =
        segmentIndex === 0 ? nStart : MIDNIGHT_MIN + nStart;
      const rangeEndGlobal =
        segmentIndex === 0 ? nEnd : MIDNIGHT_MIN + nEnd;

      // Split at OT boundary: 22:00–23:00 gets 110%, 23:00–24:00 gets night-on-OT 137.5%.
      const split =
        otStartGlobal > rangeStartGlobal && otStartGlobal < rangeEndGlobal
          ? otStartGlobal
          : null;

      const parts: { endGlobal: number; isOT: boolean }[] =
        split != null
          ? [
              { endGlobal: split, isOT: false },
              { endGlobal: rangeEndGlobal, isOT: true },
            ]
          : [
              {
                endGlobal: rangeEndGlobal,
                isOT: otStartGlobal < rangeEndGlobal,
              },
            ];

      let prevEnd = rangeStartGlobal;
      for (const { endGlobal, isOT } of parts) {
        const mins = Math.max(0, endGlobal - prevEnd);
        if (mins <= 0) continue;
        const premium = (() => {
          if (isRegHol && isOT) return nightDiffRegHolOt - regularHolidayOt;
          if (isRegHol && !isOT)
            return Math.max(0, nightDiffRegHol - regularHolidayRate);
          if (isSpecHol && isOT) return nightDiffSpecHolOt - specialHolidayOt;
          if (isSpecHol && !isOT)
            return Math.max(0, nightDiffSpecHol - specialHolidayRate);
          if (isRestDaySeg && isOT)
            return Math.max(0, nightDiffRestDayOt - restDayOt);
          if (isRestDaySeg && !isOT)
            return Math.max(0, nightDiffRestDay - restDayPremiumRate);
          if (isOT) return nightDiffOnOt - regularOt;
          return nightDiffRate >= 1 ? nightDiffRate - 1 : nightDiffRate;
        })();
        pay += (mins / 60) * hourlyRate * premium;
        prevEnd = endGlobal;
      }
    }
  });

  return pay;
}

function getLateHoursFromAttendance(att: {
  actualIn?: string;
  scheduleIn?: string;
  late?: number;
  lateManualOverride?: boolean;
  lunchStart?: string;
}): number {
  if (att.lateManualOverride === true) {
    return (att.late ?? 0) / 60;
  }

  if (att.late !== undefined && att.late !== null) {
    return att.late / 60;
  }

  const scheduleMinutes = timeStringToMinutes(att.scheduleIn);
  const actualMinutes = timeStringToMinutes(att.actualIn);
  if (scheduleMinutes === null || actualMinutes === null) return 0;
  if (att.lunchStart != null) {
    const lunchStartM = timeStringToMinutes(att.lunchStart);
    if (lunchStartM !== null && actualMinutes >= lunchStartM) return 0; // Time in after lunch = not late
  }
  return Math.max(0, actualMinutes - scheduleMinutes) / 60;
}

/** When actualOut is after midnight (e.g. 00:00) and shift is same-day (e.g. out 23:00), treat actualOut as next day so we don't count OT as undertime. */
function actualOutMinutesForUndertime(
  scheduleIn: number | null,
  scheduleOut: number,
  actualOut: number,
): number {
  if (scheduleIn === null) return actualOut;
  if (
    scheduleIn < scheduleOut &&
    actualOut < scheduleOut &&
    actualOut <= 12 * 60
  ) {
    return actualOut + 24 * 60;
  }
  return actualOut;
}

function getUndertimeHoursFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  scheduleIn?: string;
  scheduleOut?: string;
  undertime?: number;
  undertimeManualOverride?: boolean;
}): number {
  if (att.undertimeManualOverride === true) {
    return att.undertime ?? 0;
  }

  const scheduleInM = timeStringToMinutes(att.scheduleIn);
  const scheduleOutM = timeStringToMinutes(att.scheduleOut);
  const actualOutM = timeStringToMinutes(att.actualOut);
  if (scheduleOutM === null || actualOutM === null) return 0;

  const actualOutAdjusted = actualOutMinutesForUndertime(
    scheduleInM,
    scheduleOutM,
    actualOutM,
  );
  return Math.max(0, scheduleOutM - actualOutAdjusted) / 60;
}

function getHoursWorkedFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  status?: string;
  overtime?: number;
  lunchStart?: string;
  lunchEnd?: string;
}): number {
  const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
  if (att.actualIn && att.actualOut) {
    const inMins = timeStringToMinutes(att.actualIn) ?? 0;
    const outMins = timeStringToMinutes(att.actualOut) ?? 0;
    let breakMins = 60;
    if (att.lunchStart != null && att.lunchEnd != null) {
      const ls = timeStringToMinutes(att.lunchStart) ?? 0;
      const le = timeStringToMinutes(att.lunchEnd) ?? 0;
      const overlapStart = Math.max(inMins, ls);
      const overlapEnd = Math.min(outMins, le);
      breakMins = Math.max(0, overlapEnd - overlapStart);
    }
    const workMins = Math.max(0, outMins - inMins - breakMins);
    return workMins / 60;
  }
  return 8 * dayMultiplier + (att.overtime ?? 0);
}

export function calculatePayrollBaseFromRecords(args: {
  employee: any;
  cutoffStart: number;
  cutoffEnd: number;
  payFrequency: PayFrequency;
  payrollRates: ResolvedPayrollRates;
  attendance: any[];
  holidays: any[];
  leaveRequests: any[];
  leaveTypes: any[];
}): PayrollBaseResult {
  const {
    employee,
    cutoffStart,
    cutoffEnd,
    payFrequency,
    payrollRates,
    attendance,
    holidays,
    leaveRequests,
    leaveTypes,
  } = args;

  const salaryType = (employee.compensation.salaryType || "monthly") as
    | "monthly"
    | "daily"
    | "hourly";
  const payDivisor = payFrequency === "monthly" ? 1 : 2;
  const cutoffStartDay = toLocalDayTimestamp(cutoffStart);
  const cutoffEndDay = toLocalDayTimestamp(cutoffEnd);
  // Include any record that has work on at least one calendar day in the period (so overnight shifts that extend into the period are never missed).
  const periodAttendance = attendance.filter((record: any) => {
    const recordDay = toLocalDayTimestamp(record.date);
    if (recordDay >= cutoffStartDay && recordDay <= cutoffEndDay) return true;
    if (record.actualIn && record.actualOut) {
      const segs = getSegmentsByManilaDay(
        record.date,
        record.actualIn,
        record.actualOut,
      );
      const anySegmentInPeriod = segs.some((seg) => {
        const dayTs = toLocalDayTimestamp(seg.dayTimestamp);
        return dayTs >= cutoffStartDay && dayTs <= cutoffEndDay;
      });
      if (anySegmentInPeriod) return true;
    }
    return false;
  });

  const approvedLeaves = leaveRequests.filter(
    (leave: any) =>
      leave.status === "approved" &&
      leave.startDate <= cutoffEnd &&
      leave.endDate >= cutoffStart,
  );

  const isPaidLeave = (date: number): boolean => {
    const dayTs = toLocalDayTimestamp(date);

    for (const leave of approvedLeaves) {
      const leaveStart = toLocalDayTimestamp(leave.startDate);
      const leaveEnd = toLocalDayTimestamp(leave.endDate);
      if (dayTs < leaveStart || dayTs > leaveEnd) continue;

      if (leave.leaveType === "custom" && leave.customLeaveType) {
        const leaveType = leaveTypes.find(
          (entry: any) => entry.name === leave.customLeaveType,
        );
        return leaveType?.isPaid ?? false;
      }

      return (
        leave.leaveType === "vacation" ||
        leave.leaveType === "sick" ||
        leave.leaveType === "maternity" ||
        leave.leaveType === "paternity"
      );
    }

    return false;
  };

  const dailyRate = getDailyRateForEmployee(employee, {
    includeAllowance: payrollRates.dailyRateIncludesAllowance,
    workingDaysPerYear: payrollRates.dailyRateWorkingDaysPerYear,
  });
  const basicDailyRate = getDailyRateForEmployee(employee, {
    includeAllowance: false,
    workingDaysPerYear: payrollRates.dailyRateWorkingDaysPerYear,
  });
  // Absence deduction always uses (basic + allowance) × 12/261 — full daily compensation lost
  const dailyRateForAbsence = getDailyRateForEmployee(employee, {
    includeAllowance: true,
    workingDaysPerYear: payrollRates.dailyRateWorkingDaysPerYear,
  });
  // When "include allowance on daily rate" is enabled, holiday additional pay uses basic + allowance; otherwise basic only.
  const holidayPremiumBase = payrollRates.dailyRateIncludesAllowance
    ? dailyRate
    : basicDailyRate;
  const hourlyRate = dailyRate / 8;
  const basicHourlyRate = basicDailyRate / 8;
  // Late and undertime deductions use basic + allowance hourly rate, rounded to hundredths
  // so per-minute rate (e.g. P3.3525) yields correct deduction (e.g. 33.525 → P33.53).
  const hourlyRateBasicPlusAllowance = round2(
    getDailyRateForEmployee(employee, {
      includeAllowance: true,
      workingDaysPerYear: payrollRates.dailyRateWorkingDaysPerYear,
    }) / 8,
  );

  let basicPay =
    salaryType === "monthly"
      ? getPerCutoffAmount(employee.compensation.basicSalary || 0, payFrequency)
      : 0;
  let daysWorked = 0;
  let absences = 0;
  let lateHours = 0;
  let undertimeHours = 0;
  let overtimeHours = 0;
  let holidayPay = 0;
  let nightDiffPay = 0;
  let restDayPremiumPay = 0;
  let overtimeRegular = 0;
  let overtimeRestDay = 0;
  let overtimeRestDayExcess = 0;
  let overtimeSpecialHoliday = 0;
  let overtimeSpecialHolidayExcess = 0;
  let overtimeLegalHoliday = 0;
  let overtimeLegalHolidayExcess = 0;
  let lateDeduction = 0;
  let lateDeductionRegularDay = 0;
  let lateDeductionSpecialHoliday = 0;
  let lateDeductionRegularHoliday = 0;
  let undertimeDeduction = 0;
  let absentDeduction = 0;
  let holidayPayFromRegular = 0;
  let holidayPayFromSpecial = 0;

  for (const att of periodAttendance) {
    if (att.status === "present" || att.status === "half-day") {
      const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
      const isRestDayForEmployee = isRestDay(att.date, employee.schedule);
      const holidayInfo = getHolidayInfo(att.date, holidays, att, employee);
      const holidayType = holidayInfo.holidayType;
      const holidayApplies = holidayInfo.appliesToEmployee !== false;

      daysWorked += dayMultiplier;

      if (
        salaryType !== "monthly" &&
        !(
          isRestDayForEmployee &&
          holidayType !== "regular" &&
          holidayType !== "special"
        )
      ) {
        basicPay += dayMultiplier * dailyRate;
      }

      if (
        isRestDayForEmployee &&
        (!holidayInfo.isHoliday || holidayType === "special_working")
      ) {
        const hoursWorked = getHoursWorkedFromAttendance(att);
        const restDayPremiumHours = Math.min(hoursWorked, 8);
        const restDayOTHours = Math.max(0, hoursWorked - 8);
        const restDayPremiumRate =
          (payrollRates as { restDayPremiumRate?: number })
            .restDayPremiumRate ?? payrollRates.restDayOt / 1.3;
        const restDayPremiumAmount =
          restDayPremiumHours * hourlyRate * restDayPremiumRate;
        const restDayOTAmount =
          restDayOTHours * hourlyRate * payrollRates.restDayOt;
        restDayPremiumPay += restDayPremiumAmount;
        overtimeRestDay += restDayOTAmount;
        basicPay += restDayPremiumAmount + restDayOTAmount;
      }

      if (att.overtime && att.overtime > 0) {
        overtimeHours += att.overtime;

        const regularOTHours = Math.min(att.overtime, 8);
        const excessOTHours = Math.max(0, att.overtime - 8);

        // Use same hourly base as daily rate (basic+allowance when dailyRateIncludesAllowance) for OT, to match night diff and user expectation (24k/261/8 then × 125%).
        const otHourlyRate = hourlyRate;

        if (
          isRestDayForEmployee &&
          (!holidayInfo.isHoliday || holidayType === "special_working")
        ) {
          // Rest day work is already paid as rest-day premium for the actual worked hours.
        } else if (holidayType === "regular" && holidayApplies) {
          const regularOTAmount =
            regularOTHours * otHourlyRate * payrollRates.regularHolidayOt;
          const excessOTAmount =
            excessOTHours * otHourlyRate * payrollRates.regularHolidayOt;
          overtimeLegalHoliday += regularOTAmount;
          overtimeLegalHolidayExcess += excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        } else if (holidayType === "special" && holidayApplies) {
          const regularOTAmount =
            regularOTHours * otHourlyRate * payrollRates.specialHolidayOt;
          const excessOTAmount =
            excessOTHours * otHourlyRate * payrollRates.specialHolidayOt;
          overtimeSpecialHoliday += regularOTAmount;
          overtimeSpecialHolidayExcess += excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        } else {
          const regularOTAmount =
            regularOTHours * otHourlyRate * payrollRates.regularOt;
          const excessOTAmount =
            excessOTHours * otHourlyRate * payrollRates.regularOt;
          overtimeRegular += regularOTAmount + excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        }
      }

      // Late deductions: categorize by holiday type. Use employee's rate multiplier (per image 2/3):
      // Regular Holiday: late_hours × hourly_rate × employee.regularHolidayRate (e.g. 2.0 = 200%)
      // Special Holiday: late_hours × hourly_rate × employee.specialHolidayRate (e.g. 1.3 = 130%)
      // Regular Day: late_hours × hourly_rate × 1.0
      // Rates come from employee.compensation or org defaults via getEmployeePayrollRates
      const dayLateHours = getLateHoursFromAttendance(att);
      if (dayLateHours > 0) {
        lateHours += dayLateHours;
        if (holidayType === "regular" && holidayApplies) {
          lateDeductionRegularHoliday +=
            dayLateHours *
            hourlyRateBasicPlusAllowance *
            payrollRates.regularHolidayRate;
        } else if (holidayType === "special" && holidayApplies) {
          lateDeductionSpecialHoliday +=
            dayLateHours *
            hourlyRateBasicPlusAllowance *
            payrollRates.specialHolidayRate;
        } else {
          lateDeductionRegularDay +=
            dayLateHours * hourlyRateBasicPlusAllowance;
        }
      }

      const dayUndertimeHours = getUndertimeHoursFromAttendance(att);
      if (dayUndertimeHours > 0) {
        undertimeHours += dayUndertimeHours;
        undertimeDeduction += dayUndertimeHours * hourlyRateBasicPlusAllowance;
      }

      if (holidayType === "regular" && holidayApplies) {
        // Show full holiday pay on payslip; lost portion (if late) is in lateDeductionRegularHoliday
        const rate = payrollRates.regularHolidayRate;
        const fullPremium =
          holidayPremiumBase * Math.max(0, rate - 1) * dayMultiplier;
        holidayPay += fullPremium;
        holidayPayFromRegular += fullPremium;
      } else if (holidayType === "special" && holidayApplies) {
        const rate = payrollRates.specialHolidayRate;
        const fullPremium =
          holidayPremiumBase * Math.max(0, rate - 1) * dayMultiplier;
        holidayPay += fullPremium;
        holidayPayFromSpecial += fullPremium;
      }

      const dayNightDiffAmount = calculateNightDiffPay(
        att,
        holidays,
        employee,
        hourlyRateBasicPlusAllowance,
        payrollRates,
      );
      nightDiffPay += dayNightDiffAmount;
    } else if (att.status === "no_work") {
      // Holiday (or similar) when employee did not work — no additional pay, no absence
      continue;
    } else if (att.status === "leave" || att.status === "leave_with_pay") {
      // leave = legacy, treat as leave_with_pay
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
      }
    } else if (att.status === "leave_without_pay" || att.status === "absent") {
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        continue;
      }

      const holidayInfo = getHolidayInfo(att.date, holidays, att, employee);
      if (
        holidayInfo.holidayType === "regular" &&
        holidayInfo.appliesToEmployee !== false
      ) {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        const rate = payrollRates.regularHolidayRate;
        const amount = holidayPremiumBase * Math.max(0, rate - 1);
        holidayPay += amount;
        holidayPayFromRegular += amount;
        continue;
      }

      if (
        holidayInfo.holidayType === "special" &&
        holidayInfo.appliesToEmployee !== false
      ) {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        continue;
      }

      absences += 1;
      if (salaryType === "monthly") {
        absentDeduction += dailyRateForAbsence;
      }
    }
  }

  const attendanceDates = new Set(
    periodAttendance.map((record: any) => toLocalDayTimestamp(record.date)),
  );
  const currentDate = new Date(toLocalDayTimestamp(cutoffStart));
  const lastDate = new Date(toLocalDayTimestamp(cutoffEnd));

  while (currentDate <= lastDate) {
    const dateTs = currentDate.getTime();
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);

    if (attendanceDates.has(dateTs)) continue;

    if (isPaidLeave(dateTs)) {
      daysWorked += 1;
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      continue;
    }

    const holidayInfo = getHolidayInfo(dateTs, holidays, undefined, employee);
    if (
      holidayInfo.holidayType === "regular" &&
      holidayInfo.appliesToEmployee !== false
    ) {
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      const rate = payrollRates.regularHolidayRate;
      const amount = holidayPremiumBase * Math.max(0, rate - 1);
      holidayPay += amount;
      holidayPayFromRegular += amount;
      continue;
    }

    if (
      holidayInfo.holidayType === "special" &&
      holidayInfo.appliesToEmployee !== false
    ) {
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      continue;
    }

    if (isRestDay(dateTs, employee.schedule)) {
      continue;
    }

    if (holidayInfo.holidayType === "special_working") {
      absences += 1;
      if (salaryType === "monthly") {
        absentDeduction += dailyRateForAbsence;
      }
    }
  }

  // Total late deduction = regular day + holiday late portions
  lateDeduction =
    lateDeductionRegularDay +
    lateDeductionSpecialHoliday +
    lateDeductionRegularHoliday;

  const holidayPayType =
    holidayPayFromSpecial > 0
      ? "special"
      : holidayPayFromRegular > 0
        ? "regular"
        : undefined;

  // Round all monetary amounts to nearest hundredths for payslip
  return {
    basicPay: round2(basicPay),
    daysWorked,
    absences,
    lateHours,
    undertimeHours,
    overtimeHours,
    holidayPay: round2(holidayPay),
    holidayPayType,
    nightDiffPay: round2(nightDiffPay),
    restDayPremiumPay: round2(restDayPremiumPay),
    overtimeRegular: round2(overtimeRegular),
    overtimeRestDay: round2(overtimeRestDay),
    overtimeRestDayExcess: round2(overtimeRestDayExcess),
    overtimeSpecialHoliday: round2(overtimeSpecialHoliday),
    overtimeSpecialHolidayExcess: round2(overtimeSpecialHolidayExcess),
    overtimeLegalHoliday: round2(overtimeLegalHoliday),
    overtimeLegalHolidayExcess: round2(overtimeLegalHolidayExcess),
    lateDeduction: round2(lateDeduction),
    lateDeductionRegularDay: round2(lateDeductionRegularDay),
    lateDeductionSpecialHoliday: round2(lateDeductionSpecialHoliday),
    lateDeductionRegularHoliday: round2(lateDeductionRegularHoliday),
    undertimeDeduction: round2(undertimeDeduction),
    absentDeduction: round2(absentDeduction),
    dailyRate: round2(dailyRate),
    hourlyRate: round2(hourlyRate),
    salaryType,
    payDivisor,
    payrollRates,
  };
}
