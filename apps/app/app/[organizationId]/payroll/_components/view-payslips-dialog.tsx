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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, ChevronDown, ChevronUp, Loader2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { PayslipDetail } from "@/components/payslip-detail";
import {
  formatManilaShortDate,
  formatManilaShortMonthDay,
} from "@/lib/manila-date";

interface ViewPayslipsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPayrollRun: any;
  payslips: any[];
  isLoadingPayslips: boolean;
  payslipDetailsById: Record<string, any>;
  loadingPayslipDetailsById: Record<string, boolean>;
  expandedPayslipId: string | null;
  payslipConcerns: Record<string, any[]>;
  currentOrganization: any;
  isAdminOrAccounting: boolean;
  onTogglePayslip: (payslip: any) => void;
  onEditPayslip: (payslip: any) => void;
  onMarkOverrideReviewComplete?: (payrollRun: any) => void | Promise<void>;
  markingOverrideReviewRunId?: string | null;
}

function formatOverrideReviewField(field: string): string {
  const labels: Record<string, string> = {
    deductions: "deductions",
    additions: "additions",
    non_taxable_allowance: "non-taxable allowance",
    variable_earnings: "holiday, night diff, rest day, or overtime earnings",
  };
  return labels[field] ?? field.replaceAll("_", " ");
}

type OverrideReviewEmployee = {
  employeeId: string;
  fields?: string[];
};

