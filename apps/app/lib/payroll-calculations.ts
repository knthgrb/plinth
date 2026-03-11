export type DailyRateOptions = {
  includeAllowance: boolean;
  workingDaysPerYear: number;
};

export type PayFrequency = "monthly" | "bimonthly";
export type HolidayType = "regular" | "special" | "special_working";

export type PayrollRates = {
  regularOt: number;
  specialHolidayOt: number;
  regularHolidayOt: number;
  restDayOt: number;
  nightDiffRate: number;
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
  overtimeRegular: number;
  overtimeRestDay: number;
  overtimeRestDayExcess: number;
  overtimeSpecialHoliday: number;
  overtimeSpecialHolidayExcess: number;
  overtimeLegalHoliday: number;
  overtimeLegalHolidayExcess: number;
  lateDeduction: number;
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

function getManilaDateParts(date: number): { y: number; m: number; d: number; dayOfWeek: number } {
  const d = new Date(date + MANILA_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

function getDayName(date: number): string {
  const dayNames = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
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

function holidayMatchesDate(holiday: any, date: number): boolean {
  const effectiveTimestamp = holiday.offsetDate ?? holiday.date;
  const targetParts = getManilaDateParts(date);
  const holidayParts = getManilaDateParts(new Date(effectiveTimestamp).getTime());

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

function holidayAppliesToEmployee(holiday: any, employee: any): boolean {
  if (holiday.applyToAll !== false) return true;
  const provinces = holiday.provinces as string[] | undefined;
  if (!provinces || provinces.length === 0) return true;
  const empProvince = (employee?.personalInfo?.province ?? "").trim();
  if (!empProvince) return false;
  return provinces.some(
    (p) => String(p).trim().toLowerCase() === empProvince.toLowerCase()
  );
}

function getHolidayInfo(
  date: number,
  holidays: any[],
  attendanceRecord?: any,
  employee?: any,
): { isHoliday: boolean; holidayType?: HolidayType; appliesToEmployee?: boolean } {
  // Prefer holiday list (source of truth) so prod and local match; use Manila date matching.
  const holiday = holidays.find((entry) => holidayMatchesDate(entry, date));
  if (holiday) {
    const appliesToEmployee = holidayAppliesToEmployee(holiday, employee ?? {});
    return {
      isHoliday: true,
      holidayType: holiday.type,
      appliesToEmployee,
    };
  }
  // No matching holiday by date — use attendance if marked as holiday (e.g. one-off).
  if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
    return {
      isHoliday: true,
      holidayType: attendanceRecord.holidayType,
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
 * Calculate night diff hours: overlap of (scheduled shift ∩ 10pm-6am) ∩ actual worked.
 * Night diff applies only when the employee's SCHEDULED shift includes the 10pm-6am
 * window. Early clock-in (e.g. 5:40am when scheduled 6am) does not qualify.
 */
function calculateNightDiffHours(
  actualIn: string | undefined,
  actualOut: string | undefined,
  scheduleIn: string | undefined,
  scheduleOut: string | undefined,
): number {
  const actualStart = timeStringToMinutes(actualIn);
  const actualEnd = timeStringToMinutes(actualOut);
  const scheduleStart = timeStringToMinutes(scheduleIn);
  const scheduleEnd = timeStringToMinutes(scheduleOut);

  if (actualStart === null || actualEnd === null) return 0;
  if (scheduleStart === null || scheduleEnd === null) {
    // Fallback: if no schedule, use old behavior (actual ∩ night) for backward compat
    return calculateNightDiffHoursFallback(actualIn, actualOut);
  }

  const nightStart = 22 * 60;
  const nightEnd = 30 * 60; // 6:00 AM next day

  // Normalize times to handle overnight shifts (e.g. 22:00-06:00)
  const norm = (start: number, end: number) => {
    let s = start;
    let e = end;
    if (s < 6 * 60) {
      s += 24 * 60;
      e += 24 * 60;
    } else if (e <= s) {
      e += 24 * 60;
    }
    return { start: s, end: e };
  };

  const sched = norm(scheduleStart, scheduleEnd);
  const schedNightStart = Math.max(sched.start, nightStart);
  const schedNightEnd = Math.min(sched.end, nightEnd);
  if (schedNightEnd <= schedNightStart) return 0;
  // Scheduled shift has no overlap with 10pm-6am → no night diff

  const act = norm(actualStart, actualEnd);
  const actNightStart = Math.max(act.start, nightStart);
  const actNightEnd = Math.min(act.end, nightEnd);
  if (actNightEnd <= actNightStart) return 0;

  const overlapStart = Math.max(schedNightStart, actNightStart);
  const overlapEnd = Math.min(schedNightEnd, actNightEnd);
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / 60;
}

function calculateNightDiffHoursFallback(
  actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  let startMinutes = timeStringToMinutes(actualIn);
  let endMinutes = timeStringToMinutes(actualOut);
  if (startMinutes === null || endMinutes === null) return 0;
  if (startMinutes < 6 * 60) {
    startMinutes += 24 * 60;
    endMinutes += 24 * 60;
  } else if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }
  const nightStart = 22 * 60;
  const nightEnd = 30 * 60;
  const overlapStart = Math.max(startMinutes, nightStart);
  const overlapEnd = Math.min(endMinutes, nightEnd);
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / 60;
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

function getUndertimeHoursFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  scheduleIn?: string;
  scheduleOut?: string;
  undertime?: number;
  undertimeManualOverride?: boolean;
  lunchStart?: string;
  lunchEnd?: string;
}): number {
  if (att.undertimeManualOverride === true) {
    return att.undertime ?? 0;
  }

  const scheduleOutM = timeStringToMinutes(att.scheduleOut);
  const actualOutM = timeStringToMinutes(att.actualOut);
  if (scheduleOutM === null || actualOutM === null) return 0;

  const lunchStartM = att.lunchStart != null ? timeStringToMinutes(att.lunchStart) : null;
  const lunchEndM = att.lunchEnd != null ? timeStringToMinutes(att.lunchEnd) : null;
  const scheduleInM = timeStringToMinutes(att.scheduleIn);
  const actualInM = timeStringToMinutes(att.actualIn);

  if (
    lunchStartM !== null &&
    lunchEndM !== null &&
    scheduleInM !== null &&
    actualInM !== null &&
    lunchEndM > lunchStartM
  ) {
    const breakMins = lunchEndM - lunchStartM;
    const requiredWorkMins = Math.max(0, scheduleOutM - scheduleInM - breakMins);
    const breakDeducted =
      actualInM >= lunchEndM
        ? 0
        : Math.max(0, Math.min(actualOutM, lunchEndM) - Math.max(actualInM, lunchStartM));
    const actualWorkMins = Math.max(0, actualOutM - actualInM - breakDeducted);
    const undertimeMins = Math.max(0, requiredWorkMins - actualWorkMins);
    return undertimeMins / 60;
  }

  return Math.max(0, scheduleOutM - actualOutM) / 60;
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

  const salaryType =
    (employee.compensation.salaryType || "monthly") as
      | "monthly"
      | "daily"
      | "hourly";
  const payDivisor = payFrequency === "monthly" ? 1 : 2;
  const cutoffStartDay = toLocalDayTimestamp(cutoffStart);
  const cutoffEndDay = toLocalDayTimestamp(cutoffEnd);
  const periodAttendance = attendance.filter((record: any) => {
    const recordDay = toLocalDayTimestamp(record.date);
    return recordDay >= cutoffStartDay && recordDay <= cutoffEndDay;
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
  // When "include allowance on daily rate" is enabled, holiday additional pay uses basic + allowance; otherwise basic only.
  const holidayPremiumBase = payrollRates.dailyRateIncludesAllowance
    ? dailyRate
    : basicDailyRate;
  const hourlyRate = dailyRate / 8;
  const basicHourlyRate = basicDailyRate / 8;
  // Late and undertime deductions always use basic + allowance hourly rate.
  const hourlyRateBasicPlusAllowance = getDailyRateForEmployee(employee, {
    includeAllowance: true,
    workingDaysPerYear: payrollRates.dailyRateWorkingDaysPerYear,
  }) / 8;

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
  let overtimeRegular = 0;
  let overtimeRestDay = 0;
  let overtimeRestDayExcess = 0;
  let overtimeSpecialHoliday = 0;
  let overtimeSpecialHolidayExcess = 0;
  let overtimeLegalHoliday = 0;
  let overtimeLegalHolidayExcess = 0;
  let lateDeduction = 0;
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
        !(isRestDayForEmployee && holidayType !== "regular" && holidayType !== "special")
      ) {
        basicPay += dayMultiplier * dailyRate;
      }

      if (
        isRestDayForEmployee &&
        (!holidayInfo.isHoliday || holidayType === "special_working")
      ) {
        const hoursWorked = getHoursWorkedFromAttendance(att);
        const restDayAmount = hoursWorked * hourlyRate * payrollRates.restDayOt;
        overtimeRestDay += restDayAmount;
        basicPay += restDayAmount;
      }

      if (att.overtime && att.overtime > 0) {
        overtimeHours += att.overtime;

        const regularOTHours = Math.min(att.overtime, 8);
        const excessOTHours = Math.max(0, att.overtime - 8);

        if (
          isRestDayForEmployee &&
          (!holidayInfo.isHoliday || holidayType === "special_working")
        ) {
          // Rest day work is already paid as rest-day premium for the actual worked hours.
        } else if (holidayType === "regular" && holidayApplies) {
          const regularOTAmount =
            regularOTHours * basicHourlyRate * payrollRates.regularHolidayOt;
          const excessOTAmount =
            excessOTHours * basicHourlyRate * payrollRates.regularHolidayOt;
          overtimeLegalHoliday += regularOTAmount;
          overtimeLegalHolidayExcess += excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        } else if (holidayType === "special" && holidayApplies) {
          const regularOTAmount =
            regularOTHours * basicHourlyRate * payrollRates.specialHolidayOt;
          const excessOTAmount =
            excessOTHours * basicHourlyRate * payrollRates.specialHolidayOt;
          overtimeSpecialHoliday += regularOTAmount;
          overtimeSpecialHolidayExcess += excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        } else {
          const regularOTAmount =
            regularOTHours * basicHourlyRate * payrollRates.regularOt;
          const excessOTAmount =
            excessOTHours * basicHourlyRate * payrollRates.regularOt;
          overtimeRegular += regularOTAmount + excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        }
      }

      // Late and undertime deductions use basic + allowance hourly rate (not basic only).
      const dayLateHours = getLateHoursFromAttendance(att);
      if (dayLateHours > 0) {
        lateHours += dayLateHours;
        lateDeduction += dayLateHours * hourlyRateBasicPlusAllowance;
      }

      const dayUndertimeHours = getUndertimeHoursFromAttendance(att);
      if (dayUndertimeHours > 0) {
        undertimeHours += dayUndertimeHours;
        undertimeDeduction += dayUndertimeHours * hourlyRateBasicPlusAllowance;
      }

      if (holidayType === "regular" && holidayApplies) {
        const amount =
          holidayPremiumBase * payrollRates.regularHolidayRate * dayMultiplier;
        holidayPay += amount;
        holidayPayFromRegular += amount;
      } else if (holidayType === "special" && holidayApplies) {
        const amount =
          holidayPremiumBase * payrollRates.specialHolidayRate * dayMultiplier;
        holidayPay += amount;
        holidayPayFromSpecial += amount;
      }

      const dayNightDiffHours = calculateNightDiffHours(
        att.actualIn,
        att.actualOut,
        att.scheduleIn,
        att.scheduleOut,
      );
      if (dayNightDiffHours > 0) {
        nightDiffPay +=
          dayNightDiffHours * basicHourlyRate * payrollRates.nightDiffRate;
      }
    } else if (att.status === "no_work") {
      // Holiday (or similar) when employee did not work — no additional pay, no absence
      continue;
    } else if (
      att.status === "leave" ||
      att.status === "leave_with_pay"
    ) {
      // leave = legacy, treat as leave_with_pay
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
      }
    } else if (
      att.status === "leave_without_pay" ||
      att.status === "absent"
    ) {
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        continue;
      }

      const holidayInfo = getHolidayInfo(att.date, holidays, att, employee);
      if (holidayInfo.holidayType === "regular" && holidayInfo.appliesToEmployee !== false) {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        const amount = holidayPremiumBase * payrollRates.regularHolidayRate;
        holidayPay += amount;
        holidayPayFromRegular += amount;
        continue;
      }

      if (holidayInfo.holidayType === "special" && holidayInfo.appliesToEmployee !== false) {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        continue;
      }

      absences += 1;
      if (salaryType === "monthly") {
        absentDeduction += dailyRate;
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
    if (holidayInfo.holidayType === "regular" && holidayInfo.appliesToEmployee !== false) {
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      const amount = holidayPremiumBase * payrollRates.regularHolidayRate;
      holidayPay += amount;
      holidayPayFromRegular += amount;
      continue;
    }

    if (holidayInfo.holidayType === "special" && holidayInfo.appliesToEmployee !== false) {
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
        absentDeduction += dailyRate;
      }
    }
  }

  const holidayPayType =
    holidayPayFromSpecial > 0
      ? "special"
      : holidayPayFromRegular > 0
        ? "regular"
        : undefined;

  return {
    basicPay,
    daysWorked,
    absences,
    lateHours,
    undertimeHours,
    overtimeHours,
    holidayPay,
    holidayPayType,
    nightDiffPay,
    overtimeRegular,
    overtimeRestDay,
    overtimeRestDayExcess,
    overtimeSpecialHoliday,
    overtimeSpecialHolidayExcess,
    overtimeLegalHoliday,
    overtimeLegalHolidayExcess,
    lateDeduction,
    undertimeDeduction,
    absentDeduction,
    dailyRate,
    hourlyRate,
    salaryType,
    payDivisor,
    payrollRates,
  };
}
