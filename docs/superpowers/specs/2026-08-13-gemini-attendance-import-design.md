# Gemini Attendance Import Design

## Goal

Extend bulk attendance import so authorized users can upload `.xls`, `.xlsx`, `.xlsm`, and `.csv` files in varied layouts, have Gemini extract attendance records from every worksheet, review valid and invalid rows, and import only approved valid records through the existing attendance safeguards.

## Scope

The feature replaces the CSV-only interpretation path in the bulk attendance dialog. Manual bulk entry and the existing attendance mutation remain unchanged. The import continues to use the existing employee matching, schedule lookup, rest-day exclusion, duplicate detection, overwrite confirmation, and final review table.

Supported uploads are:

- Legacy Excel `.xls`
- Excel `.xlsx`
- Macro-enabled Excel `.xlsm`
- Comma-separated values `.csv`

Encrypted workbooks and all other formats are rejected. The uploader says: “Only Excel (.xls, .xlsx, .xlsm) and CSV (.csv) files are supported.” It also discloses: Macros embedded in `.xls` or `.xlsm` files are never executed, extracted, or forwarded to Gemini.

## Model and Configuration

Use the stable `gemini-3.5-flash-lite` model. It is Google's lightweight, free-tier-capable model intended for high-volume document parsing and structured extraction.

