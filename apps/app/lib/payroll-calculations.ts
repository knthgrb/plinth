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
  const dateObj = new Date(date);
  return dayNames[dateObj.getDay()];
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
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) =>
        new Date(o.date).toDateString() === new Date(date).toDateString(),
    );
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

function toLocalDayTimestamp(date: number): number {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  return dateObj.getTime();
}

function holidayMatchesDate(holiday: any, date: number): boolean {
  // Payroll uses offset date as the holiday date when set
  const effectiveTimestamp = holiday.offsetDate ?? holiday.date;
  const holidayDate = new Date(effectiveTimestamp);
  const targetDate = new Date(date);

  if (holiday.isRecurring) {
    return (
      holidayDate.getMonth() === targetDate.getMonth() &&
      holidayDate.getDate() === targetDate.getDate()
    );
  }

  if (holiday.year != null && holiday.year !== targetDate.getFullYear()) {
    return false;
  }

  return (
    holidayDate.getFullYear() === targetDate.getFullYear() &&
    holidayDate.getMonth() === targetDate.getMonth() &&
    holidayDate.getDate() === targetDate.getDate()
  );
}

function getHolidayInfo(
  date: number,
  holidays: any[],
  attendanceRecord?: any,
): { isHoliday: boolean; holidayType?: HolidayType } {
  if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
    return {
      isHoliday: true,
      holidayType: attendanceRecord.holidayType,
    };
  }

  const holiday = holidays.find((entry) => holidayMatchesDate(entry, date));
  if (holiday) {
    return {
      isHoliday: true,
      holidayType: holiday.type,
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

function calculateNightDiffHours(
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

  if (att.undertime !== undefined && att.undertime !== null) {
    return att.undertime;
  }

  const scheduleMinutes = timeStringToMinutes(att.scheduleOut);
  const actualMinutes = timeStringToMinutes(att.actualOut);
  if (scheduleMinutes === null || actualMinutes === null) return 0;
  return Math.max(0, scheduleMinutes - actualMinutes) / 60;
}

function getHoursWorkedFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  status?: string;
  overtime?: number;
}): number {
  const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
  if (att.actualIn && att.actualOut) {
    const [inH, inM] = att.actualIn.split(":").map(Number);
    const [outH, outM] = att.actualOut.split(":").map(Number);
    const inMins = (inH ?? 0) * 60 + (inM ?? 0);
    const outMins = (outH ?? 0) * 60 + (outM ?? 0);
    const workMins = outMins - inMins - 60;
    return Math.max(0, workMins / 60);
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
  const hourlyRate = dailyRate / 8;
  const basicHourlyRate = basicDailyRate / 8;

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

  for (const att of periodAttendance) {
    if (att.status === "present" || att.status === "half-day") {
      const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
      const isRestDayForEmployee = isRestDay(att.date, employee.schedule);
      const holidayInfo = getHolidayInfo(att.date, holidays, att);
      const holidayType = holidayInfo.holidayType;

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
        } else if (holidayType === "regular") {
          const regularOTAmount =
            regularOTHours * basicHourlyRate * payrollRates.regularHolidayOt;
          const excessOTAmount =
            excessOTHours * basicHourlyRate * payrollRates.regularHolidayOt;
          overtimeLegalHoliday += regularOTAmount;
          overtimeLegalHolidayExcess += excessOTAmount;
          basicPay += regularOTAmount + excessOTAmount;
        } else if (holidayType === "special") {
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

      const dayLateHours = getLateHoursFromAttendance(att);
      if (dayLateHours > 0) {
        lateHours += dayLateHours;
        lateDeduction += dayLateHours * basicHourlyRate;
      }

      const dayUndertimeHours = getUndertimeHoursFromAttendance(att);
      if (dayUndertimeHours > 0) {
        undertimeHours += dayUndertimeHours;
        undertimeDeduction += dayUndertimeHours * basicHourlyRate;
      }

      if (holidayType === "regular") {
        holidayPay +=
          basicDailyRate * payrollRates.regularHolidayRate * dayMultiplier;
      } else if (holidayType === "special") {
        holidayPay +=
          basicDailyRate * payrollRates.specialHolidayRate * dayMultiplier;
      }

      const dayNightDiffHours = calculateNightDiffHours(
        att.actualIn,
        att.actualOut,
      );
      if (dayNightDiffHours > 0) {
        nightDiffPay +=
          dayNightDiffHours * basicHourlyRate * payrollRates.nightDiffRate;
      }
    } else if (att.status === "leave") {
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
      }
    } else if (att.status === "absent") {
      if (isPaidLeave(att.date)) {
        daysWorked += 1;
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        continue;
      }

      const holidayInfo = getHolidayInfo(att.date, holidays, att);
      if (holidayInfo.holidayType === "regular") {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        holidayPay += basicDailyRate * payrollRates.regularHolidayRate;
        continue;
      }

      if (holidayInfo.holidayType === "special") {
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
    currentDate.setDate(currentDate.getDate() + 1);

    if (attendanceDates.has(dateTs)) continue;

    if (isPaidLeave(dateTs)) {
      daysWorked += 1;
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      continue;
    }

    const holidayInfo = getHolidayInfo(dateTs, holidays);
    if (holidayInfo.holidayType === "regular") {
      if (salaryType !== "monthly") {
        basicPay += dailyRate;
      }
      holidayPay += basicDailyRate * payrollRates.regularHolidayRate;
      continue;
    }

    if (holidayInfo.holidayType === "special") {
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

  return {
    basicPay,
    daysWorked,
    absences,
    lateHours,
    undertimeHours,
    overtimeHours,
    holidayPay,
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
