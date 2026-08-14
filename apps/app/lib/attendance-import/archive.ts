import { createInflateRaw } from "node:zlib";

import { ATTENDANCE_IMPORT_LIMITS } from "@/lib/attendance-import/types";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_END_RECORD_SEARCH_BYTES = 65_557;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const LOCAL_FILE_HEADER_BYTES = 30;
const ZIP64_UINT16_SENTINEL = 0xffff;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const UTF8_FLAG = 1 << 11;
const ENCRYPTED_FLAG = 1;
const DATA_DESCRIPTOR_FLAG = 1 << 3;
const STORED_COMPRESSION = 0;
const DEFLATE_COMPRESSION = 8;
const CRC32_TABLE = createCrc32Table();
const REQUIRED_OOXML_ENTRIES = new Set([
  "[Content_Types].xml",
  "xl/workbook.xml",
]);

interface ArchiveEntryMetadata {
  name: string;
  nameBytes: Uint8Array;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
}

interface ArchiveMetadata {
  entries: ArchiveEntryMetadata[];
  centralDirectoryOffset: number;
}

export interface ExtractedXlsxArchive {
  entries: ReadonlyMap<string, Uint8Array>;
  sanitizedBytes: Uint8Array;
}

export function validateXlsxArchive(bytes: Uint8Array): void {
  parseArchiveMetadata(bytes);
}

export async function extractValidatedXlsxArchive(
  bytes: Uint8Array,
): Promise<ExtractedXlsxArchive> {
  const metadata = parseArchiveMetadata(bytes);
  const extractedEntries = new Map<string, Uint8Array>();
  const retainedEntries: ArchiveEntryMetadata[] = [];
  let totalInflatedBytes = 0;

  for (const entry of metadata.entries) {
    if (isActiveContentEntry(entry.name)) {
      continue;
    }

    const compressedBytes = bytes.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize,
    );
    const remainingBytes =
      ATTENDANCE_IMPORT_LIMITS.maxUncompressedBytes - totalInflatedBytes;
    const data = await extractEntry(compressedBytes, entry, remainingBytes);

    totalInflatedBytes += data.byteLength;
    extractedEntries.set(entry.name, data);
    retainedEntries.push(entry);
  }

  return {
    entries: extractedEntries,
    sanitizedBytes: createStoredArchive(retainedEntries, extractedEntries),
  };
}

function isActiveContentEntry(name: string): boolean {
  const normalizedName = name.toLowerCase();

  return (
    normalizedName === "xl/vbaproject.bin" ||
    normalizedName === "xl/vbaprojectsignature.bin" ||
    normalizedName.startsWith("xl/activex/") ||
    normalizedName.startsWith("xl/ctrlprops/") ||
    normalizedName.startsWith("xl/embeddings/")
  );
}