export function ViewPayslipsDialog({
  open,
  onOpenChange,
  selectedPayrollRun,
  payslips,
  isLoadingPayslips,
  payslipDetailsById,
  loadingPayslipDetailsById,
  expandedPayslipId,
  payslipConcerns,
  currentOrganization,
  isAdminOrAccounting,
  onTogglePayslip,
  onEditPayslip,
  onMarkOverrideReviewComplete,
  markingOverrideReviewRunId = null,
}: ViewPayslipsDialogProps) {
  const periodTitle =
    selectedPayrollRun?.cutoffStart != null && selectedPayrollRun?.cutoffEnd != null
      ? `${formatManilaShortMonthDay(selectedPayrollRun.cutoffStart)} to ${formatManilaShortDate(selectedPayrollRun.cutoffEnd)}`
      : selectedPayrollRun?.period;
  const overrideReview = selectedPayrollRun?.draftConfig?.overrideReview;
  const overrideReviewEmployees = Array.isArray(overrideReview?.employees)
    ? overrideReview.employees
    : [];
  const overrideReviewByEmployeeId = new Map<string, OverrideReviewEmployee>(
    overrideReviewEmployees.map((row: any) => [
      String(row.employeeId),
      {
        employeeId: String(row.employeeId),
        fields: Array.isArray(row.fields) ? row.fields : [],
      },
    ]),
  );
  const needsOverrideReview = overrideReview?.status === "needs_review";
  const isMarkingOverrideReview =
    markingOverrideReviewRunId === selectedPayrollRun?._id;

  const getReviewEmployeeName = (employeeId: string): string => {
    const row = payslips.find((p: any) => String(p.employeeId) === employeeId);
    const employee = row?.employee;
    const name =
      [employee?.personalInfo?.firstName, employee?.personalInfo?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
    return name || "Unknown employee";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payslips - {periodTitle}</DialogTitle>
          <DialogDescription>
            View payslips for this payroll run
          </DialogDescription>
        </DialogHeader>
        {isLoadingPayslips ? (
          <div className="py-8 text-center">Loading payslips...</div>
        ) : (
          <div className="space-y-4">
            {needsOverrideReview && (
              <div className="rounded-md border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="font-medium">
                      Auto reapplied manual overrides need review
                    </div>
                    <div className="text-orange-800">
                      These fields were reapplied after regeneration. Open the
                      affected payslips, confirm the amounts, then mark the
                      review complete before finalizing.
                    </div>
                    <ul className="max-h-32 space-y-1 overflow-y-auto">
                      {overrideReviewEmployees.map((row: any) => (
                        <li key={String(row.employeeId)}>
                          <span className="font-medium">
                            {getReviewEmployeeName(String(row.employeeId))}
                          </span>
                          :{" "}
                          {(row.fields ?? [])
                            .map(formatOverrideReviewField)
                            .join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {onMarkOverrideReviewComplete && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isMarkingOverrideReview}
                      onClick={() =>
                        void onMarkOverrideReviewComplete(selectedPayrollRun)
                      }
                    >
                      {isMarkingOverrideReview ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      )}
                      Mark reviewed
                    </Button>
                  )}
                </div>
              </div>
            )}
            {payslips.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                No payslips found for this payroll run
              </div>
            ) : (
              payslips.map((payslip: any) => {
                const detail = payslipDetailsById[payslip._id];
                const isExpanded = expandedPayslipId === payslip._id;
                const isLoadingDetail = loadingPayslipDetailsById[payslip._id];
                const employee = detail?.employee || payslip.employee;
                const concernSummary = payslip.concernSummary || {
                  messageCount: 0,
                };
                const concerns = payslipConcerns[payslip._id] || [];
                const overrideReviewEntry = overrideReviewByEmployeeId.get(
                  String(payslip.employeeId),
                );
                const employeeName =
                  [
                    employee?.personalInfo?.firstName,
                    employee?.personalInfo?.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .trim() || "Unknown employee";

                return (
                  <div key={payslip._id} data-payslip-id={payslip._id}>
                    <Card>
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="font-semibold">{employeeName}</div>
                            <div className="text-sm text-gray-500">
                              {employee?.employment?.employeeId ||
                                "No employee ID"}{" "}
                              ·{" "}
                              {employee?.employment?.position ||
                                "No designation"}
                            </div>
                            <div className="text-sm text-gray-500">
                              Net Pay: ₱
                              {(payslip.netPay || 0).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            {concernSummary.messageCount > 0 && (
                              <div className="text-sm text-yellow-700">
                                {concernSummary.messageCount} concern
                                {concernSummary.messageCount === 1 ? "" : "s"}
                                {concernSummary.lastMessageAt
                                  ? ` · Latest ${format(new Date(concernSummary.lastMessageAt), "MMM dd, yyyy h:mm a")}`
                                  : ""}
                              </div>
                            )}
                            {overrideReviewEntry && (
                              <div className="text-sm text-orange-700">
                                Auto reapplied:{" "}
                                {(overrideReviewEntry.fields ?? [])
                                  .map(formatOverrideReviewField)
                                  .join(", ")}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onTogglePayslip(payslip)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 mr-2" />
                            ) : (
                              <ChevronDown className="h-4 w-4 mr-2" />
                            )}
                            {isExpanded ? "Hide Details" : "View Details"}
                          </Button>
                        </div>

                        {isExpanded && isLoadingDetail && (
                          <div className="py-6 text-center text-sm text-gray-500">
                            Loading payslip details...
                          </div>
                        )}

                        {isExpanded && detail && (
                          <div className="space-y-4">
                            {isAdminOrAccounting &&
                              selectedPayrollRun?.status === "draft" && (
                                <div className="flex gap-2 justify-end">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onEditPayslip(detail)}
                                  >
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit Payslip
                                  </Button>
                                </div>
                              )}
                            <PayslipDetail
                              payslip={detail}
                              employee={employee}
                              organization={currentOrganization}
                              cutoffStart={selectedPayrollRun?.cutoffStart}
                              cutoffEnd={selectedPayrollRun?.cutoffEnd}
                            />
                            {concerns.length > 0 && (
                              <Card className="bg-yellow-50 border-yellow-200">
                                <CardHeader>
                                  <CardTitle className="text-sm text-yellow-900">
                                    Employee Concerns/Comments
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="space-y-3">
                                    {concerns.map(
                                      (message: any, msgIdx: number) => (
                                        <div
                                          key={msgIdx}
                                          className="text-sm space-y-1 border-l-2 border-yellow-400 pl-3"
                                        >
                                          <div className="font-medium text-yellow-900">
                                            {message.sender?.employeeInfo?.name ||
                                              message.sender?.name ||
                                              message.sender?.email ||
                                              "Unknown"}{" "}
                                            -{" "}
                                            {format(
                                              new Date(message.createdAt),
                                              "MMM dd, yyyy 'at' h:mm a",
                                            )}
                                          </div>
                                          <div className="text-gray-700 whitespace-pre-wrap">
                                            {message.content}
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
