"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, RotateCcw, X } from "lucide-react";
import type { GovernmentDeductionSettings, TaxSettings } from "./payroll-step-3-government-deductions";
import {
  getExpectedDefaultGovLineNames,
  getRestorableDefaultGovLineNames,
  filterRestorableGovLineNamesForWithholdingReality,
} from "./payroll-wizard-gov-helpers";

interface Deduction {
  name: string;
  amount: number;
  type: string;
}

interface IncentiveLine {
  name: string;
  amount: number;
  type: string;
  taxable: boolean;
}

interface EmployeeDeduction {
  employeeId: string;
  deductions: Deduction[];
}

interface EmployeeIncentive {
  employeeId: string;
  incentives: IncentiveLine[];
}

interface PayrollStep4DeductionsIncentivesProps {
  employees: any[];
  selectedEmployees: string[];
  employeeDeductions: EmployeeDeduction[];
  employeeIncentives: EmployeeIncentive[];
  onAddDeduction: (employeeId: string) => void;
  onRemoveDeduction: (employeeId: string, index: number) => void;
  onUpdateDeduction: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number,
  ) => void;
  onAddIncentive: (employeeId: string) => void;
  onRemoveIncentive: (employeeId: string, index: number) => void;
  onUpdateIncentive: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type" | "taxable",
    value: string | number | boolean,
  ) => void;
  /** Re-runs preview using Step 3 + org tax rules; keeps only custom (loan/advance) lines from here. */
  onSyncWithStep3?: () => void | Promise<void>;
  isSyncingWithStep3?: boolean;
  /** When set with taxSettings + cutoff, enables “Restore” for default gov lines still enabled in Step 3. */
  governmentDeductionSettings?: GovernmentDeductionSettings[];
  deductionsEnabled?: boolean;
  taxSettings?: TaxSettings;
  /** Cutoff start in ms (local), same as Step 3, for org tax-deduction schedule. */
  cutoffStartMs?: number;
  onRestoreDefaultGovLine?: (
    employeeId: string,
    name: import("./payroll-wizard-gov-helpers").DefaultGovDeductionLineName,
  ) => void | Promise<void>;
  /** e.g. `${employeeId}:SSS` while a restore is in progress */
  restoringDefaultKey?: string | null;
  /**
   * Latest server preview rows (e.g. `previewData` / `editPreviewData`). Used so
   * “Restore Withholding Tax” only appears if the server actually put WHT on that
   * preview (taxable pay); not for sub-threshold employees when Step 3 has tax on.
   */
  payrollPreviewRows?: any[] | null;
}

