# Leave Policy Configuration Implementation Plan

## Scope

- Make leave accrual policy configurable per organization.
- Treat with/without pay as request data that affects balances and payroll.
- Add manual approved leave entries to leave history.
- Add editable leave guidelines for employee reference.
- Add a resigned employee leave conversion view.

## Implementation

1. Add policy fields to settings/schema:
   - `leaveAccrualFrequency`
   - `paidLeaveRequiresRegularization`
   - `anniversaryLeaveMaxDays`
   - `leaveGuidelines`
2. Add shared calculation helpers for accrual, regularization eligibility, anniversary caps, and convertible remaining days.
3. Use the helpers in:
   - leave tracker UI
   - `getEmployeeLeaveCredits`
   - approval eligibility and approval deduction
   - payroll paid-leave checks
4. Add `isPaid` and `isManual` to `leaveRequests`.
5. Extend employee request dialog with a pay-mode selector and skip paid-credit blocking for unpaid leave.
6. Add an HR manual leave entry dialog on Leave history.
7. Add employee guidelines display on My Leaves.
8. Add Admin/HR resigned conversion tab.

## Verification

- Add focused Vitest tests for policy calculations and pay-label resolution.
- Run focused leave tests.
- Run TypeScript check.
