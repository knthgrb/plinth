import { describe, expect, it } from "vitest";

import {
  extractValidatedXlsxArchive,
  validateXlsxArchive,
} from "@/lib/attendance-import/archive";
import { makeCentralDirectoryArchive } from "./helpers/zip-fixture";

const REQUIRED_ENTRIES = [
  { name: "[Content_Types].xml", uncompressedSize: 200 },
  { name: "xl/workbook.xml", uncompressedSize: 200 },
];

describe("XLSX archive validation", () => {
  it("accepts a bounded single-disk OOXML central directory", () => {
    expect(() =>
      validateXlsxArchive(makeCentralDirectoryArchive(REQUIRED_ENTRIES)),
    ).not.toThrow();
  });

  it("rejects encrypted entries before decompression", () => {
    const bytes = makeCentralDirectoryArchive([
      { name: "[Content_Types].xml", flags: 1, uncompressedSize: 200 },
      { name: "xl/workbook.xml", uncompressedSize: 200 },
    ]);

    expect(() => validateXlsxArchive(bytes)).toThrow(/encrypted/i);
  });

  it.each([
    "../escape.xml",
    "xl/./workbook.xml",
    "/xl/workbook.xml",
    "C:/xl/workbook.xml",
    "xl\\workbook.xml",
    "xl/workbook.xml\0hidden",
  ])("rejects unsafe archive path %s", (name) => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive([
          { name: "[Content_Types].xml" },
          { name },
        ]),
      ),
    ).toThrow(/unsafe/i);
  });

  it("rejects invalid central-directory signatures", () => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive(REQUIRED_ENTRIES, {
          centralDirectorySignature: 0x04034b50,
        }),
      ),
    ).toThrow(/central directory/i);
  });

  it("rejects archives without an end-of-central-directory record", () => {
    expect(() => validateXlsxArchive(new Uint8Array(100))).toThrow(/end.*directory/i);
  });

  it.each([
    { totalEntries: 0xffff },
    { centralDirectorySize: 0xffffffff },
    { centralDirectoryOffset: 0xffffffff },
  ])("rejects ZIP64 sentinel metadata %#", (options) => {
    expect(() =>
      validateXlsxArchive(makeCentralDirectoryArchive(REQUIRED_ENTRIES, options)),
    ).toThrow(/zip64/i);
  });

  it.each([
    { diskNumber: 1 },
    { centralDirectoryDisk: 1 },
    { entriesOnDisk: 1 },
  ])("rejects multi-disk metadata %#", (options) => {
    expect(() =>
      validateXlsxArchive(makeCentralDirectoryArchive(REQUIRED_ENTRIES, options)),
    ).toThrow(/multi-disk/i);
  });

  it("rejects more than 1,000 declared archive entries", () => {
    const entries = Array.from({ length: 1_001 }, (_, index) => ({
      name: `xl/worksheets/sheet${index}.xml`,
    }));

    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive(entries, {
          entriesOnDisk: 1_001,
          totalEntries: 1_001,
        }),
      ),
    ).toThrow(/too many entries/i);
  });

  it("rejects more than 50 MB of cumulative declared output", () => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive([
          ...REQUIRED_ENTRIES,
          { name: "xl/worksheets/sheet1.xml", uncompressedSize: 50 * 1024 * 1024 },
        ]),
      ),
    ).toThrow(/uncompressed/i);
  });

  it.each([
    { centralDirectoryOffset: 50_000 },
    { centralDirectorySize: 50_000 },
  ])("rejects out-of-bounds central-directory metadata %#", (options) => {
    expect(() =>
      validateXlsxArchive(makeCentralDirectoryArchive(REQUIRED_ENTRIES, options)),
    ).toThrow(/bounds/i);
  });

  it.each([50_000, 0xffffffff])(
    "rejects an out-of-bounds local-header offset %s",
    (localHeaderOffset) => {
      expect(() =>
        validateXlsxArchive(
          makeCentralDirectoryArchive([
            { ...REQUIRED_ENTRIES[0], localHeaderOffset },
            REQUIRED_ENTRIES[1],
          ]),
        ),
      ).toThrow(/local header|local-record coverage|zip64/i);
    },
  );

  it("rejects a local entry name that disagrees with its central entry", () => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive([
          {
            ...REQUIRED_ENTRIES[0],
            localNameBytes: new TextEncoder().encode("different-name.xml"),
          },
          REQUIRED_ENTRIES[1],
        ]),
      ),
    ).toThrow(/local header/i);
  });

  it.each([
    [{ name: "xl/workbook.xml" }],
    [{ name: "[Content_Types].xml" }],
  ])("rejects archives missing an OOXML marker", (entries) => {
    expect(() =>
      validateXlsxArchive(makeCentralDirectoryArchive([entries])),
    ).toThrow(/required ooxml/i);
  });

  it("rejects malformed UTF-8 entry names when the UTF-8 flag is set", () => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive([
          ...REQUIRED_ENTRIES,
          {
            name: "ignored",
            flags: 1 << 11,
            nameBytes: new Uint8Array([0xc3, 0x28]),
          },
        ]),
      ),
    ).toThrow(/utf-8/i);
  });

  it("rejects an unindexed local entry that would bypass central-directory limits", () => {
    expect(() =>
      validateXlsxArchive(
        makeCentralDirectoryArchive(REQUIRED_ENTRIES, {
          unindexedLocalEntries: [
            { name: "xl/worksheets/hidden.xml", flags: 1, data: "secret" },
          ],
        }),
      ),
    ).toThrow(/local-record coverage/i);
  });

  it("rejects actual inflated output that exceeds its declared bound", async () => {
    const bytes = makeCentralDirectoryArchive([
      { name: "[Content_Types].xml", data: "x" },
      { name: "xl/workbook.xml", data: "x" },
      {
        name: "xl/worksheets/bomb.xml",
        compressionMethod: 8,
        data: "x".repeat(1024 * 1024),
        uncompressedSize: 1,
      },
    ]);

    await expect(extractValidatedXlsxArchive(bytes)).rejects.toThrow(
      /inflated.*declared/i,
    );
  });
});
