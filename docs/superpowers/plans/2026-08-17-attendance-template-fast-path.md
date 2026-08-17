# Attendance Template Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the documented attendance CSV template without Gemini and make non-template AI extraction use ordered raw punches while omitting empty punch groups.

**Architecture:** Add a deterministic template parser after safe workbook ingestion and before the Gemini call. Keep all candidates on the existing preview path, and strengthen Gemini instructions plus server normalization for concatenated, ordered punches.

**Tech Stack:** Next.js 16, TypeScript, Zod, Vitest, existing attendance workbook parser

## Global Constraints

- Exact template headers are `Employee,Date,Time In,Time Out,Status,Notes` in that order.
- Matching template CSV files never invoke Gemini, including when a row is invalid.
- Non-template CSV, XLS, XLSX, and XLSM files continue to use Gemini.
- AI punch groups use source order: first punch is Time In and last punch is Time Out.
- AI candidates without explicit times or punches are omitted.
- Punched rest days remain reviewable and unchecked by default.
- Do not introduce `any` or new dependencies.

---

### Task 1: Deterministic template parser

**Files:**
- Create: `apps/app/lib/attendance-import/template.ts`
- Create: `apps/app/tests/attendance-import-template.test.ts`

**Interfaces:**
- Consumes: `WorkbookData`, `WorkbookCell`, and `normalizeGeminiAttendanceCandidate(candidate)`.
- Produces: `parseAttendanceTemplateWorkbook(workbook): NormalizedAttendanceCandidate[] | null`.

- [ ] **Step 1: Write the failing template parser tests**

Cover exact headers, normalized BOM/whitespace/case headers, a non-template sentinel, source-row preservation, blank-status defaulting, and invalid matched rows staying deterministic:

```ts
expect(parseAttendanceTemplateWorkbook(templateWorkbook)).toEqual([
  expect.objectContaining({
    sourceSheet: "CSV",
    sourceRow: 2,
    employeeKey: "EMP-001",
    date: "2026-08-17",
    timeIn: "9:15 AM",
    timeOut: "11:12 PM",
    status: "present",
  }),
]);
expect(parseAttendanceTemplateWorkbook(nonTemplateWorkbook)).toBeNull();
expect(parseAttendanceTemplateWorkbook(invalidTemplateWorkbook)?.[0]?.issues)
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "invalid_date" }),
  ]));
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter app test -- attendance-import-template.test.ts`

Expected: FAIL because `@/lib/attendance-import/template` does not exist.

- [ ] **Step 3: Implement the minimal parser**

Implement exact normalized header detection and map every retained data row through the existing deterministic normalizer:

```ts
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
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-template.test.ts attendance-import-time.test.ts`

Expected: all tests pass.

### Task 2: Route template files around Gemini

**Files:**
- Modify: `apps/app/app/api/attendance/import/transform/route.ts`
- Modify: `apps/app/tests/attendance-import-route.test.ts`

**Interfaces:**
- Consumes: `parseAttendanceTemplateWorkbook(workbook)` from Task 1.
- Produces: a transform route that selects direct candidates for matching CSV files and Gemini candidates otherwise.

- [ ] **Step 1: Write failing route selection tests**

Mock the template parser and assert both branches:

```ts
parseAttendanceTemplateWorkbookMock.mockReturnValue(candidates);
const response = await POST(makeMultipartRequest());
expect(response.status).toBe(200);
expect(extractAttendanceWithGeminiMock).not.toHaveBeenCalled();

parseAttendanceTemplateWorkbookMock.mockReturnValue(null);
await POST(makeMultipartRequest());
expect(extractAttendanceWithGeminiMock).toHaveBeenCalledWith(workbook);
```

Also assert `.xls`, `.xlsx`, and `.xlsm` bypass template detection and use Gemini.

- [ ] **Step 2: Run the route test and verify RED**

Run: `pnpm --filter app test -- attendance-import-route.test.ts`

Expected: FAIL because the route always invokes Gemini.

- [ ] **Step 3: Implement minimal route selection**

