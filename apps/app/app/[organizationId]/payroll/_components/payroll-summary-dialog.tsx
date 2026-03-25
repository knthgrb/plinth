"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/utils";

interface PayrollSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryData: any;
  isLoadingSummary: boolean;
  selectedPayrollRun: any;
  isAdminOrAccounting: boolean;
  isSavingDraft?: boolean;
  isFinalizing?: boolean;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onSaveDraft: () => Promise<void> | void;
  onFinalize: () => Promise<void> | void;
}

const EMP_COL = "min-w-[11rem] w-[11rem] max-w-[11rem]";
const PAY_COL = "min-w-[5.5rem] w-[5.5rem]";

function DayAttendanceBlock({ dayData }: { dayData: any }) {
  if (dayData.status === "absent" || dayData.status === "leave_without_pay") {
    return (
      <div className="text-red-600 font-semibold">
        {dayData.status === "leave_without_pay" ? "LWOP" : "ABSENT"}
      </div>
    );
  }
  if (dayData.status === "leave" || dayData.status === "leave_with_pay") {
    return <div className="text-blue-600 font-medium">LEAVE</div>;
  }
  if (dayData.timeIn || dayData.timeOut) {
    return (
      <div className="space-y-0.5 leading-tight">
        <div className="text-[rgb(53,58,68)] tabular-nums">
          {dayData.timeIn && dayData.timeOut
            ? `${dayData.timeIn} – ${dayData.timeOut}`
            : dayData.timeIn
              ? `${dayData.timeIn} –`
              : `– ${dayData.timeOut}`}
        </div>
        {(dayData.lateMinutes > 0 || dayData.undertimeMinutes > 0) && (
          <div className="flex flex-col gap-0.5 items-center">
            {dayData.lateMinutes > 0 && (
              <span className="text-red-600 font-medium">
                {dayData.lateMinutes} min late
              </span>
            )}
            {dayData.undertimeMinutes > 0 && (
              <span className="text-red-700 font-medium">
                {dayData.undertimeMinutes} min UT
              </span>
            )}
          </div>
        )}
        {(dayData.regularOTHours > 0 || dayData.specialOTHours > 0) && (
          <div className="text-emerald-700 text-[10px] font-medium">
            {dayData.regularOTHours > 0 &&
              `${dayData.regularOTHours.toFixed(1)}h OT`}
            {dayData.regularOTHours > 0 && dayData.specialOTHours > 0
              ? " · "
              : ""}
            {dayData.specialOTHours > 0 &&
              `${dayData.specialOTHours.toFixed(1)}h SOT`}
          </div>
        )}
      </div>
    );
  }
  if (
    dayData.lateMinutes > 0 ||
    dayData.undertimeMinutes > 0 ||
    dayData.regularOTHours > 0 ||
    dayData.specialOTHours > 0
  ) {
    return (
      <div className="flex flex-col gap-0.5 items-center leading-tight">
        {dayData.lateMinutes > 0 && (
          <span className="text-red-600 font-medium text-[10px]">
            {dayData.lateMinutes} min late
          </span>
        )}
        {dayData.undertimeMinutes > 0 && (
          <span className="text-red-700 font-medium text-[10px]">
            {dayData.undertimeMinutes} min UT
          </span>
        )}
        {(dayData.regularOTHours > 0 || dayData.specialOTHours > 0) && (
          <div className="text-emerald-700 text-[10px] font-medium">
            {dayData.regularOTHours > 0 &&
              `${dayData.regularOTHours.toFixed(1)}h OT`}
            {dayData.regularOTHours > 0 && dayData.specialOTHours > 0
              ? " · "
              : ""}
            {dayData.specialOTHours > 0 &&
              `${dayData.specialOTHours.toFixed(1)}h SOT`}
          </div>
        )}
      </div>
    );
  }
  return <span className="text-[rgb(160,160,160)]">–</span>;
}

