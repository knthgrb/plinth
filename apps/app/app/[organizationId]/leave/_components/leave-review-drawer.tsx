"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CalendarDays,
  ExternalLink,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  getAdminLeaveReason,
  resolveAuthenticatedReviewer,
} from "@/lib/leave/admin-workspace";

export interface LeaveReviewSelection {
  requestId: Id<"leaveRequests">;
  employeeName: string;
  policyName: string;
  confidentiality: "standard" | "restricted";
  hasSensitiveAccess: boolean;
  status: "pending" | "cancellation_requested";
}

export function LeaveReviewDrawer(props: {
  selection: LeaveReviewSelection | null;
  onOpenChange: (open: boolean) => void;
  reviewer: { displayName: string; role: "owner" | "admin" | "hr" };
  signatureRequired?: boolean;
}) {
  const { toast } = useToast();
  const context = useQuery(
    api.leave.getLeaveReviewContext,
    props.selection ? { leaveRequestId: props.selection.requestId } : "skip",
  );
  const approve = useMutation(api.leave.approveLeaveRequestV2);
  const reject = useMutation(api.leave.rejectLeaveRequestV2);
  const approveCancellation = useMutation(api.leave.approveLeaveCancellation);
  const [decisionReason, setDecisionReason] = useState("");
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string>();
  const reviewer = resolveAuthenticatedReviewer(props.reviewer);

  const close = () => {
    setDecisionReason("");
    setSignatureConfirmed(false);
    setConflictMessage(undefined);
    props.onOpenChange(false);
  };

  const decide = async (decision: "approve" | "reject") => {
    if (!props.selection) return;
    if (decision === "reject" && !decisionReason.trim()) {
      toast({ title: "Decision reason is required", variant: "destructive" });
      return;
    }
    if (props.signatureRequired && !signatureConfirmed) {
      toast({
        title: "Reviewer signature confirmation is required",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    setConflictMessage(undefined);
    try {
      if (props.selection.status === "cancellation_requested") {
        if (!decisionReason.trim()) {
          throw new Error("Cancellation decision reason is required");
        }
        await approveCancellation({
          leaveRequestId: props.selection.requestId,
          reason: decisionReason.trim(),
        });
        toast({ title: "Leave cancellation approved" });
      } else if (decision === "approve") {
        await approve({
          leaveRequestId: props.selection.requestId,
          decisionReason: decisionReason.trim() || undefined,
        });
        toast({ title: "Leave request approved" });
      } else {
        await reject({
          leaveRequestId: props.selection.requestId,
          decisionReason: decisionReason.trim(),
        });
        toast({ title: "Leave request rejected" });
      }
      close();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      if (
        message.toLowerCase().includes("conflict") ||
        message.toLowerCase().includes("overlap")
      ) {
        setConflictMessage(message);
      }
      toast({
        title: "Unable to complete review",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const request = context?.request;
  const reason =
    request && props.selection
      ? getAdminLeaveReason({
          reason: request.reason,
          confidentiality: props.selection.confidentiality,
          hasSensitiveAccess: props.selection.hasSensitiveAccess,
        })
      : "Loading request details…";

  return (
    <Sheet open={props.selection !== null} onOpenChange={props.onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader className="border-b pb-4 pr-8">
          <SheetTitle>Review leave request</SheetTitle>
          <SheetDescription>
            Final decision by {reviewer.displayName} · {reviewer.position}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto py-6 pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Employee</p>
              <p className="mt-1 font-medium">
                {props.selection?.employeeName}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Policy</p>
              <p className="mt-1 font-medium">
                {props.selection?.confidentiality === "restricted"
                  ? "Protected leave"
                  : props.selection?.policyName}
              </p>
            </div>
          </div>

          {request ? (
            <>
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CalendarDays className="h-4 w-4 text-brand-purple" /> Request
                  details
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Duration</dt>
                    <dd>
                      {request.chargeableDuration ?? request.numberOfDays} days
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pay treatment</dt>
                    <dd className="capitalize">
                      {request.payTreatment?.replaceAll("_", " ") ??
                        (request.isPaid ? "paid" : "unpaid")}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd>{reason}</dd>
                  </div>
                </dl>
              </div>

              {context.benefitEvent ? (
                <div className="rounded-xl border border-brand-purple/20 bg-brand-purple/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4 text-brand-purple" />
                      Qualifying event
                    </p>
                    <Badge variant="outline" className="capitalize">
                      {context.benefitEvent.verificationStatus}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Event</dt>
                      <dd className="capitalize">
                        {context.benefitEvent.eventType.replaceAll("_", " ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Variant</dt>
                      <dd className="capitalize">
                        {context.benefitEvent.benefitVariant?.replaceAll(
                          "_",
                          " ",
                        ) ?? "Standard entitlement"}
                      </dd>
                    </div>
                  </dl>
                  {context.benefitEvent.verificationStatus === "pending" ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Approving this request also records your verification of
                      the qualifying event and supporting evidence.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FileCheck2 className="h-4 w-4 text-brand-purple" />{" "}
                    Evidence
                  </p>
                  <Badge variant="secondary">
                    {context.supportingDocuments.length} file
                    {context.supportingDocuments.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {context.supportingDocuments.length > 0
                    ? "Review the private supporting evidence before making a decision."
                    : "No supporting document was submitted."}
                </p>
                {context.supportingDocuments.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {context.supportingDocuments.map((document) => (
                      <a
                        key={document.storageId}
                        href={document.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        aria-disabled={document.url === null}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                          document.url
                            ? "hover:border-brand-purple/50 hover:bg-brand-purple/5"
                            : "pointer-events-none opacity-60"
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          {document.fileName}
                        </span>
                        <ExternalLink className="h-4 w-4 shrink-0" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">
                  Balance and schedule check
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {context.balance
                    ? `${context.balance.available} days available · ${context.balance.reserved} days reserved`
                    : "This policy does not use a credit balance."}
                </p>
                <div className="mt-3 space-y-2">
                  {context.occurrences.map((occurrence) => (
                    <div
                      key={occurrence._id}
                      className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs"
                    >
                      <span>{occurrence.localDate}</span>
                      <span>{occurrence.leaveMinutes} leave minutes</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Loading review context…
            </p>
          )}

          {conflictMessage ? (
            <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {conflictMessage}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="leave-decision-reason">Decision reason</Label>
            <Textarea
              id="leave-decision-reason"
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder="Required for rejection and cancellation; optional for approval"
            />
          </div>
          {props.signatureRequired ? (
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <input
                type="checkbox"
                checked={signatureConfirmed}
                onChange={(event) =>
                  setSignatureConfirmed(event.target.checked)
                }
                className="mt-1"
              />
              <span>
                <span className="block font-medium">
                  Confirm reviewer signature
                </span>
                <span className="text-muted-foreground">
                  I confirm this final decision as {reviewer.displayName}.
                </span>
              </span>
            </label>
          ) : (
            <div className="flex gap-3 rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-brand-purple" />{" "}
              Reviewer identity is captured from the authenticated account.
            </div>
          )}
        </div>
        <SheetFooter className="gap-2 border-t pt-4 sm:space-x-0">
          <Button variant="outline" onClick={close} disabled={isSaving}>
            Close
          </Button>
          {props.selection?.status === "pending" ? (
            <Button
              variant="destructive"
              onClick={() => void decide("reject")}
              disabled={isSaving}
            >
              Reject
            </Button>
          ) : null}
          <Button
            onClick={() => void decide("approve")}
            disabled={isSaving || context === undefined}
          >
            {isSaving
              ? "Saving…"
              : props.selection?.status === "cancellation_requested"
                ? "Approve cancellation"
                : context?.benefitEvent?.verificationStatus === "pending"
                  ? "Verify event and approve"
                  : "Approve leave"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
