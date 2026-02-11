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
import { Pencil } from "lucide-react";
import { format } from "date-fns";
import { PayslipDetail } from "@/components/payslip-detail";

interface ViewPayslipsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPayrollRun: any;
  payslips: any[];
  isLoadingPayslips: boolean;
  payslipConcerns: Record<string, any[]>;
  currentOrganization: any;
  isAdminOrAccounting: boolean;
  onEditPayslip: (payslip: any) => void;
}

export function ViewPayslipsDialog({
  open,
  onOpenChange,
  selectedPayrollRun,
  payslips,
  isLoadingPayslips,
  payslipConcerns,
  currentOrganization,
  isAdminOrAccounting,
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
              payslips.map((payslip: any, index: number) => (
                <div key={payslip._id} data-payslip-id={payslip._id}>
                  {index > 0 && (
                    <div className="my-6 border-t-2 border-purple-500"></div>
                  )}
                  <div className="space-y-4">
                    <PayslipDetail
                      payslip={payslip}
                      employee={payslip.employee}
                      organization={currentOrganization}
                      cutoffStart={selectedPayrollRun?.cutoffStart}
                      cutoffEnd={selectedPayrollRun?.cutoffEnd}
                    />
                    {payslipConcerns[payslip._id] &&
                      payslipConcerns[payslip._id].length > 0 && (
                        <Card className="bg-yellow-50 border-yellow-200">
                          <CardHeader>
                            <CardTitle className="text-sm text-yellow-900">
                              Employee Concerns/Comments
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              {payslipConcerns[payslip._id].map(
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
                                        "MMM dd, yyyy 'at' h:mm a"
                                      )}
                                    </div>
                                    <div className="text-gray-700 whitespace-pre-wrap">
                                      {message.content}
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    {(isAdminOrAccounting &&
                      selectedPayrollRun?.status === "draft") && (
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditPayslip(payslip)}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit Payslip
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))
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
