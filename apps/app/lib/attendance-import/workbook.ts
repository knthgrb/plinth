import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import readXlsxFile from "read-excel-file/node";
import { read, utils, type WorkBook, type WorkSheet } from "xlsx";

import { extractValidatedXlsxArchive } from "@/lib/attendance-import/archive";
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
  rowNumbers?: number[];
}

type OoxmlWorkbookKind = "xlsx" | "xlsm";

export interface AttendanceWorkbookDependencies {
  readSheets?: (bytes: Uint8Array) => Promise<ParsedWorkbookSheet[]>;
  readLegacySheets?: (bytes: Uint8Array) => Promise<ParsedWorkbookSheet[]>;
}

const OLE_COMPOUND_FILE_SIGNATURE = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

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
    const parsedCsv = parseCsv(bytes);
    return convertSheets([{ sheet: "CSV", ...parsedCsv }]);
  }

  if (extension === "xlsx" || extension === "xlsm") {
    const archive = await extractValidatedXlsxArchive(bytes);
    preflightXlsxContents(archive.entries, extension);
    const parsedSheets = await (dependencies.readSheets ?? readSheetsWithLibrary)(
      archive.sanitizedBytes,
    );
    return convertSheets(parsedSheets);
  }

  if (extension === "xls") {
    validateLegacyXlsSignature(bytes);
    const parsedSheets = await (
      dependencies.readLegacySheets ?? readLegacySheetsWithLibrary
    )(bytes);
    return convertSheets(parsedSheets);
  }

  throw new Error("Unsupported attendance workbook format.");
}

async function readSheetsWithLibrary(bytes: Uint8Array): Promise<ParsedWorkbookSheet[]> {
  return readXlsxFile(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
}

async function readLegacySheetsWithLibrary(
  bytes: Uint8Array,
): Promise<ParsedWorkbookSheet[]> {
  const workbookInfo = readLegacyWorkbook(bytes, true);

  if (
    workbookInfo.SheetNames.length === 0 ||
    workbookInfo.SheetNames.length > ATTENDANCE_IMPORT_LIMITS.maxSheets
  ) {
    throw new Error("The workbook exceeds the 20 worksheets limit or has no worksheets.");
  }

  const workbook = readLegacyWorkbook(bytes, false);

  return workbook.SheetNames.map((sheet) => ({
    sheet,
    ...convertLegacyWorksheet(workbook.Sheets[sheet], sheet),
  }));
}

function readLegacyWorkbook(bytes: Uint8Array, sheetNamesOnly: boolean): WorkBook {
  return read(bytes, {
    type: "array",
    bookSheets: sheetNamesOnly,
    bookProps: false,
    bookVBA: false,
    bookFiles: false,
    bookDeps: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    cellDates: false,
    cellText: true,
    dense: true,
    nodim: true,
    sheetRows: ATTENDANCE_IMPORT_LIMITS.maxRows + 1,
    WTF: false,
    UTC: true,
  });
}

function convertLegacyWorksheet(
  worksheet: WorkSheet | undefined,
  sheetName: string,
): Pick<ParsedWorkbookSheet, "data" | "rowNumbers"> {
  if (!worksheet) {
    throw new Error(`The XLS workbook is missing worksheet ${sheetName}.`);
  }

  const range = worksheet["!fullref"] ?? worksheet["!ref"];
  let firstRowNumber = 1;

  if (range) {
    const decodedRange = utils.decode_range(range);
    firstRowNumber = decodedRange.s.r + 1;

    if (decodedRange.e.r + 1 > ATTENDANCE_IMPORT_LIMITS.maxRows) {
      throw new Error("The XLS worksheet row coordinate exceeds safe bounds.");
    }

    if (decodedRange.e.c + 1 > ATTENDANCE_IMPORT_LIMITS.maxColumns) {
      throw new Error("A workbook row exceeds the 100 columns limit.");
    }
  }

  const data = utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  });

  return {
    data,
    rowNumbers: data.map((_, index) => firstRowNumber + index),
  };
}

function validateLegacyXlsSignature(bytes: Uint8Array): void {
  if (
    bytes.byteLength < OLE_COMPOUND_FILE_SIGNATURE.byteLength ||
    OLE_COMPOUND_FILE_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error("The XLS file does not have a valid OLE Compound File signature.");
  }
}

interface ParsedCsv {
  data: string[][];
  rowNumbers: number[];
}

