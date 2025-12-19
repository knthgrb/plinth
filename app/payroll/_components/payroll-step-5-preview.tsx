"use client";

import { format } from "date-fns";
import { Label } from "@/components/ui/label";
import { PayslipDetail } from "@/components/payslip-detail";

interface PayrollStep5PreviewProps {
  previewData: any[];
  cutoffStart: string;
  cutoffEnd: string;
  currentOrganization: any;
}

export function PayrollStep5Preview({
  previewData,
  cutoffStart,
  cutoffEnd,
  currentOrganization,
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

            return (
              <div key={idx}>
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
