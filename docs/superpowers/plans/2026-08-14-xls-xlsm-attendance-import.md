# XLS and XLSM Attendance Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Gemini attendance workbook ingestion to accept safe `.xls` and `.xlsm` uploads in addition to `.xlsx` and `.csv`.

**Architecture:** Preserve the existing hardened OOXML path for `.xlsx` and `.xlsm`, expanding its content-type validation and removing macro payloads before parsing. Add the official pinned SheetJS Community Edition parser only for legacy `.xls`, validate its OLE signature, disable active-content extraction, and normalize every parsed sheet through the existing bounded workbook conversion.

**Tech Stack:** Next.js 16, TypeScript, Vitest, `read-excel-file` 9.0.9, SheetJS CE 0.20.3

## Global Constraints

- Accept only `.csv`, `.xls`, `.xlsx`, and `.xlsm`.
- Never execute, expose, retain, or forward VBA, formulas, hyperlinks, external references, or embedded active content.
- Preserve the existing 10 MB file, 20-sheet, 10,000-row, 100-column, 500,000-cell, 2,000-character-cell, and 4 MB serialized-workbook limits.
- Reject encrypted, malformed, extension-mismatched, or structurally unsafe workbooks before Gemini extraction.
- Do not introduce `any`.
- Do not accept a new high or critical production dependency advisory.

---

### Task 1: Supported-format contracts

**Files:**
- Modify: `apps/app/tests/attendance-import-client.test.ts`
- Modify: `apps/app/tests/attendance-import-route.test.ts`
- Modify: `apps/app/lib/attendance-import/client.ts`
- Modify: `apps/app/app/api/attendance/import/transform/route.ts`
- Modify: `apps/app/app/[organizationId]/attendance/_components/attendance-import-file-controls.tsx`

**Interfaces:**
- Consumes: `validateAttendanceImportFile(file)` and `POST(request)`.
- Produces: consistent `.csv|.xls|.xlsx|.xlsm` validation and uploader guidance.

- [ ] **Step 1: Write failing client and route tests**

Assert that the picker exposes `.xls,.xlsx,.xlsm,.csv`, the note names all four formats, client validation accepts lowercase `.xls` and `.xlsm`, and the route allows them to reach workbook parsing while continuing to reject unsupported extensions.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter app test -- attendance-import-client.test.ts attendance-import-route.test.ts`

Expected: failures show `.xls` and `.xlsm` are missing from the accepted extension contracts.

- [ ] **Step 3: Implement the minimal format-contract changes**

Update the picker, copy, client pattern/message, and route pattern/message without changing unrelated import behavior.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-client.test.ts attendance-import-route.test.ts`

Expected: all client and route tests pass.

### Task 2: Safe XLSM ingestion

**Files:**
- Modify: `apps/app/tests/helpers/zip-fixture.ts`
- Modify: `apps/app/tests/attendance-import-archive.test.ts`
- Modify: `apps/app/tests/attendance-import-workbook.test.ts`
- Modify: `apps/app/lib/attendance-import/archive.ts`
- Modify: `apps/app/lib/attendance-import/workbook.ts`

**Interfaces:**
- Consumes: `extractValidatedXlsxArchive(bytes)` and `readAttendanceWorkbook(file)`.
- Produces: OOXML ingestion that distinguishes `.xlsx` and `.xlsm`, removes macro payload entries, and returns all worksheet rows.

- [ ] **Step 1: Write failing XLSM tests**

Add a macro-enabled OOXML fixture containing `xl/vbaProject.bin`. Assert that a matching `.xlsm` file parses all sheets, the sanitized archive excludes the macro payload, a macro-enabled workbook mislabeled `.xlsx` is rejected, and an ordinary workbook mislabeled `.xlsm` is rejected.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter app test -- attendance-import-archive.test.ts attendance-import-workbook.test.ts`

Expected: failures show macro-enabled content types and `.xlsm` are unsupported and macro entries are retained.

- [ ] **Step 3: Implement minimal XLSM validation and sanitization**

Add an explicit OOXML workbook kind, validate its workbook content type against the extension, omit VBA-related entries from the stored sanitized archive, and keep `read-excel-file` as the value parser.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-archive.test.ts attendance-import-workbook.test.ts`

Expected: all archive and workbook tests pass.

### Task 3: Safe legacy XLS ingestion

**Files:**
- Modify: `apps/app/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/app/tests/attendance-import-workbook.test.ts`
- Modify: `apps/app/lib/attendance-import/workbook.ts`

**Interfaces:**
- Consumes: `readAttendanceWorkbook(file)` and SheetJS `read`, `utils.sheet_to_json`.
- Produces: bounded all-sheet BIFF `.xls` parsing into `WorkbookData`.

- [ ] **Step 1: Write failing XLS tests**

Use a real BIFF workbook fixture with two sheets. Assert all sheets and cached values are retained, invalid OLE signatures are rejected, encrypted input fails safely, formulas are not exposed as executable content, and existing workbook limits apply.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter app test -- attendance-import-workbook.test.ts`

Expected: failures show `.xls` is unsupported.

- [ ] **Step 3: Install the pinned official SheetJS release**

Run: `pnpm --filter app add xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`

- [ ] **Step 4: Implement minimal legacy parsing**

Validate the OLE Compound File signature, parse bytes with dense bounded options, keep `bookVBA`, formula extraction, raw book files, and external features disabled, convert each worksheet to row arrays, and pass the result through the existing `convertSheets` limits.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-workbook.test.ts`

Expected: all workbook tests pass.

### Task 4: Documentation and regression verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-gemini-attendance-import-design.md`

**Interfaces:**
- Produces: accurate operator and user documentation for all supported formats and inert macros.

- [ ] **Step 1: Update documentation**

Document `.xls`, `.xlsx`, `.xlsm`, `.csv`, macro suppression, encryption rejection, and the pinned parser source.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter app test -- attendance-import-client.test.ts attendance-import-archive.test.ts attendance-import-workbook.test.ts attendance-import-route.test.ts attendance-import-gemini.test.ts attendance-import-time.test.ts attendance-import-preview.test.ts`

Expected: all focused tests pass.

- [ ] **Step 3: Run static and dependency verification**

Run: `pnpm --filter app exec tsc --noEmit`

Run: `pnpm --filter app lint`

Run: `pnpm audit --prod`

Expected: every command exits successfully with no high or critical production dependency advisory.