function parseCsv(bytes: Uint8Array): ParsedCsv {
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
    return { data: [], rowNumbers: [] };
  }

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let endedWithRowDelimiter = false;
  let cellCount = 0;
  let physicalRowNumber = 1;

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

    row.push(cell);
    cell = "";
    afterClosingQuote = false;
  };

  const finishRow = (): void => {
    const nonemptyCells = row.filter(isNonemptyCell).length;

    if (nonemptyCells > 0) {
      if (rows.length >= ATTENDANCE_IMPORT_LIMITS.maxRows) {
        throw new Error("The workbook exceeds the 10,000 nonempty rows limit.");
      }

      cellCount += nonemptyCells;

      if (cellCount > ATTENDANCE_IMPORT_LIMITS.maxCells) {
        throw new Error("The workbook exceeds the 500,000 nonempty cells limit.");
      }

      rows.push(row);
      rowNumbers.push(physicalRowNumber);
    }

    row = [];
    physicalRowNumber += 1;
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

  return { data: rows, rowNumbers };
}

function preflightXlsxContents(
  entries: ReadonlyMap<string, Uint8Array>,
  kind: OoxmlWorkbookKind,
): void {
  const contentTypes = parseXmlEntry(entries, "[Content_Types].xml");
  const packageRelationships = parseXmlEntry(entries, "_rels/.rels");
  const workbook = parseXmlEntry(entries, "xl/workbook.xml");
  const relationships = parseXmlEntry(entries, "xl/_rels/workbook.xml.rels");

  if (contentTypes.documentElement?.localName !== "Types") {
    throw new Error("The XLSX content-types document is invalid.");
  }

  const workbookOverrides = elementsByLocalName(contentTypes, "Override").filter(
    (element) => element.getAttribute("PartName") === "/xl/workbook.xml",
  );
  const expectedWorkbookContentType =
    kind === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
      : "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

  if (
    workbookOverrides.length !== 1 ||
    workbook.documentElement?.localName !== "workbook"
  ) {
    throw new Error("The XLSX workbook structure is invalid.");
  }

  if (
    workbookOverrides[0]?.getAttribute("ContentType") !==
    expectedWorkbookContentType
  ) {
    throw new Error("The Excel workbook content type does not match its extension.");
  }

  const officeDocumentRelationships = elementsByLocalName(
    packageRelationships,
    "Relationship",
  ).filter(
    (element) =>
      element.getAttribute("Type")?.endsWith("/officeDocument") &&
      element.getAttribute("Target") === "xl/workbook.xml",
  );

  if (officeDocumentRelationships.length !== 1) {
    throw new Error("The XLSX package does not reference its workbook.");
  }

  const sheets = elementsByLocalName(workbook, "sheet");

  if (sheets.length === 0 || sheets.length > ATTENDANCE_IMPORT_LIMITS.maxSheets) {
    throw new Error("The workbook exceeds the 20 worksheets limit or has no worksheets.");
  }

  const worksheetRelationships = elementsByLocalName(relationships, "Relationship").filter(
    (element) => element.getAttribute("Type")?.endsWith("/worksheet"),
  );

  if (worksheetRelationships.length !== sheets.length) {
    throw new Error("The XLSX worksheet relationships are invalid.");
  }

  const relationshipTargets = new Map<string, string>();

  for (const relationship of worksheetRelationships) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");

    if (!id || !target || relationshipTargets.has(id)) {
      throw new Error("The XLSX worksheet relationships are invalid.");
    }

    relationshipTargets.set(id, resolveWorksheetTarget(target));
  }

  const worksheetPaths = new Set<string>();

  for (const sheet of sheets) {
    const relationshipId = sheet.getAttribute("r:id");
    const path = relationshipId ? relationshipTargets.get(relationshipId) : undefined;

    if (!path || worksheetPaths.has(path) || !entries.has(path)) {
      throw new Error("The XLSX workbook references an invalid worksheet.");
    }

    worksheetPaths.add(path);
  }

  const declaredWorksheetPaths = new Set(
    elementsByLocalName(contentTypes, "Override")
      .filter((element) =>
        element.getAttribute("ContentType")?.includes("spreadsheetml.worksheet"),
      )
      .map((element) => element.getAttribute("PartName"))
      .filter((path): path is string => Boolean(path))
      .map((path) => (path.startsWith("/") ? path.slice(1) : path)),
  );

  if (
    declaredWorksheetPaths.size !== worksheetPaths.size ||
    [...worksheetPaths].some((path) => !declaredWorksheetPaths.has(path))
  ) {
    throw new Error("The XLSX content types do not match its worksheets.");
  }

  let physicalCellCount = 0;

  for (const path of worksheetPaths) {
    physicalCellCount = preflightWorksheet(
      parseXmlEntry(entries, path),
      physicalCellCount,
    );
  }
}

