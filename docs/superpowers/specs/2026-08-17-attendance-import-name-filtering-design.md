# Attendance Import Name Filtering Design

## Goal

Make attendance import review contain only actionable rows and use employee names as the required identity shared by the uploaded file and the application.

## Import Contract

- An imported attendance row must contain a full person name in its employee field: at least two letter-containing name parts and no digits.
- Blank, numeric, and ID-like values are treated as non-name identities and dropped before review.
- AI extraction must return the employee name exactly as written in the workbook. It must not substitute row numbers or employee IDs.
- Named rows are matched against normalized `First Last` and `Last, First` employee names in the application.
- A named row that does not match remains visible with `Employee not found` so spelling and roster problems can be reviewed.
- A matched row displays the application employee's canonical full name.

## Preview Filtering

A matched employee row on a scheduled rest day is omitted from review when both Time In and Time Out are empty. Rest-day rows containing at least one punch remain visible and excluded by default so users can intentionally include rest-day work.

## Template and Copy

The downloadable CSV template uses `Employee Name` as its first header. The parser also accepts the previous `Employee` header for backward compatibility, but both paths enforce a full-name value. The loading label is `Processing…` because matching templates bypass AI.

## Testing

- Gemini extraction drops blank, numeric, and ID-like employee identities and asks for workbook names.
- Template parsing accepts `Employee Name`, retains legacy `Employee`, and drops non-name identities.
- Preview mapping uses names only, displays canonical names, omits empty rest days, and keeps punched rest days.
- UI rendering uses the neutral processing label.
