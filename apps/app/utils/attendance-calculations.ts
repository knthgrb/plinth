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
 * When actualOut is earlier in the day than scheduleOut (e.g. out 23:00, actual 00:00),
 * treat actualOut as next-day so we don't count overtime as undertime.
 * Same-day shift: scheduleIn < scheduleOut. If actualOut is in early morning (e.g. 00:00–noon), treat as next day.
 */
function actualOutMinutesForComparison(
  scheduleIn: string,
  scheduleOut: string,
  actualOut: string,
): number {
  const scheduleInM = timeToMins(scheduleIn);
  const scheduleOutM = timeToMins(scheduleOut);
  let actualOutM = timeToMins(actualOut);
  if (scheduleInM < scheduleOutM && actualOutM < scheduleOutM && actualOutM <= 12 * 60) {
    actualOutM += 24 * 60;
  }
  return actualOutM;
}

/**
 * Calculate undertime in hours.
 * Policy: Undertime = early departure only (when time out is earlier than scheduled time out).
 * Clock-out after midnight (e.g. 00:00 when schedule out is 23:00) is treated as next day, so no undertime.
 */
export function calculateUndertime(
  scheduleIn: string,
  scheduleOut: string,
  _actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  if (!actualOut) return 0;

  const scheduleOutM = timeToMins(scheduleOut);
  const actualOutM = actualOutMinutesForComparison(scheduleIn, scheduleOut, actualOut);

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
 * Calculate overtime in hours.
 * When actual time out is after scheduled time out (e.g. schedule 23:00, actual 00:00 next day), returns positive hours.
 */
export function calculateOvertime(
  scheduleOut: string,
  actualOut: string | undefined,
  scheduleIn?: string,
): number {
  if (!actualOut) return 0;

  const scheduleOutM = timeToMins(scheduleOut);
  let actualOutM = timeToMins(actualOut);
  if (scheduleIn != null) {
    const scheduleInM = timeToMins(scheduleIn);
    if (scheduleInM < scheduleOutM && actualOutM < scheduleOutM && actualOutM <= 12 * 60) {
      actualOutM += 24 * 60;
    }
  } else if (actualOutM < scheduleOutM && actualOutM <= 12 * 60) {
    actualOutM += 24 * 60;
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
