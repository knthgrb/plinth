/**
 * Calculate late time in minutes
 * @param scheduleIn - Scheduled time in (HH:mm format)
 * @param actualIn - Actual time in (HH:mm format)
 * @param hasUndertime - Whether employee has undertime (if true, don't count as late)
 * @returns Minutes late, or 0 if not late or has undertime
 */
export function calculateLate(
  scheduleIn: string,
  actualIn: string | undefined,
  hasUndertime: boolean = false,
): number {
  if (!actualIn || hasUndertime) return 0;

  const [scheduleHour, scheduleMin] = scheduleIn.split(":").map(Number);
  const [actualHour, actualMin] = actualIn.split(":").map(Number);

  const scheduleMinutes = scheduleHour * 60 + scheduleMin;
  const actualMinutes = actualHour * 60 + actualMin;

  const lateMinutes = actualMinutes - scheduleMinutes;
  return lateMinutes > 0 ? lateMinutes : 0;
}

/**
 * Calculate undertime in hours
 * Assumes 1 hour lunch break (8 hours work = 9am-6pm schedule)
 * @param scheduleIn - Scheduled time in (HH:mm format)
 * @param scheduleOut - Scheduled time out (HH:mm format)
 * @param actualIn - Actual time in (HH:mm format)
 * @param actualOut - Actual time out (HH:mm format)
 * @returns Hours undertime
 */
export function calculateUndertime(
  scheduleIn: string,
  scheduleOut: string,
  actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  if (!actualIn || !actualOut) return 0;

  const [scheduleInHour, scheduleInMin] = scheduleIn.split(":").map(Number);
  const [scheduleOutHour, scheduleOutMin] = scheduleOut.split(":").map(Number);
  const [actualInHour, actualInMin] = actualIn.split(":").map(Number);
  const [actualOutHour, actualOutMin] = actualOut.split(":").map(Number);

  // Calculate scheduled work hours (assuming 1 hour lunch break)
  const scheduleInMinutes = scheduleInHour * 60 + scheduleInMin;
  const scheduleOutMinutes = scheduleOutHour * 60 + scheduleOutMin;
  const scheduledWorkMinutes = scheduleOutMinutes - scheduleInMinutes - 60; // Subtract 1 hour lunch

  // Calculate actual work hours
  const actualInMinutes = actualInHour * 60 + actualInMin;
  const actualOutMinutes = actualOutHour * 60 + actualOutMin;
  const actualWorkMinutes = actualOutMinutes - actualInMinutes - 60; // Subtract 1 hour lunch

  // Calculate undertime
  const undertimeMinutes = scheduledWorkMinutes - actualWorkMinutes;
  const undertimeHours = undertimeMinutes / 60;

  return undertimeHours > 0 ? undertimeHours : 0;
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
