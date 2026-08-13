# Combined Release 2C–2F Compatibility Design

## Objective

Deploy the four remaining Release 2 compatibility switches as one production
release without combining any Release 3 data clearing or schema contraction.
The deployment makes normalized target tables authoritative for live reads and
keeps legacy projections transactionally synchronized for rollback.

## Release boundary

The combined release includes:

- leave configuration, employee leave balances, requirements, deductions,
  incentives, schedule overrides, payment accounts, and custom fields;
- evaluation reviewers/events, applicant child records, custom values,
  organization UI settings, and settings events;
- memo children, chat membership/receipts/pins, document grants, and attachment
  links;
- payroll-run notes, accounting receipt links, and asset custody/maintenance
  events.

It does not clear a legacy value, remove a validator or index, stop a fallback,
or authorize Release 3. All legacy projections remain available for an
immediate application rollback.

## Architecture

Each domain receives a focused compatibility module with three responsibilities:

1. load the unique normalized child rows and reconstruct the existing public
   shape used by current callers;
2. use normalized child rows when present and fall back to legacy data only
   while no normalized child row exists; empty-set dual writes clear both
   projections and repeated audits enforce their parity;
3. replace the normalized child set in the same Convex mutation that updates
   the legacy parent projection.

Normalized rows are authoritative by presence. Intentionally empty child sets
are written empty to both projections because the current schema has no
per-parent projection marker. Duplicate natural keys, parent mismatches, and
tenant mismatches fail closed. Compatibility helpers never expose secrets or
migration-only metadata.

The four domain switches remain separately registered and separately auditable.
They are merely deployed together. Program readiness reports all four as
switched only after the implementation is present; the compatibility-window
blocker remains until one complete production payroll cycle and clean repeated
audits have been recorded.

## Domain behavior

### Leave and employee children

Organization leave settings and UI fields are overlaid from their normalized
rows. Employee readers reconstruct embedded requirements, deductions,
incentives, schedule overrides, payment accounts, custom fields, and leave
balances from normalized rows. Employee/settings/leave mutations update both
stores atomically. Payroll and attendance consume the effective employee and
effective leave settings rather than raw legacy fields.

### Workflow

Evaluation readers reconstruct reviewer and history arrays from normalized
rows. Applicant readers reconstruct stage history, notes, interviews,
scorecards, offer approval, and custom fields. Evaluation/recruitment mutations
replace or append both normalized and legacy representations in one
transaction. UI settings and settings events are normalized-first.

### Communications and documents

Memo reads reconstruct reactions, acknowledgements, explicit audience members,
and attachment links. Chat reads use normalized conversation membership,
message receipts, and pinned conversations. Document authorization uses
normalized grants. Attachment ownership reads use normalized storage links.
All corresponding mutations dual-write atomically.

### Assets, accounting, and payroll

Asset readers reconstruct current custody and maintenance history from event
tables. Asset changes append/replace normalized events together with current
legacy state. Accounting receipt arrays and payroll-run note arrays are
reconstructed from normalized child rows and dual-written on mutation.
Historical payroll snapshots and correction records remain untouched.

## Error and rollback policy

- Any duplicate normalized key or tenant mismatch throws before a mutation
  commits.
- A failed transaction changes neither representation.
- A compatibility status query fails closed when the latest write/audit for any
  domain is missing, incomplete, conflicted, or stale.
- Rollback redeploys the Release 2B application. No normalized rows are deleted
  and no manual reverse copy is performed.

## Verification

Behavior tests must prove normalized data wins over conflicting legacy data,
legacy-only rows still work, normalized-empty sets remain authoritative, every
write path updates both stores, duplicate/tenant conflicts fail closed, and
Release 3 remains blocked. Production verification repeats each domain audit,
runs a zero-change dry-run for every migration, smoke-tests representative
mutations, and starts the compatibility observation window.
