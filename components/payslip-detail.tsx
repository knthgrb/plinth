"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface PayslipDetailProps {
  payslip: any;
  employee: any;
  organization?: any;
  cutoffStart?: number;
  cutoffEnd?: number;
}

export function PayslipDetail({
  payslip,
  employee,
  organization,
  cutoffStart,
  cutoffEnd,
}: PayslipDetailProps) {
  // Format period for display
  const periodDisplay = payslip.period || "N/A";

  // Format dates
  const dateHired = employee?.employment?.hireDate
    ? format(new Date(employee.employment.hireDate), "MMMM dd, yyyy")
    : "N/A";

  const cutoffDate =
    cutoffStart && cutoffEnd
      ? `${format(new Date(cutoffStart), "MMM d")} - ${format(new Date(cutoffEnd), "MMM d, yyyy")}`
      : periodDisplay;

  // Calculate paydate based on organization settings and cutoff period
  const calculatePayDate = (): string => {
    if (!cutoffEnd) {
      // Fallback to createdAt if no cutoff end
      return payslip.createdAt
        ? format(new Date(payslip.createdAt), "MMMM dd, yyyy")
        : format(new Date(), "MMMM dd, yyyy");
    }

    const cutoffEndDate = new Date(cutoffEnd);
    const cutoffMonth = cutoffEndDate.getMonth();
    const cutoffYear = cutoffEndDate.getFullYear();
    const cutoffDay = cutoffEndDate.getDate();

    // Get organization paydates (default to 15 and 30)
    const firstPayDate = organization?.firstPayDate || 15;
    const secondPayDate = organization?.secondPayDate || 30;

    // Determine which paydate to use based on cutoff end date
    // If cutoff ends on or before 15th, use first paydate
    // Otherwise, use second paydate
    let payDay: number;
    if (cutoffDay <= 15) {
      payDay = firstPayDate;
    } else {
      payDay = secondPayDate;
    }

    // Create paydate (handle month overflow - if paydate is beyond month end, use last day of month)
    const lastDayOfMonth = new Date(cutoffYear, cutoffMonth + 1, 0).getDate();
    const actualPayDay = Math.min(payDay, lastDayOfMonth);

    const payDateObj = new Date(cutoffYear, cutoffMonth, actualPayDay);
    return format(payDateObj, "MMMM dd, yyyy");
  };

  const payDate = calculatePayDate();

  // Calculate earnings breakdown
  const incentives = payslip.incentives || [];
  const totalIncentives = incentives.reduce(
    (sum: number, inc: any) => sum + inc.amount,
    0,
  );

  // Use backend / caller-calculated values as the source of truth.
  const storedGrossPay = payslip.grossPay || 0;

  const holidayPay = payslip.holidayPay || 0;
  const restDayPay = payslip.restDayPay || 0;

  // Payroll settings for daily rate formula: (basic + allowance?) × 12/workingDaysPerYear
  const settings = useQuery(
    (api as any).settings.getSettings,
    organization?._id ? { organizationId: organization._id } : "skip"
  );
  const dailyRateIncludesAllowance =
    settings?.payrollSettings?.dailyRateIncludesAllowance ?? false;
  const dailyRateWorkingDaysPerYear =
    settings?.payrollSettings?.dailyRateWorkingDaysPerYear ?? 261;

  // Calculate basic pay based on actual attendance
  // For monthly employees: daily rate = (basic + allowance?) × 12/261
  const salaryType = employee?.compensation?.salaryType || "monthly";
  const monthlySalary = employee?.compensation?.basicSalary || 0;
  const allowance = employee?.compensation?.allowance ?? 0;
  const daysWorked = payslip.daysWorked || 0;
  const absences = payslip.absences || 0;
  const lateHours = payslip.lateHours || 0;
  const undertimeHours = payslip.undertimeHours || 0;

  // Helper to get day name from timestamp
  const getDayName = (date: number): string => {
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return days[new Date(date).getDay()];
  };

  // Helper to check if a date is a rest day
  const isRestDay = (date: number, employeeSchedule: any): boolean => {
    const dayName = getDayName(date);
    const daySchedule =
      employeeSchedule?.defaultSchedule?.[
        dayName as keyof typeof employeeSchedule.defaultSchedule
      ];

    if (employeeSchedule?.scheduleOverrides) {
      const override = employeeSchedule.scheduleOverrides.find(
        (o: any) =>
          new Date(o.date).toDateString() === new Date(date).toDateString(),
      );
      if (override) return false;
    }

    return !daySchedule?.isWorkday;
  };

  // Calculate working days in cutoff period
  const calculateWorkingDaysInRange = (
    startDate: number,
    endDate: number,
    employeeSchedule: any,
  ): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workingDays = 0;
    const current = new Date(start);

    while (current <= end) {
      const ts = current.getTime();
      if (!employeeSchedule || !employeeSchedule.defaultSchedule) {
        // If there is no schedule configured, treat all days as working days
        workingDays++;
      } else if (!isRestDay(ts, employeeSchedule)) {
        workingDays++;
      }
      current.setDate(current.getDate() + 1);
    }

    // Fallback: if schedule marks everything as rest day, treat the entire range as working days
    if (workingDays === 0) {
      const totalDays =
        Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) +
        1;
      return totalDays;
    }

    return workingDays;
  };

  let fullBasicPay = 0; // Full basic pay for the cutoff period (before prorating)
  let dailyRate = 0;
  let hourlyRate = 0;
  let workingDaysInCutoff = 0;

  if (salaryType === "monthly" && cutoffStart && cutoffEnd) {
    // For bi-monthly cutoff, show the full bi-monthly amount
    fullBasicPay = monthlySalary / 2;
    workingDaysInCutoff = calculateWorkingDaysInRange(
      cutoffStart,
      cutoffEnd,
      employee?.schedule,
    );
    // Daily rate = (basic + allowance?) × 12/workingDaysPerYear (matches backend)
    const monthlyBase =
      monthlySalary + (dailyRateIncludesAllowance ? allowance : 0);
    dailyRate = monthlyBase * (12 / dailyRateWorkingDaysPerYear);
    hourlyRate = dailyRate / 8;
  } else if (salaryType === "daily") {
    // For daily employees, daily rate is the basicSalary
    dailyRate = monthlySalary;
    hourlyRate = dailyRate / 8;
    // Calculate working days in cutoff for daily employees
    const workingDaysInCutoff =
      cutoffStart && cutoffEnd
        ? calculateWorkingDaysInRange(
            cutoffStart,
            cutoffEnd,
            employee?.schedule,
          )
        : 22; // Default fallback
    fullBasicPay = dailyRate * workingDaysInCutoff;
  } else if (salaryType === "hourly") {
    // For hourly employees
    dailyRate = monthlySalary * 8;
    hourlyRate = monthlySalary;
    // Calculate working days in cutoff for hourly employees
    const workingDaysInCutoff =
      cutoffStart && cutoffEnd
        ? calculateWorkingDaysInRange(
            cutoffStart,
            cutoffEnd,
            employee?.schedule,
          )
        : 22; // Default fallback
    fullBasicPay = dailyRate * workingDaysInCutoff;
  } else if (salaryType === "monthly") {
    // Fallback if cutoff dates not provided
    fullBasicPay = monthlySalary / 2;
    const monthlyBase =
      monthlySalary + (dailyRateIncludesAllowance ? allowance : 0);
    dailyRate = monthlyBase * (12 / dailyRateWorkingDaysPerYear);
    hourlyRate = dailyRate / 8;
  }

  // Calculate deductions for lates, undertime, and absences
  // These are based on the per-day rate and actual attendance

  // For monthly employees we rely on the backend-computed absences, which
  // already take into account rest days, holidays, and paid leaves. This keeps
  // the payslip display consistent with the server-side computation.
  const calculatedAbsences = absences;

  const lateDeduction = lateHours * hourlyRate;
  const undertimeDeduction = undertimeHours * hourlyRate;
  const absentDeduction =
    salaryType === "monthly" ? calculatedAbsences * dailyRate : 0;

  // Basic pay shows the full amount (₱5,000 for bi-monthly)
  // Deductions are shown separately in the "Less" section
  const basicPay = fullBasicPay;

  // Use actual overtime values from payslip
  const overtimeRegular = payslip.overtimeRegular || 0;

  // Taxable gross earnings = Basic Pay - Absent Deduction - Late Deduction - Undertime Deduction + Overtime + Incentives
  // This is the final amount after all attendance-based deductions
  const taxableGrossEarnings = Math.max(
    0,
    basicPay -
      absentDeduction -
      lateDeduction -
      undertimeDeduction +
      overtimeRegular +
      totalIncentives,
  );

  // Non-taxable items (allowances, transportation)
  const nonTaxableAllowance =
    payslip.nonTaxableAllowance || employee?.compensation?.allowance || 0;
  const transportation = 0; // Can be added later

  // Total earnings
  const totalEarnings =
    taxableGrossEarnings + nonTaxableAllowance + transportation;

  // Only show sections when they have at least one line with value > 0
  const hasOtherEarnings =
    (payslip.nightDiffPay ?? 0) > 0 ||
    (payslip.holidayPay ?? 0) > 0 ||
    (payslip.restDayPay ?? 0) > 0 ||
    (payslip.overtimeRegular ?? 0) > 0 ||
    (payslip.overtimeRestDay ?? 0) > 0 ||
    (payslip.overtimeRestDayExcess ?? 0) > 0 ||
    (payslip.overtimeSpecialHoliday ?? 0) > 0 ||
    (payslip.overtimeSpecialHolidayExcess ?? 0) > 0 ||
    (payslip.overtimeLegalHoliday ?? 0) > 0 ||
    (payslip.overtimeLegalHolidayExcess ?? 0) > 0;
  const hasAddEarnings =
    (payslip.adjustments ?? 0) > 0 ||
    (payslip.commission ?? 0) > 0 ||
    (payslip.thirteenthMonth ?? 0) > 0;
  const hasLess =
    (payslip.adjustmentsNegative ?? 0) > 0 ||
    absentDeduction > 0 ||
    lateDeduction > 0 ||
    undertimeDeduction > 0;
  const hasAddNonTaxable =
    nonTaxableAllowance > 0 ||
    transportation > 0 ||
    (incentives?.filter((inc: any) => inc.amount > 0).length ?? 0) > 0;

  // Separate deductions by type
  const governmentDeductions =
    payslip.deductions?.filter((d: any) => d.type === "government") || [];

  // Non-government, non-attendance deductions (e.g. loans, advances, other).
  // Attendance (absent, late, undertime) is only shown on the left under "Less", not here.
  const loanDeductions =
    payslip.deductions?.filter(
      (d: any) => d.type !== "government" && d.type !== "attendance",
    ) || [];
  const loanDeductionsWithAmount = loanDeductions.filter(
    (d: any) => d.amount > 0,
  );

  // Calculate totals (full total includes gov + loans + attendance; used for net pay)
  const computedTotalDeductions =
    payslip.deductions?.reduce((sum: number, d: any) => sum + d.amount, 0) || 0;
  const totalDeductions =
    typeof payslip.totalDeductions === "number"
      ? (payslip.totalDeductions as number)
      : computedTotalDeductions;

  // Right column shows only gov + loans; total there must match those line items only
  const totalDeductionsRightColumn =
    (governmentDeductions.reduce(
      (s: number, d: any) => s + (d.amount || 0),
      0,
    ) || 0) +
    (loanDeductionsWithAmount.reduce((s: number, d: any) => s + d.amount, 0) ||
      0);

  // Net pay = total earnings minus only gov + loans (absent/late/undertime already deducted in earnings)
  const netPay = Math.max(0, totalEarnings - totalDeductionsRightColumn);

  // Get specific deduction amounts
  const getDeductionAmount = (name: string) => {
    const deduction = payslip.deductions?.find((d: any) =>
      d.name.toLowerCase().includes(name.toLowerCase()),
    );
    return deduction?.amount || 0;
  };

  const hasDeduction = (name: string) => {
    return payslip.deductions?.some((d: any) =>
      d.name.toLowerCase().includes(name.toLowerCase()),
    );
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardContent className="p-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold">PAYSLIP</h1>
            <p className="text-lg text-gray-600 mt-1">{periodDisplay}</p>
          </div>
        </div>

        {/* Employee Info and Dates */}
        <div className="grid grid-cols-2 gap-8 mb-6 pb-4 border-b">
          <div>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-gray-500">Name:</span>
                <p className="font-semibold">
                  {employee?.personalInfo?.firstName}{" "}
                  {employee?.personalInfo?.lastName}
                </p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Employee ID:</span>
                <p className="font-semibold">
                  {employee?.employment?.employeeId || "N/A"}
                </p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Designation:</span>
                <p className="font-semibold">
                  {employee?.employment?.position || "N/A"}
                </p>
              </div>
            </div>
          </div>
          <div>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-gray-500">Date Hired:</span>
                <p className="font-semibold">{dateHired}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Cut off Date:</span>
                <p className="font-semibold">{cutoffDate}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Pay Date:</span>
                <p className="font-semibold">{payDate}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Earnings and Deductions */}
        <div className="grid grid-cols-2 gap-8">
          {/* EARNINGS Column */}
          <div>
            <h2 className="font-bold text-lg mb-4">EARNINGS</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Basic Pay</span>
                <span className="font-semibold">
                  ₱
                  {basicPay.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              {hasOtherEarnings && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Other Earnings</p>
                  <div className="space-y-1 text-sm">
                    {payslip.nightDiffPay && payslip.nightDiffPay > 0 && (
                      <div className="flex justify-between">
                        <span>Night Differential</span>
                        <span>
                          ₱
                          {payslip.nightDiffPay.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.holidayPay && payslip.holidayPay > 0 && (
                      <div className="flex justify-between">
                        <span>Holiday Pay</span>
                        <span>
                          ₱
                          {payslip.holidayPay.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.restDayPay && payslip.restDayPay > 0 && (
                      <div className="flex justify-between">
                        <span>Rest Day Pay</span>
                        <span>
                          ₱
                          {payslip.restDayPay.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.overtimeRegular && payslip.overtimeRegular > 0 && (
                      <div className="flex justify-between">
                        <span>Overtime - Regular</span>
                        <span>
                          ₱
                          {payslip.overtimeRegular.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.overtimeRestDay && payslip.overtimeRestDay > 0 && (
                      <div className="flex justify-between">
                        <span>Overtime - Rest Day</span>
                        <span>
                          ₱
                          {payslip.overtimeRestDay.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.overtimeRestDayExcess &&
                      payslip.overtimeRestDayExcess > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime - RD excess of 8 hrs.</span>
                          <span>
                            ₱
                            {payslip.overtimeRestDayExcess.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                    {payslip.overtimeSpecialHoliday &&
                      payslip.overtimeSpecialHoliday > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime - Special Holiday</span>
                          <span>
                            ₱
                            {payslip.overtimeSpecialHoliday.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                    {payslip.overtimeSpecialHolidayExcess &&
                      payslip.overtimeSpecialHolidayExcess > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime - SH excess of 8 hrs.</span>
                          <span>
                            ₱
                            {payslip.overtimeSpecialHolidayExcess.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                    {payslip.overtimeLegalHoliday &&
                      payslip.overtimeLegalHoliday > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime - Legal Holiday</span>
                          <span>
                            ₱
                            {payslip.overtimeLegalHoliday.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                    {payslip.overtimeLegalHolidayExcess &&
                      payslip.overtimeLegalHolidayExcess > 0 && (
                        <div className="flex justify-between">
                          <span>Overtime - LH excess of 8 hrs.</span>
                          <span>
                            ₱
                            {payslip.overtimeLegalHolidayExcess.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {hasAddEarnings && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Add</p>
                  <div className="space-y-1 text-sm">
                    {/* Only show items with value > 0 */}
                    {payslip.adjustments && payslip.adjustments > 0 && (
                      <div className="flex justify-between">
                        <span>Adjustments (+)</span>
                        <span>
                          ₱
                          {payslip.adjustments.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.commission && payslip.commission > 0 && (
                      <div className="flex justify-between">
                        <span>Commission</span>
                        <span>
                          ₱
                          {payslip.commission.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {payslip.thirteenthMonth && payslip.thirteenthMonth > 0 && (
                      <div className="flex justify-between">
                        <span>13th month pay</span>
                        <span>
                          ₱
                          {payslip.thirteenthMonth.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {hasLess && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Less</p>
                  <div className="space-y-1 text-sm">
                    {/* Only show items with value > 0 */}
                    {payslip.adjustmentsNegative &&
                      payslip.adjustmentsNegative > 0 && (
                        <div className="flex justify-between">
                          <span>Adjustments (-)</span>
                          <span>
                            ₱
                            {payslip.adjustmentsNegative.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </span>
                        </div>
                      )}
                    {absentDeduction > 0 && (
                      <div className="flex justify-between">
                        <span>
                          Absent{" "}
                          {calculatedAbsences > 0 &&
                            `(${calculatedAbsences} days)`}
                        </span>
                        <span>
                          ₱
                          {absentDeduction.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {lateDeduction > 0 && (
                      <div className="flex justify-between">
                        <span>Late</span>
                        <span>
                          ₱
                          {lateDeduction.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {undertimeDeduction > 0 && (
                      <div className="flex justify-between">
                        <span>Undertime</span>
                        <span>
                          ₱
                          {undertimeDeduction.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t pt-2 mt-4">
                <div className="flex justify-between font-semibold">
                  <span>Taxable Gross Earnings</span>
                  <span>
                    ₱
                    {taxableGrossEarnings.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>

              {hasAddNonTaxable && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Add</p>
                  <div className="space-y-1 text-sm">
                    {nonTaxableAllowance > 0 && (
                      <div className="flex justify-between">
                        <span>Non-taxable Allowance</span>
                        <span>
                          ₱
                          {nonTaxableAllowance.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {transportation > 0 && (
                      <div className="flex justify-between">
                        <span>Transportation</span>
                        <span>
                          ₱
                          {transportation.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    {incentives.length > 0 && (
                      <>
                        {incentives
                          .filter((inc: any) => inc.amount > 0)
                          .map((inc: any, i: number) => (
                            <div key={i} className="flex justify-between">
                              <span>{inc.name}</span>
                              <span>
                                ₱
                                {inc.amount.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          ))}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t-2 pt-2 mt-4">
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>
                    ₱
                    {totalEarnings.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* DEDUCTIONS Column */}
          <div>
            <h2 className="font-bold text-lg mb-4">DEDUCTIONS</h2>
            <div className="space-y-3">
              <div>
                <p className="font-semibold mb-2">Government Deductions</p>
                <div className="space-y-1 text-sm">
                  {hasDeduction("SSS") && (
                    <div className="flex justify-between">
                      <span>SSS</span>
                      <span>
                        ₱
                        {getDeductionAmount("SSS").toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  )}
                  {hasDeduction("PhilHealth") && (
                    <div className="flex justify-between">
                      <span>PhilHealth</span>
                      <span>
                        ₱
                        {getDeductionAmount("PhilHealth").toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}
                      </span>
                    </div>
                  )}
                  {hasDeduction("Pag-IBIG") && (
                    <div className="flex justify-between">
                      <span>Pag-IBIG</span>
                      <span>
                        ₱
                        {getDeductionAmount("Pag-IBIG").toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}
                      </span>
                    </div>
                  )}
                  {hasDeduction("Withholding Tax") && (
                    <div className="flex justify-between">
                      <span>Withholding Tax</span>
                      <span>
                        ₱
                        {getDeductionAmount("Withholding Tax").toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}
                      </span>
                    </div>
                  )}
                  {governmentDeductions.length === 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>None</span>
                      <span>₱0.00</span>
                    </div>
                  )}
                </div>
              </div>

              {loanDeductionsWithAmount.length > 0 && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Loans and Advances</p>
                  <div className="space-y-1 text-sm">
                    {loanDeductionsWithAmount.map((ded: any, idx: number) => (
                      <div key={idx} className="flex justify-between">
                        <span>{ded.name}</span>
                        <span>
                          ₱
                          {ded.amount.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t-2 pt-2 mt-4">
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>
                    ₱
                    {totalDeductionsRightColumn.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Net Pay */}
        <div className="border-t-2 pt-4 mt-6">
          <div className="flex justify-between items-center">
            <span className="text-xl font-bold">Net Pay</span>
            <span className="text-2xl font-bold text-purple-600">
              ₱
              {netPay.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        {/* Edit History */}
        {payslip.editHistory && payslip.editHistory.length > 0 && (
          <div className="border-t-2 border-purple-300 pt-6 mt-6">
            <h3 className="text-lg font-bold text-purple-900 mb-4">
              Edit History
            </h3>
            <div className="space-y-4">
              {payslip.editHistory.map((edit: any, editIdx: number) => (
                <Card key={editIdx} className="bg-purple-50 border-purple-200">
                  <CardHeader>
                    <CardTitle className="text-sm text-purple-900">
                      Edit #{editIdx + 1} -{" "}
                      {edit.editedByEmail || "Unknown User"} -{" "}
                      {format(
                        new Date(edit.editedAt),
                        "MMM dd, yyyy 'at' h:mm a",
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {edit.changes.map((change: any, changeIdx: number) => (
                        <div
                          key={changeIdx}
                          className="border-l-2 border-purple-300 pl-3 space-y-1"
                        >
                          <div className="font-medium text-purple-900 capitalize">
                            {change.field.replace(/([A-Z])/g, " $1").trim()}:
                          </div>
                          {change.details && change.details.length > 0 ? (
                            <div className="text-gray-700 ml-2 space-y-1">
                              {change.details.map(
                                (detail: string, idx: number) => (
                                  <div key={idx} className="text-sm">
                                    • {detail}
                                  </div>
                                ),
                              )}
                            </div>
                          ) : change.field === "deductions" ||
                            change.field === "incentives" ? (
                            <div className="text-gray-700 ml-2 space-y-1 text-sm">
                              <div>
                                Old:{" "}
                                {Array.isArray(change.oldValue)
                                  ? change.oldValue.length
                                  : 0}{" "}
                                items
                              </div>
                              <div>
                                New:{" "}
                                {Array.isArray(change.newValue)
                                  ? change.newValue.length
                                  : 0}{" "}
                                items
                              </div>
                            </div>
                          ) : (
                            <div className="text-gray-700 ml-2 space-y-1 text-sm">
                              <div>
                                Old: ₱
                                {(change.oldValue || 0).toLocaleString(
                                  "en-US",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  },
                                )}
                              </div>
                              <div>
                                New: ₱
                                {(change.newValue || 0).toLocaleString(
                                  "en-US",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  },
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