function parseArchiveMetadata(bytes: Uint8Array): ArchiveMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endRecordOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endRecordOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endRecordOffset + 6, true);
  const entriesOnDisk = view.getUint16(endRecordOffset + 8, true);
  const totalEntries = view.getUint16(endRecordOffset + 10, true);
  const centralDirectorySize = view.getUint32(endRecordOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endRecordOffset + 16, true);
  const commentLength = view.getUint16(endRecordOffset + 20, true);

  if (
    entriesOnDisk === ZIP64_UINT16_SENTINEL ||
    totalEntries === ZIP64_UINT16_SENTINEL ||
    centralDirectorySize === ZIP64_UINT32_SENTINEL ||
    centralDirectoryOffset === ZIP64_UINT32_SENTINEL
  ) {
    throw new Error("ZIP64 XLSX archives are not supported.");
  }

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries
  ) {
    throw new Error("Multi-disk XLSX archives are not supported.");
  }

  if (totalEntries > ATTENDANCE_IMPORT_LIMITS.maxArchiveEntries) {
    throw new Error("The XLSX archive contains too many entries.");
  }

  if (
    endRecordOffset + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength !==
    bytes.byteLength
  ) {
    throw new Error("The XLSX end-of-central-directory record is invalid.");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (
    centralDirectoryOffset > endRecordOffset ||
    centralDirectoryEnd > endRecordOffset ||
    centralDirectoryEnd < centralDirectoryOffset
  ) {
    throw new Error("The XLSX central directory is outside archive bounds.");
  }

  const entries: ArchiveEntryMetadata[] = [];
  const entryNames = new Set<string>();
  const presentRequiredEntries = new Set<string>();
  let totalUncompressedBytes = 0;
  let entryOffset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (entryOffset + CENTRAL_DIRECTORY_HEADER_BYTES > centralDirectoryEnd) {
      throw new Error("The XLSX central directory entry is outside archive bounds.");
    }

    if (view.getUint32(entryOffset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("The XLSX central directory signature is invalid.");
    }

    const flags = view.getUint16(entryOffset + 8, true);
    const compressionMethod = view.getUint16(entryOffset + 10, true);
    const crc32 = view.getUint32(entryOffset + 16, true);
    const compressedSize = view.getUint32(entryOffset + 20, true);
    const uncompressedSize = view.getUint32(entryOffset + 24, true);
    const nameLength = view.getUint16(entryOffset + 28, true);
    const extraLength = view.getUint16(entryOffset + 30, true);
    const entryCommentLength = view.getUint16(entryOffset + 32, true);
    const diskStart = view.getUint16(entryOffset + 34, true);
    const localHeaderOffset = view.getUint32(entryOffset + 42, true);

    if (
      compressedSize === ZIP64_UINT32_SENTINEL ||
      uncompressedSize === ZIP64_UINT32_SENTINEL ||
      localHeaderOffset === ZIP64_UINT32_SENTINEL ||
      diskStart === ZIP64_UINT16_SENTINEL
    ) {
      throw new Error("ZIP64 XLSX archives are not supported.");
    }

    if (diskStart !== 0) {
      throw new Error("Multi-disk XLSX archives are not supported.");
    }

    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new Error("Encrypted XLSX archive entries are not supported.");
    }

    if (
      compressionMethod !== STORED_COMPRESSION &&
      compressionMethod !== DEFLATE_COMPRESSION
    ) {
      throw new Error("The XLSX archive uses an unsupported compression method.");
    }

    const variableLength = nameLength + extraLength + entryCommentLength;
    const nextEntryOffset = entryOffset + CENTRAL_DIRECTORY_HEADER_BYTES + variableLength;

    if (nextEntryOffset > centralDirectoryEnd || nextEntryOffset < entryOffset) {
      throw new Error("The XLSX central directory entry is outside archive bounds.");
    }

    const nameBytes = bytes.subarray(
      entryOffset + CENTRAL_DIRECTORY_HEADER_BYTES,
      entryOffset + CENTRAL_DIRECTORY_HEADER_BYTES + nameLength,
    );
    const name = decodeEntryName(nameBytes, (flags & UTF8_FLAG) !== 0);

    if (isUnsafeEntryPath(name)) {
      throw new Error("The XLSX archive contains an unsafe entry path.");
    }

    if (entryNames.has(name)) {
      throw new Error("The XLSX archive contains duplicate entry names.");
    }

    entryNames.add(name);
    totalUncompressedBytes += uncompressedSize;

    if (totalUncompressedBytes > ATTENDANCE_IMPORT_LIMITS.maxUncompressedBytes) {
      throw new Error("The XLSX archive declares too many uncompressed bytes.");
    }

    if (REQUIRED_OOXML_ENTRIES.has(name)) {
      presentRequiredEntries.add(name);
    }

    entries.push({
      name,
      nameBytes: new Uint8Array(nameBytes),
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset: 0,
    });
    entryOffset = nextEntryOffset;
  }

  if (entryOffset !== centralDirectoryEnd) {
    throw new Error("The XLSX central directory size is invalid.");
  }

  if (presentRequiredEntries.size !== REQUIRED_OOXML_ENTRIES.size) {
    throw new Error("The XLSX archive is missing required OOXML entries.");
  }

  validateLocalRecordCoverage(bytes, view, entries, centralDirectoryOffset);
  return { entries, centralDirectoryOffset };
}

