import readXlsxFile from "read-excel-file/node";

import { validateXlsxArchive } from "@/lib/attendance-import/archive";
import { ATTENDANCE_IMPORT_LIMITS } from "@/lib/attendance-import/types";

export type WorkbookCell = string | number | boolean | null;

export interface WorkbookRow {
  rowNumber: number;
  cells: WorkbookCell[];
}

export interface WorkbookSheet {
  name: string;
  rows: WorkbookRow[];
}

export interface WorkbookData {
  sheets: WorkbookSheet[];
  rowCount: number;
  cellCount: number;
}

interface ParsedWorkbookSheet {
  sheet: string;
  data: unknown[][];
}

export interface AttendanceWorkbookDependencies {
  readSheets?: (bytes: Uint8Array) => Promise<ParsedWorkbookSheet[]>;
}

export async function readAttendanceWorkbook(
  file: File,
  dependencies: AttendanceWorkbookDependencies = {},
): Promise<WorkbookData> {
  if (file.size > ATTENDANCE_IMPORT_LIMITS.maxFileBytes) {
    throw new Error("Attendance files must not exceed 10 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength > ATTENDANCE_IMPORT_LIMITS.maxFileBytes) {
    throw new Error("Attendance files must not exceed 10 MB.");
  }

  const extension = file.name.toLowerCase().split(".").at(-1);

  if (extension === "csv") {
    return convertSheets([{ sheet: file.name, data: parseCsv(bytes) }]);
  }

  if (extension === "xlsx") {
    validateXlsxArchive(bytes);
    const parsedSheets = await (dependencies.readSheets ?? readSheetsWithLibrary)(bytes);
    return convertSheets(parsedSheets);
  }

  throw new Error("Unsupported attendance workbook format.");
}

async function readSheetsWithLibrary(bytes: Uint8Array): Promise<ParsedWorkbookSheet[]> {
  return readXlsxFile(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
}

function parseCsv(bytes: Uint8Array): string[][] {
  if (bytes.includes(0)) {
    throw new Error("CSV files must not contain NUL bytes.");
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("CSV files must contain valid UTF-8 text.");
  }

  if (!text) {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let endedWithRowDelimiter = false;
  let cellCount = 0;

  const appendCharacter = (character: string): void => {
    cell += character;

    if (cell.length > ATTENDANCE_IMPORT_LIMITS.maxCellCharacters) {
      throw new Error("A workbook cell exceeds the 2,000 character limit.");
    }
  };

  const finishCell = (): void => {
    if (row.length >= ATTENDANCE_IMPORT_LIMITS.maxColumns) {
      throw new Error("A workbook row exceeds the 100 columns limit.");
    }

    cellCount += 1;

    if (cellCount > ATTENDANCE_IMPORT_LIMITS.maxCells) {
      throw new Error("The workbook exceeds the 500,000 cells limit.");
    }

    row.push(cell);
    cell = "";
    afterClosingQuote = false;
  };

  const finishRow = (): void => {
    if (rows.length >= ATTENDANCE_IMPORT_LIMITS.maxRows) {
      throw new Error("The workbook exceeds the 10,000 rows limit.");
    }

    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendCharacter('"');
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        appendCharacter(character);
      }

      endedWithRowDelimiter = false;
      continue;
    }

    if (afterClosingQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("The CSV contains an invalid quoted CSV field.");
    }

    if (character === '"') {
      if (cell.length !== 0) {
        throw new Error("The CSV contains an invalid quoted CSV field.");
      }

      inQuotes = true;
      endedWithRowDelimiter = false;
      continue;
    }

    if (character === ",") {
      finishCell();
      endedWithRowDelimiter = false;
      continue;
    }

    if (character === "\r" || character === "\n") {
      finishCell();
      finishRow();

      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      endedWithRowDelimiter = true;
      continue;
    }

    appendCharacter(character);
    endedWithRowDelimiter = false;
  }

  if (inQuotes) {
    throw new Error("The CSV contains an unterminated quoted CSV field.");
  }

  if (!endedWithRowDelimiter) {
    finishCell();
    finishRow();
  }

  return rows;
}

function convertSheets(parsedSheets: ParsedWorkbookSheet[]): WorkbookData {
  if (parsedSheets.length > ATTENDANCE_IMPORT_LIMITS.maxSheets) {
    throw new Error("The workbook exceeds the 20 worksheets limit.");
  }

  const sheets: WorkbookSheet[] = [];
  let rowCount = 0;
  let cellCount = 0;

  for (const parsedSheet of parsedSheets) {
    const rows: WorkbookRow[] = [];

    for (let rowIndex = 0; rowIndex < parsedSheet.data.length; rowIndex += 1) {
      const sourceCells = parsedSheet.data[rowIndex];

      if (sourceCells.length > ATTENDANCE_IMPORT_LIMITS.maxColumns) {
        throw new Error("A workbook row exceeds the 100 columns limit.");
      }

      rowCount += 1;

      if (rowCount > ATTENDANCE_IMPORT_LIMITS.maxRows) {
        throw new Error("The workbook exceeds the 10,000 rows limit.");
      }

      cellCount += sourceCells.length;

      if (cellCount > ATTENDANCE_IMPORT_LIMITS.maxCells) {
        throw new Error("The workbook exceeds the 500,000 cells limit.");
      }

      rows.push({
        rowNumber: rowIndex + 1,
        cells: sourceCells.map(normalizeCell),
      });
    }

    sheets.push({ name: parsedSheet.sheet, rows });
  }

  const workbook: WorkbookData = { sheets, rowCount, cellCount };

  if (
    JSON.stringify(workbook).length >
    ATTENDANCE_IMPORT_LIMITS.maxSerializedCharacters
  ) {
    throw new Error("The serialized workbook exceeds the 4 MB limit.");
  }

  return workbook;
}

function normalizeCell(value: unknown): WorkbookCell {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "string") {
    if (value.length > ATTENDANCE_IMPORT_LIMITS.maxCellCharacters) {
      throw new Error("A workbook cell exceeds the 2,000 character limit.");
    }

    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}
