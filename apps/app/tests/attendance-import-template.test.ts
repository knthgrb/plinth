import { describe, expect, it } from "vitest";

import { parseAttendanceTemplateWorkbook } from "@/lib/attendance-import/template";
import type { WorkbookData } from "@/lib/attendance-import/workbook";

function workbookWithRows(rows: WorkbookData["sheets"][number]["rows"]): WorkbookData {
  const cellCount = rows.reduce(
    (total, row) => total + row.cells.filter((cell) => cell !== null && cell !== "").length,
    0,
  );

  return {
    sheets: [{ name: "CSV", rows }],
    rowCount: rows.length,
    cellCount,
  };
}

const templateHeader = {
  rowNumber: 1,
  cells: ["Employee Name", "Date", "Time In", "Time Out", "Status", "Notes"],
};

describe("attendance template parsing", () => {
  it("normalizes valid template rows without an AI transformation", () => {
    const workbook = workbookWithRows([
      templateHeader,
      {
        rowNumber: 2,
        cells: ["Ada Lovelace", "2026-08-17", "09:15", "23:12", "", "Night close"],
      },
    ]);

    expect(parseAttendanceTemplateWorkbook(workbook)).toEqual([
      {
        sourceSheet: "CSV",
        sourceRow: 2,
        employeeKey: "Ada Lovelace",
        date: "2026-08-17",
        timeIn: "9:15 AM",
        timeOut: "11:12 PM",
        status: "present",
        notes: "Night close",
        issues: [],
      },
    ]);
  });

  it("accepts harmless template header formatting differences", () => {
    const workbook = workbookWithRows([
      {
        rowNumber: 1,
        cells: [
          "\uFEFF employee name ",
          " DATE ",
          " time in ",
          " TIME OUT ",
          " Status ",
          " notes ",
        ],
      },
      {
        rowNumber: 4,
        cells: ["Grace Hopper", "2026-08-18", "8:30 AM", "5:30 PM", "present", null],
      },
    ]);

    expect(parseAttendanceTemplateWorkbook(workbook)?.[0]).toMatchObject({
      sourceRow: 4,
      employeeKey: "Grace Hopper",
      timeIn: "8:30 AM",
      timeOut: "5:30 PM",
      notes: "",
    });
  });

  it("keeps the previous Employee header compatible", () => {
    const workbook = workbookWithRows([
      {
        ...templateHeader,
        cells: ["Employee", "Date", "Time In", "Time Out", "Status", "Notes"],
      },
      {
        rowNumber: 2,
        cells: ["Ada Lovelace", "2026-08-17", "09:00", "18:00", "", ""],
      },
    ]);

    expect(parseAttendanceTemplateWorkbook(workbook)?.[0]?.employeeKey).toBe(
      "Ada Lovelace",
    );
  });

  it("drops template rows whose employee value is only a number", () => {
    const workbook = workbookWithRows([
      templateHeader,
      {
        rowNumber: 2,
        cells: ["8", "2026-08-17", "09:00", "18:00", "", ""],
      },
    ]);

    expect(parseAttendanceTemplateWorkbook(workbook)).toEqual([]);
  });

  it("returns null for CSV layouts that do not match the template", () => {
    const workbook = workbookWithRows([
      {
        rowNumber: 1,
        cells: ["Name", "Work Date", "Clock In", "Clock Out"],
      },
      {
        rowNumber: 2,
        cells: ["Ada", "2026-08-17", "09:00", "18:00"],
      },
    ]);

    expect(parseAttendanceTemplateWorkbook(workbook)).toBeNull();
  });

  it("keeps invalid rows on the deterministic template path for review", () => {
    const workbook = workbookWithRows([
      templateHeader,
      {
        rowNumber: 8,
        cells: ["Katherine Johnson", "2026-02-29", "09:00", "", "present", ""],
      },
    ]);

    const result = parseAttendanceTemplateWorkbook(workbook);

    expect(result).not.toBeNull();
    expect(result?.[0]).toMatchObject({
      sourceRow: 8,
      employeeKey: "Katherine Johnson",
      date: "2026-02-29",
      timeIn: "9:00 AM",
      timeOut: undefined,
    });
    expect(result?.[0]?.issues.map((issue) => issue.code)).toEqual([
      "invalid_date",
      "missing_time_out",
    ]);
  });
});
