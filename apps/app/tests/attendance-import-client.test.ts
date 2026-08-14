import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AttendanceImportFileControls } from "@/app/[organizationId]/attendance/_components/attendance-import-file-controls";
import {
  transformAttendanceImport,
  validateAttendanceImportFile,
} from "@/lib/attendance-import/client";
import {
  areAttendanceImportLookupsReady,
  AttendanceImportRequestCoordinator,
  handleAttendanceDialogOpenChange,
  isAttendanceConflictCheckPending,
  runLatestAttendanceImportRequest,
} from "@/lib/attendance-import/lifecycle";
import type { NormalizedAttendanceCandidate } from "@/lib/attendance-import/types";

const organizationId = "k57c6m9n2p4q7r8s3t5v6w9x2y4z7a8b";
const validCsvFile = new File(
  ["Employee,Date\nAda,2026-08-13"],
  "attendance.csv",
  { type: "text/csv" },
);
const validCandidate: NormalizedAttendanceCandidate = {
  sourceSheet: "CSV",
  sourceRow: 2,
  employeeKey: "Ada Lovelace",
  date: "2026-08-13",
  timeIn: "9:00 AM",
  timeOut: "5:00 PM",
  status: "present",
  notes: "Client visit",
  issues: [],
};
const invalidCandidate: NormalizedAttendanceCandidate = {
  sourceSheet: "Night Shift",
  sourceRow: 7,
  employeeKey: "",
  date: "2026-08-13",
  status: "present",
  notes: "",
  issues: [
    { code: "missing_employee", message: "Employee is required." },
    { code: "missing_time_in", message: "Time In is required." },
    { code: "missing_time_out", message: "Time Out is required." },
  ],
};

