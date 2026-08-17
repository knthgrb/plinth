# Conditional Attendance Correction Reason Design

## Problem

The bulk attendance dialog always renders a payroll correction reason. Most manual additions and file imports do not affect finalized payroll, so the field incorrectly suggests that ordinary attendance entry is a payroll correction.

## Decision

Use the existing exact employee/date preflight to return both attendance conflicts and payroll-lock information. The client will derive whether currently included rows touch a finalized payroll period.

- Hide the correction field until at least one included row is payroll-locked.
- Show the field only when the current organization member is an owner or admin and policy allows reason-based corrections.
- Show a blocking payroll-lock notice instead of the field when locked rows cannot be corrected by the current member or organization policy.
- Keep the server-side authorization in `bulkCreateAttendance` as the source of truth.
- Apply the same conditional behavior to both file imports and manual bulk entry because both use the same mutation and payroll-lock policy.

## Data Flow

The batch-review action accepts exact employee/date pairs, validates organization access, batches requests, and returns:

```ts
type AttendanceBatchReview = {
  conflicts: Doc<"attendance">[];
  lockedEntries: Array<{
    employeeId: Id<"employees">;
    date: number;
  }>;
  canCorrectWithReason: boolean;
};
```

The file preview reconciles `conflicts` exactly as it does today. A small client helper matches included rows against `lockedEntries` using normalized attendance dates. Manual bulk entry uses the same helper with selected, non-excluded dates.

## Error Handling

While review is pending, submission stays disabled. If review fails, the existing preview error area reports the failure. The mutation repeats all authorization checks so stale or manipulated client state cannot bypass payroll locking.

## Testing

- Convex tests prove the preflight identifies locked employee/date pairs and reports correction permission by role and policy.
- Client helper tests prove the field is hidden for ordinary rows, shown for included locked rows, and unaffected by excluded locked rows.
- Existing attendance hardening and import tests must remain green.
