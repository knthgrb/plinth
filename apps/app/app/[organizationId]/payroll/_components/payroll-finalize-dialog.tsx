"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  updatePayrollRunStatus,
  sendFinalizedPayrollPayslipEmails,
} from "@/actions/payroll";
import { payslipPdfPasswordDescription } from "@/lib/payslip-pdf-password";
import { useToast } from "@/components/ui/use-toast";

type PayrollFinalizeDialogProps = {
  open: boolean;
  payrollRunId: string | null;
  onClose: () => void;
  onFlowSuccess: () => Promise<void>;
  onFlowCancel: () => Promise<void>;
};

export function PayrollFinalizeDialog({
  open,
  payrollRunId,
  onClose,
  onFlowSuccess,
  onFlowCancel,
}: PayrollFinalizeDialogProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const data = useQuery(
    api.payroll.getPayrollFinalizePayslipRecipients,
    open && payrollRunId
      ? { payrollRunId: payrollRunId as Id<"payrollRuns"> }
      : "skip",
  );

  const closeFromUser = async () => {
    if (confirming) return;
    await onFlowCancel();
    onClose();
  };

  const handleConfirm = async () => {
    if (!payrollRunId || confirming) return;
    setConfirming(true);
    try {
      await updatePayrollRunStatus(payrollRunId, "finalized");
      const result = await sendFinalizedPayrollPayslipEmails(payrollRunId);
      const errTail =
        result.errors.length > 0
          ? ` Some sends failed: ${result.errors.slice(0, 3).join("; ")}${
              result.errors.length > 3 ? "…" : ""
            }`
          : "";
      toast({
        title: "Payroll finalized",
        description: `Emailed ${result.sent} payslip PDF(s). ${result.withoutAccountCount} employee(s) have no Plinth account and were skipped.${errTail}`,
        variant:
          result.errors.length > 0 && result.sent === 0
            ? "destructive"
            : "default",
      });
      await onFlowSuccess();
      onClose();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Could not finalize or send payslips";
      toast({
        title: "Finalize failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  const canFinalize = data?.runStatus === "draft";

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        hideCloseIcon
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Finalize payroll and email payslips</DialogTitle>
          <DialogDescription>
            PDFs are encrypted. Open password:{" "}
            {payslipPdfPasswordDescription()} Login passwords are never stored
            in readable form, so they cannot be used as the PDF password.
          </DialogDescription>
        </DialogHeader>

        {data === undefined && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading recipients…
          </div>
        )}

        {data && !canFinalize && (
          <p className="text-sm text-destructive">
            This payroll run is not in draft status; it cannot be finalized from
            here.
          </p>
        )}

        {data && canFinalize && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-emerald-800 dark:text-emerald-200">
                Will email PDF ({data.withAccount.length})
              </p>
              <p className="text-muted-foreground text-xs mb-1">
                Has a Plinth account in this organization (login email)
              </p>
              <ul className="max-h-32 overflow-y-auto rounded border border-border p-2 space-y-0.5">
                {data.withAccount.length === 0 && (
                  <li className="text-muted-foreground">None</li>
                )}
                {data.withAccount.map(
                  (row: {
                    employeeId: string;
                    name: string;
                    email: string;
                  }) => (
                    <li key={row.employeeId}>
                      {row.name}{" "}
                      <span className="text-muted-foreground">
                        ({row.email})
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                No Plinth account — skipped ({data.withoutAccount.length})
              </p>
              <ul className="max-h-32 overflow-y-auto rounded border border-border p-2 space-y-0.5">
                {data.withoutAccount.length === 0 && (
                  <li className="text-muted-foreground">None</li>
                )}
                {data.withoutAccount.map(
                  (row: {
                    employeeId: string;
                    name: string;
                    workEmail: string;
                  }) => (
                    <li key={row.employeeId}>
                      {row.name}
                      {row.workEmail ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — work: {row.workEmail}
                        </span>
                      ) : null}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => void closeFromUser()}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#695eff] hover:bg-[#5547e8] text-white"
            onClick={() => void handleConfirm()}
            disabled={confirming || !data || !canFinalize}
          >
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Finalizing…
              </>
            ) : (
              "Finalize and send emails"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