The server reads:

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3.5-flash-lite
```

`GEMINI_API_KEY` is required. `GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`. Neither variable may use the `NEXT_PUBLIC_` prefix or be included in a client bundle.

Free-tier Gemini requests may be used by Google for product improvement. The UI disclosure is required. Production deployments processing real employee data should use a paid Gemini tier, for which Google states submitted data is not used for product improvement.

## Architecture

The client sends the selected file and organization ID as multipart form data to an authenticated attendance-import API route. The route verifies attendance-write access, validates the upload, converts every worksheet into bounded plain row data, asks Gemini for a structured extraction, validates the response, deterministically resolves explicit times and punch fallbacks, and returns normalized candidate rows plus row-level issues.

The browser maps those candidates into the existing preview-row model. Employee resolution, schedules, rest days, existing-attendance conflicts, inclusion toggles, and the final Convex bulk mutation remain client-side as they are today.

The feature is divided into focused units:

- Upload validation verifies authorization, file metadata, file signatures, and resource limits.
- Workbook extraction reads all worksheets without evaluating active content.
- Gemini extraction defines the prompt and strict structured-response contract.
- Attendance normalization enforces time priority, punch fallback, date validation, and 12-hour output.
- Preview mapping connects normalized candidates to the existing attendance review workflow.

## Upload and Workbook Security

The route requires a signed-in user who belongs to the supplied organization and has one of the attendance-write roles: `owner`, `admin`, `hr`, or `manager`. Missing authentication returns `401`; insufficient organization permission returns `403`.

The route applies these upload controls before calling Gemini:

- Maximum request file size: 10 MB.
- Accepted extensions: `.xls`, `.xlsx`, `.xlsm`, and `.csv` only.
- Accepted MIME types must agree with the extension when the browser supplies a specific MIME type.
- `.xlsx` and `.xlsm` content must have a ZIP signature and a valid OOXML workbook structure matching the extension.
- `.xls` content must have a valid OLE Compound File signature and a readable BIFF workbook stream.
- ZIP central-directory metadata is inspected before decompression. Encrypted entries, ZIP64 archives, unsafe paths, more than 1,000 archive entries, or more than 50 MB total declared uncompressed content are rejected.
- CSV content containing NUL bytes or invalid UTF-8 is rejected.
- A workbook may contain at most 20 worksheets, 10,000 non-empty rows in total, 100 columns per row, 500,000 non-empty cells, and 2,000 characters per cell.
- Serialized workbook content sent to Gemini is capped at 4 MB.
- Gemini may return at most 10,000 candidates.

Keep the pinned `read-excel-file` parser for OOXML `.xlsx` and `.xlsm` workbooks so the existing ZIP and XML preflight remains authoritative. Accept the macro-enabled OOXML workbook content type, strip macro payload entries from the sanitized archive, and parse only worksheet cached values. Parse legacy BIFF `.xls` workbooks with the official pinned SheetJS Community Edition release from the SheetJS distribution CDN rather than the outdated npm-registry release. SheetJS is limited to `.xls`, uses bounded dense parsing, and leaves `bookVBA`, formula extraction, raw-file access, and external behavior disabled. Run the production dependency audit after installation. If installation introduces a high or critical production vulnerability, implementation stops and selects a different parser.

Workbook parsing never evaluates formulas, macros, hyperlinks, or external references. Formula cells contribute only a bounded cached display value when the parser exposes one safely; otherwise they are treated as empty. Uploaded bytes and extracted employee data are held only for the request lifetime and are not written to disk or application logs.

## Gemini Extraction Contract

Workbook content is delimited and labeled as untrusted data. The system instruction tells Gemini to ignore commands or instructions found inside spreadsheet cells and perform extraction only.

Gemini examines every worksheet and identifies attendance-like rows or row groups. It returns candidates with:

- source sheet name
- source row number or starting row number
- employee name or employee ID
- date
- explicit Time In, when present
- explicit Time Out, when present
- all punch times associated with the employee and date
- attendance status, when explicitly present
- notes or remarks, when present
- extraction issues, when the source is incomplete or ambiguous

The structured response is validated with Zod. Unknown properties are rejected. Candidate strings and arrays are bounded. A response that is not valid structured data is treated as a file-level transformation failure; no guessed rows are imported.

Gemini is instructed to:

1. Prefer explicitly labeled Time In and Time Out values over punch lists.
2. When explicit fields are absent, collect all punches belonging to the same employee and date, even when punches are arranged vertically or across rows.
3. Preserve incomplete attendance-looking rows with empty values and an issue rather than silently dropping them.
4. Extract notes when present without inventing notes.
5. Preserve an explicitly supplied attendance status without inventing one.
6. Return times using 12-hour format with `AM` or `PM`.
7. Avoid guessing an ambiguous employee or date.

These prompt rules improve extraction, but server normalization remains authoritative.

## Deterministic Attendance Normalization

For each candidate, the server applies the following precedence:

1. A valid explicit Time In becomes Time In.
2. A valid explicit Time Out becomes Time Out.
3. If Time In is absent and valid punches exist, the earliest chronological punch becomes Time In.
4. If Time Out is absent and two or more valid punches exist, the latest chronological punch becomes Time Out.
5. An explicit value is never replaced by a punch-derived value.

For a sequence such as `6:01 AM`, `7:02 AM`, `8:01 AM`, and `12:00 PM`, the result is `6:01 AM` Time In and `12:00 PM` Time Out when no explicit columns exist.

Times returned to the browser use `h:mm AM/PM`. The preview displays that format. Immediately before the existing attendance mutation, values are converted to the backend's canonical `HH:mm` representation so schedule calculations and stored records continue to work.

Dates are converted to the existing canonical Manila attendance day. A date that cannot be resolved without guessing remains an invalid row. Notes are trimmed and bounded. Duplicate extracted candidates for the same resolved employee and Manila day are merged only when their non-empty fields do not conflict; conflicting duplicates remain flagged for review.

## Partial Success and Preview Behavior

Every recognizable attendance candidate appears in the preview, including rows with missing or invalid fields. Row-level validation flags:

- missing or unmatched employee
- missing or invalid date
- missing Time In or Time Out for a present row
- invalid or ambiguous time
- conflicting duplicate candidates
- extraction issues reported by Gemini
- existing attendance conflicts

Valid rows remain selectable and importable even when other rows fail. Invalid rows are visibly highlighted, excluded from import, and cannot be toggled on. Rest-day rows remain excluded by default. Existing records still require an explicit overwrite choice. The import button is enabled only when at least one included valid row exists and all included conflicts are resolved.

The UI shows a processing state while the server parses and transforms the file. Selecting another file clears prior candidates and errors. Closing the dialog does not submit partial work.

## Error Handling

File-level failures produce a safe, actionable message and no preview rows:

- unsupported file type
- file too large or workbook limits exceeded
- corrupt, encrypted, or unsafe workbook
- invalid CSV encoding
- missing server-side Gemini configuration
- authentication or authorization failure
- Gemini rate limit, timeout, or temporary unavailability
- Gemini safety refusal
- malformed or schema-invalid Gemini response
- no attendance-like data found in any worksheet

Provider payloads, stack traces, prompts, workbook content, and API credentials are not returned to the browser. Server logs may include a request correlation ID, error category, HTTP/provider status, duration, file size, and counts, but no file name, cell content, employee data, prompt, or Gemini response body.

The Gemini call uses an abort timeout and does not retry validation errors. A single retry with bounded backoff is allowed only for a transient provider failure or rate limit when the provider supplies a short retry interval and the request remains inside the overall timeout.

## Testing

Unit tests cover:

- `.csv`, `.xls`, `.xlsx`, and `.xlsm` acceptance and all unsupported formats
- extension, MIME, signature, archive, encoding, and resource-limit validation
- all-sheet extraction with sheet names and source row numbers
- formula, macro, and active-content handling
- prompt-injection text remaining inert data
- strict Gemini response validation and output bounds
- explicit Time In/Time Out priority
- earliest/latest fallback from horizontal and vertical punches
- mixed explicit and punch-derived values
- 12-hour parsing, formatting, noon, and midnight
- Manila date normalization
- incomplete rows and partial success
- duplicate merge and conflict behavior
- safe error mapping for configuration, timeout, rate limit, refusal, and malformed output
- authentication, organization membership, and role authorization

Component-level tests cover the accepted-file note, Gemini privacy disclosure, processing state, valid and invalid row preview, disabled invalid-row toggles, existing conflict resolution, and importing only selected valid rows.

Regression verification runs the focused importer tests, the complete application test suite, lint, TypeScript/build validation, and `pnpm audit`. No new high or critical production dependency advisory is acceptable.

## Clean-Code Constraints

New code uses explicit interfaces and discriminated unions. It does not introduce `any`. Existing `any` types encountered in modified importer code are replaced with concrete employee, holiday, attendance, API-response, and error types. Parsing, model interaction, normalization, and UI mapping remain separate so each can be tested without network calls or React rendering.
