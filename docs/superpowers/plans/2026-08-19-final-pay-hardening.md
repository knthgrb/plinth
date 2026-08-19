# Final Pay Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete, calculation-safe, lifecycle-safe final-pay workflow for resigned and terminated employees.

**Architecture:** Keep final pay as a dedicated payroll run and centralize its employment-window, overlap, settlement-identity, and state-transition rules in typed helpers used by Convex mutations and UI entry points. Bind approvals to a calculation version and use behavioral tests at helper and Convex boundaries.

**Tech Stack:** TypeScript, Next.js 16, React 19, Convex, Vitest, convex-test.

**Spec:** `docs/superpowers/specs/2026-08-19-final-pay-hardening-design.md`

## Global Constraints

- Preserve existing attendance changes in the working tree.
- Do not introduce `any`; replace touched `any` types with concrete types where practical.
- Final pay stays separate from regular payroll but may share its cutoff/payday.
- New loan settlements require a manually verified payoff amount.
- All production behavior is implemented test-first.

---

### Task 1: Employment window and final-pay base reconciliation

**Files:**
- Modify: `apps/app/lib/payroll-calculations.ts`
- Create: `apps/app/utils/final-pay-payroll.ts`
- Test: `apps/app/tests/payroll-calculations.test.ts`
- Create: `apps/app/tests/final-pay-payroll-helpers.test.ts`

**Interfaces:**
- Produces: `resolveEmploymentPayrollWindow(employee, cutoffStart, cutoffEnd)` and `reconcileFinalPayBasicPay(computedBasicPay, overlappingPaidBasicPay)`.
- Consumed by: payroll base calculation and final-pay generation/regeneration.

- [ ] Write failing tests proving post-separation workdays are not absences, monthly basic/allowance use the shortened employment window, and overlapping paid basic cannot be paid twice.
- [ ] Run the focused tests and confirm failures are caused by the cutoff-end-only behavior and missing reconciliation helper.
- [ ] Implement an inclusive effective employment window and use its end throughout attendance filtering, leave filtering, absence iteration, and proration.
- [ ] Implement basic-pay overlap reconciliation with currency rounding and a zero floor.
- [ ] Run focused tests and the existing payroll calculation suite.

### Task 2: Separation identity, readiness, and immutable lifecycle

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Modify: `apps/app/utils/final-settlement.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Test: `apps/app/tests/final-settlement-helpers.test.ts`
- Create: `apps/app/tests/final-settlement-workflow.test.ts`

**Interfaces:**
- Produces: `buildSeparationKey`, `assertFinalSettlementEditable`, `assertFinalSettlementTransition`, strict `isFinalSettlementReadyForPayroll`, and settlement fields `separationEventId`, `separationKey`, `calculationVersion`, `reviewedCalculationVersion`.
- Consumed by: settlement mutations and payroll linking.

- [ ] Write failing helper and Convex tests for one settlement per separation, rehire/new separation support, released-settlement immutability, invalid backwards transitions, and reopened-clearance synchronization.
- [ ] Run the tests and confirm the existing employee-only lookup and permissive mutations fail them.
- [ ] Add backward-compatible schema fields and separation-key lookup.
- [ ] Enforce editable statuses and explicit state transitions in every settlement mutation.
- [ ] Reset employee clearance to `pending` when required items are reopened.
- [ ] Make readiness accept only an unlinked `ready_for_payroll` settlement with resolved clearance and loans.
- [ ] Run focused helper and Convex workflow tests.

### Task 3: Verified loan payoff workflow

**Files:**
- Modify: `apps/app/utils/final-settlement.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Modify: `apps/app/app/[organizationId]/payroll/_components/final-settlements-tab.tsx`
- Test: `apps/app/tests/final-settlement-helpers.test.ts`

**Interfaces:**
- Produces: unresolved loan rows with `payoffAmount: 0`, explicit verified/custom approval, and user-facing verified-balance copy.
- Consumed by: settlement readiness and payroll deduction generation.

- [ ] Write failing tests proving scheduled deductions are not copied as loan balances and zero/unconfirmed balances block readiness.
- [ ] Run the tests and confirm the existing default-copy behavior fails them.
- [ ] Change settlement preparation to require explicit verified amounts and validate approved non-waived payoff rows are positive.
- [ ] Update the UI labels, validation, disabled states, and error handling for verified balances.
- [ ] Run focused tests and TypeScript checks for the component.

