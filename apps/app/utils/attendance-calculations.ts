/**
 * Parse "HH:mm" to minutes since midnight.
 */
function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
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
    if (actualMinutes >= lunchStartMins) return 0; // Clock in after/during lunch = not late
  }

  const lateMinutes = actualMinutes - scheduleMinutes;
  return lateMinutes > 0 ? lateMinutes : 0;
}

/**
 * Calculate undertime in hours.
 * Policy: Undertime = early departure only (when time out is earlier than scheduled time out).
 * Late arrival (time in) is handled separately and is NOT counted as undertime.
 */
export function calculateUndertime(
  _scheduleIn: string,
  scheduleOut: string,
  _actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  if (!actualOut) return 0;

  const scheduleOutM = timeToMins(scheduleOut);
  const actualOutM = timeToMins(actualOut);

  const undertimeMinutes = Math.max(0, scheduleOutM - actualOutM);
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
 * Calculate overtime in hours
 * Overtime is calculated when actual time out is after scheduled time out
 * @param scheduleOut - Scheduled time out (HH:mm format)
 * @param actualOut - Actual time out (HH:mm format)
 * @returns Hours overtime, or 0 if no overtime
 */
export function calculateOvertime(
  scheduleOut: string,
  actualOut: string | undefined,
): number {
  if (!actualOut) return 0;

  const [scheduleOutHour, scheduleOutMin] = scheduleOut.split(":").map(Number);
  const [actualOutHour, actualOutMin] = actualOut.split(":").map(Number);

  const scheduleOutMinutes = scheduleOutHour * 60 + scheduleOutMin;
  const actualOutMinutes = actualOutHour * 60 + actualOutMin;

  const overtimeMinutes = actualOutMinutes - scheduleOutMinutes;
  const overtimeHours = overtimeMinutes / 60;

  return overtimeHours > 0 ? overtimeHours : 0;
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
