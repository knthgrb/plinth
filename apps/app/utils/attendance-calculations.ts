/**
 * Parse "HH:mm" to minutes since midnight.
 */
function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const MAX_LATE_MINUTES = 60;

const MIDNIGHT_MIN = 24 * 60;

const MANILA_MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Manila wall-clock offset used elsewhere (attendance schedule, payroll). */
export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * In/out on one shift as minutes from 00:00 on the attendance calendar day,
 * with clock-out past midnight as minutes beyond 1440 (same as payroll `pairInOutGlobalMinutes`).
 */
export function pairInOutGlobalMinutes(
  inStr: string,
  outStr: string,
): { inGlobal: number; outGlobal: number } | null {
  const inM = timeToMins(inStr);
  const outM = timeToMins(outStr);
  if (!Number.isFinite(inM) || !Number.isFinite(outM)) return null;
  const outGlobal = outM <= inM ? MIDNIGHT_MIN + outM : outM;
  return { inGlobal: inM, outGlobal };
}

/** True when clock-out is interpreted as the next calendar day (e.g. in 2:00 PM, out 12:00 AM). */
export function clockOutIsNextCalendarDay(timeIn: string, timeOut: string): boolean {
  if (!timeIn?.trim() || !timeOut?.trim()) return false;
  return timeToMins(timeOut) <= timeToMins(timeIn);
}

/** True when scheduled end is the morning after scheduled start (overnight shift). */
export function scheduleEndsNextCalendarDay(schedIn: string, schedOut: string): boolean {
  if (!schedIn?.trim() || !schedOut?.trim()) return false;
  return timeToMins(schedOut) <= timeToMins(schedIn);
}

/** Label for the attendance row’s calendar day in Manila (for `record.date` timestamps). */
export function formatManilaAttendanceDayLabel(recordDateTs: number): string {
  const u = new Date(recordDateTs + MANILA_OFFSET_MS);
  return `${MANILA_MONTH_SHORT[u.getUTCMonth()]} ${u.getUTCDate()}, ${u.getUTCFullYear()}`;
}

/** Next Manila calendar day after the attendance row day (for “time out is next day” hints). */
export function formatNextManilaCalendarDayFromAttendanceTs(recordDateTs: number): string {
  const u = new Date(recordDateTs + MANILA_OFFSET_MS);
  const next = new Date(
    Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate() + 1),
  );
  return `${MANILA_MONTH_SHORT[next.getUTCMonth()]} ${next.getUTCDate()}, ${next.getUTCFullYear()}`;
}

/** `yyyy-MM-dd` from a date picker → same calendar label as Manila (date-only, no TZ ambiguity). */
export function formatAttendanceDateLabelFromYmd(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const u = new Date(Date.UTC(y, mo - 1, d));
  return `${MANILA_MONTH_SHORT[u.getUTCMonth()]} ${u.getUTCDate()}, ${u.getUTCFullYear()}`;
}

export function formatNextDayLabelFromYmd(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const u = new Date(Date.UTC(y, mo - 1, d + 1));
  return `${MANILA_MONTH_SHORT[u.getUTCMonth()]} ${u.getUTCDate()}, ${u.getUTCFullYear()}`;
}

/**
 * Calculate late time in minutes (arrival after scheduled start).
 * Per policy: late and undertime are independent — late = late arrival only.
 * When lunchStart is provided: if actualIn is at or after lunchStart, count as 0 late (time in after lunch = undertime, not late).
 */
export function calculateLate(
  scheduleIn: string,
  actualIn: string | undefined,
  lunchStart?: string,
): number {
  if (!actualIn) return 0;

  const scheduleMinutes = timeToMins(scheduleIn);
  const actualMinutes = timeToMins(actualIn);

  if (lunchStart != null) {
    const lunchStartMins = timeToMins(lunchStart);
    if (actualMinutes >= lunchStartMins) return 0;
  }

  const lateMinutes = actualMinutes - scheduleMinutes;
  if (lateMinutes <= 0) return 0;

  // Policy: maximum of 60 minutes is treated as "late".
  // If the employee is more than 60 minutes late, treat all of it as undertime instead (late = 0).
  if (lateMinutes > MAX_LATE_MINUTES) return 0;

  return lateMinutes;
}

