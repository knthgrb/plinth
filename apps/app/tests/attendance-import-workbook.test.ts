import { describe, expect, it } from "vitest";

import { readAttendanceWorkbook } from "@/lib/attendance-import/workbook";
import {
  makeTwoSheetXlsx,
  makeWorksheetXml,
} from "./helpers/zip-fixture";

function makeValidatedXlsxFile(): File {
  const bytes = makeTwoSheetXlsx();

  return new File(
    [new Uint8Array(bytes)],
    "attendance.xlsx",
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}

describe("attendance workbook ingestion", () => {
  it("parses escaped quotes and embedded newlines without splitting a CSV record", async () => {
    const file = new File(
      ['Name,Notes\r\nAna,"Said ""hello""\nand left"'],
      "attendance.csv",
      { type: "text/csv" },
    );

    const workbook = await readAttendanceWorkbook(file);

    expect(workbook.sheets).toEqual([
      {
        name: "attendance.csv",
        rows: [
          { rowNumber: 1, cells: ["Name", "Notes"] },
          { rowNumber: 2, cells: ["Ana", 'Said "hello"\nand left'] },
        ],
      },
    ]);
    expect(workbook.rowCount).toBe(2);
    expect(workbook.cellCount).toBe(4);
  });

  it("keeps formula-looking CSV cells as inert plain text", async () => {
    const workbook = await readAttendanceWorkbook(
      new File(["Employee,Value\nAna,=2+2"], "formulas.csv"),
    );

    expect(workbook.sheets[0]?.rows[1]?.cells[1]).toBe("=2+2");
  });

  it("rejects malformed UTF-8 instead of replacing invalid bytes", async () => {
    const file = new File(
      [new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xc3, 0x28])],
      "invalid.csv",
    );

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/utf-8/i);
  });

  it("rejects NUL bytes instead of forwarding hidden CSV content", async () => {
    const file = new File(["Name\nAna\0hidden"], "nul.csv");

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/nul/i);
  });

  it("rejects a CSV with more than 10,000 physical rows before retaining it", async () => {
    const file = new File(
      [Array.from({ length: 10_001 }, () => "Ana").join("\n")],
      "rows.csv",
    );

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/rows/i);
  });

  it("rejects a CSV row with more than 100 columns", async () => {
    const file = new File([Array.from({ length: 101 }, () => "x").join(",")], "columns.csv");

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/columns/i);
  });

  it("rejects a CSV cell longer than 2,000 characters while parsing", async () => {
    const file = new File(["x".repeat(2_001)], "cell.csv");

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/cell/i);
  });

  it("rejects more than 500,000 aggregate CSV cells while parsing", async () => {
    const row = Array.from({ length: 100 }, () => "x").join(",");
    const file = new File(
      [Array.from({ length: 5_001 }, () => row).join("\n")],
      "cells.csv",
    );

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/cells/i);
  });

  it("rejects malformed quoted CSV instead of interpreting ambiguous columns", async () => {
    const file = new File(['Name,Notes\nAna,"unclosed'], "quotes.csv");

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/quoted csv/i);
  });

  it("retains every worksheet and source row number", async () => {
    const file = makeValidatedXlsxFile();
    const readSheets = async () => [
      { sheet: "Manila", data: [["Name", "Date"], ["Ana", "2026-08-13"]] },
      { sheet: "Cebu", data: [["Name", "Date"], ["Ben", "2026-08-13"]] },
    ];

    const workbook = await readAttendanceWorkbook(file, { readSheets });

    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Manila", "Cebu"]);
    expect(workbook.sheets[1]?.rows[1]?.rowNumber).toBe(2);
    expect(workbook.rowCount).toBe(4);
    expect(workbook.cellCount).toBe(8);
  });

  it("parses a real minimal two-sheet OOXML workbook through the production parser", async () => {
    const workbook = await readAttendanceWorkbook(makeValidatedXlsxFile());

    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Manila", "Cebu"]);
    expect(workbook.sheets[0]?.rows[1]).toEqual({
      rowNumber: 2,
      cells: ["Ana", "2026-08-13"],
    });
    expect(workbook.sheets[1]?.rows[1]).toEqual({
      rowNumber: 2,
      cells: ["Ben", "2026-08-13"],
    });
  });

  it("rejects hostile worksheet dimensions before invoking read-excel-file", async () => {
    const bytes = makeTwoSheetXlsx({
      Manila: makeWorksheetXml("A1:XFD1048576", [["Name"]]),
    });
    let parserWasCalled = false;

    await expect(
      readAttendanceWorkbook(new File([new Uint8Array(bytes)], "hostile.xlsx"), {
        readSheets: async () => {
          parserWasCalled = true;
          return [];
        },
      }),
    ).rejects.toThrow(/worksheet dimension/i);
    expect(parserWasCalled).toBe(false);
  });

  it("normalizes XLSX dates to UTC calendar-only ISO text", async () => {
    const workbook = await readAttendanceWorkbook(makeValidatedXlsxFile(), {
      readSheets: async () => [
        {
          sheet: "Dates",
          data: [[new Date("2026-08-13T23:30:00.000Z")]],
        },
      ],
    });

    expect(workbook.sheets[0]?.rows[0]?.cells).toEqual(["2026-08-13"]);
  });

  it("counts only nonempty CSV rows and cells while retaining source row numbers", async () => {
    const workbook = await readAttendanceWorkbook(
      new File(["Name\n\n\nAna"], "sparse.csv"),
    );

    expect(workbook.rowCount).toBe(2);
    expect(workbook.cellCount).toBe(2);
    expect(workbook.sheets[0]?.rows.map((row) => row.rowNumber)).toEqual([1, 4]);
  });

  it("counts only nonempty XLSX rows and cells", async () => {
    const workbook = await readAttendanceWorkbook(makeValidatedXlsxFile(), {
      readSheets: async () => [
        { sheet: "Sparse", data: [[null, null], ["Ana", null], []] },
      ],
    });

    expect(workbook.rowCount).toBe(1);
    expect(workbook.cellCount).toBe(1);
    expect(workbook.sheets[0]?.rows).toEqual([
      { rowNumber: 2, cells: ["Ana", null] },
    ]);
  });

  it("turns unsupported XLSX parser objects into empty cells", async () => {
    const workbook = await readAttendanceWorkbook(makeValidatedXlsxFile(), {
      readSheets: async () => [
        {
          sheet: "Objects",
          data: [[{ formula: "=2+2" }, true, 7]],
        },
      ],
    });

    expect(workbook.sheets[0]?.rows[0]?.cells).toEqual([null, true, 7]);
  });

  it("rejects invalid XLSX metadata before invoking the decompression parser", async () => {
    let parserWasCalled = false;

    await expect(
      readAttendanceWorkbook(new File([new Uint8Array(100)], "invalid.xlsx"), {
        readSheets: async () => {
          parserWasCalled = true;
          return [];
        },
      }),
    ).rejects.toThrow(/end.*directory/i);
    expect(parserWasCalled).toBe(false);
  });

  it("rejects XLSX workbooks with more than 20 worksheets", async () => {
    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () =>
          Array.from({ length: 21 }, (_, index) => ({
            sheet: `Sheet ${index + 1}`,
            data: [["Name"]],
          })),
      }),
    ).rejects.toThrow(/worksheets/i);
  });

  it("rejects more than 10,000 aggregate XLSX rows", async () => {
    const data = Array.from({ length: 10_001 }, () => ["Ana"]);

    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [{ sheet: "Rows", data }],
      }),
    ).rejects.toThrow(/rows/i);
  });

  it("rejects an XLSX row with more than 100 columns", async () => {
    const data = [Array.from({ length: 101 }, () => "x")];

    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [{ sheet: "Columns", data }],
      }),
    ).rejects.toThrow(/columns/i);
  });

  it("rejects more than 500,000 aggregate XLSX cells", async () => {
    const row = Array.from({ length: 100 }, () => "x");
    const data = Array.from({ length: 5_001 }, () => row);

    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [{ sheet: "Cells", data }],
      }),
    ).rejects.toThrow(/cells/i);
  });

  it("rejects XLSX cells longer than 2,000 characters", async () => {
    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [
          { sheet: "Cell", data: [["x".repeat(2_001)]] },
        ],
      }),
    ).rejects.toThrow(/cell/i);
  });

  it("rejects workbook serialization larger than 4 MB", async () => {
    const row = Array.from({ length: 100 }, () => "x".repeat(20));
    const data = Array.from({ length: 2_500 }, () => row);

    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [{ sheet: "Serialized", data }],
      }),
    ).rejects.toThrow(/serialized/i);
  });

  it("measures serialized workbook limits in UTF-8 bytes", async () => {
    const row = Array.from({ length: 100 }, () => "😀".repeat(15));
    const data = Array.from({ length: 1_000 }, () => row);

    await expect(
      readAttendanceWorkbook(makeValidatedXlsxFile(), {
        readSheets: async () => [{ sheet: "Utf8", data }],
      }),
    ).rejects.toThrow(/serialized/i);
  });

  it("rejects files larger than the 10 MB ingestion limit", async () => {
    const file = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "oversized.csv",
    );

    await expect(readAttendanceWorkbook(file)).rejects.toThrow(/10 mb/i);
  });

  it("rejects unsupported workbook extensions at the ingestion boundary", async () => {
    await expect(
      readAttendanceWorkbook(new File(["Name"], "attendance.xls")),
    ).rejects.toThrow(/unsupported/i);
  });
});