describe("attendance import client", () => {
  it("renders the supported file guidance and Gemini processing state", () => {
    const markup = renderToStaticMarkup(
      createElement(AttendanceImportFileControls, {
        isTransforming: true,
        isCheckingConflicts: false,
        lookupsReady: true,
        onFileChange: () => undefined,
        onDownloadTemplate: () => undefined,
      }),
    );

    expect(markup).toContain("Attendance file");
    expect(markup).toContain('accept=".xls,.xlsx,.xlsm,.csv"');
    expect(markup).toContain(
      "Only Excel (.xls, .xlsx, .xlsm) and CSV (.csv) files are supported.",
    );
    expect(markup).toContain("Processing with Gemini…");
  });

  it("disables upload while employee and holiday lookups are loading", () => {
    const markup = renderToStaticMarkup(
      createElement(AttendanceImportFileControls, {
        isTransforming: false,
        isCheckingConflicts: false,
        lookupsReady: false,
        onFileChange: () => undefined,
        onDownloadTemplate: () => undefined,
      }),
    );

    expect(markup).toContain('type="file"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Preparing employee and holiday data…");
  });

  it("renders the conflict-checking state before final import is allowed", () => {
    const markup = renderToStaticMarkup(
      createElement(AttendanceImportFileControls, {
        isTransforming: false,
        isCheckingConflicts: true,
        lookupsReady: true,
        onFileChange: () => undefined,
        onDownloadTemplate: () => undefined,
      }),
    );

    expect(markup).toContain("Checking existing attendance…");
  });

  it("treats empty lookup and conflict results as loaded", () => {
    expect(areAttendanceImportLookupsReady(undefined, [])).toBe(false);
    expect(areAttendanceImportLookupsReady([], undefined)).toBe(false);
    expect(areAttendanceImportLookupsReady([], [])).toBe(true);
    expect(isAttendanceConflictCheckPending(true, undefined)).toBe(true);
    expect(isAttendanceConflictCheckPending(true, [])).toBe(false);
    expect(isAttendanceConflictCheckPending(false, undefined)).toBe(false);
  });

  it("lets only the latest request update rows, errors, and loading", async () => {
    const coordinator = new AttendanceImportRequestCoordinator();
    const first = deferred<string>();
    const second = deferred<string>();
    const rows: string[] = [];
    const errors: string[] = [];
    const signals: AbortSignal[] = [];
    let loading = false;

    const run = (request: Promise<string>) =>
      runLatestAttendanceImportRequest(
        coordinator,
        (signal) => {
          signals.push(signal);
          return request;
        },
        {
          onStart: () => {
            loading = true;
          },
          onSuccess: (value) => rows.push(value),
          onError: (error) =>
            errors.push(error instanceof Error ? error.message : "unknown"),
          onFinish: () => {
            loading = false;
          },
        },
      );

    const firstRun = run(first.promise);
    const secondRun = run(second.promise);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    first.reject(new Error("stale failure"));
    await firstRun;

    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
    expect(loading).toBe(true);

    second.resolve("current rows");
    await secondRun;

    expect(rows).toEqual(["current rows"]);
    expect(errors).toEqual([]);
    expect(loading).toBe(false);
  });

  it("invalidates and aborts an active request when the dialog closes", async () => {
    const coordinator = new AttendanceImportRequestCoordinator();
    const request = deferred<string>();
    const rows: string[] = [];
    let loading = false;
    let dialogOpen = true;
    let activeSignal: AbortSignal | undefined;
    const running = runLatestAttendanceImportRequest(
      coordinator,
      (signal) => {
        activeSignal = signal;
        return request.promise;
      },
      {
        onStart: () => {
          loading = true;
        },
        onSuccess: (value) => rows.push(value),
        onError: () => rows.push("error"),
        onFinish: () => {
          loading = false;
        },
      },
    );

    handleAttendanceDialogOpenChange(
      false,
      () => {
        coordinator.invalidate();
        loading = false;
      },
      (open) => {
        dialogOpen = open;
      },
    );
    request.resolve("late rows");
    await running;

    expect(dialogOpen).toBe(false);
    expect(activeSignal?.aborted).toBe(true);
    expect(rows).toEqual([]);
    expect(loading).toBe(false);
  });

  it("accepts supported lowercase Excel extensions before upload", () => {
    expect(() =>
      validateAttendanceImportFile(new File(["legacy"], "attendance.xls")),
    ).not.toThrow();
    expect(() =>
      validateAttendanceImportFile(new File(["ooxml"], "attendance.xlsx")),
    ).not.toThrow();
    expect(() =>
      validateAttendanceImportFile(new File(["macros"], "attendance.xlsm")),
    ).not.toThrow();
  });

  it("rejects unsupported, uppercase-extension, and oversized files before upload", () => {
    expect(() =>
      validateAttendanceImportFile(
        new File(["name,date"], "attendance.txt", { type: "text/plain" }),
      ),
    ).toThrow(
      "Only Excel (.xls, .xlsx, .xlsm) and CSV (.csv) files are supported.",
    );
    expect(() =>
      validateAttendanceImportFile(
        new File(["name,date"], "attendance.CSV", { type: "text/csv" }),
      ),
    ).toThrow(
      "Only Excel (.xls, .xlsx, .xlsm) and CSV (.csv) files are supported.",
    );
    expect(() =>
      validateAttendanceImportFile(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "attendance.csv"),
      ),
    ).toThrow("The attendance file must be 10 MB or smaller.");
  });

  it("uploads the organization in the header and multipart body and keeps every candidate", async () => {
    const candidates = [validCandidate, invalidCandidate];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, candidates }));

    const controller = new AbortController();
    const result = await transformAttendanceImport(
      validCsvFile,
      organizationId,
      fetchImpl,
      controller.signal,
    );

    expect(result).toEqual(candidates);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/attendance/import/transform");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-organization-id")).toBe(
      organizationId,
    );
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(init?.signal).toBe(controller.signal);
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("organizationId")).toBe(organizationId);
    expect((body as FormData).get("file")).toBe(validCsvFile);
  });

  it("surfaces only the route's fixed safe error message", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          code: "rate_limited",
          message: "Attendance extraction is busy. Try again shortly.",
        },
        { status: 429 },
      ),
    );

    await expect(
      transformAttendanceImport(validCsvFile, organizationId, fetchImpl),
    ).rejects.toThrow("Attendance extraction is busy. Try again shortly.");
  });

  it.each([
    {
      name: "invalid JSON",
      response: new Response("not-json", { status: 502 }),
    },
    {
      name: "a success with extra fields",
      response: Response.json({
        ok: true,
        candidates: [validCandidate],
        providerOutput: "private",
      }),
    },
    {
      name: "a malformed candidate",
      response: Response.json({
        ok: true,
        candidates: [{ ...validCandidate, sourceRow: 0 }],
      }),
    },
    {
      name: "an attacker-controlled route message",
      response: Response.json(
        {
          ok: false,
          code: "rate_limited",
          message: "SECRET PROVIDER BODY",
        },
        { status: 429 },
      ),
    },
    {
      name: "an error payload with a successful HTTP status",
      response: Response.json({
        ok: false,
        code: "rate_limited",
        message: "Attendance extraction is busy. Try again shortly.",
      }),
    },
    {
      name: "an error payload with the wrong failure status",
      response: Response.json(
        {
          ok: false,
          code: "rate_limited",
          message: "Attendance extraction is busy. Try again shortly.",
        },
        { status: 403 },
      ),
    },
  ])("rejects $name with the fixed transform failure", async ({ response }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      transformAttendanceImport(validCsvFile, organizationId, fetchImpl),
    ).rejects.toThrow("The attendance file could not be transformed.");
  });

  it("maps a network failure to the fixed transform failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private network details"));

    await expect(
      transformAttendanceImport(validCsvFile, organizationId, fetchImpl),
    ).rejects.toThrow("The attendance file could not be transformed.");
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}
