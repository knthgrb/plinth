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
import { Plus, X } from "lucide-react";

type Deduction = { name: string; amount: number; type: string };

interface EditPayslipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPayslip: any;
  editDeductions: Deduction[];
  editIncentives: Deduction[];
  editNonTaxableAllowance: number;
  isSavingPayslip: boolean;
  onAddDeduction: () => void;
  onRemoveDeduction: (index: number) => void;
  onUpdateDeduction: (
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
  onAddIncentive: () => void;
  onRemoveIncentive: (index: number) => void;
  onUpdateIncentive: (
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
  onNonTaxableChange: (value: number) => void;
  onSave: () => void;
}

export function EditPayslipDialog({
  open,
  onOpenChange,
  editingPayslip,
  editDeductions,
  editIncentives,
  editNonTaxableAllowance,
  isSavingPayslip,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onAddIncentive,
  onRemoveIncentive,
  onUpdateIncentive,
  onNonTaxableChange,
  onSave,
}: EditPayslipDialogProps) {
  if (!editingPayslip) return null;

  const employeeName =
    editingPayslip.employee?.personalInfo?.firstName &&
    editingPayslip.employee?.personalInfo?.lastName
      ? `${editingPayslip.employee.personalInfo.firstName} ${editingPayslip.employee.personalInfo.lastName}`
      : "Employee";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit payslip – {employeeName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Deductions – only amount is editable/overridable */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Deductions</Label>
              <span className="text-xs text-gray-500">
                Override the amount (value) only
              </span>
            </div>
            {editDeductions.map((deduction, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                    {deduction.name || "—"}
                  </div>
                </div>
                <div className="w-28">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
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
                <div className="w-24">
                  <Label className="text-xs">Type</Label>
                  <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                    {deduction.type || "—"}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveDeduction(idx)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={onAddDeduction}>
              <Plus className="h-4 w-4 mr-2" />
              Add deduction
            </Button>
          </div>

          {/* Incentives – only amount is editable */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Incentives</Label>
              <span className="text-xs text-gray-500">
                Override the amount (value) only
              </span>
            </div>
            {editIncentives.map((inc, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                    {inc.name || "—"}
                  </div>
                </div>
                <div className="w-28">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveIncentive(idx)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={onAddIncentive}>
              <Plus className="h-4 w-4 mr-2" />
              Add incentive
            </Button>
          </div>

          {/* Non-taxable allowance */}
          <div className="space-y-2">
            <Label className="text-base">Non-taxable allowance</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={editNonTaxableAllowance ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || val === "-") {
                  onNonTaxableChange(0);
                } else {
                  const numVal = parseFloat(val);
                  if (!isNaN(numVal) && numVal >= 0) {
                    onNonTaxableChange(numVal);
                  }
                }
              }}
              placeholder="0.00"
            />
          </div>
        </div>

        <DialogFooter>
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
            {isSavingPayslip ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
