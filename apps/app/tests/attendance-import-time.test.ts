import { describe, expect, it } from "vitest";

import {
  normalizeGeminiAttendanceCandidate,
  parseAttendanceTime,
} from "@/lib/attendance-import/time";

describe("Gemini attendance normalization", () => {
  it("keeps explicit times ahead of punch-derived values", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "August",
      sourceRow: 8,
      employeeKey: "EMP-001",
      date: "2026-08-13",
      explicitTimeIn: "8:30 AM",
      explicitTimeOut: "5:15 PM",
      punches: ["6:01 AM", "12:00 PM"],
      status: "present",
      notes: "Client visit",
      extractionIssues: [],
    });

    expect(result.timeIn).toBe("8:30 AM");
    expect(result.timeOut).toBe("5:15 PM");
    expect(result.issues).toEqual([]);
  });

  it("uses earliest and latest punches when explicit columns are absent", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Punches",
      sourceRow: 3,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "",
      explicitTimeOut: "",
      punches: ["7:02 AM", "12:00 PM", "6:01 AM", "8:01 AM"],
      status: "",
      notes: "",
      extractionIssues: [],
    });

    expect(result.timeIn).toBe("6:01 AM");
    expect(result.timeOut).toBe("12:00 PM");
    expect(result.status).toBe("present");
  });

  it("derives only time in from a single punch", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Punches",
      sourceRow: 4,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "",
      explicitTimeOut: "",
      punches: ["6:01 AM"],
      status: "present",
      notes: "",
      extractionIssues: [],
    });

    expect(result.timeIn).toBe("6:01 AM");
    expect(result.timeOut).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain(
      "missing_time_out",
    );
  });

  it("flags an incomplete row without discarding its valid values", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 4,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "9:00 AM",
      explicitTimeOut: "",
      punches: [],
      status: "present",
      notes: "",
      extractionIssues: [],
    });

    expect(result.timeIn).toBe("9:00 AM");
    expect(result.issues.map((issue) => issue.code)).toContain("missing_time_out");
  });

  it("formats midnight, noon, and 24-hour input consistently", () => {
    expect(parseAttendanceTime("12:00 AM")).toEqual({
      minutes: 0,
      formatted: "12:00 AM",
    });
    expect(parseAttendanceTime("12:00 PM")).toEqual({
      minutes: 720,
      formatted: "12:00 PM",
    });
    expect(parseAttendanceTime("17:05")).toEqual({
      minutes: 1025,
      formatted: "5:05 PM",
    });
  });

  it("rejects invalid time minutes", () => {
    expect(parseAttendanceTime("8:60 AM")).toBeUndefined();
  });

  it("does not replace an invalid explicit time with a punch", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 2,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "8:60 AM",
      explicitTimeOut: "",
      punches: ["8:00 AM", "5:00 PM"],
      status: "present",
      notes: "",
      extractionIssues: [],
    });

    expect(result.timeIn).toBeUndefined();
    expect(result.timeOut).toBe("5:00 PM");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "invalid_time",
      "missing_time_in",
    ]);
  });

  it("flags missing employee and date values", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 1,
      employeeKey: "",
      date: "",
      explicitTimeIn: "",
      explicitTimeOut: "",
      punches: [],
      status: "",
      notes: "",
      extractionIssues: [],
    });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "missing_employee",
      "missing_date",
      "missing_time_in",
      "missing_time_out",
    ]);
  });

  it("rejects invalid ISO calendar dates", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 1,
      employeeKey: "Jane Doe",
      date: "2026-02-29",
      explicitTimeIn: "8:00 AM",
      explicitTimeOut: "5:00 PM",
      punches: [],
      status: "present",
      notes: "",
      extractionIssues: [],
    });

    expect(result.issues.map((issue) => issue.code)).toContain("invalid_date");
  });

  it("preserves explicitly supplied supported statuses", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 1,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "8:00 AM",
      explicitTimeOut: "5:00 PM",
      punches: [],
      status: "leave_without_pay",
      notes: "",
      extractionIssues: [],
    });

    expect(result.status).toBe("leave_without_pay");
    expect(result.issues).toEqual([]);
  });

  it("defaults unsupported statuses to present and flags them", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 1,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "8:00 AM",
      explicitTimeOut: "5:00 PM",
      punches: [],
      status: "working remotely",
      notes: "",
      extractionIssues: [],
    });

    expect(result.status).toBe("present");
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_status");
  });

  it("retains extraction issues as import issues", () => {
    const result = normalizeGeminiAttendanceCandidate({
      sourceSheet: "Sheet1",
      sourceRow: 1,
      employeeKey: "Jane Doe",
      date: "2026-08-13",
      explicitTimeIn: "8:00 AM",
      explicitTimeOut: "5:00 PM",
      punches: [],
      status: "present",
      notes: "",
      extractionIssues: ["Merged cells obscured the row"],
    });

    expect(result.issues).toContainEqual({
      code: "extraction_issue",
      message: "Merged cells obscured the row",
    });
  });
});