export function PayrollStep4DeductionsIncentives({
  employees,
  selectedEmployees,
  employeeDeductions,
  employeeIncentives,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onAddIncentive,
  onRemoveIncentive,
  onUpdateIncentive,
  onSyncWithStep3,
  isSyncingWithStep3 = false,
  governmentDeductionSettings,
  deductionsEnabled = true,
  taxSettings = {
    taxDeductionFrequency: "twice_per_month",
    taxDeductOnPay: "first",
  },
  cutoffStartMs,
  onRestoreDefaultGovLine,
  restoringDefaultKey = null,
  payrollPreviewRows,
}: PayrollStep4DeductionsIncentivesProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-6">
        {/* Deductions Section */}
        <div className="space-y-4">
          {onSyncWithStep3 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onSyncWithStep3()}
                disabled={isSyncingWithStep3}
              >
                {isSyncingWithStep3 ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Recalculating…
                  </>
                ) : (
                  "Recalculate from Step 3 (preview)"
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                This re-runs the full preview from Step 3 (keeps your custom
                loan/advance rows). If you only removed a default SSS, tax, etc.
                line below, use Restore on that employee instead.
              </p>
            </div>
          )}
          <Label>Enter Other Deductions (Loans, etc.)</Label>
          <p className="text-sm text-gray-500">
            Step 3 controls which SSS, PhilHealth, Pag-IBIG, and Withholding
            Tax lines are available; opening Step 4 after Step 3 matches that.
            You can remove or edit lines here for one-off overrides. If you
            removed a default that is still turned on in Step 3, use
            &quot;Restore&quot; next to that person. To turn a default off, go
            back to Step 3.
          </p>
          <div className="space-y-6 max-h-96 overflow-y-auto">
            {selectedEmployees.map((employeeId: string) => {
              const employee = employees?.find(
                (e: any) => e._id === employeeId,
              );
              const empDeductions = employeeDeductions.find(
                (ed) => ed.employeeId === employeeId,
              ) || { employeeId, deductions: [] };
              const expectedDefaultGov =
                governmentDeductionSettings != null
                  ? getExpectedDefaultGovLineNames(
                      governmentDeductionSettings,
                      employeeId,
                      deductionsEnabled,
                      taxSettings,
                      cutoffStartMs,
                    )
                  : [];
              const restorableRaw =
                onRestoreDefaultGovLine && expectedDefaultGov.length > 0
                  ? getRestorableDefaultGovLineNames(
                      expectedDefaultGov,
                      empDeductions.deductions,
                    )
                  : [];
              const previewRow = Array.isArray(payrollPreviewRows)
                ? payrollPreviewRows.find(
                    (p: { employee?: { _id?: string } }) =>
                      p?.employee?._id != null &&
                      String(p.employee._id) === String(employeeId),
                  )
                : undefined;
              const restorableDefaults = filterRestorableGovLineNamesForWithholdingReality(
                restorableRaw,
                { previewRow },
              );

              return (
                <Card key={employeeId}>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {employee?.personalInfo.firstName}{" "}
                      {employee?.personalInfo.lastName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {empDeductions.deductions.map((deduction, idx) => (
                      <div key={idx} className="flex flex-wrap gap-2 items-end sm:items-center">
                        <div className="flex-1">
                          <Label>Deduction Name</Label>
                          <Input
                            value={deduction.name}
                            onChange={(e) =>
                              onUpdateDeduction(
                                employeeId,
                                idx,
                                "name",
                                e.target.value,
                              )
                            }
                            placeholder="e.g., Loan, Advance, etc."
                          />
                        </div>
                        <div className="w-32">
                          <Label>Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={
                              deduction.amount === 0 ? "" : deduction.amount
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                onUpdateDeduction(employeeId, idx, "amount", 0);
                              } else {
                                const numVal = parseFloat(val);
                                if (!isNaN(numVal)) {
                                  onUpdateDeduction(
                                    employeeId,
                                    idx,
                                    "amount",
                                    numVal,
                                  );
                                }
                              }
                            }}
                            placeholder="0.00"
                          />
                        </div>
                        <div className="w-full min-w-0 sm:w-40 md:w-44">
                          <Label>Type</Label>
                          <Input
                            value={deduction.type}
                            onChange={(e) =>
                              onUpdateDeduction(
                                employeeId,
                                idx,
                                "type",
                                e.target.value,
                              )
                            }
                            placeholder="loan/advance"
                            className="font-mono text-sm"
                            title={deduction.type}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveDeduction(employeeId, idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {restorableDefaults.length > 0 && onRestoreDefaultGovLine && (
                      <div className="flex flex-col gap-2 pt-1 rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-2">
                        <p className="text-xs text-muted-foreground">
                          These were removed in Step 4 but are still enabled in
                          Step 3—restore the calculated amount from preview:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {restorableDefaults.map((name) => {
                            const rKey = `${employeeId}:${name}`;
                            const busy = restoringDefaultKey === rKey;
                            return (
                              <Button
                                key={name}
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8"
                                disabled={!!restoringDefaultKey}
                                onClick={() =>
                                  void onRestoreDefaultGovLine(employeeId, name)
                                }
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                )}
                                Restore {name}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAddDeduction(employeeId)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Deduction
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Additions Section (opposite of deductions: incentives, bonuses, etc.) */}
        <div className="space-y-4">
          <Label>Enter Additions</Label>
          <p className="text-sm text-gray-500">
            Add back pay, bonuses, or other extra amounts. Turn on{" "}
            <span className="font-medium">Taxable</span> only when the amount
            should be included in withholding tax (taxable gross). New rows
            default to non-taxable. With{" "}
            <span className="font-medium">TRAIN ₱90,000 cap</span> enabled in
            Payroll settings, non-taxable lines share the annual cap and any
            excess is split to a taxable line automatically.
          </p>
          <div className="space-y-6 max-h-96 overflow-y-auto">
            {selectedEmployees.map((employeeId: string) => {
              const employee = employees?.find(
                (e: any) => e._id === employeeId,
              );
              const empIncentives = employeeIncentives.find(
                (ei) => ei.employeeId === employeeId,
              ) || { employeeId, incentives: [] };

              return (
                <Card key={employeeId}>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {employee?.personalInfo.firstName}{" "}
                      {employee?.personalInfo.lastName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {empIncentives.incentives.map((incentive, idx) => {
                      const isTaxable = incentive.taxable !== false;
                      return (
                        <div
                          key={idx}
                          className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                        >
                          <div className="flex flex-wrap gap-2 items-end sm:items-center">
                            <div className="min-w-[140px] flex-1">
                              <Label>Addition Name</Label>
                              <Input
                                value={incentive.name}
                                onChange={(e) =>
                                  onUpdateIncentive(
                                    employeeId,
                                    idx,
                                    "name",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., Holiday back pay"
                              />
                            </div>
                            <div className="w-32">
                              <Label>Amount</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={
                                  incentive.amount === 0
                                    ? ""
                                    : incentive.amount
                                }
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === "" || val === "-") {
                                    onUpdateIncentive(
                                      employeeId,
                                      idx,
                                      "amount",
                                      0,
                                    );
                                  } else {
                                    const numVal = parseFloat(val);
                                    if (!isNaN(numVal)) {
                                      onUpdateIncentive(
                                        employeeId,
                                        idx,
                                        "amount",
                                        numVal,
                                      );
                                    }
                                  }
                                }}
                                placeholder="0.00"
                              />
                            </div>
                            <div className="flex h-9 items-center gap-2 sm:shrink-0">
                              <Checkbox
                                id={`taxable-${employeeId}-${idx}`}
                                checked={isTaxable}
                                onCheckedChange={(checked) =>
                                  onUpdateIncentive(
                                    employeeId,
                                    idx,
                                    "taxable",
                                    checked === true,
                                  )
                                }
                              />
                              <Label
                                htmlFor={`taxable-${employeeId}-${idx}`}
                                className="text-sm font-normal cursor-pointer whitespace-nowrap leading-none"
                              >
                                Taxable
                              </Label>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() =>
                                onRemoveIncentive(employeeId, idx)
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAddIncentive(employeeId)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Addition
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
