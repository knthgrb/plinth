import { ATTENDANCE_IMPORT_LIMITS } from "@/lib/attendance-import/types";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_END_RECORD_SEARCH_BYTES = 65_557;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_BYTES = 30;
const ZIP64_UINT16_SENTINEL = 0xffff;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const UTF8_FLAG = 1 << 11;
const ENCRYPTED_FLAG = 1;
const REQUIRED_OOXML_ENTRIES = new Set([
  "[Content_Types].xml",
  "xl/workbook.xml",
]);

export function validateXlsxArchive(bytes: Uint8Array): void {
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

    validateLocalEntry({
      bytes,
      view,
      centralDirectoryOffset,
      localHeaderOffset,
      nameBytes,
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
    });

    totalUncompressedBytes += uncompressedSize;

    if (totalUncompressedBytes > ATTENDANCE_IMPORT_LIMITS.maxUncompressedBytes) {
      throw new Error("The XLSX archive declares too many uncompressed bytes.");
    }

    if (REQUIRED_OOXML_ENTRIES.has(name)) {
      presentRequiredEntries.add(name);
    }

    entryOffset = nextEntryOffset;
  }

  if (entryOffset !== centralDirectoryEnd) {
    throw new Error("The XLSX central directory size is invalid.");
  }

  if (presentRequiredEntries.size !== REQUIRED_OOXML_ENTRIES.size) {
    throw new Error("The XLSX archive is missing required OOXML entries.");
  }
}

interface LocalEntryValidation {
  bytes: Uint8Array;
  view: DataView;
  centralDirectoryOffset: number;
  localHeaderOffset: number;
  nameBytes: Uint8Array;
  flags: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}

function validateLocalEntry({
  bytes,
  view,
  centralDirectoryOffset,
  localHeaderOffset,
  nameBytes,
  flags,
  compressionMethod,
  compressedSize,
  uncompressedSize,
}: LocalEntryValidation): void {
  if (
    localHeaderOffset + LOCAL_FILE_HEADER_BYTES > centralDirectoryOffset ||
    localHeaderOffset + LOCAL_FILE_HEADER_BYTES < localHeaderOffset ||
    view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error("The XLSX local header is outside archive bounds or invalid.");
  }

  const localFlags = view.getUint16(localHeaderOffset + 6, true);
  const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
  const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
  const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true);
  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const localNameOffset = localHeaderOffset + LOCAL_FILE_HEADER_BYTES;
  const localDataOffset = localNameOffset + localNameLength + localExtraLength;
  const localDataEnd = localDataOffset + compressedSize;

  if (
    localFlags !== flags ||
    localCompressionMethod !== compressionMethod ||
    localCompressedSize !== compressedSize ||
    localUncompressedSize !== uncompressedSize ||
    localNameLength !== nameBytes.length ||
    localDataOffset < localHeaderOffset ||
    localDataEnd < localDataOffset ||
    localDataEnd > centralDirectoryOffset
  ) {
    throw new Error("The XLSX local header does not match its central entry.");
  }

  const localNameBytes = bytes.subarray(localNameOffset, localNameOffset + localNameLength);

  if (!localNameBytes.every((byte, index) => byte === nameBytes[index])) {
    throw new Error("The XLSX local header does not match its central entry.");
  }
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
