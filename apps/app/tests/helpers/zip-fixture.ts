export interface CentralDirectoryEntryFixture {
  name: string;
  flags?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  nameBytes?: Uint8Array;
  localHeaderOffset?: number;
  localNameBytes?: Uint8Array;
}

export interface CentralDirectoryArchiveOptions {
  centralDirectoryOffset?: number;
  centralDirectorySize?: number;
  centralDirectorySignature?: number;
  diskNumber?: number;
  centralDirectoryDisk?: number;
  entriesOnDisk?: number;
  totalEntries?: number;
}

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export function makeCentralDirectoryArchive(
  entries: CentralDirectoryEntryFixture[],
  options: CentralDirectoryArchiveOptions = {},
): Uint8Array {
  const encodedEntries = entries.map((entry) => ({
    ...entry,
    nameBytes: entry.nameBytes ?? new TextEncoder().encode(entry.name),
    localNameBytes:
      entry.localNameBytes ?? entry.nameBytes ?? new TextEncoder().encode(entry.name),
  }));
  const localHeadersSize = encodedEntries.reduce(
    (size, entry) => size + 30 + entry.localNameBytes.length + (entry.compressedSize ?? 0),
    0,
  );
  const centralDirectorySize = encodedEntries.reduce(
    (size, entry) => size + 46 + entry.nameBytes.length,
    0,
  );
  const bytes = new Uint8Array(localHeadersSize + centralDirectorySize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  const localHeaderOffsets = encodedEntries.map((entry) => {
    const localHeaderOffset = offset;
    view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(offset + 6, entry.flags ?? 0, true);
    view.setUint32(offset + 18, entry.compressedSize ?? 0, true);
    view.setUint32(offset + 22, entry.uncompressedSize ?? 0, true);
    view.setUint16(offset + 26, entry.localNameBytes.length, true);
    bytes.set(entry.localNameBytes, offset + 30);
    offset += 30 + entry.localNameBytes.length + (entry.compressedSize ?? 0);
    return localHeaderOffset;
  });

  const actualCentralDirectoryOffset = offset;

  for (const [entryIndex, entry] of encodedEntries.entries()) {
    view.setUint32(
      offset,
      options.centralDirectorySignature ?? CENTRAL_DIRECTORY_SIGNATURE,
      true,
    );
    view.setUint16(offset + 8, entry.flags ?? 0, true);
    view.setUint32(offset + 20, entry.compressedSize ?? 0, true);
    view.setUint32(offset + 24, entry.uncompressedSize ?? 0, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint32(
      offset + 42,
      entry.localHeaderOffset ?? localHeaderOffsets[entryIndex],
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
