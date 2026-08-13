import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AttendanceImportFileControls } from "@/app/[organizationId]/attendance/_components/attendance-import-file-controls";
import {
  transformAttendanceImport,
  validateAttendanceImportFile,
} from "@/lib/attendance-import/client";
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
        onFileChange: () => undefined,
        onDownloadTemplate: () => undefined,
      }),
    );

    expect(markup).toContain("Attendance file");
    expect(markup).toContain('accept=".xlsx,.csv"');
    expect(markup).toContain(
      "Only Excel (.xlsx) and CSV (.csv) files are supported.",
    );
    expect(markup).toContain(
      "This file will be processed by Google Gemini.",
    );
    expect(markup).toContain("Processing with Gemini…");
  });

  it("rejects unsupported, uppercase-extension, and oversized files before upload", () => {
    expect(() =>
      validateAttendanceImportFile(
        new File(["name,date"], "attendance.txt", { type: "text/plain" }),
      ),
    ).toThrow("Only Excel (.xlsx) and CSV (.csv) files are supported.");
    expect(() =>
      validateAttendanceImportFile(
        new File(["name,date"], "attendance.CSV", { type: "text/csv" }),
      ),
    ).toThrow("Only Excel (.xlsx) and CSV (.csv) files are supported.");
    expect(() =>
      validateAttendanceImportFile(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "attendance.csv"),
      ),
    ).toThrow("The attendance file must be 10 MB or smaller.");
  });

  it("uploads the organization in the header and multipart body and keeps every candidate", async () => {
    const candidates = [validCandidate, invalidCandidate];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ok: true, candidates }),
    );

    const result = await transformAttendanceImport(
      validCsvFile,
      organizationId,
      fetchImpl,
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
