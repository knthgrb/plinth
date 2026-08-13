import { z } from "zod";

import {
  ATTENDANCE_IMPORT_LIMITS,
  ATTENDANCE_IMPORT_STATUSES,
  type AttendanceImportTransformErrorCode,
  type NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";

const UNSUPPORTED_FILE_MESSAGE =
  "Only Excel (.xlsx) and CSV (.csv) files are supported.";
const OVERSIZED_FILE_MESSAGE =
  "The attendance file must be 10 MB or smaller.";
const TRANSFORM_FAILURE_MESSAGE =
  "The attendance file could not be transformed.";
const SUPPORTED_FILE_EXTENSION_PATTERN = /\.(csv|xlsx)$/;

const SAFE_ERROR_RESPONSES = {
  unauthenticated: { message: "Authentication is required.", statuses: [401] },
  forbidden: {
    message: "You are not allowed to transform attendance imports.",
    statuses: [403],
  },
  invalid_request: {
    message: "The attendance import request is invalid.",
    statuses: [400, 413],
  },
  unsupported_file: {
    message: "Choose a CSV or XLSX attendance file.",
    statuses: [415],
  },
  unsafe_workbook: {
    message: "The attendance workbook could not be processed safely.",
    statuses: [422],
  },
  no_attendance: {
    message: "No attendance candidates were found.",
    statuses: [422],
  },
  not_configured: {
    message: "Attendance extraction is not configured.",
    statuses: [503],
  },
  rate_limited: {
    message: "Attendance extraction is busy. Try again shortly.",
    statuses: [429],
  },
  timeout: {
    message: "Attendance extraction timed out. Try again.",
    statuses: [503],
  },
  provider_unavailable: {
    message: "Attendance extraction is temporarily unavailable.",
    statuses: [503],
  },
  invalid_provider_response: {
    message: "Attendance extraction returned an invalid response.",
    statuses: [502],
  },
} satisfies Record<
  AttendanceImportTransformErrorCode,
  { message: string; statuses: readonly number[] }
>;

const attendanceImportIssueSchema = z
  .object({
    code: z.enum([
      "missing_employee",
      "missing_date",
      "invalid_date",
      "invalid_time",
      "missing_time_in",
      "missing_time_out",
      "invalid_status",
      "extraction_issue",
      "duplicate_conflict",
    ]),
    message: z.string().max(2_000),
  })
  .strict();

const normalizedAttendanceCandidateSchema = z
  .object({
    sourceSheet: z.string().trim().min(1).max(200),
    sourceRow: z.number().int().min(1).max(10_000),
    employeeKey: z.string().max(300),
    date: z.string().max(40),
    timeIn: z.string().max(40).optional(),
    timeOut: z.string().max(40).optional(),
    status: z.enum(ATTENDANCE_IMPORT_STATUSES),
    notes: z.string().max(2_000),
    issues: z.array(attendanceImportIssueSchema).max(50),
  })
  .strict();

const attendanceImportTransformResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      candidates: z
        .array(normalizedAttendanceCandidateSchema)
        .max(ATTENDANCE_IMPORT_LIMITS.maxCandidates),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(Object.keys(SAFE_ERROR_RESPONSES) as [
        AttendanceImportTransformErrorCode,
        ...AttendanceImportTransformErrorCode[],
      ]),
      message: z.string(),
    })
    .strict(),
]);

export function validateAttendanceImportFile(file: File): void {
  if (!SUPPORTED_FILE_EXTENSION_PATTERN.test(file.name)) {
    throw new Error(UNSUPPORTED_FILE_MESSAGE);
  }

  if (file.size > ATTENDANCE_IMPORT_LIMITS.maxFileBytes) {
    throw new Error(OVERSIZED_FILE_MESSAGE);
  }
}

export async function transformAttendanceImport(
  file: File,
  organizationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedAttendanceCandidate[]> {
  validateAttendanceImportFile(file);

  const formData = new FormData();
  formData.set("organizationId", organizationId);
  formData.set("file", file);

  try {
    const response = await fetchImpl("/api/attendance/import/transform", {
      method: "POST",
      headers: { "x-organization-id": organizationId },
      body: formData,
    });
    const responseBody: unknown = await response.json();
    const parsed = attendanceImportTransformResponseSchema.safeParse(responseBody);

    if (!parsed.success) {
      throw new Error(TRANSFORM_FAILURE_MESSAGE);
    }

    if (parsed.data.ok) {
      if (!response.ok) {
        throw new Error(TRANSFORM_FAILURE_MESSAGE);
      }

      return parsed.data.candidates;
    }

    if (response.ok) {
      throw new Error(TRANSFORM_FAILURE_MESSAGE);
    }

    const safeResponse = SAFE_ERROR_RESPONSES[parsed.data.code];

    if (
      parsed.data.message !== safeResponse.message ||
      !safeResponse.statuses.includes(response.status)
    ) {
      throw new Error(TRANSFORM_FAILURE_MESSAGE);
    }

    throw new Error(safeResponse.message);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message === TRANSFORM_FAILURE_MESSAGE ||
        Object.values(SAFE_ERROR_RESPONSES).some(
          ({ message }) => message === error.message,
        ))
    ) {
      throw error;
    }

    throw new Error(TRANSFORM_FAILURE_MESSAGE);
  }
}
