"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  CalendarX2,
  CheckCircle2,
  CircleDot,
  Clock3,
  XCircle,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  getEmployeeRequestAction,
  type EmployeeLeaveRequestStatus,
} from "@/lib/leave/employee-workspace";

export interface EmployeeLeaveTimelineRequest {
  id: string;
  policyLabel: string;
  status: EmployeeLeaveRequestStatus;
  startDate: number;
  endDate: number;
  filedDate: number;
  chargeableDuration?: number;
  reason?: string;
  payTreatment?: string;
  decisionReason?: string;
  reviewedAt?: number;
  cancellationReason?: string;
  isLocked?: boolean;
}

function statusLabel(status: EmployeeLeaveRequestStatus): string {
  return status.replaceAll("_", " ");
}

function statusIcon(status: EmployeeLeaveRequestStatus) {
  if (status === "approved") return CheckCircle2;
  if (status === "rejected" || status === "cancelled") return XCircle;
  if (status === "cancellation_requested") return CalendarX2;
  if (status === "pending") return Clock3;
  return CircleDot;
}

function dateRange(request: EmployeeLeaveTimelineRequest): string {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  const start = formatter.format(request.startDate);
  const end = formatter.format(request.endDate);
  return start === end ? start : `${start} – ${end}`;
}

export function LeaveRequestTimeline(props: {
  organizationId: Id<"organizations">;
  requests: readonly EmployeeLeaveTimelineRequest[];
}) {
  const { toast } = useToast();
  const withdraw = useMutation(api.leave.withdrawPendingLeaveRequest);
  const requestCancellation = useMutation(
    api.leave.requestApprovedLeaveCancellation,
  );
  const [selected, setSelected] = useState<EmployeeLeaveTimelineRequest | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedAction = selected
    ? getEmployeeRequestAction(selected, Date.now())
    : "read_only";

  const closeAction = () => {
    setSelected(null);
    setReason("");
  };

  const confirmAction = async () => {
    if (!selected || selectedAction === "read_only") return;
    if (selectedAction === "request_cancellation" && !reason.trim()) {
      toast({
        title: "Cancellation reason is required",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      if (selectedAction === "withdraw") {
        await withdraw({
          leaveRequestId: selected.id as Id<"leaveRequests">,
          reason: reason.trim() || undefined,
        });
        toast({ title: "Leave request withdrawn" });
      } else {
        await requestCancellation({
          leaveRequestId: selected.id as Id<"leaveRequests">,
          reason: reason.trim(),
        });
        toast({ title: "Cancellation request sent" });
      }
      closeAction();
    } catch (error: unknown) {
      toast({
        title: "Unable to update leave request",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (props.requests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">No leave requests yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Submitted requests and their decisions will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <ol className="space-y-1" aria-label="Leave request timeline">
        {props.requests.map((request, index) => {
          const Icon = statusIcon(request.status);
          const action = getEmployeeRequestAction(request, Date.now());
          return (
            <li key={request.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < props.requests.length - 1 ? (
                <span className="absolute bottom-0 left-[11px] top-7 w-px bg-border" />
              ) : null}
              <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
                <Icon className="h-3.5 w-3.5 text-brand-purple" />
              </span>
              <div className="min-w-0 flex-1 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{request.policyLabel}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dateRange(request)}
                      {request.chargeableDuration !== undefined
                        ? ` · ${request.chargeableDuration} day${request.chargeableDuration === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {statusLabel(request.status)}
                  </Badge>
                </div>
                {request.decisionReason ? (
                  <p className="mt-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                    Decision: {request.decisionReason}
                  </p>
                ) : null}
                {action !== "read_only" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSelected(request)}
                  >
                    {action === "withdraw"
                      ? "Withdraw"
                      : "Request cancellation"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedAction === "withdraw"
                ? "Withdraw leave request?"
                : "Request leave cancellation?"}
            </DialogTitle>
            <DialogDescription>
              {selectedAction === "withdraw"
                ? "The reserved balance will be released immediately."
                : "HR, Admin, or the Owner must confirm cancellation of approved leave."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              selectedAction === "withdraw"
                ? "Optional withdrawal note"
                : "Why should this approved leave be cancelled?"
            }
            aria-label="Request action reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeAction} disabled={isSaving}>
              Keep request
            </Button>
            <Button onClick={confirmAction} disabled={isSaving}>
              {isSaving ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
