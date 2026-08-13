import { deflateRawSync } from "node:zlib";

export interface CentralDirectoryEntryFixture {
  name: string;
  flags?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  nameBytes?: Uint8Array;
  localHeaderOffset?: number;
  localNameBytes?: Uint8Array;
  compressionMethod?: 0 | 8;
  data?: string | Uint8Array;
}

export interface CentralDirectoryArchiveOptions {
  centralDirectoryOffset?: number;
  centralDirectorySize?: number;
  centralDirectorySignature?: number;
  diskNumber?: number;
  centralDirectoryDisk?: number;
  entriesOnDisk?: number;
  totalEntries?: number;
  unindexedLocalEntries?: CentralDirectoryEntryFixture[];
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CRC32_TABLE = createCrc32Table();

export function makeCentralDirectoryArchive(
  entries: CentralDirectoryEntryFixture[],
  options: CentralDirectoryArchiveOptions = {},
): Uint8Array {
  const encodedEntries = entries.map(encodeEntry);
  const unindexedLocalEntries = (options.unindexedLocalEntries ?? []).map(encodeEntry);
  const allLocalEntries = [...unindexedLocalEntries, ...encodedEntries];
  const localHeadersSize = allLocalEntries.reduce(
    (size, entry) => size + 30 + entry.localNameBytes.length + entry.compressedData.length,
    0,
  );
  const centralDirectorySize = encodedEntries.reduce(
    (size, entry) => size + 46 + entry.nameBytes.length,
    0,
  );
  const bytes = new Uint8Array(localHeadersSize + centralDirectorySize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  const indexedOffsets = new Map<(typeof encodedEntries)[number], number>();

  for (const entry of allLocalEntries) {
    const localHeaderOffset = offset;
    view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 6, entry.flags ?? 0, true);
    view.setUint16(offset + 8, entry.compressionMethod, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.declaredCompressedSize, true);
    view.setUint32(offset + 22, entry.declaredUncompressedSize, true);
    view.setUint16(offset + 26, entry.localNameBytes.length, true);
    bytes.set(entry.localNameBytes, offset + 30);
    bytes.set(entry.compressedData, offset + 30 + entry.localNameBytes.length);
    offset += 30 + entry.localNameBytes.length + entry.compressedData.length;

    if (!unindexedLocalEntries.includes(entry)) {
      indexedOffsets.set(entry, localHeaderOffset);
    }
  }

  const actualCentralDirectoryOffset = offset;

  for (const [entryIndex, entry] of encodedEntries.entries()) {
    view.setUint32(
      offset,
      options.centralDirectorySignature ?? CENTRAL_DIRECTORY_SIGNATURE,
      true,
    );
    view.setUint16(offset + 8, entry.flags ?? 0, true);
    view.setUint16(offset + 10, entry.compressionMethod, true);
    view.setUint32(offset + 16, entry.crc32, true);
    view.setUint32(offset + 20, entry.declaredCompressedSize, true);
    view.setUint32(offset + 24, entry.declaredUncompressedSize, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint32(
      offset + 42,
      entry.localHeaderOffset ?? indexedOffsets.get(entry) ?? entryIndex,
      true,
    );
    bytes.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  }

  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, options.diskNumber ?? 0, true);
  view.setUint16(offset + 6, options.centralDirectoryDisk ?? 0, true);
  view.setUint16(offset + 8, options.entriesOnDisk ?? entries.length, true);
  view.setUint16(offset + 10, options.totalEntries ?? entries.length, true);
  view.setUint32(
    offset + 12,
    options.centralDirectorySize ?? centralDirectorySize,
    true,
  );
  view.setUint32(
    offset + 16,
    options.centralDirectoryOffset ?? actualCentralDirectoryOffset,
    true,
  );

  return bytes;
}

export function makeTwoSheetXlsx(
  worksheetOverrides: Partial<Record<"Manila" | "Cebu", string>> = {},
): Uint8Array {
  const worksheets = {
    Manila:
      worksheetOverrides.Manila ??
      worksheetXml("A1:B2", [
        ["Name", "Date"],
        ["Ana", "2026-08-13"],
      ]),
    Cebu:
      worksheetOverrides.Cebu ??
      worksheetXml("A1:B2", [
        ["Name", "Date"],
        ["Ben", "2026-08-13"],
      ]),
  };

  return makeCentralDirectoryArchive([
    { name: "[Content_Types].xml", data: contentTypesXml() },
    { name: "_rels/.rels", data: packageRelationshipsXml() },
    { name: "xl/workbook.xml", data: workbookXml() },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelationshipsXml() },
    { name: "xl/worksheets/sheet1.xml", data: worksheets.Manila },
    { name: "xl/worksheets/sheet2.xml", data: worksheets.Cebu },
  ]);
}

export function makeWorksheetXml(dimension: string, rows: string[][]): string {
  return worksheetXml(dimension, rows);
}

interface EncodedEntry extends CentralDirectoryEntryFixture {
  nameBytes: Uint8Array;
  localNameBytes: Uint8Array;
  compressionMethod: 0 | 8;
  compressedData: Uint8Array;
  declaredCompressedSize: number;
  declaredUncompressedSize: number;
  crc32: number;
}

function encodeEntry(entry: CentralDirectoryEntryFixture): EncodedEntry {
  const data =
    typeof entry.data === "string"
      ? new TextEncoder().encode(entry.data)
      : (entry.data ?? new Uint8Array());
  const compressionMethod = entry.compressionMethod ?? 0;
  const compressedData =
    compressionMethod === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const nameBytes = entry.nameBytes ?? new TextEncoder().encode(entry.name);

  return {
    ...entry,
    nameBytes,
    localNameBytes: entry.localNameBytes ?? nameBytes,
    compressionMethod,
    compressedData,
    declaredCompressedSize: entry.compressedSize ?? compressedData.length,
    declaredUncompressedSize: entry.uncompressedSize ?? data.length,
    crc32: crc32(data),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }

    table[index] = value >>> 0;
  }

  return table;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Manila" sheetId="1" r:id="rId1"/>
    <sheet name="Cebu" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;
}

function packageRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;
}

function worksheetXml(dimension: string, rows: string[][]): string {
  const rowXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, columnIndex) => {
            const coordinate = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
            return `<c r="${coordinate}" t="inlineStr"><is><t>${cell}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}
