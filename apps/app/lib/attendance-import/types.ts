export const ATTENDANCE_IMPORT_STATUSES = [
  "present",
  "absent",
  "half-day",
  "leave",
  "leave_with_pay",
  "leave_without_pay",
  "no_work",
] as const;

export const ATTENDANCE_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxMultipartBytes: 11 * 1024 * 1024,
  maxArchiveEntries: 1_000,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 10_000,
  maxColumns: 100,
  maxCells: 500_000,
  maxCellCharacters: 2_000,
  maxSerializedCharacters: 4 * 1024 * 1024,
  maxCandidates: 10_000,
} as const;

export type AttendanceImportStatus =
  (typeof ATTENDANCE_IMPORT_STATUSES)[number];

export type AttendanceImportIssueCode =
  | "missing_employee"
  | "missing_date"
  | "invalid_date"
  | "invalid_time"
  | "missing_time_in"
  | "missing_time_out"
  | "invalid_status"
  | "extraction_issue"
  | "duplicate_conflict";

export interface GeminiAttendanceCandidate {
  sourceSheet: string;
  sourceRow: number;
  employeeKey: string;
  date: string;
  explicitTimeIn: string;
  explicitTimeOut: string;
  punches: string[];
  status: string;
  notes: string;
  extractionIssues: string[];
}

export interface AttendanceImportIssue {
  code: AttendanceImportIssueCode;
  message: string;
}

export interface NormalizedAttendanceCandidate {
  sourceSheet: string;
  sourceRow: number;
  employeeKey: string;
  date: string;
  timeIn?: string;
  timeOut?: string;
  status: AttendanceImportStatus;
  notes: string;
  issues: AttendanceImportIssue[];
}
