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
  if (!holiday) return { isHoliday: false };
  const appliesToEmployee = holidayAppliesToEmployee(holiday, employee ?? {});
  if (!appliesToEmployee) return { isHoliday: false };
  // Use attendance's type when set (from backfill/edit), so per-record classification is preserved.
  const type =
    attendanceRecord?.isHoliday && attendanceRecord?.holidayType
      ? (attendanceRecord.holidayType as HolidayType)
      : holiday.type;
  return {
    isHoliday: true,
    holidayType: type,
    appliesToEmployee: true,
  };
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
 * Uses only attendance in the cutoff: for each day, count hours the employee actually
 * worked beyond 10pm (or in 12am–6am). No schedule overlap requirement.
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

  const nightStart = 22 * 60; // 10:00 PM
  const nightEnd = 24 * 60 + 6 * 60; // 6:00 AM next day (1800 min from midnight)

  // Normalize actual span to handle overnight (e.g. 22:00–06:00)
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
  actualOut?: string;
  scheduleOut?: string;
  undertime?: number;
  undertimeManualOverride?: boolean;
}): number {
  if (att.undertimeManualOverride === true) {
    return att.undertime ?? 0;
  }

  const scheduleOutM = timeStringToMinutes(att.scheduleOut);
  const actualOutM = timeStringToMinutes(att.actualOut);
  if (scheduleOutM === null || actualOutM === null) return 0;

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

  const salaryType = (employee.compensation.salaryType || "monthly") as
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

      const dayNightDiffHours = calculateNightDiffHours(
        att.actualIn,
        att.actualOut,
        att.scheduleIn,
        att.scheduleOut,
      );
      if (dayNightDiffHours > 0) {
        // Use same hourly rate as other earnings (basic + allowance) for 10% night diff
        nightDiffPay +=
          dayNightDiffHours * hourlyRateBasicPlusAllowance * payrollRates.nightDiffRate;
      }
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
