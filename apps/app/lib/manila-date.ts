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
