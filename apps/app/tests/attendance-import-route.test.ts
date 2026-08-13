import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/convex/_generated/api";
import {
  canTransformAttendanceImport,
} from "@/lib/attendance-import/authorization";
import {
  GeminiAttendanceError,
  extractAttendanceWithGemini,
} from "@/lib/attendance-import/gemini";
import type {
  AttendanceImportTransformResponse,
  NormalizedAttendanceCandidate,
} from "@/lib/attendance-import/types";
import {
  readAttendanceWorkbook,
  type WorkbookData,
} from "@/lib/attendance-import/workbook";
import { fetchAuthQuery, getToken } from "@/lib/auth-server";
import { POST } from "@/app/api/attendance/import/transform/route";

vi.mock("@/lib/auth-server", () => ({
  fetchAuthQuery: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/attendance-import/workbook", () => ({
  readAttendanceWorkbook: vi.fn(),
}));

vi.mock("@/lib/attendance-import/gemini", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/attendance-import/gemini")
  >();

  return {
    ...actual,
    extractAttendanceWithGemini: vi.fn(),
  };
});

const ORGANIZATION_ID = "k57c6m9n2p4q7r8s3t5v6w9x2y4z7a8b";
const validCsvFile = new File(
  ["Employee,Date,Time In,Time Out\nAda,2026-08-13,9:00 AM,5:00 PM"],
  "attendance.csv",
  { type: "text/csv" },
);
const workbook: WorkbookData = {
  sheets: [
    {
      name: "CSV",
      rows: [{ rowNumber: 1, cells: ["Employee", "Date"] }],
    },
  ],
  rowCount: 1,
  cellCount: 2,
};
const candidates: NormalizedAttendanceCandidate[] = [
  {
    sourceSheet: "CSV",
    sourceRow: 2,
    employeeKey: "Ada",
    date: "2026-08-13",
    timeIn: "09:00",
    timeOut: "17:00",
    status: "present",
    notes: "",
    issues: [],
  },
  {
    sourceSheet: "CSV",
    sourceRow: 3,
    employeeKey: "",
    date: "",
    status: "present",
    notes: "",
    issues: [
      { code: "missing_employee", message: "Employee is required." },
      { code: "missing_date", message: "Date is required." },
    ],
  },
];

const getTokenMock = vi.mocked(getToken);
const fetchAuthQueryMock = vi.mocked(fetchAuthQuery);
const readAttendanceWorkbookMock = vi.mocked(readAttendanceWorkbook);
const extractAttendanceWithGeminiMock = vi.mocked(
  extractAttendanceWithGemini,
);
const consoleInfoMock = vi
  .spyOn(console, "info")
  .mockImplementation(() => undefined);

afterAll(() => {
  consoleInfoMock.mockRestore();
});

function makeMultipartRequest({
  file = validCsvFile,
  organizationId = ORGANIZATION_ID,
  headerOrganizationId,
  contentLength,
  formData: suppliedFormData,
}: {
  file?: File | null;
  organizationId?: string | null;
  headerOrganizationId?: string | null;
  contentLength?: number | null;
  formData?: FormData;
} = {}): NextRequest {
  const formData = suppliedFormData ?? new FormData();

  if (suppliedFormData === undefined && organizationId !== null) {
    formData.set("organizationId", organizationId);
  }

  if (suppliedFormData === undefined && file !== null) {
    formData.set("file", file);
  }

  const headers = new Headers();
  const authorizedOrganizationId =
    headerOrganizationId === undefined ? organizationId : headerOrganizationId;

  if (authorizedOrganizationId !== null) {
    headers.set("x-organization-id", authorizedOrganizationId);
  }

  const effectiveContentLength =
    contentLength === undefined ? (file?.size ?? 0) + 512 : contentLength;

  if (effectiveContentLength !== null) {
    headers.set("content-length", String(effectiveContentLength));
  }

  return new NextRequest(
    "http://localhost/api/attendance/import/transform",
    { method: "POST", body: formData, headers },
  );
}

async function makeObservedStreamRequest({
  formData,
  headerOrganizationId = ORGANIZATION_ID,
}: {
  formData: FormData;
  headerOrganizationId?: string;
}): Promise<{
  request: NextRequest;
  pullSpy: ReturnType<typeof vi.fn>;
  cancelSpy: ReturnType<typeof vi.fn>;
}> {
  const encodedRequest = new Request("http://localhost", {
    method: "POST",
    body: formData,
  });
  const bytes = new Uint8Array(await encodedRequest.arrayBuffer());

  return makeChunkedRequest({
    chunks: [bytes],
    contentLength: bytes.byteLength,
    contentType: encodedRequest.headers.get("content-type") ?? "",
    headerOrganizationId,
  });
}

