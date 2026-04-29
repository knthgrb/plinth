"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X } from "lucide-react";
import {
  PREVIEW_EARNING_LABELS,
  type PreviewEditableEarningKey,
  type PreviewEditableEarnings,
} from "./payroll-preview-earnings-helpers";

/** Order matches the payslip “Other earnings” block. */
const EARNINGS_FORM_ORDER: PreviewEditableEarningKey[] = [
  "nightDiffPay",
  "holidayPay",
  "restDayPay",
  "overtimeRegular",
  "overtimeRestDay",
  "overtimeRestDayExcess",
  "overtimeSpecialHoliday",
  "overtimeSpecialHolidayExcess",
  "overtimeLegalHoliday",
  "overtimeLegalHolidayExcess",
];

type Deduction = { name: string; amount: number; type: string };

type IncentiveEdit = {
  name: string;
  amount: number;
  type: string;
  taxable: boolean;
};

type EarningsContext = "preview" | "saved";

interface EditPayslipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPayslip: any;
  editDeductions: Deduction[];
  editIncentives: IncentiveEdit[];
  isSavingPayslip: boolean;
  onAddDeduction: () => void;
  onRemoveDeduction: (index: number) => void;
  onUpdateDeduction: (
    index: number,
    field: "name" | "amount" | "type",
    value: string | number,
  ) => void;
  onAddIncentive: () => void;
  onRemoveIncentive: (index: number) => void;
  onUpdateIncentive: (
    index: number,
    field: "name" | "amount" | "type" | "taxable",
    value: string | number | boolean,
  ) => void;
  showVariableEarnings?: boolean;
  /** Pay step preview vs. saved payslip: tweaks helper copy. */
  earningsContext?: EarningsContext;
  editEarnings?: PreviewEditableEarnings;
  onUpdateEarning?: (key: PreviewEditableEarningKey, value: number) => void;
  onSave: () => void;
}

