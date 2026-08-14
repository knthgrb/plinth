# Philippine Leave Management Redesign

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan
**Scope:** Leave policy configuration, employee requests, final review, balances, attendance, payroll, statutory leave, migration, and UI

## 1. Objective

Replace the current split leave calculations and mutable employee credit fields with a single, auditable leave-management model that supports:

- Philippine private-sector employers and Philippine government organizations.
- A pooled Annual SIL or company-leave balance.
- Independently tracked vacation, sick, emergency, and custom company leave.
- Statutory leave that does not incorrectly consume company credits.
- Organization-controlled proration, accrual, carryover, conversion, and document rules.
- A direct final decision by an Owner, Admin, or HR user.
- Correct schedule, holiday, attendance, payroll, rehire, separation, and migration behavior.

Existing organizations must retain their current settings, balances, and request history. New Philippine presets apply automatically only when a new organization configures leave.

## 2. Current-State Problems

The existing module already attempts pooled and by-type tracking, but it does not have one authoritative policy or balance model.

- General leave is represented by a magic custom leave key and deducts legacy vacation then sick balances.
- Entitlements are calculated dynamically while approvals mutate persisted employee credits, so the displayed entitlement and stored balance can disagree.
- General Annual SIL defaults to eight days instead of modeling the five-day statutory floor separately from a more generous company benefit.
- Eligibility is primarily tied to regularization, while private-sector statutory SIL is based on at least one year of service for covered employees.
- Accrual frequency affects tracker presentation but is not an authoritative, posted accrual process.
- Working days are hard-coded as Monday through Friday and ignore employee schedules, rest days, applicable holidays, and partial-day requests.
- A paid custom type with no tracked balance can be treated as having unlimited credit.
- Cancellation can change an approved request without restoring credits.
- Cash conversion reduces credits without creating a payable or payroll transaction.
- Payroll relies on a broad paid/unpaid flag and a combination of request and attendance state.
- Managers are currently accepted as HR reviewers even though the product has no direct-manager model.
- Reviewer names and signatures are manually entered rather than derived from authenticated identity and policy.
- Organization-wide reads and client-side filtering will not scale to large leave histories.
- Sensitive statutory leave details are not isolated from ordinary organization administration access.

## 3. Legal and Policy Baseline

The product will provide policy presets and guardrails, not legal determinations. Each preset records its source and effective date, and organizations remain responsible for confirming applicability.

### 3.1 Private-sector preset

- Service Incentive Leave is a five-day paid benefit after at least one year of service for covered employees and may be used for sick, vacation, or other leave purposes.
- A more generous existing company benefit can satisfy the SIL minimum when legally applicable.
- Unused SIL must not silently expire where conversion or separation commutation remains due.
- Maternity, paternity, solo-parent, VAWC, and special leave for women are separate statutory policies rather than company-credit deductions.
- An organization may record a coverage exemption only with an effective date, reason, and responsible actor.

### 3.2 Government preset

- Vacation and sick leave are separate accounts, with the standard preset accruing 1.25 days each per month.
- Government-specific categories include mandatory or forced leave, special privilege leave, study leave, rehabilitation privilege, special emergency leave, maternity, paternity, solo-parent leave, VAWC leave, special leave for women, adoption leave, and other Civil Service categories supported by current rules.
- The preset offers the current discretionary Wellness Leave policy as an optional, separate benefit rather than deducting it from vacation, sick, or special privilege leave.
- Agency-specific benefits may exceed the preset but cannot silently modify a protected baseline.

### 3.3 Primary references

