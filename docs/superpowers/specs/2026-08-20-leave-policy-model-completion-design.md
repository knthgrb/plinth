# Leave Policy Model Completion

**Date:** 2026-08-20
**Status:** Approved for implementation
**Extends:** `docs/superpowers/specs/2026-08-14-philippine-leave-management-design.md`

## Outcome

Complete Leave Engine V2 so each private organization uses exactly one company leave model: a shared annual pool or balances by leave type. Philippine statutory presets are synchronized automatically and act as protected compliance baselines. Annual, semiannual, monthly, and service-anniversary entitlements all create idempotent ledger grants, while maternity and similar protected benefits are filed against verified qualifying events.

## Company leave model

- Private organizations default to `pooled`; government organizations remain `by_type`.
- The selected model is authoritative for active company entitlement policies. Pooled organizations use `shared_pool` with the canonical `company_leave` pool. By-type organizations use `individual_account` balances.
- Company-policy creation and versioning reject account behavior that conflicts with the selected organization model.
- A model change is effective-dated at a future calendar-year boundary. Existing ledger rows and policy versions are never deleted or rewritten.
- Existing balances remain visible and spendable under their originating historical policy period. Only the new model receives entitlement postings after the transition date.
- Government organizations cannot switch away from by-type.
- Vacation and Sick Leave are not created automatically for pooled private organizations. By-type activation ensures active Vacation Leave and Sick Leave policies exist for the new effective period.

## Statutory policies

- Sector setup and migration activation run the same idempotent statutory preset synchronization.
- Missing presets are inserted by stable source key; existing policies and versions are never overwritten.
- Statutory policies cannot be created as arbitrary custom policies, archived, or reduced below their protected baseline.
- For migrated private organizations, a qualifying general company policy can cover the SIL minimum. The coverage link prevents the statutory SIL preset from creating an additive grant while retaining the statutory policy and legal-source history.
- Coverage requires an active credit policy whose effective rule grants at least five paid days, does not delay eligibility beyond twelve completed service months, and uses the statutory shared pool. Coverage is explicit and auditable.
- Event-based statutory policies remain non-credit and require qualification or verified event evidence rather than annual balances.

## Balance administration

- Active balance administration returns only canonical V2 projections with a policy period and engine status.
- Preserved legacy source rows remain in storage for migration audit but are excluded from active totals and adjustments.

## Scheduled grants

- A single materializer handles monthly, annual, semiannual, and anniversary entitlement methods.
- Annual grants post once when the configured eligibility date has been reached.
- Semiannual grants post in two bounded installments whose cumulative total never exceeds annual units.
- Anniversary grants post on the service anniversary. The yearly amount is one day per completed service year, capped by the policy's configured annual-unit maximum.
- Anniversary service may be based on hire or regularization date. Rehire uses lifecycle service windows and does not grant outside active employment.
- Every posting uses a stable employee, policy, policy-year, and installment idempotency key so a later policy version cannot duplicate an existing grant.
- Shared pools have one governing entitlement. A covered statutory SIL policy is a compliance floor and does not post an additional grant.

## Anniversary leave

- Leave Engine V2 stores organization-level anniversary settings: enabled, maximum days, and service-date basis (`hire_date` or `regularization_date`).
- Enabling the benefit creates or reactivates the system-managed Anniversary Leave policy effective on the requested date; disabling it ends only future entitlement and preserves prior ledger history and remaining balances.
- Under the pooled model, anniversary grants are separately identified ledger grants posted into the canonical company pool and are additive to the base pool entitlement.
- Under the by-type model, Anniversary Leave is an individual account and appears as its own employee balance.
- The maximum is the annual anniversary bonus cap, not a cap on the combined shared-pool balance.

## Event-based statutory filing

- Maternity, miscarriage, emergency termination of pregnancy, paternity, adoption, surgery, calamity, and other protected event policies do not consume company leave balances.
- The employee request workflow captures the qualifying event type and date, benefit variant, and supporting documents.
- Submission creates a pending benefit event and a draft request atomically. HR verifies or rejects the event; verification submits the linked request into the normal approval workflow, while rejection leaves an auditable rejected event and rejects the draft request.
- Existing verified events can be selected and reused only when the policy permits it and event limits have not been exhausted.
- Maternity variants drive the statutory duration ceiling: live birth 105 calendar days, live birth for a qualified solo parent 120, miscarriage or emergency termination 60, with an optional separately identified 30-day unpaid extension.
- Statutory rules remain effective-dated and source-cited. Payroll reconciliation retains the SSS-supported amount, employer salary differential, and unpaid extension separately.

## UI

- The settings cards become an accessible enforced-model selector with persisted effective date and transition explanation.
- Add Policy derives account behavior from the organization model and does not expose a conflicting per-policy choice.
- Add Policy supports Vacation Leave and Sick Leave quick starts plus custom policies.
- Anniversary leave exposes start basis, one-day-per-year behavior, and cap.
- The statutory section explains automatic synchronization and shows protected legal-source policies; it has no arbitrary Add button.
- Event-based statutory policies open a filing wizard that records or selects a qualifying event and uploads evidence before HR verification.

## Verification

- Regression tests prove legacy rows are hidden from active balances.
- Mutation tests prove default allocation persistence and authorization.
- Migration tests prove statutory synchronization is idempotent and SIL coverage is non-additive.
- Accrual tests prove annual, semiannual, anniversary, eligibility, cap, replay, and rehire behavior.
- UI view-model tests prove defaults and statutory descriptions.
- Model-transition tests prove incompatible policy creation is rejected, future versions use the selected model, and historical balances remain untouched.
- Event-filing tests prove pending event creation, HR verification/rejection, duration ceilings, organization isolation, and request linkage.
- Run focused leave tests, full app tests, TypeScript, schema inventory, and production build.
