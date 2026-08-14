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
  type AttendanceImportTransformErrorCode,
  type AttendanceImportTransformResponse,
  type NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";
import {
  readAttendanceWorkbook,
  type WorkbookData,
} from "@/lib/attendance-import/workbook";
import { fetchAuthQuery, getToken } from "@/lib/auth-server";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteMetrics {
  correlationId: string;
  startedAt: number;
  byteCount: number;
  sheetCount: number;
  rowCount: number;
  candidateCount: number;
}

type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; byteCount: number; tooLarge: boolean };

const ORGANIZATION_ID_PATTERN = /^[a-z0-9]{20,64}$/;
const SUPPORTED_FILE_EXTENSION_PATTERN = /\.(csv|xls|xlsx|xlsm)$/i;
const DECIMAL_CONTENT_LENGTH_PATTERN = /^\d+$/;
type SupportedFileExtension = "csv" | "xls" | "xlsx" | "xlsm";
const GENERIC_FILE_MIME_TYPES = new Set(["", "application/octet-stream"]);
const SUPPORTED_FILE_MIME_TYPES: Record<
  SupportedFileExtension,
  readonly string[]
> = {
  csv: ["text/csv", "application/csv"],
  xls: ["application/vnd.ms-excel"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  xlsm: ["application/vnd.ms-excel.sheet.macroenabled.12"],
};

const ERROR_MESSAGES: Record<AttendanceImportTransformErrorCode, string> = {
  unauthenticated: "Authentication is required.",
  forbidden: "You are not allowed to transform attendance imports.",
  invalid_request: "The attendance import request is invalid.",
  unsupported_file: "Choose a CSV, XLS, XLSX, or XLSM attendance file.",
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

  const organizationIdValue = request.headers.get("x-organization-id")?.trim();

  if (
    organizationIdValue === undefined ||
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

  const boundedBody = await readBoundedBody(request);

  if (!boundedBody.ok) {
    metrics.byteCount = boundedBody.byteCount;
    return errorResponse(
      "invalid_request",
      boundedBody.tooLarge ? 413 : 400,
      metrics,
    );
  }

  metrics.byteCount = boundedBody.bytes.byteLength;

  let formData: FormData;

  try {
    const multipartRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: boundedBody.bytes.buffer,
    });
    formData = await multipartRequest.formData();
  } catch {
    return errorResponse("invalid_request", 400, metrics);
  }

  const formEntries = Array.from(formData.entries());
  const organizationValues = formData.getAll("organizationId");
  const fileValues = formData.getAll("file");

  if (
    formEntries.length !== 2 ||
    formEntries.some(
      ([name]) => name !== "organizationId" && name !== "file",
    ) ||
    organizationValues.length !== 1 ||
    typeof organizationValues[0] !== "string" ||
    organizationValues[0] !== organizationIdValue ||
    fileValues.length !== 1
  ) {
    return errorResponse("invalid_request", 400, metrics);
  }

  const fileValue = fileValues[0];

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return errorResponse("invalid_request", 400, metrics);
  }

  metrics.byteCount = fileValue.size;

  if (fileValue.size > ATTENDANCE_IMPORT_LIMITS.maxFileBytes) {
    return errorResponse("invalid_request", 413, metrics);
  }

  if (!isSupportedAttendanceFile(fileValue)) {
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

function isSupportedAttendanceFile(file: File): boolean {
  const extensionMatch = SUPPORTED_FILE_EXTENSION_PATTERN.exec(file.name);
  const extension = extensionMatch?.[1]?.toLowerCase() as
    | SupportedFileExtension
    | undefined;

  if (!extension) {
    return false;
  }

  const mimeType = file.type.trim().toLowerCase();

  return (
    GENERIC_FILE_MIME_TYPES.has(mimeType) ||
    SUPPORTED_FILE_MIME_TYPES[extension].includes(mimeType)
  );
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

async function readBoundedBody(request: NextRequest): Promise<BoundedBodyResult> {
  const reader = request.body?.getReader();

  if (!reader) {
    return { ok: false, byteCount: 0, tooLarge: false };
  }

  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      byteCount += value.byteLength;

      if (byteCount > ATTENDANCE_IMPORT_LIMITS.maxMultipartBytes) {
        try {
          await reader.cancel();
        } catch {
          // The oversized request is rejected even if its source cannot cancel.
        }
        return { ok: false, byteCount, tooLarge: true };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, byteCount, tooLarge: false };
  }

  const bytes = new Uint8Array(byteCount);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
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