After successful workbook ingestion:

```ts
const templateCandidates = fileValue.name.toLowerCase().endsWith(".csv")
  ? parseAttendanceTemplateWorkbook(workbook)
  : null;

if (templateCandidates !== null) {
  candidates = templateCandidates;
} else {
  candidates = await extractAttendanceWithGemini(workbook);
}
```

Preserve the existing error mapping and `no_attendance` response for both branches.

- [ ] **Step 4: Run the route tests and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-route.test.ts attendance-import-client.test.ts`

Expected: all tests pass.

### Task 3: Ordered and concatenated AI punches

**Files:**
- Modify: `apps/app/lib/attendance-import/time.ts`
- Modify: `apps/app/lib/attendance-import/gemini.ts`
- Modify: `apps/app/tests/attendance-import-time.test.ts`
- Modify: `apps/app/tests/attendance-import-gemini.test.ts`

**Interfaces:**
- Consumes: Gemini's structured `punches: string[]` response.
- Produces: ordered first/last normalization, safe adjacent-token expansion, and omission of empty AI groups.

- [ ] **Step 1: Write failing normalization tests**

Replace the chronological-sort expectation with source-order behavior and add concatenated and overnight cases:

```ts
expect(normalizeGeminiAttendanceCandidate({
  ...candidate,
  punches: ["09:1512:3813:5917:5518:4918:4923:12"],
})).toMatchObject({ timeIn: "9:15 AM", timeOut: "11:12 PM" });

expect(normalizeGeminiAttendanceCandidate({
  ...candidate,
  punches: ["10:00 PM", "2:00 AM"],
})).toMatchObject({ timeIn: "10:00 PM", timeOut: "2:00 AM" });
```

- [ ] **Step 2: Write failing Gemini behavior tests**

Assert the serialized instruction contains raw-log precedence, adjacent `HH:mm` splitting, first/last source order, and zero-punch omission. Return one valid and one empty raw candidate from the provider and expect only the valid candidate.

- [ ] **Step 3: Run the tests and verify RED**

Run: `pnpm --filter app test -- attendance-import-time.test.ts attendance-import-gemini.test.ts`

Expected: failures show chronological sorting, concatenated punch rejection, missing prompt rules, and retention of the empty candidate.

- [ ] **Step 4: Implement ordered punch parsing**

Parse each punch directly when possible. Otherwise accept only strings composed entirely of adjacent supported time tokens and harmless separators, flatten those tokens in source order, and keep invalid strings as `invalid_time` issues. Remove the `.sort(...)` call before selecting `punches[0]` and `punches.at(-1)`.

- [ ] **Step 5: Strengthen Gemini extraction deterministically**

Update the system instruction with the approved source-precedence and punch rules. Before normalization, remove only Gemini candidates for which `explicitTimeIn`, `explicitTimeOut`, and every punch are blank.

- [ ] **Step 6: Run the tests and verify GREEN**

Run: `pnpm --filter app test -- attendance-import-time.test.ts attendance-import-gemini.test.ts`

Expected: all tests pass.

### Task 4: Focused regression verification

**Files:**
- Verify: `apps/app/tests/attendance-import-preview.test.ts`

**Interfaces:**
- Consumes: normalized candidates produced by Tasks 1–3.
- Verifies: configured rest-day candidates remain visible, valid, and unchecked.

- [ ] **Step 1: Run all focused attendance-import tests**

Run: `pnpm --filter app test -- attendance-import-template.test.ts attendance-import-workbook.test.ts attendance-import-route.test.ts attendance-import-client.test.ts attendance-import-gemini.test.ts attendance-import-time.test.ts attendance-import-preview.test.ts`

Expected: all focused tests pass, including `excludes scheduled rest days by default without marking the row invalid`.

- [ ] **Step 2: Run static verification**

Run: `pnpm --filter app exec tsc --noEmit`

Run: `pnpm --filter app lint`

Expected: both commands exit successfully without new warnings or errors.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only scoped attendance-import implementation, tests, and planning documents are changed.
