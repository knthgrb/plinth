import { normalizeGeminiAttendanceCandidate } from "@/lib/attendance-import/time";
import type { NormalizedAttendanceCandidate } from "@/lib/attendance-import/types";
import type {
  WorkbookCell,
  WorkbookData,
} from "@/lib/attendance-import/workbook";

const TEMPLATE_HEADERS = [
  "employee",
  "date",
  "time in",
  "time out",
  "status",
  "notes",
] as const;

export function parseAttendanceTemplateWorkbook(
  workbook: WorkbookData,
): NormalizedAttendanceCandidate[] | null {
  const sheet = workbook.sheets.length === 1 ? workbook.sheets[0] : undefined;
  const header = sheet?.name === "CSV" ? sheet.rows[0] : undefined;

  if (!sheet || !header || !matchesTemplateHeaders(header.cells)) {
    return null;
  }

  return sheet.rows.slice(1).map((row) =>
    normalizeGeminiAttendanceCandidate({
      sourceSheet: sheet.name,
      sourceRow: row.rowNumber,
      employeeKey: cellText(row.cells[0]),
      date: cellText(row.cells[1]),
      explicitTimeIn: cellText(row.cells[2]),
      explicitTimeOut: cellText(row.cells[3]),
      punches: [],
      status: cellText(row.cells[4]),
      notes: cellText(row.cells[5]),
      extractionIssues: [],
    }),
  );
}

function matchesTemplateHeaders(cells: readonly WorkbookCell[]): boolean {
  return (
    cells.length === TEMPLATE_HEADERS.length &&
    TEMPLATE_HEADERS.every(
      (expectedHeader, index) => normalizeHeader(cells[index]) === expectedHeader,
    )
  );
}

function normalizeHeader(value: WorkbookCell | undefined): string {
  return cellText(value).replace(/^\uFEFF/, "").toLowerCase();
}

function cellText(value: WorkbookCell | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}
