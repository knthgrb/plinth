import type { LeaveDurationBasis } from "@/lib/leave/types";

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_UNPAID_BREAK_MINUTES = 60;

const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type WeekdayName = (typeof weekdayNames)[number];

export interface LeaveDaySchedule {
  in: string;
  out: string;
  isWorkday: boolean;
  unpaidBreakMinutes?: number;
}

export type LeaveWeekSchedule = Record<WeekdayName, LeaveDaySchedule>;

export interface LeaveOccurrenceDraft {
  localDate: string;
  legalUnits: number;
  scheduledMinutes: number;
  leaveMinutes: number;
  creditUnits: number;
  isHoliday: boolean;
  isRestDay: boolean;
}

export interface BuildLeaveOccurrenceDraftsInput {
  startLocalDate: string;
  endLocalDate: string;
  durationBasis: LeaveDurationBasis;
  requestedMinutesByDate: Readonly<Record<string, number>>;
  scheduleByWeekday: LeaveWeekSchedule;
  holidays: ReadonlySet<string>;
}

export function buildLeaveOccurrenceDrafts(
  input: BuildLeaveOccurrenceDraftsInput,
): LeaveOccurrenceDraft[] {
  const start = parseLocalDate(input.startLocalDate);
  const end = parseLocalDate(input.endLocalDate);

  if (start.getTime() > end.getTime()) {
    throw new Error("Leave end date cannot be before the start date.");
  }
  validateRequestedMinutesByDate(
    input.requestedMinutesByDate,
    start.getTime(),
    end.getTime(),
  );

  const drafts: LeaveOccurrenceDraft[] = [];
  for (
    let cursor = start;
    cursor.getTime() <= end.getTime();
    cursor = addLocalDays(cursor, 1)
  ) {
    const localDate = formatLocalDate(cursor);
    const schedule = input.scheduleByWeekday[weekdayNames[cursor.getUTCDay()]];
    const isRestDay = !schedule.isWorkday;
    const isHoliday = input.holidays.has(localDate);
    const scheduledMinutes = isRestDay ? 0 : getScheduledMinutes(schedule);
    const requestedMinutes = input.requestedMinutesByDate[localDate];

    if (requestedMinutes !== undefined && requestedMinutes > scheduledMinutes) {
      throw new Error(
        "Requested leave minutes cannot exceed scheduled minutes.",
      );
    }

    const leaveMinutes =
      isRestDay || isHoliday ? 0 : (requestedMinutes ?? scheduledMinutes);
    const creditUnits =
      scheduledMinutes === 0 ? 0 : leaveMinutes / scheduledMinutes;
    const legalUnits =
      input.durationBasis === "scheduled_work" ? creditUnits : 1;

    drafts.push({
      localDate,
      legalUnits,
      scheduledMinutes,
      leaveMinutes,
      creditUnits,
      isHoliday,
      isRestDay,
    });
  }

  return drafts;
}

function validateRequestedMinutesByDate(
  requestedMinutesByDate: Readonly<Record<string, number>>,
  startTimestamp: number,
  endTimestamp: number,
): void {
  for (const [localDate, minutes] of Object.entries(requestedMinutesByDate)) {
    const timestamp = parseLocalDate(localDate).getTime();
    if (timestamp < startTimestamp || timestamp > endTimestamp) {
      throw new Error(
        "Requested leave minutes must be within the leave date range.",
      );
    }
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error("Requested leave minutes must be a positive whole number.");
    }
  }
}

function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Leave dates must use YYYY-MM-DD format.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Leave date is invalid.");
  }
  return date;
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function formatLocalDate(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function getScheduledMinutes(schedule: LeaveDaySchedule): number {
  const start = parseTime(schedule.in);
  const end = parseTime(schedule.out);
  const elapsed = end > start ? end - start : end + MINUTES_PER_DAY - start;
  const unpaidBreakMinutes =
    schedule.unpaidBreakMinutes ??
    (elapsed >= 6 * 60 ? DEFAULT_UNPAID_BREAK_MINUTES : 0);

  if (
    !Number.isInteger(unpaidBreakMinutes) ||
    unpaidBreakMinutes < 0 ||
    unpaidBreakMinutes >= elapsed
  ) {
    throw new Error("Unpaid break minutes must be shorter than the shift.");
  }
  return elapsed - unpaidBreakMinutes;
}

function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Schedule times must use HH:mm format.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error("Schedule time is invalid.");
  }
  return hours * 60 + minutes;
}