function validateLocalRecordCoverage(
  bytes: Uint8Array,
  view: DataView,
  entries: ArchiveEntryMetadata[],
  centralDirectoryOffset: number,
): void {
  const entriesByLocalOffset = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  let expectedOffset = 0;

  for (const entry of entriesByLocalOffset) {
    if (entry.localHeaderOffset !== expectedOffset) {
      throw new Error("The XLSX archive has incomplete local-record coverage.");
    }

    const offset = entry.localHeaderOffset;

    if (
      offset + LOCAL_FILE_HEADER_BYTES > centralDirectoryOffset ||
      view.getUint32(offset, true) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error("The XLSX local header is outside archive bounds or invalid.");
    }

    const localFlags = view.getUint16(offset + 6, true);
    const localCompressionMethod = view.getUint16(offset + 8, true);
    const localCrc32 = view.getUint32(offset + 14, true);
    const localCompressedSize = view.getUint32(offset + 18, true);
    const localUncompressedSize = view.getUint32(offset + 22, true);
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    const localNameOffset = offset + LOCAL_FILE_HEADER_BYTES;
    const dataOffset = localNameOffset + localNameLength + localExtraLength;
    const compressedDataEnd = dataOffset + entry.compressedSize;

    if (
      localFlags !== entry.flags ||
      localCompressionMethod !== entry.compressionMethod ||
      localNameLength !== entry.nameBytes.length ||
      dataOffset < offset ||
      compressedDataEnd < dataOffset ||
      compressedDataEnd > centralDirectoryOffset
    ) {
      throw new Error("The XLSX local header does not match its central entry.");
    }

    const usesDataDescriptor = (entry.flags & DATA_DESCRIPTOR_FLAG) !== 0;

    if (
      !usesDataDescriptor &&
      (localCrc32 !== entry.crc32 ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize)
    ) {
      throw new Error("The XLSX local header does not match its central entry.");
    }

    const localNameBytes = bytes.subarray(localNameOffset, localNameOffset + localNameLength);

    if (!localNameBytes.every((byte, index) => byte === entry.nameBytes[index])) {
      throw new Error("The XLSX local header does not match its central entry.");
    }

    expectedOffset = usesDataDescriptor
      ? validateDataDescriptor(view, compressedDataEnd, entry, centralDirectoryOffset)
      : compressedDataEnd;
    entry.dataOffset = dataOffset;
  }

  if (expectedOffset !== centralDirectoryOffset) {
    throw new Error("The XLSX archive has incomplete local-record coverage.");
  }
}

function validateDataDescriptor(
  view: DataView,
  offset: number,
  entry: ArchiveEntryMetadata,
  centralDirectoryOffset: number,
): number {
  let fieldOffset = offset;

  if (
    fieldOffset + 4 <= centralDirectoryOffset &&
    view.getUint32(fieldOffset, true) === DATA_DESCRIPTOR_SIGNATURE
  ) {
    fieldOffset += 4;
  }

  if (fieldOffset + 12 > centralDirectoryOffset) {
    throw new Error("The XLSX data descriptor is outside archive bounds.");
  }

  if (
    view.getUint32(fieldOffset, true) !== entry.crc32 ||
    view.getUint32(fieldOffset + 4, true) !== entry.compressedSize ||
    view.getUint32(fieldOffset + 8, true) !== entry.uncompressedSize
  ) {
    throw new Error("The XLSX data descriptor does not match its central entry.");
  }

  return fieldOffset + 12;
}

async function extractEntry(
  compressedBytes: Uint8Array,
  entry: ArchiveEntryMetadata,
  remainingBytes: number,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > remainingBytes) {
    throw new Error("The XLSX archive exceeds the actual inflated-byte limit.");
  }

  const data =
    entry.compressionMethod === STORED_COMPRESSION
      ? new Uint8Array(compressedBytes)
      : await inflateEntry(compressedBytes, entry.uncompressedSize, remainingBytes);

  if (data.byteLength !== entry.uncompressedSize) {
    throw new Error("The XLSX entry's inflated bytes do not match its declared size.");
  }

  if (calculateCrc32(data) !== entry.crc32) {
    throw new Error("The XLSX entry failed its CRC integrity check.");
  }

  return data;
}

