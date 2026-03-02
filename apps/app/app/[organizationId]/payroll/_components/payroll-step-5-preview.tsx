"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Pencil, Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PayslipDetail } from "@/components/payslip-detail";

interface Deduction {
  name: string;
  amount: number;
  type: string;
}

interface EmployeeDeduction {
  employeeId: string;
  deductions: Deduction[];
}

export interface PayrollStep5PreviewProps {
  previewData: any[];
  cutoffStart: string;
  cutoffEnd: string;
  currentOrganization: any;
  /** When true (admin/hr/owner), show "Edit deductions" in preview */
  canEditDeductions?: boolean;
  employeeDeductions?: EmployeeDeduction[];
  /** Per-employee overrides for deduction amounts (SSS, PhilHealth, etc.) */
  previewDeductionOverrides?: Record<string, Record<string, number>>;
  onAddDeduction?: (employeeId: string) => void;
  onRemoveDeduction?: (employeeId: string, index: number) => void;
  onUpdateDeduction?: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
  onOverrideDeductionAmount?: (
    employeeId: string,
    deductionName: string,
    amount: number
  ) => void;
  onRecomputePreview?: () => void;
}

export function PayrollStep5Preview({
  previewData,
  cutoffStart,
  cutoffEnd,
  currentOrganization,
  canEditDeductions = false,
  employeeDeductions = [],
  previewDeductionOverrides = {},
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onOverrideDeductionAmount,
  onRecomputePreview,
}: PayrollStep5PreviewProps) {
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);

  const handleCloseEditDeductions = () => {
    setEditingEmployeeId(null);
    onRecomputePreview?.();
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-4">
        <Label>Preview Payroll</Label>
        {/* Let the parent dialog handle scrolling to avoid nested scrollbars */}
        <div className="space-y-6">
          {previewData.map((preview, idx) => {
            const startDate = new Date(cutoffStart);
            const endDate = new Date(cutoffEnd);
            const period = `${format(startDate, "MMM. dd, yyyy")} - ${format(
              endDate,
              "MMM. dd, yyyy"
            )}`;

            // Create a mock payslip object for preview with actual attendance data
            const mockPayslip = {
              period,
              grossPay: preview.grossPay,
              deductions: preview.deductions,
              incentives: preview.incentives,
              nonTaxableAllowance: preview.nonTaxableAllowance,
              netPay: preview.netPay,
              daysWorked: preview.daysWorked || 0,
              absences: preview.absences || 0,
              lateHours: preview.lateHours || 0,
              undertimeHours: preview.undertimeHours || 0,
              overtimeHours: preview.overtimeHours || 0,
              holidayPay: preview.holidayPay || 0,
              restDayPay: preview.restDayPay || 0,
              createdAt: Date.now(),
            };

            const employeeId = preview.employee?._id;
            const empDeductions =
              employeeId &&
              employeeDeductions.find((ed) => ed.employeeId === employeeId);

            return (
              <div key={idx} className="space-y-2">
                {canEditDeductions && employeeId && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingEmployeeId(employeeId)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit deductions
                    </Button>
                  </div>
                )}
                <PayslipDetail
                  payslip={mockPayslip}
                  employee={preview.employee}
                  organization={currentOrganization}
                  cutoffStart={new Date(cutoffStart).getTime()}
                  cutoffEnd={new Date(cutoffEnd).getTime()}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit deductions dialog (admin/hr/owner only) */}
      <Dialog open={!!editingEmployeeId} onOpenChange={(open) => !open && handleCloseEditDeductions()}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit deductions</DialogTitle>
          </DialogHeader>
          {editingEmployeeId && (
            <EditDeductionsForm
              employeeId={editingEmployeeId}
              employee={previewData.find((p) => p.employee?._id === editingEmployeeId)?.employee}
              previewDeductions={
                previewData.find((p) => p.employee?._id === editingEmployeeId)?.deductions ?? []
              }
              employeeDeductions={employeeDeductions}
              previewDeductionOverrides={previewDeductionOverrides}
              onAddDeduction={onAddDeduction!}
              onRemoveDeduction={onRemoveDeduction!}
              onUpdateDeduction={onUpdateDeduction!}
              onOverrideDeductionAmount={onOverrideDeductionAmount!}
            />
          )}
          <DialogFooter>
            <Button type="button" onClick={handleCloseEditDeductions}>
              Done (recompute preview)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const GOV_OR_OTHER_NAMES = new Set([
  "SSS",
  "PhilHealth",
  "Pag-IBIG",
  "Withholding Tax",
  "Other Deductions",
]);

function isGovOrOtherDeduction(d: Deduction): boolean {
  return d.type === "government" || GOV_OR_OTHER_NAMES.has(d.name);
}

function EditDeductionsForm({
  employeeId,
  employee,
  previewDeductions,
  employeeDeductions,
  previewDeductionOverrides,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
  onOverrideDeductionAmount,
}: {
  employeeId: string;
  employee: any;
  previewDeductions: Deduction[];
  employeeDeductions: EmployeeDeduction[];
  previewDeductionOverrides: Record<string, Record<string, number>>;
  onAddDeduction: (employeeId: string) => void;
  onRemoveDeduction: (employeeId: string, index: number) => void;
  onUpdateDeduction: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
  onOverrideDeductionAmount: (
    employeeId: string,
    deductionName: string,
    amount: number
  ) => void;
}) {
  const empDeductions =
    employeeDeductions.find((ed) => ed.employeeId === employeeId) || {
      employeeId,
      deductions: [],
    };
  const overrides = previewDeductionOverrides[employeeId] ?? {};
  const name =
    employee?.personalInfo?.firstName && employee?.personalInfo?.lastName
      ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`
      : "Employee";

  let manualIndex = 0;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{name}</p>
      <p className="text-xs text-gray-500">
        Override the amount (value) for each deduction. Click &quot;Done&quot; to recompute the preview.
      </p>
      <div className="space-y-3">
        {previewDeductions.map((deduction, idx) => {
          const isGovOrOther = isGovOrOtherDeduction(deduction);
          const displayAmount = isGovOrOther
            ? (overrides[deduction.name] ?? deduction.amount)
            : (empDeductions.deductions[manualIndex]?.amount ?? deduction.amount);
          const currentManualIndex = manualIndex;
          if (!isGovOrOther) manualIndex += 1;

          return (
            <div key={idx} className="flex gap-2 items-end">
              <div className="flex-1">
                <Label>Name</Label>
                <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                  {deduction.name || "—"}
                </div>
              </div>
              <div className="w-28">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={displayAmount ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const numVal =
                      val === "" || val === "-"
                        ? 0
                        : parseFloat(val);
                    if (numVal >= 0 && !isNaN(numVal)) {
                      if (isGovOrOther) {
                        onOverrideDeductionAmount(
                          employeeId,
                          deduction.name,
                          numVal
                        );
                      } else {
                        onUpdateDeduction(
                          employeeId,
                          currentManualIndex,
                          "amount",
                          numVal
                        );
                      }
                    }
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="w-24">
                <Label>Type</Label>
                <div className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm text-muted-foreground">
                  {deduction.type || "—"}
                </div>
              </div>
              {!isGovOrOther && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveDeduction(employeeId, currentManualIndex)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              {isGovOrOther && <div className="w-9" />}
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAddDeduction(employeeId)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add deduction
        </Button>
      </div>
    </div>
  );
}
