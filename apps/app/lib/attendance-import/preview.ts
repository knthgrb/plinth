import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  attendanceDayKey,
  formatManilaShortDate,
  parseYmdToAttendanceDateMs,
} from "@/lib/manila-date";
import {
  holidayAppliesToEmployee,
  holidayMatchesDate,
  isEmployeeRestDay,
} from "@/lib/payroll-calculations";
import { parseAttendanceTime } from "@/lib/attendance-import/time";
import type {
  AttendanceImportIssue,
  AttendanceImportStatus,
  NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";

export type AttendanceImportEmployee = Doc<"employees">;
export type AttendanceImportHoliday = Doc<"holidays">;

export interface AttendanceImportPreviewRow {
  sourceSheet: string;
  sourceRow: number;
  employeeId: Id<"employees"> | null;
  employeeName: string;
  sourceDate: string;
  dateTs: number;
  dateLabel: string;
  scheduleIn: string;
  scheduleOut: string;
  actualIn?: string;
  actualOut?: string;
  status: AttendanceImportStatus;
  notes: string;
  error: string | null;
  includeInImport: boolean;
  existingAttendanceId: Id<"attendance"> | null;
  overwriteExisting: boolean;
  isRestDay: boolean;
}

export type AttendanceImportConflictRecord = Pick<
  Doc<"attendance">,
  "_id" | "employeeId" | "date"
>;

const DEFAULT_SCHEDULE_IN = "09:00";
const DEFAULT_SCHEDULE_OUT = "18:00";

interface EmployeeMatch {
  employee: AttendanceImportEmployee | null;
  isAmbiguous: boolean;
}

export function buildAttendanceImportPreview(
  candidates: readonly NormalizedAttendanceCandidate[],
  employees: readonly AttendanceImportEmployee[],
  holidays: readonly AttendanceImportHoliday[],
): AttendanceImportPreviewRow[] {
  return candidates.map((candidate) => buildPreviewRow(candidate, employees, holidays));
}

export function buildAttendanceImportPreviewWhenReady(
  candidates: readonly NormalizedAttendanceCandidate[],
  employees: readonly AttendanceImportEmployee[] | undefined,
  holidays: readonly AttendanceImportHoliday[] | undefined,
): AttendanceImportPreviewRow[] | undefined {
  if (employees === undefined || holidays === undefined) {
    return undefined;
  }

  return buildAttendanceImportPreview(candidates, employees, holidays);
}

export function applyAttendanceImportConflicts(
  rows: readonly AttendanceImportPreviewRow[],
  records: readonly AttendanceImportConflictRecord[] | undefined,
): AttendanceImportPreviewRow[] {
  if (records === undefined) {
    return [...rows];
  }

  const existingAttendanceByKey = new Map<string, Id<"attendance">>();

  for (const record of records) {
    const key = attendanceDayKey(record.employeeId, record.date);

    if (!existingAttendanceByKey.has(key)) {
      existingAttendanceByKey.set(key, record._id);
    }
  }

  return rows.map((row) => {
    if (!row.employeeId || row.dateTs <= 0) {
      return { ...row, existingAttendanceId: null };
    }

    const key = attendanceDayKey(row.employeeId, row.dateTs);

    return {
      ...row,
      existingAttendanceId: existingAttendanceByKey.get(key) ?? null,
    };
  });
}

export function findAttendanceEmployee(
  employeeKey: string,
  employees: readonly AttendanceImportEmployee[],
): AttendanceImportEmployee | null {
  return resolveAttendanceEmployee(employeeKey, employees).employee;
}

function resolveAttendanceEmployee(
  employeeKey: string,
  employees: readonly AttendanceImportEmployee[],
): EmployeeMatch {
  const normalizedKey = normalizeEmployeeKey(employeeKey);

  if (!normalizedKey) {
    return { employee: null, isAmbiguous: false };
  }

  const matchingEmployees = new Map<Id<"employees">, AttendanceImportEmployee>();

  for (const employee of employees) {
    const firstName = normalizeEmployeeKey(employee.personalInfo.firstName);
    const lastName = normalizeEmployeeKey(employee.personalInfo.lastName);
    const firstLast = `${firstName} ${lastName}`.trim();
    const lastFirst = `${lastName}, ${firstName}`.trim();
    const employeeId = normalizeEmployeeKey(employee.employment.employeeId);

    if (
      normalizedKey === employeeId ||
      normalizedKey === firstLast ||
      normalizedKey === lastFirst
    ) {
      matchingEmployees.set(employee._id, employee);
    }
  }

  const matches = [...matchingEmployees.values()];

  if (matches.length === 1) {
    return { employee: matches[0], isAmbiguous: false };
  }

  return { employee: null, isAmbiguous: matches.length > 1 };
}

export function attendanceTimeToHHmm(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseAttendanceTime(value);

  if (!parsed) {
    return undefined;
  }

  const hour = Math.floor(parsed.minutes / 60);
  const minute = parsed.minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildPreviewRow(
  candidate: NormalizedAttendanceCandidate,
  employees: readonly AttendanceImportEmployee[],
  holidays: readonly AttendanceImportHoliday[],
): AttendanceImportPreviewRow {
  const employeeMatch = resolveAttendanceEmployee(candidate.employeeKey, employees);
  const employee = employeeMatch.employee;
  const { dateTs, dateLabel } = parsePreviewDate(candidate.date);
  const actualIn = attendanceTimeToHHmm(candidate.timeIn);
  const actualOut = attendanceTimeToHHmm(candidate.timeOut);
  const errors = candidateIssuesForStatus(candidate.issues, candidate.status);

  if (employeeMatch.isAmbiguous) {
    errors.push("Employee match is ambiguous");
  } else if (!employee && candidate.employeeKey.trim()) {
    errors.push("Employee not found");
  }

  if (!candidate.employeeKey.trim() && !hasIssue(candidate.issues, "missing_employee")) {
    errors.push("Employee is required.");
  }

  if (!candidate.date.trim()) {
    if (!hasIssue(candidate.issues, "missing_date")) {
      errors.push("Date is required.");
    }
  } else if (dateTs === 0 && !hasIssue(candidate.issues, "invalid_date")) {
    errors.push("Invalid date");
  }

  addTimeErrors(candidate, actualIn, actualOut, errors);

  const { scheduleIn, scheduleOut } = getScheduleForDate(employee, dateTs);
  const isRestDay = Boolean(
    employee && dateTs > 0 && isEmployeeRestDay(dateTs, employee.schedule),
  );

  if (
    candidate.status === "no_work" &&
    (!employee || dateTs === 0 || !hasApplicableNonWorkingHoliday(dateTs, employee, holidays))
  ) {
    errors.push("No work is only allowed on holiday dates for this employee");
  }

  const error = uniqueMessages(errors).join("; ") || null;

  return {
    sourceSheet: candidate.sourceSheet,
    sourceRow: candidate.sourceRow,
    employeeId: employee?._id ?? null,
    employeeName: candidate.employeeKey || "—",
    sourceDate: candidate.date,
    dateTs,
    dateLabel,
    scheduleIn,
    scheduleOut,
    actualIn,
    actualOut,
    status: candidate.status,
    notes: candidate.notes,
    error,
    includeInImport: error === null && !isRestDay,
    existingAttendanceId: null,
    overwriteExisting: false,
    isRestDay,
  };
}

function normalizeEmployeeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parsePreviewDate(value: string): { dateTs: number; dateLabel: string } {
  const date = value.trim();

  if (!date) {
    return { dateTs: 0, dateLabel: "—" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { dateTs: 0, dateLabel: date };
  }

  try {
    const dateTs = parseYmdToAttendanceDateMs(date);

    return { dateTs, dateLabel: formatManilaShortDate(dateTs) };
  } catch {
    return { dateTs: 0, dateLabel: date };
  }
}

function getScheduleForDate(
  employee: AttendanceImportEmployee | null,
  dateTs: number,
): { scheduleIn: string; scheduleOut: string } {
  if (!employee || dateTs === 0) {
    return { scheduleIn: DEFAULT_SCHEDULE_IN, scheduleOut: DEFAULT_SCHEDULE_OUT };
  }

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const manilaDay = new Date(dateTs + 8 * 60 * 60 * 1000).getUTCDay();
  const schedule = employee.schedule.defaultSchedule[dayNames[manilaDay]];

  if (
    !schedule.isWorkday ||
    !isCanonicalHHmm(schedule.in) ||
    !isCanonicalHHmm(schedule.out)
  ) {
    return { scheduleIn: DEFAULT_SCHEDULE_IN, scheduleOut: DEFAULT_SCHEDULE_OUT };
  }

  return { scheduleIn: schedule.in, scheduleOut: schedule.out };
}

function isCanonicalHHmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function candidateIssuesForStatus(
  issues: readonly AttendanceImportIssue[],
  status: AttendanceImportStatus,
): string[] {
  return issues
    .filter((issue) => requiresActualTimes(status) || !isMissingTimeIssue(issue))
    .map((issue) => issue.message.trim())
    .filter(Boolean);
}

function requiresActualTimes(status: AttendanceImportStatus): boolean {
  return status === "present" || status === "half-day";
}

function isMissingTimeIssue(issue: AttendanceImportIssue): boolean {
  return issue.code === "missing_time_in" || issue.code === "missing_time_out";
}

function hasIssue(
  issues: readonly AttendanceImportIssue[],
  code: AttendanceImportIssue["code"],
): boolean {
  return issues.some((issue) => issue.code === code);
}

function addTimeErrors(
  candidate: NormalizedAttendanceCandidate,
  actualIn: string | undefined,
  actualOut: string | undefined,
  errors: string[],
): void {
  if (!requiresActualTimes(candidate.status)) {
    return;
  }

  if (
    (!actualIn || !actualOut) &&
    !hasIssue(candidate.issues, "missing_time_in") &&
    !hasIssue(candidate.issues, "missing_time_out")
  ) {
    errors.push(`Time In/Out required for ${candidate.status}`);
  }

  if (candidate.timeIn && !actualIn && !hasIssue(candidate.issues, "invalid_time")) {
    errors.push("Invalid time in");
  }

  if (candidate.timeOut && !actualOut && !hasIssue(candidate.issues, "invalid_time")) {
    errors.push("Invalid time out");
  }
}

function hasApplicableNonWorkingHoliday(
  dateTs: number,
  employee: AttendanceImportEmployee,
  holidays: readonly AttendanceImportHoliday[],
): boolean {
  return holidays.some(
    (holiday) =>
      (holiday.type === "regular" || holiday.type === "special") &&
      holidayMatchesDate(holiday, dateTs) &&
      holidayAppliesToEmployee(holiday, employee),
  );
}

function uniqueMessages(messages: readonly string[]): string[] {
  return [...new Set(messages)];
}