### Task 4: Duplicate and overlap protection in payroll generation

**Files:**
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/utils/final-pay-payroll.ts`
- Test: `apps/app/tests/final-pay-payroll-helpers.test.ts`
- Modify: `apps/app/tests/final-pay-payroll.test.ts`

**Interfaces:**
- Consumes: strict settlement readiness and final-pay reconciliation helpers.
- Produces: employee-level live-settlement link guard, overlapping regular-payslip totals, and corrected 13th-month YTD inclusion.

- [ ] Write failing behavioral tests for duplicate linked settlement rejection, same-cutoff regular-pay overlap, archived-run reuse prevention, and same-period YTD inclusion.
- [ ] Run focused tests and confirm the existing status and cutoff-only checks fail them.
- [ ] Reject settlements already linked to an existing run or already released.
- [ ] Load finalized/paid overlapping regular payslips and subtract their basic pay from final basic pay.
- [ ] Include qualifying same-period regular basic pay and 13th-month payments in final accrual history without including the current run.
- [ ] Run focused payroll tests.

### Task 5: Cancellation, deletion, regeneration, and approval versioning

**Files:**
- Modify: `apps/app/convex/payroll.ts`
- Modify: `apps/app/convex/finalSettlements.ts`
- Test: `apps/app/tests/final-settlement-workflow.test.ts`

**Interfaces:**
- Produces: `unlinkFinalSettlementsForRun`, calculation-version invalidation, run-linked transition assertions, and regeneration eligibility filtering.

- [ ] Write failing Convex tests proving cancellation/deletion clears links, regeneration invalidates review, regenerated runs keep the Final Pay label, and wrong-status employees are rejected.
- [ ] Run the tests and confirm each existing lifecycle defect is reproduced.
- [ ] Unlink settlements before payslip deletion and restore `ready_for_payroll` without dangling IDs.
- [ ] Increment settlement calculation version on generation/regeneration and reset BIR/final-tax review metadata.
- [ ] Require current-version review before payment.
- [ ] Reapply run-type employee eligibility during regeneration and preserve Manila final-pay period formatting.
- [ ] Enforce legal payroll run status transitions server-side.
- [ ] Run focused workflow tests.

### Task 6: Generate-final-pay UI and typed action pipeline

**Files:**
- Modify: `apps/app/actions/payroll.ts`
- Modify: `apps/app/services/payroll-service.ts`
- Modify: `apps/app/app/[organizationId]/payroll/payroll-page-client.tsx`
- Modify: `apps/app/app/[organizationId]/payroll/_components/final-settlements-tab.tsx`
- Create: `apps/app/tests/final-pay-create-request.test.ts`

**Interfaces:**
- Produces: typed `runType?: "regular" | "final_pay"` request propagation and a settlement-scoped generation action.
- Consumes: existing payroll create action and payroll-run refresh/view callbacks.

- [ ] Write a failing behavior test for a final-settlement create request reaching the Convex boundary with `runType: "final_pay"` and the selected employee ID.
- [ ] Run the test and confirm the action/service pipeline drops or cannot express the run type.
- [ ] Add the typed run type through action and service layers.
- [ ] Add cutoff inputs and `Generate final pay` to ready settlements, defaulting cutoff end to the separation date and keeping controls locked for generated/released settlements.
- [ ] Refresh/open the created draft through existing page callbacks.
- [ ] Run the focused UI/request tests.

### Task 7: Replace source-presence checks with workflow coverage

**Files:**
- Modify: `apps/app/tests/final-pay-payroll.test.ts`
- Modify: `apps/app/tests/final-settlement-workspace.test.ts`
- Modify: `apps/app/tests/final-settlement-helpers.test.ts`
- Modify: `apps/app/tests/final-settlement-workflow.test.ts`

**Interfaces:**
- Consumes all final-pay public helper and mutation contracts.
- Produces regression coverage for all ten reviewed findings.

- [ ] Remove assertions that only search source text when a behavioral assertion now covers the contract.
- [ ] Add explicit cases for resigned and terminated employees, no-selected-settlement UI state, and current separation selection after rehire.
- [ ] Run all final-pay, settlement, attendance, and payroll suites.
- [ ] Run lint/typecheck and the app production build.
- [ ] Review the final diff against every design requirement and record verification evidence.
