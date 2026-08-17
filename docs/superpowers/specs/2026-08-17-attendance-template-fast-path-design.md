# Attendance Template Fast Path Design

## Goal

Make the documented attendance CSV template deterministic and independent of Gemini while improving AI extraction for non-template workbooks such as biometric punch reports.

## Required Behavior

- A CSV matching the documented header sequence `Employee,Date,Time In,Time Out,Status,Notes` is parsed directly after the existing authorization and safe workbook-ingestion checks. Gemini is not called.
- Header matching tolerates a UTF-8 byte-order mark, surrounding whitespace, and capitalization differences. Other layouts use the existing Gemini fallback.
- Direct template parsing preserves each physical CSV source row and returns normalized candidates through the existing preview workflow.
- Non-template CSV, XLS, XLSX, and XLSM files continue to use Gemini.
- In detailed punch reports without explicit Time In and Time Out fields, punch order is authoritative: the first punch is Time In and the last punch is Time Out.
- Concatenated 24-hour punches such as `09:1512:3813:59...23:12` must be recognized as separate punches.
- When the same employee and date appear in both raw punch logs and derived summary, statistics, or exception sheets, Gemini uses the detailed raw punch log.
- Employee/date groups without punches are omitted from AI extraction.
- A punched rest day remains in the review summary but is unchecked by default according to the matched employee's configured work schedule.

## Architecture

Add a focused server-side template parser beside the existing workbook, Gemini, time-normalization, and preview modules. The transform route first reads the upload with the existing bounded workbook parser. For CSV files, it asks the template parser whether the workbook matches the documented template. A match returns deterministic normalized candidates; a non-match returns a sentinel and invokes Gemini.

The template parser does not perform employee lookup, schedule evaluation, conflict checks, or persistence. Those responsibilities remain in the existing preview and import paths. This keeps template and Gemini candidates on the same downstream validation path.

## Template Detection and Parsing

Only a single-sheet CSV workbook named `CSV` is eligible for the fast path. The first retained row must contain exactly the six documented columns in the documented order after header normalization. A matched template stays on the deterministic path even when individual data rows contain invalid values; row errors must not trigger AI processing.

Each non-header row is mapped to the existing candidate contract:

- `Employee` becomes the employee key.
- `Date` must remain an ISO date candidate for deterministic validation.
- `Time In` and `Time Out` are explicit values.
- `Status` defaults to `present` when blank.
- `Notes` remains source text within existing workbook limits.
- Source sheet and physical row number are preserved.

The shared deterministic normalizer validates dates, times, statuses, and missing values. Template parsing returns invalid candidates for review instead of silently dropping malformed populated rows.

## Gemini Extraction Changes

The system instruction explicitly distinguishes detailed raw punch/log sheets from derived exception, summary, and statistical reports. When both represent the same employee/date, the detailed log is authoritative and the derived candidate is omitted.

For layouts without explicitly labeled Time In and Time Out, Gemini must preserve workbook punch order, split adjacent `HH:mm` tokens within a cell, and return every token as a separate punch. It returns no candidate for an employee/date group with zero punches. A single punch remains Time In only; two or more punches use the first and last values.

Server normalization preserves returned punch order instead of chronologically sorting it. This supports overnight records where the last clock-out may be earlier on the clock than the first clock-in.

## Rest-Day Review Behavior

The existing preview resolves employees before checking their configured schedule. If the attendance date is a configured non-workday, a valid punched candidate remains visible with `isRestDay: true` and `includeInImport: false`. Users may explicitly include it after review. No change is made to manual bulk attendance behavior or final attendance persistence.

## Error Handling

- Unsafe or malformed files continue to fail before template detection or Gemini.
- A matched template never falls through to Gemini because of row-level validation errors.
- A non-matching template uses existing Gemini error mapping.
- Empty AI punch groups do not create missing-time preview errors because they are omitted before normalization.
- Existing partial-success, employee matching, duplicate-conflict, overwrite, and import safeguards remain unchanged.

## Testing

- Unit-test exact and normalized template header detection.
- Unit-test valid and invalid template rows, source row preservation, and status defaults.
- Route-test that matching template CSV data bypasses Gemini.
- Route-test that non-template CSV and Excel data still use Gemini.
- Prompt-test raw-log precedence, concatenated punches, first/last ordering, and no-punch omission instructions.
- Normalizer-test source-order selection, including an overnight punch sequence.
- Regression-test that a punched configured rest day remains valid and unchecked.
- Run focused attendance-import tests, TypeScript validation, and lint.

## Clean-Code Constraints

- Do not introduce `any`.
- Keep template detection, AI interaction, deterministic normalization, preview scheduling, and persistence separate.
- Do not add new dependencies.
- Do not change unrelated attendance workflows.