/**
 * Calculate undertime in hours.
 * Uses the same global timeline as payroll: clock-out at or before clock-in on the clock face
 * is treated as the next calendar day (e.g. 14:00–00:00 → 10 hours worked, not negative span).
 */
export function calculateUndertime(
  scheduleIn: string,
  scheduleOut: string,
  actualIn: string | undefined,
  actualOut: string | undefined,
  lunchStart?: string,
  lunchEnd?: string,
): number {
  if (!actualIn || !actualOut) return 0;

  const act = pairInOutGlobalMinutes(actualIn, actualOut);
  const sch = pairInOutGlobalMinutes(scheduleIn, scheduleOut);
  if (!act || !sch) return 0;

  let scheduledWorkMinutes = Math.max(0, sch.outGlobal - sch.inGlobal);
  if (lunchStart != null && lunchEnd != null) {
    const ls = timeToMins(lunchStart);
    const le = timeToMins(lunchEnd);
    if (ls < le) {
      const overlapStart = Math.max(sch.inGlobal, ls);
      const overlapEnd = Math.min(sch.outGlobal, le);
      const lunchOverlap = Math.max(0, overlapEnd - overlapStart);
      scheduledWorkMinutes = Math.max(0, scheduledWorkMinutes - lunchOverlap);
    }
  }

  let actualWorkMinutes = Math.max(0, act.outGlobal - act.inGlobal);
  if (lunchStart != null && lunchEnd != null) {
    const ls = timeToMins(lunchStart);
    const le = timeToMins(lunchEnd);
    if (ls < le) {
      const overlapStart = Math.max(act.inGlobal, ls);
      const overlapEnd = Math.min(act.outGlobal, le);
      const lunchOverlap = Math.max(0, overlapEnd - overlapStart);
      actualWorkMinutes = Math.max(0, actualWorkMinutes - lunchOverlap);
    }
  }

  const rawUndertimeMinutes = Math.max(
    0,
    scheduledWorkMinutes - actualWorkMinutes,
  );

  const lateForDay = calculateLate(scheduleIn, actualIn, lunchStart);
  const undertimeMinutes = Math.max(0, rawUndertimeMinutes - lateForDay);

  return undertimeMinutes / 60;
}

/**
 * Convert time string (HH:mm) to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Calculate overtime in hours (actual end after scheduled end on the global timeline).
 * Pass `actualIn` whenever possible so overnight clock-out is interpreted correctly.
 */
export function calculateOvertime(
  scheduleOut: string,
  actualOut: string | undefined,
  scheduleIn?: string,
  actualIn?: string,
): number {
  if (!actualOut?.trim()) return 0;

  if (scheduleIn?.trim() && actualIn?.trim()) {
    const act = pairInOutGlobalMinutes(actualIn, actualOut);
    const sch = pairInOutGlobalMinutes(scheduleIn, scheduleOut);
    if (!act || !sch) return 0;
    const overtimeMinutes = act.outGlobal - sch.outGlobal;
    return overtimeMinutes > 0 ? overtimeMinutes / 60 : 0;
  }

  const scheduleOutM = timeToMins(scheduleOut);
  let actualOutM = timeToMins(actualOut);
  if (actualOutM < scheduleOutM && actualOutM <= 12 * 60) {
    actualOutM += MIDNIGHT_MIN;
  }

  const overtimeMinutes = actualOutM - scheduleOutM;
  return overtimeMinutes > 0 ? overtimeMinutes / 60 : 0;
}

/**
 * Convert minutes since midnight to time string (HH:mm)
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Format 24-hour time string (HH:mm) for display as 12-hour with AM/PM
 * e.g. "09:30" → "9:30 AM", "14:00" → "2:00 PM"
 */
export function formatTime12Hour(time24: string): string {
  if (!time24 || typeof time24 !== "string") return "";
  const parts = time24.trim().split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) || 0;
  if (isNaN(hours)) return "";
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

/**
 * Format 24-hour time with AM/PM on a separate line below (for uniform table display).
 * e.g. "09:30" → "9:30\nAM", "22:56" → "10:56\nPM"
 */
export function formatTime12HourStacked(time24: string): string {
  if (!time24 || typeof time24 !== "string") return "";
  const parts = time24.trim().split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) || 0;
  if (isNaN(hours)) return "";
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hour12}:${minutes.toString().padStart(2, "0")}\n${period}`;
}
