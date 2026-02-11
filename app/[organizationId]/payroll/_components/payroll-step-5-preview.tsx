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

interface PayrollStep5PreviewProps {
  previewData: any[];
  cutoffStart: string;
  cutoffEnd: string;
  currentOrganization: any;
  /** When true (admin/hr/owner), show "Edit deductions" in preview */
  canEditDeductions?: boolean;
  employeeDeductions?: EmployeeDeduction[];
  onAddDeduction?: (employeeId: string) => void;
  onRemoveDeduction?: (employeeId: string, index: number) => void;
  onUpdateDeduction?: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
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
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
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
              employeeDeductions={employeeDeductions}
              onAddDeduction={onAddDeduction!}
              onRemoveDeduction={onRemoveDeduction!}
              onUpdateDeduction={onUpdateDeduction!}
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

function EditDeductionsForm({
  employeeId,
  employee,
  employeeDeductions,
  onAddDeduction,
  onRemoveDeduction,
  onUpdateDeduction,
}: {
  employeeId: string;
  employee: any;
  employeeDeductions: EmployeeDeduction[];
  onAddDeduction: (employeeId: string) => void;
  onRemoveDeduction: (employeeId: string, index: number) => void;
  onUpdateDeduction: (
    employeeId: string,
    index: number,
    field: "name" | "amount" | "type",
    value: string | number
  ) => void;
}) {
  const empDeductions =
    employeeDeductions.find((ed) => ed.employeeId === employeeId) || {
      employeeId,
      deductions: [],
    };
  const name =
    employee?.personalInfo?.firstName && employee?.personalInfo?.lastName
      ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`
      : "Employee";

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{name}</p>
      <div className="space-y-3">
        {empDeductions.deductions.map((deduction, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1">
              <Label>Deduction name</Label>
              <Input
                value={deduction.name}
                onChange={(e) =>
                  onUpdateDeduction(employeeId, idx, "name", e.target.value)
                }
                placeholder="e.g., Loan, Advance"
              />
            </div>
            <div className="w-28">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={deduction.amount === 0 ? "" : deduction.amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || val === "-") {
                    onUpdateDeduction(employeeId, idx, "amount", 0);
                  } else {
                    const numVal = parseFloat(val);
                    if (!isNaN(numVal)) {
                      onUpdateDeduction(employeeId, idx, "amount", numVal);
                    }
                  }
                }}
                placeholder="0.00"
              />
            </div>
            <div className="w-24">
              <Label>Type</Label>
              <Input
                value={deduction.type}
                onChange={(e) =>
                  onUpdateDeduction(employeeId, idx, "type", e.target.value)
                }
                placeholder="loan"
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
