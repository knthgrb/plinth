# Final Pay Hardening Design

## Goal

Make final pay usable from the product UI and prevent incorrect, duplicate, stale, or unaudited settlement payments for resigned and terminated employees.

## Workflow

Final pay remains a dedicated `final_pay` payroll run. It may use the same scheduled cutoff and payday as a regular run, but it retains separate employee eligibility and approval gates.

1. An employee is separated through a resignation or termination lifecycle event.
2. Attendance may be backfilled through the last working or separation date.
3. HR prepares a settlement for the current separation event.
4. Required clearance and loan payoff decisions are resolved.
5. HR marks the settlement ready and generates a draft final-pay run directly from the settlement workspace.
6. The draft calculates unpaid earnings only through the employment end date and excludes earnings already paid by an overlapping regular run.
7. Accounting reviews BIR 2316 data and final tax for the current draft calculation version.
8. The run is finalized, paid, and the settlement is released.

## Data Integrity

- A settlement belongs to one separation lifecycle event, identified by `separationEventId` when available and by a stable separation key for legacy data.
- Only one non-void settlement may represent the same employee separation.
- Only `ready_for_payroll` settlements without a live payroll link may generate final pay.
- Editable settlement fields are locked after payroll generation. Cancelling or deleting a draft unlinks the settlement and restores it to `ready_for_payroll`.
- Payroll regeneration invalidates BIR/final-tax review by incrementing `calculationVersion` and resetting review metadata.
- Finalization and payment verify that the settlement link belongs to the run being transitioned.

## Calculation Rules

- The employment window is the intersection of the cutoff, hire date, and last working/separation date.
- Attendance, leave, absence iteration, monthly salary proration, and allowance proration use that effective window.
- A final-pay run checks overlapping finalized or paid regular payslips for the employee. Already-paid basic pay is excluded from final basic pay, and the same payslip is included in year-to-date 13th-month inputs so it is not paid twice or omitted from accrual.
- If the overlap already covers all computed basic pay, final basic pay is zero while other settlement additions and deductions remain available.

## Loan Payoff

The recurring deduction amount is not treated as an outstanding loan balance. Each active loan starts as unresolved with no verified payoff amount. A user must enter the verified outstanding balance and approve it, choose a custom amount and approve it, or waive it before the settlement can be marked ready.

## UI

- A ready settlement shows a `Generate final pay` action.
- Generation asks for cutoff start and cutoff end, defaults the end to the separation date, creates a `final_pay` draft for that employee, refreshes payroll runs, and opens the generated run for review when supported by the existing page callback.
- Generated/released settlements show their linked run and do not expose mutating controls that violate the state machine.
- Draft regeneration preserves the `Final Pay` label and revalidates separated-employee eligibility.

## Compatibility

- Existing settlement rows without `separationEventId`, `separationKey`, or `calculationVersion` remain readable.
- Legacy loan payoff rows remain valid, but new settlement preparation no longer assumes the scheduled deduction is the balance.
- Existing final-pay rows are treated as linked when their referenced payroll run still exists.

## Verification

Behavioral tests cover employment-window calculation, overlap reconciliation, settlement readiness and transitions, cancellation/deletion cleanup, regeneration invalidation, duplicate prevention, rehire separation identity, action/service propagation, and the generate-final-pay UI flow. Source-text-only tests are replaced or supplemented with real helper and Convex behavior tests.
