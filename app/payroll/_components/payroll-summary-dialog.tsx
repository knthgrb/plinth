"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface PayrollSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryData: any;
  isLoadingSummary: boolean;
  selectedPayrollRun: any;
  isAdminOrAccounting: boolean;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onSaveDraft: () => Promise<void> | void;
  onFinalize: () => Promise<void> | void;
}

export function PayrollSummaryDialog({
  open,
  onOpenChange,
  summaryData,
  isLoadingSummary,
  selectedPayrollRun,
  isAdminOrAccounting,
  onExportExcel,
  onExportPDF,
  onSaveDraft,
  onFinalize,
}: PayrollSummaryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseIcon
        className="max-w-[95vw] max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            Payroll Summary - {selectedPayrollRun?.period}
          </DialogTitle>
          <DialogDescription>
            Detailed attendance summary for this payroll run
          </DialogDescription>
        </DialogHeader>
        {isLoadingSummary ? (
          <div className="py-8 text-center">Loading summary...</div>
        ) : summaryData ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onExportExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export to Excel
                </Button>
                <Button variant="outline" size="sm" onClick={onExportPDF}>
                  <Download className="h-4 w-4 mr-2" />
                  Export to PDF
                </Button>
              </div>
              {selectedPayrollRun?.status === "draft" &&
                isAdminOrAccounting && (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={onSaveDraft}>
                      Save as Draft
                    </Button>
                    <Button onClick={onFinalize}>Finalize Payroll</Button>
                  </div>
                )}
            </div>
            <div className="border rounded-lg overflow-x-auto w-full max-w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-white z-10 min-w-[200px]">
                      Employee
                    </TableHead>
                    {summaryData.dates.map((date: number) => (
                      <TableHead
                        key={date}
                        className="text-center min-w-[120px]"
                      >
                        {format(new Date(date), "MMM dd")}
                      </TableHead>
                    ))}
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Total Late (min)
                    </TableHead>
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Total Undertime (min)
                    </TableHead>
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Total Reg. OT (hrs)
                    </TableHead>
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Total Special OT (hrs)
                    </TableHead>
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Total Night Diff (hrs)
                    </TableHead>
                    <TableHead className="text-center bg-gray-50 font-semibold">
                      Absent Days
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryData.summary.map((empSummary: any) => {
                    return (
                      <TableRow key={empSummary.employee._id}>
                        <TableCell className="sticky left-0 bg-white z-10 font-medium">
                          {empSummary.employee.personalInfo.firstName}{" "}
                          {empSummary.employee.personalInfo.lastName}
                        </TableCell>
                        {summaryData.dates.map((date: number) => {
                          const dayData = empSummary.dailyData.find(
                            (d: any) => d.date === date
                          );
                          const dayNote = dayData?.note;
                          if (!dayData) {
                            return (
                              <TableCell key={date} className="text-center">
                                -
                              </TableCell>
                            );
                          }

                          // If there's a note, make the whole cell the popover trigger
                          if (dayNote) {
                            return (
                              <TableCell
                                key={date}
                                className="relative text-center text-xs cursor-pointer hover:bg-gray-50"
                              >
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <div className="relative w-full h-full py-1">
                                      {dayData.status === "absent" ? (
                                        <div className="text-red-600 font-medium">
                                          ABSENT
                                        </div>
                                      ) : dayData.status === "leave" ? (
                                        <div className="text-blue-600">
                                          LEAVE
                                        </div>
                                      ) : (
                                        <div>
                                          {dayData.timeIn || dayData.timeOut ? (
                                            <div className="space-y-1">
                                              {dayData.timeIn &&
                                              dayData.timeOut ? (
                                                <div>
                                                  {dayData.timeIn} -{" "}
                                                  {dayData.timeOut}
                                                </div>
                                              ) : dayData.timeIn ? (
                                                <div>{dayData.timeIn} -</div>
                                              ) : (
                                                <div>- {dayData.timeOut}</div>
                                              )}
                                              {dayData.lateMinutes > 0 && (
                                                <div className="text-red-600 font-medium text-xs">
                                                  {dayData.lateMinutes} MIN L
                                                </div>
                                              )}
                                              {(dayData.regularOTHours > 0 ||
                                                dayData.specialOTHours > 0) && (
                                                <div className="text-green-600 text-xs">
                                                  {dayData.regularOTHours > 0 &&
                                                    `${dayData.regularOTHours.toFixed(1)}H OT`}
                                                  {dayData.specialOTHours > 0 &&
                                                    ` ${dayData.specialOTHours.toFixed(1)}H SOT`}
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <div>-</div>
                                          )}
                                        </div>
                                      )}
                                      {/* Purple corner indicator */}
                                      <span className="pointer-events-none absolute top-0 right-0 w-0 h-0 border-t-8 border-r-8 border-t-purple-500 border-r-transparent" />
                                    </div>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    align="end"
                                    className="max-w-xs text-xs whitespace-pre-wrap"
                                  >
                                    {dayNote}
                                  </PopoverContent>
                                </Popover>
                              </TableCell>
                            );
                          }

                          // No note: plain non-interactive cell
                          return (
                            <TableCell
                              key={date}
                              className="relative text-center text-xs"
                            >
                              {dayData.status === "absent" ? (
                                <div className="text-red-600 font-medium">
                                  ABSENT
                                </div>
                              ) : dayData.status === "leave" ? (
                                <div className="text-blue-600">LEAVE</div>
                              ) : (
                                <div>
                                  {dayData.timeIn || dayData.timeOut ? (
                                    <div className="space-y-1">
                                      {dayData.timeIn && dayData.timeOut ? (
                                        <div>
                                          {dayData.timeIn} - {dayData.timeOut}
                                        </div>
                                      ) : dayData.timeIn ? (
                                        <div>{dayData.timeIn} -</div>
                                      ) : (
                                        <div>- {dayData.timeOut}</div>
                                      )}
                                      {dayData.lateMinutes > 0 && (
                                        <div className="text-red-600 font-medium text-xs">
                                          {dayData.lateMinutes} MIN L
                                        </div>
                                      )}
                                      {(dayData.regularOTHours > 0 ||
                                        dayData.specialOTHours > 0) && (
                                        <div className="text-green-600 text-xs">
                                          {dayData.regularOTHours > 0 &&
                                            `${dayData.regularOTHours.toFixed(1)}H OT`}
                                          {dayData.specialOTHours > 0 &&
                                            ` ${dayData.specialOTHours.toFixed(1)}H SOT`}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div>-</div>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className={`text-center font-medium ${
                            empSummary.totals.totalLateMinutes > 0
                              ? "text-red-600"
                              : ""
                          }`}
                        >
                          {empSummary.totals.totalLateMinutes}
                        </TableCell>
                        <TableCell className="text-center">
                          {empSummary.totals.totalUndertimeMinutes}
                        </TableCell>
                        <TableCell className="text-center">
                          {empSummary.totals.totalRegularOTHours.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          {empSummary.totals.totalSpecialOTHours.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          {empSummary.totals.totalNightDiffHours.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          {empSummary.totals.totalAbsentDays}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