function parseXmlEntry(
  entries: ReadonlyMap<string, Uint8Array>,
  path: string,
): XmlDocument {
  const bytes = entries.get(path);

  if (!bytes) {
    throw new Error(`The XLSX archive is missing required OOXML entry ${path}.`);
  }

  let source: string;

  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`The XLSX OOXML entry ${path} is not valid UTF-8.`);
  }

  try {
    return new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") {
          throw new Error(message);
        }
      },
    }).parseFromString(source, "application/xml");
  } catch {
    throw new Error(`The XLSX OOXML entry ${path} is malformed.`);
  }
}

function elementsByLocalName(
  document: XmlDocument,
  localName: string,
): XmlElement[] {
  return Array.from(document.getElementsByTagNameNS("*", localName));
}

function resolveWorksheetTarget(target: string): string {
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const segments = path.split("/");

  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    !path.startsWith("xl/worksheets/")
  ) {
    throw new Error("The XLSX workbook contains an unsafe worksheet target.");
  }

  return path;
}

function preflightWorksheet(document: XmlDocument, priorCellCount: number): number {
  if (document.documentElement?.localName !== "worksheet") {
    throw new Error("The XLSX worksheet structure is invalid.");
  }

  const dimensions = elementsByLocalName(document, "dimension");

  if (dimensions.length > 1) {
    throw new Error("The XLSX worksheet dimension is invalid.");
  }

  if (dimensions[0]) {
    validateWorksheetRange(dimensions[0].getAttribute("ref"));
  }

  for (const row of elementsByLocalName(document, "row")) {
    const rowNumber = row.getAttribute("r");

    if (rowNumber && !isBoundedRowNumber(rowNumber)) {
      throw new Error("The XLSX worksheet row coordinate exceeds safe bounds.");
    }
  }

  const cells = elementsByLocalName(document, "c");
  const totalCellCount = priorCellCount + cells.length;

  if (totalCellCount > ATTENDANCE_IMPORT_LIMITS.maxCells) {
    throw new Error("The XLSX worksheet contains too many physical cells.");
  }

  for (const cell of cells) {
    validateWorksheetCoordinate(cell.getAttribute("r"));
  }

  return totalCellCount;
}

function validateWorksheetRange(reference: string | null): void {
  if (!reference) {
    throw new Error("The XLSX worksheet dimension is invalid.");
  }

  const coordinates = reference.split(":");

  if (coordinates.length > 2) {
    throw new Error("The XLSX worksheet dimension is invalid.");
  }

  const start = parseWorksheetCoordinate(coordinates[0]);
  const end = parseWorksheetCoordinate(coordinates[1] ?? coordinates[0]);

  if (start.row > end.row || start.column > end.column) {
    throw new Error("The XLSX worksheet dimension is invalid.");
  }
}

function validateWorksheetCoordinate(reference: string | null): void {
  if (!reference) {
    throw new Error("The XLSX worksheet cell coordinate is missing.");
  }

  parseWorksheetCoordinate(reference);
}

function parseWorksheetCoordinate(reference: string): {
  row: number;
  column: number;
} {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(reference);

  if (!match) {
    throw new Error("The XLSX worksheet coordinate is invalid.");
  }

  const row = Number(match[2]);
  let column = 0;

  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }

  if (
    row > ATTENDANCE_IMPORT_LIMITS.maxRows ||
    column > ATTENDANCE_IMPORT_LIMITS.maxColumns
  ) {
    throw new Error("The XLSX worksheet dimension exceeds safe bounds.");
  }

  return { row, column };
}

function isBoundedRowNumber(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number(value) <= ATTENDANCE_IMPORT_LIMITS.maxRows;
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

      const cells = sourceCells.map(normalizeCell);
      const nonemptyCells = cells.filter(isNonemptyCell).length;

      if (nonemptyCells === 0) {
        continue;
      }

      rowCount += 1;

      if (rowCount > ATTENDANCE_IMPORT_LIMITS.maxRows) {
        throw new Error("The workbook exceeds the 10,000 nonempty rows limit.");
      }

      cellCount += nonemptyCells;

      if (cellCount > ATTENDANCE_IMPORT_LIMITS.maxCells) {
        throw new Error("The workbook exceeds the 500,000 nonempty cells limit.");
      }

      rows.push({
        rowNumber: parsedSheet.rowNumbers?.[rowIndex] ?? rowIndex + 1,
        cells,
      });
    }

    sheets.push({ name: parsedSheet.sheet, rows });
  }

  const workbook: WorkbookData = { sheets, rowCount, cellCount };

  if (
    Buffer.byteLength(JSON.stringify(workbook), "utf8") >
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

    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
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

function isNonemptyCell(value: WorkbookCell): boolean {
  return value !== null && value !== "";
}