export function EditPayslipDialog({
  open,
  onOpenChange,
  editingPayslip,
  editDeductions,
  editIncentives,
  isSavingPayslip,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onAddIncentive,
  onRemoveIncentive,
  onUpdateIncentive,
  showVariableEarnings = false,
  earningsContext = "saved",
  editEarnings,
  onUpdateEarning,
  onSave,
}: EditPayslipDialogProps) {
  if (!editingPayslip) return null;

  const isEditableName = (
    entry: Deduction,
    section: "deduction" | "addition",
  ) => {
    const t = (entry.type || "").toLowerCase();
    if (section === "addition") return true;
    return t === "custom" || t === "incentive";
  };

  const employeeName =
    editingPayslip.employee?.personalInfo?.firstName &&
    editingPayslip.employee?.personalInfo?.lastName
      ? `${editingPayslip.employee.personalInfo.firstName} ${editingPayslip.employee.personalInfo.lastName}`
      : "Employee";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="shrink-0 border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>Edit payslip – {employeeName}</DialogTitle>
            <p className="text-sm text-muted-foreground text-left font-normal pt-1">
              Basic pay and non‑taxable allowance are not edited here. Attendance
              (late, absent, undertime) is under{" "}
              <span className="font-medium">Deductions</span>.
            </p>
          </DialogHeader>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-8 min-h-0">
          {showVariableEarnings && editEarnings && onUpdateEarning && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Label className="text-base font-semibold">Earnings (variable)</Label>
                <span className="text-xs text-muted-foreground text-right max-w-sm">
                  {earningsContext === "preview" ? (
                    <>
                      Withholding tax in Deductions updates as you edit (when
                      enabled in Step 3). Regenerate preview if totals look off.
                    </>
                  ) : (
                    <>
                      Withholding tax in Deductions updates as you edit when it
                      is on for this run (same rules as payroll generation).
                    </>
                  )}
                </span>
              </div>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/20 p-4"
                role="group"
                aria-label="Variable earnings amounts"
              >
                {EARNINGS_FORM_ORDER.map((key) => (
                  <div key={key} className="space-y-1.5 min-w-0">
                    <Label
                      className="text-xs font-medium text-foreground"
                      htmlFor={`earn-${key}`}
                    >
                      {PREVIEW_EARNING_LABELS[key]}
                    </Label>
                    <Input
                      id={`earn-${key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={editEarnings[key] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === "-") {
                          onUpdateEarning(key, 0);
                          return;
                        }
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0) {
                          onUpdateEarning(key, num);
                        }
                      }}
                      className="h-9 font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Deductions</Label>
              <span className="text-xs text-muted-foreground">
                Override the amount (value) only
              </span>
            </div>
            {editDeductions.length > 0 && (
              <div
                className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_2.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground items-center"
                role="row"
                aria-hidden
              >
                <div>Name</div>
                <div>Amount</div>
                <div className="min-w-0">Type</div>
                <div className="w-8 shrink-0" />
              </div>
            )}
            <div className="space-y-2">
              {editDeductions.map((deduction, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_2.5rem] gap-2 sm:items-center rounded-md border p-2 sm:p-0 sm:border-0 sm:px-1 sm:py-0"
                >
                  <div className="min-w-0 sm:pr-0">
                    <span className="text-xs text-muted-foreground sm:hidden block mb-1">
                      Name
                    </span>
                    {isEditableName(deduction, "deduction") ? (
                      <Input
                        value={deduction.name ?? ""}
                        onChange={(e) =>
                          onUpdateDeduction(idx, "name", e.target.value)
                        }
                        placeholder="Deduction name"
                        className="h-9"
                        aria-label={`Deduction ${idx + 1} name`}
                      />
                    ) : (
                      <div
                        className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground"
                        title={deduction.name}
                      >
                        {deduction.name}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground sm:hidden block mb-1">
                      Amount
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-9 font-mono text-sm"
                      value={deduction.amount ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === "-") {
                          onUpdateDeduction(idx, "amount", 0);
                        } else {
                          const numVal = parseFloat(val);
                          if (!isNaN(numVal) && numVal >= 0) {
                            onUpdateDeduction(idx, "amount", numVal);
                          }
                        }
                      }}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-muted-foreground sm:hidden block mb-1">
                      Type
                    </span>
                    <div
                      className="flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-muted px-2.5 sm:px-3 text-sm text-muted-foreground"
                      title={deduction.type || undefined}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">
                        {deduction.type || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-end sm:justify-center sm:shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveDeduction(idx)}
                      aria-label={`Remove deduction ${idx + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddDeduction}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add deduction
            </Button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Additions</Label>
              <span className="text-xs text-muted-foreground">
                Bonuses, back pay, payback, etc.; toggle taxable
              </span>
            </div>
            {editIncentives.length > 0 && (
              <div
                className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_2.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground items-center"
                role="row"
                aria-hidden
              >
                <div>Name</div>
                <div>Amount</div>
                <div>Taxable</div>
                <div className="w-8 shrink-0" />
              </div>
            )}
            <div className="space-y-2">
              {editIncentives.map((inc, idx) => {
                const isTaxable = inc.taxable !== false;
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_2.5rem] gap-2 sm:items-center rounded-md border p-2 sm:p-0 sm:border-0 sm:px-1"
                  >
                    <div className="min-w-0">
                      <span className="text-xs text-muted-foreground sm:hidden block mb-1">
                        Name
                      </span>
                      {isEditableName(inc, "addition") ? (
                        <Input
                          value={inc.name ?? ""}
                          onChange={(e) =>
                            onUpdateIncentive(idx, "name", e.target.value)
                          }
                          placeholder="e.g. back pay, payback"
                          className="h-9"
                        />
                      ) : (
                        <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                          {inc.name}
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground sm:hidden block mb-1">
                        Amount
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-9 font-mono text-sm"
                        value={inc.amount ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || val === "-") {
                            onUpdateIncentive(idx, "amount", 0);
                          } else {
                            const numVal = parseFloat(val);
                            if (!isNaN(numVal) && numVal >= 0) {
                              onUpdateIncentive(idx, "amount", numVal);
                            }
                          }
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex h-9 items-center gap-2 sm:justify-start sm:self-center">
                      <Checkbox
                        id={`edit-inc-taxable-${idx}`}
                        className="shrink-0"
                        checked={isTaxable}
                        onCheckedChange={(checked) =>
                          onUpdateIncentive(idx, "taxable", checked === true)
                        }
                      />
                      <Label
                        htmlFor={`edit-inc-taxable-${idx}`}
                        className="text-sm font-normal cursor-pointer leading-none"
                      >
                        Taxable
                      </Label>
                    </div>
                    <div className="flex h-9 items-center justify-end sm:justify-center sm:shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemoveIncentive(idx)}
                        aria-label={`Remove addition ${idx + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddIncentive}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add addition
            </Button>
          </div>
        </div>

        <div className="shrink-0 border-t px-6 py-4">
          <DialogFooter className="sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSavingPayslip}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={isSavingPayslip}
            >
              {isSavingPayslip ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
