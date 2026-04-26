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
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { format } from "date-fns";
import { PayslipDetail } from "@/components/payslip-detail";

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
}

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
}: ViewPayslipsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payslips - {selectedPayrollRun?.period}</DialogTitle>
          <DialogDescription>
            View payslips for this payroll run
          </DialogDescription>
        </DialogHeader>
        {isLoadingPayslips ? (
          <div className="py-8 text-center">Loading payslips...</div>
        ) : (
          <div className="space-y-4">
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