function makeChunkedRequest({
  chunks,
  contentLength,
  contentType,
  headerOrganizationId = ORGANIZATION_ID,
}: {
  chunks: Uint8Array[];
  contentLength: number;
  contentType: string;
  headerOrganizationId?: string;
}): {
  request: NextRequest;
  pullSpy: ReturnType<typeof vi.fn>;
  cancelSpy: ReturnType<typeof vi.fn>;
} {
  const pullSpy = vi.fn();
  const cancelSpy = vi.fn();
  let chunkIndex = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pullSpy();
        const chunk = chunks[chunkIndex];

        if (chunk === undefined) {
          controller.close();
          return;
        }

        chunkIndex += 1;
        controller.enqueue(chunk);
      },
      cancel: cancelSpy,
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers({
    "content-length": String(contentLength),
    "content-type": contentType,
    "x-organization-id": headerOrganizationId,
  });
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> & {
    duplex: "half";
  } = {
    method: "POST",
    body,
    headers,
    duplex: "half",
  };

  return {
    request: new NextRequest(
      "http://localhost/api/attendance/import/transform",
      init,
    ),
    pullSpy,
    cancelSpy,
  };
}

function makeValidFormData(): FormData {
  const formData = new FormData();
  formData.set("organizationId", ORGANIZATION_ID);
  formData.set("file", validCsvFile);
  return formData;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function expectTransformationNotStarted(): void {
  expect(readAttendanceWorkbookMock).not.toHaveBeenCalled();
  expect(extractAttendanceWithGeminiMock).not.toHaveBeenCalled();
}

describe("canTransformAttendanceImport", () => {
  it.each(["owner", "admin", "hr", "manager"])(
    "allows an active %s membership",
    (role) => {
      expect(
        canTransformAttendanceImport({ role, accessStatus: "active" }),
      ).toBe(true);
    },
  );

  it.each(["employee", "accounting", "unknown"])(
    "rejects an active %s membership",
    (role) => {
      expect(
        canTransformAttendanceImport({ role, accessStatus: "active" }),
      ).toBe(false);
    },
  );

  it("rejects inactive, malformed, and missing memberships", () => {
    expect(
      canTransformAttendanceImport({ role: "owner", accessStatus: "inactive" }),
    ).toBe(false);
    expect(canTransformAttendanceImport({ role: "OWNER", accessStatus: "active" })).toBe(
      true,
    );
    expect(canTransformAttendanceImport(null)).toBe(false);
  });
});

describe("POST /api/attendance/import/transform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTokenMock.mockResolvedValue("test-token");
    fetchAuthQueryMock.mockResolvedValue({
      role: "hr",
      accessStatus: "active",
    });
    readAttendanceWorkbookMock.mockResolvedValue(workbook);
    extractAttendanceWithGeminiMock.mockResolvedValue(candidates);
  });

  it("returns 401 without a token before querying membership or transforming", async () => {
    getTokenMock.mockResolvedValue(undefined);

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Authentication is required.",
    });
    expect(fetchAuthQueryMock).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it("does not pull a body chunk before rejecting an unauthenticated request", async () => {
    getTokenMock.mockResolvedValue(undefined);
    const { request, pullSpy } = await makeObservedStreamRequest({
      formData: makeValidFormData(),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(pullSpy).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it("returns a fixed 401 response when token retrieval fails", async () => {
    getTokenMock.mockRejectedValue(new Error("sensitive authentication detail"));

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Authentication is required.",
    });
    expect(fetchAuthQueryMock).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it.each([null, "", "not/a/convex/id", "short", "K57C6M9N2P4Q7R8S3T5V6W9X2Y4Z7A8B"])(
    "returns 400 for the missing or invalid organization ID %s",
    async (organizationId) => {
      const response = await POST(makeMultipartRequest({ organizationId }));

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        ok: false,
        code: "invalid_request",
        message: "The attendance import request is invalid.",
      });
      expect(fetchAuthQueryMock).not.toHaveBeenCalled();
      expectTransformationNotStarted();
    },
  );

  it.each(["employee", "accounting"])(
    "rejects the %s role before reading the workbook",
    async (role) => {
      fetchAuthQueryMock.mockResolvedValue({ role, accessStatus: "active" });

      const response = await POST(makeMultipartRequest());

      expect(response.status).toBe(403);
      expect(await readJson(response)).toEqual({
        ok: false,
        code: "forbidden",
        message: "You are not allowed to transform attendance imports.",
      });
      expectTransformationNotStarted();
    },
  );

  it("does not pull a body chunk before rejecting a forbidden membership", async () => {
    fetchAuthQueryMock.mockResolvedValue({
      role: "employee",
      accessStatus: "active",
    });
    const { request, pullSpy } = await makeObservedStreamRequest({
      formData: makeValidFormData(),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(pullSpy).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it("rejects an inactive membership before reading the workbook", async () => {
    fetchAuthQueryMock.mockResolvedValue({
      role: "owner",
      accessStatus: "alumni",
    });

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(403);
    expectTransformationNotStarted();
  });

  it("rejects a missing membership before reading the workbook", async () => {
    fetchAuthQueryMock.mockResolvedValue(null);

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(403);
    expectTransformationNotStarted();
  });

  it.each(["owner", "admin", "hr", "manager"])(
    "allows the %s role to transform attendance",
    async (role) => {
      fetchAuthQueryMock.mockResolvedValue({ role, accessStatus: "active" });

      const response = await POST(makeMultipartRequest());

      expect(response.status).toBe(200);
      expect(fetchAuthQueryMock).toHaveBeenCalledWith(
        api.organizations.getCurrentUser,
        { organizationId: ORGANIZATION_ID },
      );
      expect(await readJson(response)).toEqual({ ok: true, candidates });
    },
  );

  it("returns 400 when the multipart request has no file", async () => {
    const response = await POST(makeMultipartRequest({ file: null }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expectTransformationNotStarted();
  });

  it("returns 400 when authorized multipart omits its organization field", async () => {
    const formData = new FormData();
    formData.set("file", validCsvFile);

    const response = await POST(makeMultipartRequest({ formData }));

    expect(response.status).toBe(400);
    expectTransformationNotStarted();
  });

  it("returns 413 before parsing multipart above 11 MB", async () => {
    const response = await POST(
      makeMultipartRequest({ contentLength: 11 * 1024 * 1024 + 1 }),
    );

    expect(response.status).toBe(413);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(fetchAuthQueryMock).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it("returns 413 and cancels a streamed multipart body that exceeds 11 MB despite a low declared length", async () => {
    const encoder = new TextEncoder();
    const boundary = "attendance-boundary";
    const chunks = [
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\n`,
      ),
      ...Array.from(
        { length: 12 },
        () => new Uint8Array(1024 * 1024),
      ),
    ];
    const { request, cancelSpy } = makeChunkedRequest({
      chunks,
      contentLength: 1,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(cancelSpy).toHaveBeenCalledOnce();
    expectTransformationNotStarted();
  });

  it("returns 400 before parsing multipart without Content-Length", async () => {
    const response = await POST(makeMultipartRequest({ contentLength: null }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(fetchAuthQueryMock).not.toHaveBeenCalled();
    expectTransformationNotStarted();
  });

  it("returns 415 for an unsupported file before workbook parsing", async () => {
    const file = new File(["legacy"], "attendance.xls", {
      type: "application/vnd.ms-excel",
    });

    const response = await POST(makeMultipartRequest({ file }));

    expect(response.status).toBe(415);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: "unsupported_file",
    });
    expectTransformationNotStarted();
  });

  it.each([
    {
      name: "an extra field",
      mutate(formData: FormData) {
        formData.set("notes", "private notes");
      },
    },
    {
      name: "duplicate organization fields",
      mutate(formData: FormData) {
        formData.append("organizationId", ORGANIZATION_ID);
      },
    },
    {
      name: "duplicate file fields",
      mutate(formData: FormData) {
        formData.append("file", validCsvFile);
      },
    },
    {
      name: "a non-string organization field",
      mutate(formData: FormData) {
        formData.set("organizationId", validCsvFile);
      },
    },
    {
      name: "a non-file upload field",
      mutate(formData: FormData) {
        formData.set("file", "not-a-file");
      },
    },
  ])("returns 400 for multipart containing $name", async ({ mutate }) => {
    const formData = makeValidFormData();
    mutate(formData);

    const response = await POST(makeMultipartRequest({ formData }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expectTransformationNotStarted();
  });

  it("returns 400 when multipart organization does not match the authorized header", async () => {
    const otherOrganizationId = "a57c6m9n2p4q7r8s3t5v6w9x2y4z7a8b";

    const response = await POST(
      makeMultipartRequest({ headerOrganizationId: otherOrganizationId }),
    );

    expect(response.status).toBe(400);
    expect(fetchAuthQueryMock).toHaveBeenCalledWith(
      api.organizations.getCurrentUser,
      { organizationId: otherOrganizationId },
    );
    expectTransformationNotStarted();
  });

  it("returns 422 when strict workbook ingestion rejects the file", async () => {
    readAttendanceWorkbookMock.mockRejectedValue(
      new Error("sensitive cell payload"),
    );

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(422);
    expect(await readJson(response)).toEqual({
      ok: false,
      code: "unsafe_workbook",
      message: "The attendance workbook could not be processed safely.",
    });
    expect(extractAttendanceWithGeminiMock).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", 503, "not_configured"],
    ["rate_limited", 429, "rate_limited"],
    ["timeout", 503, "timeout"],
    ["unavailable", 503, "provider_unavailable"],
    ["refused", 502, "invalid_provider_response"],
    ["invalid_response", 502, "invalid_provider_response"],
  ] as const)(
    "maps Gemini %s to a fixed %s response",
    async (geminiCode, status, responseCode) => {
      extractAttendanceWithGeminiMock.mockRejectedValue(
        new GeminiAttendanceError(geminiCode, "sensitive provider body"),
      );

      const response = await POST(makeMultipartRequest());
      const body = await readJson(response);

      expect(response.status).toBe(status);
      expect(body).toMatchObject({ ok: false, code: responseCode });
      expect(JSON.stringify(body)).not.toContain("sensitive provider body");
    },
  );

  it("returns 422 when Gemini finds no attendance candidates", async () => {
    extractAttendanceWithGeminiMock.mockResolvedValue([]);

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(422);
    expect(await readJson(response)).toEqual({
      ok: false,
      code: "no_attendance",
      message: "No attendance candidates were found.",
    });
  });

  it("returns mixed valid and invalid normalized candidates", async () => {
    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, candidates });
    const parsedFile = readAttendanceWorkbookMock.mock.calls[0]?.[0];
    expect(parsedFile).toBeInstanceOf(File);
    expect({
      name: parsedFile?.name,
      size: parsedFile?.size,
      type: parsedFile?.type,
    }).toEqual({
      name: validCsvFile.name,
      size: validCsvFile.size,
      type: validCsvFile.type,
    });
    expect(extractAttendanceWithGeminiMock).toHaveBeenCalledWith(workbook);
  });

  it("never returns or logs the uploaded filename or caught boundary values", async () => {
    const sensitiveFilename = "private-payroll-secret.csv";
    const sensitiveError = "sensitive provider body";
    extractAttendanceWithGeminiMock.mockRejectedValue(
      new GeminiAttendanceError("refused", sensitiveError),
    );

    const response = await POST(
      makeMultipartRequest({
        file: new File(["Name\nAda"], sensitiveFilename, {
          type: "text/csv",
        }),
      }),
    );
    const responseBody: AttendanceImportTransformResponse =
      await response.json();
    const serializedLogs = JSON.stringify(consoleInfoMock.mock.calls);

    expect(JSON.stringify(responseBody)).not.toContain(sensitiveFilename);
    expect(JSON.stringify(responseBody)).not.toContain(sensitiveError);
    expect(serializedLogs).not.toContain(sensitiveFilename);
    expect(serializedLogs).not.toContain(sensitiveError);
    const metadata = consoleInfoMock.mock.calls.at(-1)?.[1];
    expect(metadata).toBeTypeOf("object");
    expect(Object.keys(metadata as object).sort()).toEqual([
      "byteCount",
      "candidateCount",
      "category",
      "correlationId",
      "durationMs",
      "rowCount",
      "sheetCount",
      "status",
    ]);
  });

  it("does not return a CSV upload filename on successful transformation", async () => {
    const sensitiveFilename = "private-payroll-secret.csv";

    const response = await POST(
      makeMultipartRequest({
        file: new File(["Name\nAda"], sensitiveFilename, {
          type: "text/csv",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(
      sensitiveFilename,
    );
  });
});
