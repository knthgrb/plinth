"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface LeavePolicyImpactSummary {
  affectedBalanceCount: number;
  affectedRequestCount: number;
  warnings: string[];
}

export function LeavePolicyImpactDialog(props: {
  open: boolean;
  impact: LeavePolicyImpactSummary | undefined;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm effective-dated policy change</DialogTitle>
          <DialogDescription>
            Existing history stays unchanged. New requests and accruals use the
            new version from its effective date.
          </DialogDescription>
        </DialogHeader>
        {props.impact ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-muted-foreground">Balances in scope</p>
                <p className="text-lg font-semibold">
                  {props.impact.affectedBalanceCount}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Requests in scope</p>
                <p className="text-lg font-semibold">
                  {props.impact.affectedRequestCount}
                </p>
              </div>
            </div>
            {props.impact.warnings.map((warning) => (
              <p key={warning} className="flex gap-2 text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Calculating impact…</p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
          >
            Go back
          </Button>
          <Button
            type="button"
            disabled={!props.impact || props.isSaving}
            onClick={props.onConfirm}
          >
            {props.isSaving ? "Saving…" : "Create policy version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