export function PayrollSummaryDialog({
  open,
  onOpenChange,
  summaryData,
  isLoadingSummary,
  selectedPayrollRun,
  isAdminOrAccounting,
  isSavingDraft = false,
  isFinalizing = false,
  onExportExcel,
  onExportPDF,
  onSaveDraft,
  onFinalize,
}: PayrollSummaryDialogProps) {
  const formatCurrency = (amount: number) =>
    `P${amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const thBase =
    "h-9 px-2.5 text-left align-middle text-[11px] font-semibold text-[rgb(64,64,64)] border-b border-[rgb(230,230,230)]";
  const tdBase =
    "px-2.5 py-2 align-middle text-[11px] border-b border-[rgb(240,240,240)]";
  const thSticky =
    "sticky z-20 bg-[rgb(246,246,247)] shadow-[1px_0_0_rgb(230,230,230)]";
  const tdSticky = "sticky z-10 bg-white shadow-[1px_0_0_rgb(230,230,230)]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseIcon
        className={cn(
          "flex h-[min(88vh,820px)] max-h-[90vh] w-[min(96vw,1400px)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0",
          "border-[rgb(230,230,230)] sm:rounded-xl",
        )}
      >
        <div className="shrink-0 border-b border-[rgb(230,230,230)] px-5 pt-5 pb-4">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-lg font-semibold text-[rgb(35,35,35)]">
              Payroll run summary
              {selectedPayrollRun?.cutoffStart != null &&
              selectedPayrollRun?.cutoffEnd != null
                ? ` · ${format(new Date(selectedPayrollRun.cutoffStart), "MMM d")} – ${format(new Date(selectedPayrollRun.cutoffEnd), "MMM d, yyyy")}`
                : selectedPayrollRun?.period
                  ? ` · ${selectedPayrollRun.period}`
                  : null}
            </DialogTitle>
            <DialogDescription className="text-xs text-[rgb(115,115,115)] leading-relaxed">
              Attendance by day (late and undertime shown per date). Daily pay is
              the rate from compensation settings for this period.
            </DialogDescription>
          </DialogHeader>
        </div>

        {isLoadingSummary ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-[rgb(115,115,115)]">
            Loading summary…
          </div>
        ) : summaryData ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[rgb(230,230,230)] bg-[rgb(252,252,252)] px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onExportExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={onExportPDF}>
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </div>
              {selectedPayrollRun?.status === "draft" &&
                isAdminOrAccounting && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onSaveDraft}
                      disabled={isSavingDraft || isFinalizing}
                    >
                      {isSavingDraft ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Save as draft"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[#695eff] hover:bg-[#5547e8] text-white"
                      onClick={onFinalize}
                      disabled={isSavingDraft || isFinalizing}
                    >
                      {isFinalizing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Finalizing…
                        </>
                      ) : (
                        "Finalize payroll"
                      )}
                    </Button>
                  </div>
                )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4">
              {/* Single scroll container: wide table only (no nested Table overflow) */}
              <section className="flex min-h-0 flex-[1.15] flex-col rounded-lg border border-[rgb(230,230,230)] bg-white shadow-sm">
                <div className="shrink-0 border-b border-[rgb(230,230,230)] px-3 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[rgb(100,100,100)]">
                    Attendance
                  </h3>
                </div>
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                  <table className="w-max min-w-full border-collapse">
                    <thead
                      className={cn(
                        "sticky top-0 z-30",
                        "bg-[rgb(246,246,247)] shadow-[inset_0_-1px_0_rgb(230,230,230)]",
                      )}
                    >
                      <tr>
                        <th
                          className={cn(
                            thBase,
                            thSticky,
                            "left-0 z-40",
                            EMP_COL,
                          )}
                        >
                          Employee
                        </th>
                        <th
                          className={cn(
                            thBase,
                            thSticky,
                            "left-[11rem] z-40 text-right",
                            PAY_COL,
                          )}
                        >
                          Daily pay
                        </th>
                        {summaryData.dates.map((date: number) => (
                          <th
                            key={date}
                            className={cn(
                              thBase,
                              "min-w-[104px] text-center whitespace-nowrap",
                            )}
                          >
                            {format(new Date(date), "EEE MMM d")}
                          </th>
                        ))}
                        <th
                          className={cn(
                            thBase,
                            "min-w-[4.5rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          Late
                          <br />
                          <span className="font-normal opacity-80">(min)</span>
                        </th>
                        <th
                          className={cn(
                            thBase,
                            "min-w-[4.5rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          UT
                          <br />
                          <span className="font-normal opacity-80">(min)</span>
                        </th>
                        <th
                          className={cn(
                            thBase,
                            "min-w-[3.5rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          Reg. OT
                        </th>
                        <th
                          className={cn(
                            thBase,
                            "min-w-[3.5rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          Sp. OT
                        </th>
                        <th
                          className={cn(
                            thBase,
                            "min-w-[3.5rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          Night
                        </th>
                        <th
                          className={cn(
                            thBase,
                            "min-w-[3.25rem] text-center bg-[rgb(250,250,251)]",
                          )}
                        >
                          Abs.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryData.summary.map((empSummary: any) => (
                        <tr
                          key={empSummary.employee._id}
                          className="hover:bg-[rgb(252,252,254)]"
                        >
                          <td
                            className={cn(
                              tdBase,
                              tdSticky,
                              "left-0 font-medium text-[rgb(45,45,45)]",
                              EMP_COL,
                            )}
                          >
                            {empSummary.employee.personalInfo.firstName}{" "}
                            {empSummary.employee.personalInfo.lastName}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              tdSticky,
                              "left-[11rem] text-right tabular-nums text-[rgb(53,58,68)]",
                              PAY_COL,
                            )}
                          >
                            {formatCurrency(empSummary.dailyPayRate ?? 0)}
                          </td>
                          {summaryData.dates.map((date: number) => {
                            const dayData = empSummary.dailyData.find(
                              (d: any) => d.date === date,
                            );
                            const dayNote = dayData?.note;
                            if (!dayData) {
                              return (
                                <td
                                  key={date}
                                  className={cn(
                                    tdBase,
                                    "text-center text-[rgb(180,180,180)]",
                                  )}
                                >
                                  –
                                </td>
                              );
                            }
                            const block = <DayAttendanceBlock dayData={dayData} />;
                            if (dayNote) {
                              return (
                                <td
                                  key={date}
                                  className={cn(
                                    tdBase,
                                    "relative text-center cursor-pointer hover:bg-[rgb(248,248,250)]",
                                  )}
                                >
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <div className="relative w-full py-0.5">
                                        {block}
                                        <span
                                          className="pointer-events-none absolute top-0.5 right-0.5 h-2 w-2 rounded-sm bg-[#695eff]"
                                          aria-hidden
                                        />
                                      </div>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      side="top"
                                      align="center"
                                      className="max-w-xs text-xs whitespace-pre-wrap"
                                    >
                                      {dayNote}
                                    </PopoverContent>
                                  </Popover>
                                </td>
                              );
                            }
                            return (
                              <td
                                key={date}
                                className={cn(tdBase, "text-center")}
                              >
                                {block}
                              </td>
                            );
                          })}
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums font-medium",
                              empSummary.totals.totalLateMinutes > 0
                                ? "text-red-600"
                                : "text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalLateMinutes}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums font-medium",
                              empSummary.totals.totalUndertimeMinutes > 0
                                ? "text-red-700"
                                : "text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalUndertimeMinutes}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalRegularOTHours.toFixed(2)}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalSpecialOTHours.toFixed(2)}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalNightDiffHours.toFixed(2)}
                          </td>
                          <td
                            className={cn(
                              tdBase,
                              "text-center tabular-nums text-[rgb(80,80,80)]",
                            )}
                          >
                            {empSummary.totals.totalAbsentDays}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5 min-h-0 max-h-[40vh] overflow-y-auto overflow-x-hidden pb-1">
                <section className="rounded-lg border border-[rgb(230,230,230)] bg-white shadow-sm overflow-hidden flex flex-col min-h-0">
                  <div className="shrink-0 border-b border-[rgb(230,230,230)] px-3 py-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[rgb(100,100,100)]">
                      Earnings
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead className="bg-[rgb(246,246,247)]">
                        <tr className="border-b border-[rgb(230,230,230)]">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[rgb(64,64,64)]">
                            Employee
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Daily pay
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Gross
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Allowance
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Net pay
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.summary.map((empSummary: any) => (
                          <tr
                            key={`${empSummary.employee._id}-pay`}
                            className="border-b border-[rgb(240,240,240)] last:border-0"
                          >
                            <td className="px-3 py-2 font-medium text-[rgb(45,45,45)]">
                              {empSummary.employee.personalInfo.firstName}{" "}
                              {empSummary.employee.personalInfo.lastName}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(empSummary.dailyPayRate ?? 0)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(
                                empSummary.payslipBreakdown?.grossPay ?? 0,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[rgb(90,90,90)]">
                              {formatCurrency(
                                empSummary.payslipBreakdown
                                  ?.nonTaxableAllowance ?? 0,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {formatCurrency(
                                empSummary.payslipBreakdown?.netPay ?? 0,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-lg border border-[rgb(230,230,230)] bg-white shadow-sm overflow-hidden flex flex-col min-h-0">
                  <div className="shrink-0 border-b border-[rgb(230,230,230)] px-3 py-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[rgb(100,100,100)]">
                      Contributions
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead className="bg-[rgb(246,246,247)]">
                        <tr className="border-b border-[rgb(230,230,230)]">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[rgb(64,64,64)]">
                            Employee
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Daily pay
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Employee
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Company
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-[rgb(64,64,64)]">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.summary.map((empSummary: any) => (
                          <tr
                            key={`${empSummary.employee._id}-contrib`}
                            className="border-b border-[rgb(240,240,240)] last:border-0"
                          >
                            <td className="px-3 py-2 font-medium text-[rgb(45,45,45)]">
                              <div>
                                {empSummary.employee.personalInfo.firstName}{" "}
                                {empSummary.employee.personalInfo.lastName}
                              </div>
                              <div className="mt-1 text-[10px] font-normal leading-snug text-[rgb(130,130,130)]">
                                SSS{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.employeeContributions?.sss ?? 0,
                                )}{" "}
                                /{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.companyContributions?.sss ?? 0,
                                )}
                                {" · "}
                                PhilHealth{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.employeeContributions?.philhealth ?? 0,
                                )}{" "}
                                /{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.companyContributions?.philhealth ?? 0,
                                )}
                                {" · "}
                                Pag-IBIG{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.employeeContributions?.pagibig ?? 0,
                                )}{" "}
                                /{" "}
                                {formatCurrency(
                                  empSummary.payslipBreakdown
                                    ?.companyContributions?.pagibig ?? 0,
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums align-top">
                              {formatCurrency(empSummary.dailyPayRate ?? 0)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums align-top">
                              {formatCurrency(
                                empSummary.payslipBreakdown
                                  ?.totalEmployeeContribution ?? 0,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums align-top">
                              {formatCurrency(
                                empSummary.payslipBreakdown
                                  ?.totalCompanyContribution ?? 0,
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums align-top">
                              {formatCurrency(
                                (empSummary.payslipBreakdown
                                  ?.totalEmployeeContribution ?? 0) +
                                  (empSummary.payslipBreakdown
                                    ?.totalCompanyContribution ?? 0),
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center py-12 text-sm text-[rgb(150,150,150)]">
            No summary data
          </div>
        )}

        <div className="shrink-0 border-t border-[rgb(230,230,230)] bg-[rgb(252,252,252)] px-5 py-3">
          <DialogFooter className="sm:justify-end gap-2 p-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
