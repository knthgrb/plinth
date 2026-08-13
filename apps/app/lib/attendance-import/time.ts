import {
  ATTENDANCE_IMPORT_STATUSES,
  type AttendanceImportIssue,
  type AttendanceImportStatus,
  type GeminiAttendanceCandidate,
  type NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";

export interface ParsedAttendanceTime {
  minutes: number;
  formatted: string;
}

const TWELVE_HOUR_TIME = /^(0?[1-9]|1[0-2]):([0-5][0-9]) (AM|PM)$/;
const TWENTY_FOUR_HOUR_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseAttendanceTime(value: string): ParsedAttendanceTime | undefined {
  const normalizedValue = value.trim();
  const twelveHourMatch = TWELVE_HOUR_TIME.exec(normalizedValue);

  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minute = Number(twelveHourMatch[2]);
    const period = twelveHourMatch[3];
    const minutes = (hour % 12) * 60 + minute + (period === "PM" ? 720 : 0);

    return { minutes, formatted: formatAttendanceTime(minutes) };
  }

  const twentyFourHourMatch = TWENTY_FOUR_HOUR_TIME.exec(normalizedValue);

  if (!twentyFourHourMatch) {
    return undefined;
  }

  const minutes = Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);

  return { minutes, formatted: formatAttendanceTime(minutes) };
}

export function normalizeGeminiAttendanceCandidate(
  candidate: GeminiAttendanceCandidate,
): NormalizedAttendanceCandidate {
  const issues: AttendanceImportIssue[] = [];
  const employeeKey = candidate.employeeKey.trim();
  const date = candidate.date.trim();

  if (!employeeKey) {
    issues.push({ code: "missing_employee", message: "Employee is required." });
  }

  if (!date) {
    issues.push({ code: "missing_date", message: "Date is required." });
  } else if (!isValidIsoDate(date)) {
    issues.push({ code: "invalid_date", message: "Date must be a valid ISO date." });
  }

  const explicitTimeIn = parseCandidateTime(candidate.explicitTimeIn, "time in", issues);
  const explicitTimeOut = parseCandidateTime(candidate.explicitTimeOut, "time out", issues);
  const punches = candidate.punches
    .map((punch) => parseCandidateTime(punch, "punch", issues))
    .filter((punch): punch is ParsedAttendanceTime => punch !== undefined)
    .sort((left, right) => left.minutes - right.minutes);

  const timeIn = explicitTimeIn?.formatted ?? punches[0]?.formatted;
  const timeOut = explicitTimeOut?.formatted ?? punches.at(-1)?.formatted;

  if (!timeIn) {
    issues.push({ code: "missing_time_in", message: "Time in is required." });
  }

  if (!timeOut) {
    issues.push({ code: "missing_time_out", message: "Time out is required." });
  }

  const status = normalizeStatus(candidate.status, issues);

  for (const extractionIssue of candidate.extractionIssues) {
    const message = extractionIssue.trim();

    if (message) {
      issues.push({ code: "extraction_issue", message });
    }
  }

  return {
    sourceSheet: candidate.sourceSheet,
    sourceRow: candidate.sourceRow,
    employeeKey,
    date,
    timeIn,
    timeOut,
    status,
    notes: candidate.notes,
    issues,
  };
}

function formatAttendanceTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;

  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function parseCandidateTime(
  value: string,
  label: string,
  issues: AttendanceImportIssue[],
): ParsedAttendanceTime | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsedTime = parseAttendanceTime(value);

  if (!parsedTime) {
    issues.push({ code: "invalid_time", message: `Invalid ${label}: ${value}.` });
  }

  return parsedTime;
}

function normalizeStatus(
  value: string,
  issues: AttendanceImportIssue[],
): AttendanceImportStatus {
  const status = value.trim();

  if (!status) {
    return "present";
  }

  if (isAttendanceImportStatus(status)) {
    return status;
  }

  issues.push({ code: "invalid_status", message: `Unsupported status: ${value}.` });
  return "present";
}

function isAttendanceImportStatus(value: string): value is AttendanceImportStatus {
  return ATTENDANCE_IMPORT_STATUSES.some((status) => status === value);
}

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
