const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const MONTH_NAMES_SHORT = [
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

const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type ManilaDateParts = {
  year: number;
  monthIndex: number;
  day: number;
};

export function getManilaDateParts(timestampMs: number): ManilaDateParts {
  const shifted = new Date(timestampMs + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

export function formatManilaShortDate(timestampMs: number): string {
  const { monthIndex, day, year } = getManilaDateParts(timestampMs);
  return `${MONTH_NAMES_SHORT[monthIndex]} ${day}, ${year}`;
}

export function formatManilaShortMonthDay(timestampMs: number): string {
  const { monthIndex, day } = getManilaDateParts(timestampMs);
  return `${MONTH_NAMES_SHORT[monthIndex]} ${day}`;
}

export function formatManilaLongDate(timestampMs: number): string {
  const { monthIndex, day, year } = getManilaDateParts(timestampMs);
  return `${MONTH_NAMES_LONG[monthIndex]} ${String(day).padStart(2, "0")}, ${year}`;
}

export function formatManilaNumericDate(timestampMs: number): string {
  const { monthIndex, day, year } = getManilaDateParts(timestampMs);
  return `${monthIndex + 1}/${day}/${year}`;
}

/** Canonical attendance `date` field: midnight UTC for the Manila calendar day. */
export function normalizeAttendanceDateMs(timestampMs: number): number {
  const { year, monthIndex, day } = getManilaDateParts(timestampMs);
  return Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
}

/** Parse `YYYY-MM-DD` as a Manila calendar attendance date. */
export function parseYmdToAttendanceDateMs(ymd: string): number {
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((ymd ?? "").trim());
  if (!isoMatch) {
    throw new Error("Invalid date");
  }
  const year = parseInt(isoMatch[1], 10);
  const monthIndex = parseInt(isoMatch[2], 10) - 1;
  const day = parseInt(isoMatch[3], 10);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    throw new Error("Invalid date");
  }
  const ts = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  const check = getManilaDateParts(ts);
  if (
    check.year !== year ||
    check.monthIndex !== monthIndex ||
    check.day !== day
  ) {
    throw new Error("Invalid date");
  }
  return ts;
}

export function sameManilaCalendarDay(aMs: number, bMs: number): boolean {
  const a = getManilaDateParts(aMs);
  const b = getManilaDateParts(bMs);
  return (
    a.year === b.year && a.monthIndex === b.monthIndex && a.day === b.day
  );
}

export function attendanceDayKey(employeeId: string, dateMs: number): string {
  return `${employeeId}:${normalizeAttendanceDateMs(dateMs)}`;
}
