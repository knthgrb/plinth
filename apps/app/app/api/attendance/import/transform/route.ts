import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { canTransformAttendanceImport } from "@/lib/attendance-import/authorization";
import {
  extractAttendanceWithGemini,
  GeminiAttendanceError,
  type GeminiAttendanceErrorCode,
} from "@/lib/attendance-import/gemini";
import {
  ATTENDANCE_IMPORT_LIMITS,
  type NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";
import {
  readAttendanceWorkbook,
  type WorkbookData,
} from "@/lib/attendance-import/workbook";
import { fetchAuthQuery, getToken } from "@/lib/auth-server";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type AttendanceImportTransformErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "unsupported_file"
  | "unsafe_workbook"
  | "no_attendance"
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "invalid_provider_response";

export type AttendanceImportTransformResponse =
  | { ok: true; candidates: NormalizedAttendanceCandidate[] }
  | {
      ok: false;
      code: AttendanceImportTransformErrorCode;
      message: string;
    };

interface RouteMetrics {
  correlationId: string;
  startedAt: number;
  byteCount: number;
  sheetCount: number;
  rowCount: number;
  candidateCount: number;
}

const ORGANIZATION_ID_PATTERN = /^[a-z0-9]{20,64}$/;
const SUPPORTED_FILE_EXTENSION_PATTERN = /\.(csv|xlsx)$/i;
const DECIMAL_CONTENT_LENGTH_PATTERN = /^\d+$/;

const ERROR_MESSAGES: Record<AttendanceImportTransformErrorCode, string> = {
  unauthenticated: "Authentication is required.",
  forbidden: "You are not allowed to transform attendance imports.",
  invalid_request: "The attendance import request is invalid.",
  unsupported_file: "Choose a CSV or XLSX attendance file.",
  unsafe_workbook: "The attendance workbook could not be processed safely.",
  no_attendance: "No attendance candidates were found.",
  not_configured: "Attendance extraction is not configured.",
  rate_limited: "Attendance extraction is busy. Try again shortly.",
  timeout: "Attendance extraction timed out. Try again.",
  provider_unavailable: "Attendance extraction is temporarily unavailable.",
  invalid_provider_response:
    "Attendance extraction returned an invalid response.",
};

const GEMINI_ERROR_RESPONSES: Record<
  GeminiAttendanceErrorCode,
  { code: AttendanceImportTransformErrorCode; status: number }
> = {
  not_configured: { code: "not_configured", status: 503 },
  rate_limited: { code: "rate_limited", status: 429 },
  timeout: { code: "timeout", status: 503 },
  unavailable: { code: "provider_unavailable", status: 503 },
  refused: { code: "invalid_provider_response", status: 502 },
  invalid_response: { code: "invalid_provider_response", status: 502 },
};

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AttendanceImportTransformResponse>> {
  const metrics: RouteMetrics = {
    correlationId: crypto.randomUUID(),
    startedAt: Date.now(),
    byteCount: 0,
    sheetCount: 0,
    rowCount: 0,
    candidateCount: 0,
  };
  const contentLength = request.headers.get("content-length");

  if (contentLength === null) {
    return errorResponse("invalid_request", 400, metrics);
  }

  const normalizedContentLength = contentLength.trim();

  if (!DECIMAL_CONTENT_LENGTH_PATTERN.test(normalizedContentLength)) {
    return errorResponse("invalid_request", 400, metrics);
  }

  metrics.byteCount = Number(normalizedContentLength);

  if (metrics.byteCount > ATTENDANCE_IMPORT_LIMITS.maxMultipartBytes) {
    return errorResponse("invalid_request", 413, metrics);
  }

  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    return errorResponse("invalid_request", 400, metrics);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("invalid_request", 400, metrics);
  }

  const organizationIdValue = formData.get("organizationId");

  if (
    typeof organizationIdValue !== "string" ||
    !ORGANIZATION_ID_PATTERN.test(organizationIdValue)
  ) {
    return errorResponse("invalid_request", 400, metrics);
  }

  let token: Awaited<ReturnType<typeof getToken>>;

  try {
    token = await getToken();
  } catch {
    return errorResponse("unauthenticated", 401, metrics);
  }

  if (!token) {
    return errorResponse("unauthenticated", 401, metrics);
  }

  const organizationId = organizationIdValue as Id<"organizations">;
  let currentUser: Awaited<
    ReturnType<typeof fetchAuthQuery<typeof api.organizations.getCurrentUser>>
  >;

  try {
    currentUser = await fetchAuthQuery(api.organizations.getCurrentUser, {
      organizationId,
    });
  } catch {
    return errorResponse("forbidden", 403, metrics);
  }

  if (!canTransformAttendanceImport(currentUser)) {
    return errorResponse("forbidden", 403, metrics);
  }

  const fileValue = formData.get("file");

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return errorResponse("invalid_request", 400, metrics);
  }

  metrics.byteCount = fileValue.size;

  if (fileValue.size > ATTENDANCE_IMPORT_LIMITS.maxFileBytes) {
    return errorResponse("invalid_request", 413, metrics);
  }

  if (!SUPPORTED_FILE_EXTENSION_PATTERN.test(fileValue.name)) {
    return errorResponse("unsupported_file", 415, metrics);
  }

  let workbook: WorkbookData;

  try {
    workbook = await readAttendanceWorkbook(fileValue);
  } catch {
    return errorResponse("unsafe_workbook", 422, metrics);
  }

  metrics.sheetCount = workbook.sheets.length;
  metrics.rowCount = workbook.rowCount;

  let candidates: NormalizedAttendanceCandidate[];

  try {
    candidates = await extractAttendanceWithGemini(workbook);
  } catch (error: unknown) {
    if (error instanceof GeminiAttendanceError) {
      const mappedError = GEMINI_ERROR_RESPONSES[error.code];
      return errorResponse(mappedError.code, mappedError.status, metrics);
    }

    return errorResponse("invalid_provider_response", 502, metrics);
  }

  metrics.candidateCount = candidates.length;

  if (candidates.length === 0) {
    return errorResponse("no_attendance", 422, metrics);
  }

  logResult("success", 200, metrics);

  return NextResponse.json({ ok: true, candidates }, { status: 200 });
}

function errorResponse(
  code: AttendanceImportTransformErrorCode,
  status: number,
  metrics: RouteMetrics,
): NextResponse<AttendanceImportTransformResponse> {
  logResult(code, status, metrics);

  return NextResponse.json(
    { ok: false, code, message: ERROR_MESSAGES[code] },
    { status },
  );
}

function logResult(
  category: AttendanceImportTransformErrorCode | "success",
  status: number,
  metrics: RouteMetrics,
): void {
  console.info("attendance_import_transform", {
    correlationId: metrics.correlationId,
    category,
    status,
    durationMs: Date.now() - metrics.startedAt,
    byteCount: metrics.byteCount,
    sheetCount: metrics.sheetCount,
    rowCount: metrics.rowCount,
    candidateCount: metrics.candidateCount,
  });
}
