"use client";

import { format } from "date-fns";
import { Label } from "@/components/ui/label";
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
  ..._unused
}: PayrollStep5PreviewProps) {
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
              deductions: [
                ...(preview.deductions || []),
                ...(preview.absentDeduction > 0
                  ? [
                      (() => {
                        const noWorkDays = preview.noWorkNoPayDays || 0;
                        const absentDays = Math.max(
                          0,
                          (preview.absences || 0) - noWorkDays,
                        );
                        const label =
                          noWorkDays > 0 && absentDays === 0
                            ? `No work on a holiday (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`
                            : `Absent (${preview.absences || 0} ${(preview.absences || 0) === 1 ? "day" : "days"})`;
                        return {
                          name: label,
                          amount: preview.absentDeduction,
                          type: "attendance",
                        };
                      })(),
                    ]
                  : []),
                ...(preview.lateDeductionSpecialHoliday > 0
                  ? [
                      {
                        name: "Special Holiday Late",
                        amount: preview.lateDeductionSpecialHoliday,
                        type: "attendance",
                      },
                    ]
                  : []),
                ...(preview.lateDeductionRegularHoliday > 0
                  ? [
                      {
                        name: "Regular Holiday Late",
                        amount: preview.lateDeductionRegularHoliday,
                        type: "attendance",
                      },
                    ]
                  : []),
                ...((preview.lateDeductionRegularDay ?? 0) > 0
                  ? [
                      {
                        name:
                          (preview.lateDeductionSpecialHoliday > 0 ||
                            preview.lateDeductionRegularHoliday > 0)
                            ? "Regular day late"
                            : "Late",
                        amount: preview.lateDeductionRegularDay,
                        type: "attendance",
                      },
                    ]
                  : []),
                ...(preview.lateDeduction > 0 &&
                !preview.lateDeductionSpecialHoliday &&
                !preview.lateDeductionRegularHoliday &&
                !preview.lateDeductionRegularDay
                  ? [
                      {
                        name: "Late",
                        amount: preview.lateDeduction,
                        type: "attendance",
                      },
                    ]
                  : []),
                ...(preview.undertimeDeduction > 0
                  ? [
                      {
                        name: "Undertime",
                        amount: preview.undertimeDeduction,
                        type: "attendance",
                      },
                    ]
                  : []),
              ],
              incentives: preview.incentives,
              nonTaxableAllowance: preview.nonTaxableAllowance,
              netPay: preview.netPay,
              daysWorked: preview.daysWorked || 0,
              absences: preview.absences || 0,
              lateHours: preview.lateHours || 0,
              undertimeHours: preview.undertimeHours || 0,
              overtimeHours: preview.overtimeHours || 0,
              holidayPay: preview.holidayPay || 0,
              holidayPayType: preview.holidayPayType ?? preview.payroll?.holidayPayType,
              restDayPay: preview.restDayPay || 0,
              nightDiffPay: preview.nightDiffPay || 0,
              nightDiffBreakdown: preview.nightDiffBreakdown,
              overtimeRegular: preview.overtimeRegular || 0,
              overtimeRestDay: preview.overtimeRestDay || 0,
              overtimeRestDayExcess: preview.overtimeRestDayExcess || 0,
              overtimeSpecialHoliday: preview.overtimeSpecialHoliday || 0,
              overtimeSpecialHolidayExcess:
                preview.overtimeSpecialHolidayExcess || 0,
              overtimeLegalHoliday: preview.overtimeLegalHoliday || 0,
              overtimeLegalHolidayExcess:
                preview.overtimeLegalHolidayExcess || 0,
              createdAt: Date.now(),
            };

            return (
              <div key={idx} className="space-y-2">
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
    </div>
  );
}