async function inflateEntry(
  compressedBytes: Uint8Array,
  declaredSize: number,
  remainingBytes: number,
): Promise<Uint8Array> {
  const inflater = createInflateRaw();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  inflater.end(Buffer.from(compressedBytes));

  try {
    for await (const value of inflater as AsyncIterable<unknown>) {
      if (!(value instanceof Uint8Array)) {
        throw new Error("The XLSX inflater returned an unsupported chunk.");
      }

      totalBytes += value.byteLength;

      if (totalBytes > declaredSize) {
        throw new Error("The XLSX entry's inflated bytes exceed its declared size.");
      }

      if (totalBytes > remainingBytes) {
        throw new Error("The XLSX archive exceeds the actual inflated-byte limit.");
      }

      chunks.push(new Uint8Array(value));
    }
  } finally {
    inflater.destroy();
  }

  return concatenateBytes(chunks, totalBytes);
}

function createStoredArchive(
  metadataEntries: ArchiveEntryMetadata[],
  extractedEntries: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const entries = metadataEntries.map((metadata) => ({
    metadata,
    data: getExtractedEntry(extractedEntries, metadata.name),
    nameBytes: new TextEncoder().encode(metadata.name),
  }));
  const localBytes = entries.reduce(
    (total, entry) => total + LOCAL_FILE_HEADER_BYTES + entry.nameBytes.length + entry.data.length,
    0,
  );
  const centralBytes = entries.reduce(
    (total, entry) => total + CENTRAL_DIRECTORY_HEADER_BYTES + entry.nameBytes.length,
    0,
  );
  const bytes = new Uint8Array(localBytes + centralBytes + END_OF_CENTRAL_DIRECTORY_BYTES);
  const view = new DataView(bytes.buffer);
  const localOffsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, STORED_COMPRESSION, true);
    view.setUint32(offset + 14, entry.metadata.crc32, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    bytes.set(entry.nameBytes, offset + LOCAL_FILE_HEADER_BYTES);
    bytes.set(entry.data, offset + LOCAL_FILE_HEADER_BYTES + entry.nameBytes.length);
    offset += LOCAL_FILE_HEADER_BYTES + entry.nameBytes.length + entry.data.length;
  }

  const centralDirectoryOffset = offset;

  for (const [entryIndex, entry] of entries.entries()) {
    view.setUint32(offset, CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, STORED_COMPRESSION, true);
    view.setUint32(offset + 16, entry.metadata.crc32, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint32(offset + 42, localOffsets[entryIndex], true);
    bytes.set(entry.nameBytes, offset + CENTRAL_DIRECTORY_HEADER_BYTES);
    offset += CENTRAL_DIRECTORY_HEADER_BYTES + entry.nameBytes.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralDirectorySize, true);
  view.setUint32(offset + 16, centralDirectoryOffset, true);
  return bytes;
}

function getExtractedEntry(
  entries: ReadonlyMap<string, Uint8Array>,
  name: string,
): Uint8Array {
  const entry = entries.get(name);

  if (!entry) {
    throw new Error("The XLSX archive extraction is incomplete.");
  }

  return entry;
}

function concatenateBytes(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function calculateCrc32(bytes: Uint8Array): number {
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

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) {
    throw new Error("The XLSX end-of-central-directory record is missing.");
  }

  const finalOffset = view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES;
  const firstOffset = Math.max(0, view.byteLength - MAX_END_RECORD_SEARCH_BYTES);

  for (let offset = finalOffset; offset >= firstOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("The XLSX end-of-central-directory record is missing.");
}

function decodeEntryName(bytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("The XLSX archive contains an invalid UTF-8 entry name.");
    }
  }

  let name = "";

  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new Error("The XLSX archive contains a non-ASCII entry name.");
    }

    name += String.fromCharCode(byte);
  }

  return name;
}

function isUnsafeEntryPath(name: string): boolean {
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /^[A-Za-z]:/.test(name)
  ) {
    return true;
  }

  return name.split("/").some((segment) => segment === "." || segment === "..");
}