- [DOLE 2024 Handbook on Workers' Statutory Monetary Benefits](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf)
- [Labor Code, Article 95](https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html)
- [Expanded Maternity Leave Law, RA 11210](https://lawphil.net/statutes/repacts/ra2019/ra_11210_2019.html)
- [Paternity Leave Act, RA 8187](https://lawphil.net/statutes/repacts/ra1996/ra_8187_1996.html)
- [Expanded Solo Parents Welfare Act, RA 11861](https://lawphil.net/statutes/repacts/ra2022/ra_11861_2022.html)
- [Anti-VAWC Act, RA 9262](https://lawphil.net/statutes/repacts/ra2004/ra_9262_2004.html)
- [Magna Carta of Women, RA 9710](https://lawphil.net/statutes/repacts/ra2009/ra_9710_2009.html)
- [Civil Service Form No. 6 and current leave categories](https://csc.gov.ph/downloads/category/298-mc-no-05-s-2021-amendment-to-omnibus-rules-on-leave-csc-mc-no-41-s-1998-as-amended)
- [CSC monthly vacation and sick leave accrual reference](https://csc.gov.ph/csc-grants-agencies-more-flexibility-in-updated-four-day-workweek-setup)
- [CSC 2026 Wellness Leave Policy](https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2026/MC%20No.%2001%20s.%202026%20-%20Wellness%20Leave%20Policy.pdf)

## 4. Core Design Decisions

### 4.1 One policy engine

Pooled and by-type organizations use the same primitives. A request selects a policy; the policy either charges a shared pool, charges its own account, or is non-credit statutory or unpaid leave.

### 4.2 Immutable ledger with materialized projections

Ledger entries are the audit source of truth. `employeeLeaveBalances` becomes a bounded, atomically updated projection for fast reads. Normal request paths do not aggregate an employee's entire ledger. A repair operation can rebuild and compare a projection from indexed ledger entries for a specific employee, account, and policy period.

### 4.3 Effective-dated immutable policy versions

The stable policy identity is separate from the rules in force for a period. A request links to the exact policy version used for its eligibility, charge, and pay decisions. Editing a policy creates a new version rather than rewriting history.

### 4.4 Explicit daily occurrences

Approval creates one leave occurrence for each affected scheduled workday. Occurrences snapshot the schedule, holiday decision, duration, charge, and pay treatment used at approval. Attendance, calendars, and payroll consume these indexed occurrences instead of independently reinterpreting a date range.

### 4.5 Direct final review

Owner, Admin, and HR are final reviewers. Managers are not leave approvers. A reviewer cannot approve their own linked employee request. There is no manager-first stage.

## 5. Data Model

Names below are implementation targets; the implementation plan may refine a name without changing the contract.

### 5.1 `organizationLeaveSettings`

Retain organization-level presentation and workflow settings, and add:

- `employmentSector`: `private` or `government`, optional only while an existing organization awaits owner confirmation during migration.
- `policyYearBasis`: initially `calendar_year`, designed to allow `hire_anniversary` later.
- `requestPrecision`: `day`, `half_day`, or `hour`.
- `approvalSignatureMode`: `none`, `stored_signature`, or `per_decision`.
- `migrationState` and `activePolicyEngineVersion`.

Existing fields remain readable until the organization completes migration.

### 5.2 `leavePolicies`

Stable organization-owned identity:

- Organization and stable source key.
- Display name and description.
- Category: `company`, `statutory`, or `unpaid`.
- Confidentiality: `standard` or `restricted`.
- Active/archived state.
- Optional compliance role, such as `private_sil_minimum`.

### 5.3 `leavePolicyVersions`

Immutable effective-dated rules:

- `leavePolicyId`, version number, effective start, and optional effective end.
- Account behavior: `shared_pool`, `individual_account`, or `non_credit`.
- Pool key when sharing a balance.
- Pay treatment: company paid, statutory paid, government paid, statutory-benefit-supported, or unpaid.
- Duration basis: scheduled work time, calendar days, or event-defined duration.
- Entitlement method: upfront, monthly, semiannual, anniversary, event-based, or none.
- Annual amount or accrual rate.
- Eligibility basis and completed-service requirement.
- Proration method: none, calendar months, actual days, or legacy 15th-day cutoff.
- Rounding increment.
- Carryover, cap, expiration, and conversion rules.
- Maximum consecutive duration and notice rules.
- Required-document rules.
- Source citation and source effective date for protected presets.
- Creator, creation time, and change reason.

Protected statutory fields can be superseded only by a newer preset or an explicitly more generous rule. Operational fields remain configurable.

### 5.4 `employeeLeaveBalances`

Extend the existing normalized table into the materialized balance projection for a policy period:

- Organization, employee, policy or shared-pool key, period start, and period end.
- Current projection totals for granted, used, reserved, converted, expired, and available amounts.
- Projection version and last ledger entry.
- Open, closed, or reconciliation-required status.

A balance projection does not store policy rules. It references the policy or shared pool it represents. Legacy year, type, total, used, balance, source, and reconciliation fields remain available during compatibility and are populated consistently for migrated rows.

### 5.5 `leaveLedgerEntries`

Append-only balance transactions:

- Organization, employee, balance projection, policy version, and effective date.
- Kind: opening grant, opening usage, grant, accrual, reservation, reservation release, usage, restoration, adjustment, carryover, expiration, conversion, or migration reconciliation.
- Signed amount and unit.
- Request, conversion, payroll, migration, or correction reference.
- Actor and required reason for privileged/manual entries.
- Idempotency key.
- Creation time and optional reversal reference.

Entries are never updated or deleted. Corrections are new reversing or adjusting entries.

### 5.6 `leaveRequests`

Evolve the request into an explicit workflow record:

- Policy and policy-version references.
- Requested start/end and requested duration mode.
- Server-calculated chargeable duration.
- Pay-treatment snapshot.
- Status: draft, pending, approved, rejected, cancellation requested, cancelled, or corrected.
- Submitter, reviewer, review time, decision reason, and authenticated reviewer display snapshot.
- Optional employee signature and policy-controlled reviewer signature.
- Migration and legacy type fields only while compatibility reads are active.

### 5.7 `leaveRequestOccurrences`

One row per affected employee work date:

- Request, organization, employee, and local Manila work date.
- Schedule and holiday snapshots.
- Scheduled minutes, leave minutes, and credit amount.
- Pay treatment and lifecycle state.
- Attendance conflict state and payroll lock/reference.

The table is indexed by employee/date and organization/date for payroll, calendars, and conflict checks.

### 5.8 `leaveRequestEvents`

Append-only request timeline for submission, review, rejection, cancellation request, cancellation, correction, document verification, and notifications.

### 5.9 `employeeLeaveQualifications`

Effective-dated eligibility evidence for policies such as solo-parent or other statutory qualification:

- Employee, qualification type, validity period, verification state, verifier, and document references.
- Sensitive metadata is stored separately and uses restricted authorization.

### 5.10 `leaveBenefitEvents`

Confidential, event-specific eligibility for maternity, miscarriage or emergency termination of pregnancy, spouse delivery, allocated maternity credits, surgery, adoption, calamity, or other protected events:

- Employee, event type, qualifying date, benefit variant, verified evidence, and verifier.
- Optional allocation relationship and number of allocated days where the governing rule permits it.
- Only the minimum derived eligibility result is exposed outside sensitive-leave authorization.

### 5.11 `leaveSensitiveAccessGrants`

Explicit organization membership grants for viewing restricted leave reasons and evidence. Owner status alone does not expose confidential details. Grant and revocation are audited, and payroll access never inherits this permission.

### 5.12 `leaveConversionRequests`

Tracks requested days, policy/account, decision, ledger transaction, daily rate snapshot, payable amount, payroll earning/final settlement reference, and payment status.

## 6. Policy and Balance Rules

### 6.1 Pooled company leave

Request reasons remain distinct for reporting, but all eligible policies charge a single pool. There is no vacation-first/sick-second implementation detail. The pool is one account with one balance.

### 6.2 By-type company leave

Each configured type owns an account unless explicitly mapped to a shared pool. Paid custom leave cannot be approved without a configured entitlement/account rule.

### 6.3 Statutory leave

Statutory leave has its own eligibility and duration. It does not consume a company pool by default. Event-based benefits can create entitlement upon verified application rather than maintaining a misleading annual balance. Policies distinguish calendar-day duration from chargeable scheduled work time so benefits such as continuous maternity leave are not incorrectly reduced to weekdays.

### 6.4 Pending reservations

Pending requests reserve availability so concurrent requests cannot overbook the same credit. Reservation entries are replaced atomically by usage on approval or released on rejection/withdrawal.

### 6.5 Accrual and proration

- Accrual jobs are idempotent and keyed by employee, policy version, and earning period.
- Proration uses the employee lifecycle timeline, including hire, separation, and rehire boundaries.
- Each policy chooses no proration, calendar-month proration, actual-day proration, or the migrated 15th-day cutoff rule.
- Rounding occurs once at the policy-defined boundary and never independently in the client.
- An organization-wide setting may provide defaults, but the policy version is authoritative.

### 6.6 Carryover, expiration, and conversion

- Year-end processing posts explicit ledger entries.
- Protected SIL is not silently expired when a monetary liability remains.
- Noncumulative statutory benefits use their own expiry rule.
- Conversion is not usage. It creates a conversion ledger entry and a linked payroll earning or final-settlement liability.
- A finalized payroll reference locks the conversion from destructive change.

## 7. Request Workflow

### 7.1 Employee submission

1. Load only policies available to the linked active employee.
2. Select policy, dates, and duration.
3. Calculate legal duration and chargeable scheduled work time on the server using the policy duration basis, employee schedule, applicable holiday configuration, and Manila-local dates.
4. Display available, reserved, requested, projected balance, pay treatment, and required evidence.
5. Validate eligibility, documents, overlap, duration, notice rule, and balance in the mutation.
6. Create the pending request, occurrences, reservation entries, event, and reviewer notifications atomically.

Employees do not choose paid versus unpaid independently of policy. If insufficient paid credit exists and policy permits an unpaid alternative, the UI offers a separate unpaid policy choice with an explicit preview.

### 7.2 Final review

- Owner, Admin, or HR can make the final decision.
- Managers cannot review.
- Self-approval is denied using membership-to-employee linkage, not email comparison.
- The reviewer sees policy eligibility, balance, reservation, work schedule, holidays, occurrences, documents, overlapping employee requests, and non-blocking staffing context.
- Approval revalidates all invariants, converts reservations to usage, activates occurrences, records the authenticated reviewer, appends an event, and notifies the employee.
- Rejection requires a reason, releases reservations, records an event, and notifies the employee.

### 7.3 Manual and emergency entry

Owner, Admin, or HR may enter approved historical or emergency leave for another employee. The mutation requires a reason and creates the same request, occurrence, ledger, audit, and payroll effects as a normal approval. A privileged user cannot use this path to self-approve.

### 7.4 Cancellation and correction

- The employee may immediately withdraw a pending request.
- The employee may request cancellation of approved future leave.
- Owner, Admin, or HR confirms an approved-request cancellation.
- A confirmed cancellation reverses usage, restores availability, deactivates future occurrences, and records events.
- HR cancellation requires a reason.
- Past or payroll-locked occurrences use an audited correction flow and payroll adjustment rather than destructive cancellation.

## 8. Attendance and Payroll Integration

Approved occurrences are authoritative for leave dates and duration.

- Attendance presents approved leave as an overlay rather than creating fake clock punches.
- Actual work on an approved occurrence creates a conflict for HR resolution.
- A future schedule or holiday change recalculates only unlocked future occurrences through an audited reconciliation job. Past or payroll-locked occurrences are not silently changed.
- Payroll loads occurrences by employee/date and uses the pay-treatment snapshot.
- Paid leave prevents absence deductions for the covered duration.
- Unpaid leave creates the correct duration-based deduction.
- Partial leave pays or deducts only the uncovered fraction.
- Statutory-benefit-supported pay can record employer advance, external benefit, salary differential, and final payroll treatment without pretending it is ordinary vacation pay.
- Finalized payroll locks consumed occurrences and linked conversion payments.

Legacy payroll request reads remain in compatibility mode only until an organization is reconciled and switched.

## 9. Authorization and Privacy

- Active employees can read and create only their own requests and balances.
- Owner, Admin, and HR can administer ordinary leave.
- Managers have employee self-service only until a real reporting-line model exists.
- Accounting/payroll receives only fields required to calculate pay, not confidential reasons or attachments.
- Restricted leave shows neutral calendar and administrative labels.
- VAWC details and documents are available only to the employee and members with an active `leaveSensitiveAccessGrant`.
- Every query and mutation authorizes by organization membership and linked employee ID.
- File access uses a leave-request-scoped endpoint that verifies both request access and attachment ownership.

## 10. User Experience

### 10.1 Employee workspace

- Summary cards for available company leave, statutory eligibility, pending reservations, and upcoming approved leave.
- Guided request drawer: type, duration, preview, evidence, confirmation.
- Server-calculated charge preview with workdays and holidays explained.
- History with status timeline, decision, cancellation state, and balance impact.
- Neutral presentation for restricted leave.

### 10.2 Administrative workspace

- Approval inbox is the default view.
- Queues for pending decisions, cancellations, evidence verification, and conflicts.
- Review drawer contains decision context and derives reviewer identity from authentication.
- Calendar view displays approved availability without leaking reasons.
- Paginated employee balance tracker with search and policy/year filters.
- Employee balance detail includes ledger explanation and adjustment action.
- Dedicated conversion and offboarding settlement queues.
- Column customization is retained only where it adds value; essential review fields cannot be hidden.

### 10.3 Settings

- Guided Private Sector or Government setup.
- Preset or preserve-existing path.
- Pooled company leave or by-type configuration.
- Statutory policies separated from company benefits.
- Effective-dated changes with an impact preview.
- Protected legal fields identified clearly.
- Destructive edits archive a policy for future use; they do not remove history or balances.

## 11. Migration and Compatibility

Migration is additive, idempotent, organization-scoped, and reversible before activation.

### 11.1 Policy mapping

- `general` maps to one shared company pool using the current Annual SIL, proration, accrual frequency, anniversary, eligibility, and conversion settings.
- `by_type` maps each configured current type to an individual policy and account rule.
- Existing anniversary leave becomes an effective-dated company policy or pool grant according to current behavior.
- Existing settings are never replaced by a new legal preset.
- Existing organizations are not guessed to be private or government. The sector remains unconfirmed until an Owner selects it; current custom policies and migrated balances continue to operate unchanged in the meantime.

### 11.2 Balance opening entries

For each employee, type/pool, and current period:

- Post opening grant and opening usage entries to reproduce the current total and used values.
- If `balance != total - used`, post an explicit migration reconciliation entry so the projected available balance exactly matches the existing balance.
- Mark the account `reconciliation_required` and include the discrepancy in the migration report.
- Do not silently normalize negative or inconsistent legacy values.

Pre-cutover approved requests remain historical provenance. They are linked to the migrated policy but do not create a second usage deduction. New ledger activity begins at the organization cutover timestamp.

### 11.3 Verification and activation

1. Create policies, versions, balance projections, and opening entries.
2. Compare every projected balance to its legacy source.
3. Compare request counts and historical status totals.
4. Produce an organization migration report.
5. Enable comparison reads without changing user-visible balances.
6. Activate the new engine only when required invariants pass or an authorized HR user accepts explicitly listed discrepancies.
7. Keep legacy rows read-only during the verification window.

## 12. Error Handling and Concurrency

- Request, reservation, approval, cancellation, projection update, and event writes occur in one Convex transaction where possible.
- Every generated transaction uses a stable idempotency key.
- Approval always reloads the request, policy version, eligibility, occurrences, account projection, and payroll lock.
- Duplicate decisions return the existing terminal state or a clear conflict.
- User errors explain the failed rule and current server value without exposing restricted information.
- Repair operations are bounded by organization/employee/account/period indexes and support resumable batches.

## 13. Testing Strategy

Implementation follows test-driven development.

### 13.1 Pure policy tests

- Private SIL eligibility and five-day floor.
- Government vacation/sick monthly accrual.
- Pooled versus individual charging.
- All proration methods and rounding increments.
- Hire, regularization, separation, and rehire periods.
- Carryover, expiration, statutory protection, and conversion.
- Full-day, half-day, and hourly duration.
- Calendar-day statutory duration versus scheduled-work credit charging.
- Manila timezone, overnight shifts, rest days, and holidays.

### 13.2 Transaction and authorization tests

- Reservation concurrency and insufficient-balance races.
- Final approval and rejection.
- Self-approval denial for Owner/Admin/HR linked employees.
- Manager denial.
- Cancellation restoration and payroll-lock correction.
- Manual entry audit requirements.
- Restricted leave and attachment authorization.
- Idempotent accrual, year-end, conversion, and migration operations.

### 13.3 Integration tests

- Approved leave to attendance overlay.
- Actual-work conflict behavior.
- Paid, unpaid, partial, statutory-supported, and government payroll treatment.
- Conversion to payroll or final settlement.
- Future schedule/holiday reconciliation.
- Employee separation and rehire.

### 13.4 Migration tests

- General and by-type organizations.
- Exact preservation of settings and balances.
- Inconsistent legacy totals.
- Repeated migration runs.
- Historical request association without double deduction.
- Comparison-read and activation gates.

### 13.5 UI tests

- Employee request preview and validation.
- Admin queue filtering and final decision.
- Responsive layouts and keyboard accessibility.
- Loading, empty, conflict, and error states.
- Sensitive-data redaction.

Touched leave and payroll-integration files must not retain explicit `any` types.

## 14. Rollout Sequence

1. Introduce pure policy, duration, and ledger-domain utilities with tests.
2. Add schemas, indexes, and internal projection helpers.
3. Add private and government presets.
4. Add migration planner, executor, comparison report, and activation gate.
5. Build the new request/reservation/review/cancellation mutations.
6. Add occurrence-based attendance and payroll integration behind the organization engine version.
7. Replace settings, employee, and administrative UI.
8. Run organization-scoped migration and comparison.
9. Activate reconciled organizations incrementally.
10. Retire legacy writes, then legacy reads after the verification window.

## 15. Success Criteria

- Existing organizations retain their exact current configuration and balances at cutover.
- Pooled and by-type policies use the same tested engine.
- No approved or cancelled request can leave the account projection inconsistent with its ledger.
- No user can approve their own request.
- Managers cannot perform final leave review.
- Workday duration respects employee schedules, holidays, and partial days.
- Payroll consumes explicit approved occurrences and pay treatment.
- Cash conversion creates a payable record.
- Sensitive statutory leave remains confidential.
- Migration is idempotent, reportable, and does not double-deduct historical requests.
- Large organizations use indexed, paginated, bounded reads.

## 16. Explicit Non-Goals

- A reporting-line or direct-manager hierarchy.
- Multi-stage approval routing.
- Automatic legal eligibility determinations from sensitive personal attributes alone.
- Replacing SSS, GSIS, Civil Service, or DOLE filing systems.
- Silently changing a migrated organization's existing policy to a preset.
