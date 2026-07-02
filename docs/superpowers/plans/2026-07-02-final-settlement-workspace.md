# Final Settlement Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Final Settlements workspace under Payroll and make final-pay payroll runs consume approved settlement deductions, clearance, loan payoff, and BIR/final-tax release state.

**Architecture:** Store settlement state in a new Convex table keyed by organization and employee. Keep reusable settlement math in a pure utility, expose Convex mutations for HR/accounting workflow updates, and have `final_pay` payroll runs pull approved settlement deduction lines before payslip generation.

**Tech Stack:** Convex schema/functions, Next.js client components, server actions/services, Vitest source and helper tests.

---

### Task 1: Settlement Helper Contract

**Files:**
- Create: `apps/app/utils/final-settlement.ts`
- Test: `apps/app/tests/final-settlement-helpers.test.ts`

- [ ] **Step 1: Write failing helper tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildFinalSettlementPayrollDeductions,
  computeFinalSettlementSummary,
  createDefaultFinalSettlementChecklist,
  isFinalSettlementReadyForPayroll,
} from "../utils/final-settlement";

describe("final settlement helpers", () => {
  it("requires every required clearance item to be completed or waived", () => {
    const checklist = createDefaultFinalSettlementChecklist(1);
    expect(isFinalSettlementReadyForPayroll({ status: "in_review", clearanceItems: checklist })).toBe(false);
    expect(isFinalSettlementReadyForPayroll({
      status: "ready_for_payroll",
      clearanceItems: checklist.map((item) => ({ ...item, status: "completed" })),
    })).toBe(true);
  });

  it("builds approved loan payoff and custom deduction payroll lines", () => {
    const lines = buildFinalSettlementPayrollDeductions({
      loanPayoffs: [{ id: "loan-1", name: "SSS Loan", payoffAmount: 1800, rule: "custom_amount", status: "approved" }],
      customDeductions: [{ id: "prop-1", name: "Unreturned asset", amount: 2500, type: "company_property" }],
    });
    expect(lines).toEqual([
      { name: "Loan Payoff - SSS Loan", amount: 1800, type: "loan" },
      { name: "Separation Deduction - Unreturned asset", amount: 2500, type: "separation" },
    ]);
  });

  it("summarizes loan payoff, custom deductions, and release readiness", () => {
    const summary = computeFinalSettlementSummary({
      status: "payroll_generated",
      clearanceItems: [
        { id: "hr", label: "HR Clearance", required: true, status: "completed" },
        { id: "it", label: "IT Assets", required: true, status: "pending" },
      ],
      loanPayoffs: [{ id: "loan", name: "Salary Loan", payoffAmount: 1000, rule: "deduct_full_balance", status: "approved" }],
      customDeductions: [{ id: "fee", name: "Training bond", amount: 1500, type: "other" }],
      bir2316: { status: "data_ready" },
      finalTaxRelease: { status: "reviewed" },
    });
    expect(summary.clearance.completedRequired).toBe(1);
    expect(summary.totalSettlementDeductions).toBe(2500);
    expect(summary.readyForRelease).toBe(true);
  });
});
```

- [ ] **Step 2: Run red test**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-helpers.test.ts`
Expected: fail because `../utils/final-settlement` does not exist.

- [ ] **Step 3: Implement helper**

Create focused exported helpers for checklist defaults, settlement readiness, payroll deduction line generation, and summary totals.

- [ ] **Step 4: Run green test**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-helpers.test.ts`
Expected: pass.

### Task 2: Schema, Convex API, And Payroll Integration

**Files:**
- Modify: `apps/app/convex/schema.ts`
- Create: `apps/app/convex/finalSettlements.ts`
- Modify: `apps/app/convex/payroll.ts`
- Test: `apps/app/tests/final-settlement-workspace.test.ts`
- Modify: `apps/app/tests/final-pay-payroll.test.ts`

- [ ] **Step 1: Write failing source tests**

Check that `finalSettlements` schema exists, Convex functions expose `getFinalSettlements`, `prepareFinalSettlement`, clearance/loan/custom deduction/BIR/final tax mutations, and payroll references settlement helpers when run type is `final_pay`.

- [ ] **Step 2: Run red test**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-workspace.test.ts apps/app/tests/final-pay-payroll.test.ts`
Expected: fail on missing final settlement table/API/integration markers.

- [ ] **Step 3: Implement schema/API/integration**

Add the `finalSettlements` table. Add create/read/update mutations with role checks. In `createPayrollRun` and `updatePayrollRun`, merge approved settlement deduction lines into final-pay manual deductions. When a final-pay run is created/regenerated/paid, patch linked settlement status and release fields.

- [ ] **Step 4: Run green test**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-workspace.test.ts apps/app/tests/final-pay-payroll.test.ts`
Expected: pass.

### Task 3: Payroll Workspace UI

**Files:**
- Create: `apps/app/app/[organizationId]/payroll/_components/final-settlements-tab.tsx`
- Modify: `apps/app/app/[organizationId]/payroll/payroll-page-client.tsx`
- Modify if needed: `apps/app/convex/_generated/api.d.ts`
- Test: `apps/app/tests/final-settlement-workspace.test.ts`

- [ ] **Step 1: Extend failing source test**

Assert that Payroll has a `final_settlements` tab, imports `FinalSettlementsTab`, and the tab references `api.finalSettlements`.

- [ ] **Step 2: Implement UI**

Add a compact settlement table and review dialog with checklist, loan payoff, custom deduction, BIR 2316, final tax, and ready-for-payroll controls. Keep the tab under Payroll.

- [ ] **Step 3: Run green test**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-workspace.test.ts`
Expected: pass.

### Task 4: Full Verification

**Files:**
- All files touched above.

- [ ] **Step 1: Focused tests**

Run: `pnpm --filter app test -- apps/app/tests/final-settlement-helpers.test.ts apps/app/tests/final-settlement-workspace.test.ts apps/app/tests/final-pay-payroll.test.ts`
Expected: all tests pass.

- [ ] **Step 2: Full tests**

Run: `pnpm --filter app test`
Expected: all tests pass.

- [ ] **Step 3: Build**

Run: `pnpm --filter app build`
Expected: build exits 0.
