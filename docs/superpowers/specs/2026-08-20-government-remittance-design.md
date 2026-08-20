# Government Remittance Workflow Design

## Goal

Add an auditable accounting workflow that settles payroll-created government liabilities without conflating employee payroll payment with filing or remittance to BIR, SSS, PhilHealth, or Pag-IBIG.

## Core model

A remittance belongs to one organization and one agency, covers a defined period, and allocates an amount to one or more payroll-run liability balances for that agency. Payroll finalization creates the liability. Paying employees settles only Payroll Payable. Recording a government remittance payment posts a separate journal that debits the agency payable and credits Cash and Bank.

The lifecycle is:

```text
draft -> reviewed -> approved -> filed -> paid -> reversed
   |         |           |         |
   +---------+-----------+---------+-> cancelled

approved -> failed(filing) -> approved
filed    -> failed(payment) -> filed
```

Filing is non-financial. Payment is the only forward lifecycle action that posts a remittance journal. Reversal posts an equal and opposite journal and never deletes the original record or entry.

## Reconciliation and concurrency

The source liability for an agency is the signed balance of that agency's payable account in payroll-run journals:

- SSS: `2110`
- PhilHealth: `2120`
- Pag-IBIG: `2130`
- BIR Withholding Tax: `2140`

Draft and reviewed allocations are proposals. Approved, filed, and paid allocations reserve or consume balances. Approval and payment both revalidate allocations against the current signed payroll liability, paid amounts, and reservations from other remittances. This prevents two concurrent remittances from claiming the same liability.

Underpayments are represented by allocating less than the outstanding liability. Penalties and interest are separate expense lines. Overpayments create an agency-specific government remittance advance asset. A later same-agency remittance may apply available advances, reducing cash paid. Advance applications are reserved at approval, validated again at payment, and released when the applying remittance is reversed. A source overpayment cannot be reversed while a later paid remittance still consumes its advance.

## Authorization

Owner, admin, and accounting memberships may read remittances, prepare drafts, submit for review, record filing, record payment, record failures, and retry failures. Only owner and admin memberships may approve, cancel an approved remittance, or reverse a paid remittance. An actor and timestamp are stored for each material lifecycle step.

## Sensitive data and evidence

Filing references, payment references, bank labels, failure details, notes, and reversal reasons are encrypted with domain-separated field-encryption purposes. Amounts, agency, dates, status, and account codes remain queryable accounting data. Evidence files use the existing organization-scoped upload-intent and registered-storage-object model with a dedicated `government_remittance_evidence` purpose and links to the remittance.

## Accounting

The payment journal is:

```text
Debit   Agency payable                     allocated liability
Debit   Government penalties expense       penalty
Debit   Government interest expense        interest
Debit   Government remittance advances     new overpayment/advance
Credit  Government remittance advances     advance applied
Credit  Cash and Bank                       remaining cash payment
```

All amounts are finite, non-negative, currency-rounded values. Allocations and advance applications may not exceed current availability. The journal must balance and may not be empty. Stable source keys make payment and reversal idempotent.

Payment also advances the matching payroll-generated accounting cost projections to partial or paid for each allocated run. Reversal subtracts the same allocations. The journal remains the accounting source of truth; projection synchronization only keeps the existing Accounting UI consistent with that ledger state.

## Audit events

The workflow emits tamper-evident operational events for creation, update, review, return, approval, filing, payment, failure, retry, cancellation, evidence attachment, and reversal. Events identify organization, aggregate, actor, occurrence time, changed fields, summary, and encrypted payload.

## UI

Accounting receives a dedicated Government Remittances page linked from the Finance sidebar. It shows outstanding liabilities by agency, remittance status, period, allocated liability, additions, advances, cash amount, and due date. A create dialog loads payroll-run balances for an agency and period. Contextual actions expose only valid lifecycle transitions and require references or reasons where applicable. Filing and payment dialogs accept evidence files.

## Verification

Pure domain tests cover transitions, journal construction, rounding, penalties, interest, overpayments, and advance application. Convex integration tests cover tenant authorization, reconciliation, double-allocation rejection, filing without a journal, idempotent payment, advance reuse prevention, reversal ordering, encrypted sensitive fields, evidence ownership, and operational events. Repository typecheck, production build, schema-contract tests, and the full app test suite are final gates.
