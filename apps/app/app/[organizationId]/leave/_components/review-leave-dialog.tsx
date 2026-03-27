"use client";

import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Download, Loader2, Save, X, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { approveLeaveRequest, rejectLeaveRequest } from "@/actions/leave";
import { createDocument } from "@/actions/documents";
import { generateUploadUrl } from "@/actions/files";
import { TiptapViewer } from "@/components/tiptap-viewer";
import { SignaturePad } from "@/components/signature-pad";
import {
  downloadElementAsPdf,
  getElementPdfBlob,
} from "@/components/leave/leave-request-pdf";

type LeaveRequestRecord = {
  _id: string;
  employeeId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  leaveType: string;
  customLeaveType?: string;
  startDate: number;
  endDate: number;
  numberOfDays: number;
  reason: string;
  remarks?: string;
  filledFormContent?: string;
  signatureDataUrl?: string;
};

type EmployeeSummary = {
  _id: string;
  personalInfo: {
    firstName: string;
    lastName: string;
  };
};

interface ReviewLeaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  request: LeaveRequestRecord | null;
  employees?: EmployeeSummary[];
  onSuccess?: () => void;
}

export function ReviewLeaveDialog({
  isOpen,
  onOpenChange,
  organizationId,
  request,
  employees,
  onSuccess,
}: ReviewLeaveDialogProps) {
  const { toast } = useToast();
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isSavingToDocuments, setIsSavingToDocuments] = useState(false);
  const [approverSignatureDataUrl, setApproverSignatureDataUrl] = useState("");
  const pdfContentRef = useRef<HTMLDivElement | null>(null);

  const approvalInfo = useQuery(
    (api as any).leave.getLeaveRequestApprovalInfo,
    request?.status === "pending" && request?._id
      ? { leaveRequestId: request._id }
      : "skip",
  );
  const canApprove = approvalInfo?.canApprove !== false;
  const blockReason = approvalInfo?.blockReason;

  const handleApprove = async () => {
    if (!request) return;
    try {
      await approveLeaveRequest(request._id, reviewRemarks);
      onOpenChange(false);
      setReviewRemarks("");
      toast({
        title: "Success",
        description: "Leave request approved successfully",
      });
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to approve leave request",
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    if (!request) return;
    if (!reviewRemarks.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason for rejection",
        variant: "destructive",
      });
      return;
    }
    try {
      await rejectLeaveRequest(request._id, reviewRemarks);
      onOpenChange(false);
      setReviewRemarks("");
      toast({
        title: "Success",
        description: "Leave request rejected",
      });
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to reject leave request",
        variant: "destructive",
      });
    }
  };

  if (!request) return null;

  const employee = employees?.find((e) => e._id === request.employeeId);
  const employeeName = employee
    ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`
    : "Unknown Employee";

  const handleDownloadPdf = async () => {
    if (!pdfContentRef.current) return;

    setIsDownloadingPdf(true);
    try {
      const safeEmployeeName = employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const start = format(new Date(request.startDate), "yyyy-MM-dd");
      await downloadElementAsPdf(
        pdfContentRef.current,
        `leave-request-${safeEmployeeName || "employee"}-${start}.pdf`,
      );
    } catch (error: unknown) {
      toast({
        title: "PDF download failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSaveToDocuments = async () => {
    if (!pdfContentRef.current || !organizationId) return;

    setIsSavingToDocuments(true);
    try {
      const safeEmployeeName = employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const start = format(new Date(request.startDate), "yyyy-MM-dd");
      const fileName = `leave-request-${safeEmployeeName || "employee"}-${start}.pdf`;
      const pdfBlob = await getElementPdfBlob(pdfContentRef.current);
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: new File([pdfBlob], fileName, { type: "application/pdf" }),
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload PDF");
      }

      const responseText = await uploadResponse.text();
      let storageId: string;
      try {
        const jsonResponse = JSON.parse(responseText);
        storageId = jsonResponse.storageId || jsonResponse;
      } catch {
        storageId = responseText;
      }

      storageId = storageId.trim().replace(/^["']|["']$/g, "");

      await createDocument({
        organizationId,
        employeeId: request.employeeId,
        title: `Leave Request - ${employeeName} - ${format(
          new Date(request.startDate),
          "MMM dd, yyyy",
        )}`,
        content:
          request.filledFormContent ??
          JSON.stringify({ type: "doc", content: [] }),
        type: "leave_form",
        category: "Leave Form",
        attachments: [storageId],
      });

      toast({
        title: "Saved to Documents",
        description: "The leave form PDF is now available in Documents.",
      });
    } catch (error: unknown) {
      toast({
        title: "Save failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingToDocuments(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <div className="fixed left-[-9999px] top-0 z-[-1]">
          <div
            ref={pdfContentRef}
            className="w-[794px] bg-white p-8 text-black"
          >
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold">Leave Request</h1>
                <p className="mt-1 text-sm text-gray-600">
                  Exported submission record
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium">Employee</p>
                  <p>{employeeName}</p>
                </div>
                <div>
                  <p className="font-medium">Status</p>
                  <p className="capitalize">{request.status}</p>
                </div>
                <div>
                  <p className="font-medium">Leave Type</p>
                  <p>{request.customLeaveType || request.leaveType}</p>
                </div>
                <div>
                  <p className="font-medium">Requested Days</p>
                  <p>{request.numberOfDays}</p>
                </div>
                <div>
                  <p className="font-medium">Start Date</p>
                  <p>{format(new Date(request.startDate), "MMM dd, yyyy")}</p>
                </div>
                <div>
                  <p className="font-medium">End Date</p>
                  <p>{format(new Date(request.endDate), "MMM dd, yyyy")}</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Reason</p>
                <div className="rounded border border-[rgb(230,230,230)] bg-white p-4 text-sm">
                  {request.reason}
                </div>
              </div>

              {request.filledFormContent && (
                <div>
                  <p className="mb-2 text-sm font-medium">Submitted form</p>
                  <div className="rounded border border-[rgb(230,230,230)] bg-white">
                    <TiptapViewer content={request.filledFormContent} />
                  </div>
                </div>
              )}

              {request.signatureDataUrl && (
                <div>
                  <p className="mb-2 text-sm font-medium">Employee signature</p>
                  <div className="rounded border border-[rgb(230,230,230)] bg-white p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={request.signatureDataUrl}
                      alt="Employee signature"
                      className="h-24 w-auto max-w-full object-contain"
                    />
                  </div>
                </div>
              )}
              {approverSignatureDataUrl && (
                <div>
                  <p className="mb-2 text-sm font-medium">Reviewer signature</p>
                  <div className="rounded border border-[rgb(230,230,230)] bg-white p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={approverSignatureDataUrl}
                      alt="Reviewer signature"
                      className="h-24 w-auto max-w-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogHeader>
          <DialogTitle>
            {request.status === "pending"
              ? "Review Leave Request"
              : "Leave Request Details"}
          </DialogTitle>
          <DialogDescription>
            <div className="space-y-2 mt-2">
              <p>
                <strong>Employee:</strong>{" "}
                {employeeName}
              </p>
              <p>
                <strong>Leave Type:</strong>{" "}
                {request.customLeaveType || request.leaveType}
              </p>
              <p>
                <strong>Period:</strong>{" "}
                {format(new Date(request.startDate), "MMM dd, yyyy")} -{" "}
                {format(new Date(request.endDate), "MMM dd, yyyy")}
              </p>
              <p>
                <strong>Days:</strong> {request.numberOfDays}
              </p>
              <p>
                <strong>Reason:</strong> {request.reason}
              </p>
              {request.status !== "pending" && request.remarks && (
                <p>
                  <strong>Review notes:</strong> {request.remarks}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        {request.filledFormContent && (
          <div className="space-y-3">
            <Label>Submitted form</Label>
            <div className="overflow-hidden rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
              <TiptapViewer content={request.filledFormContent} />
            </div>
            {request.signatureDataUrl && (
              <div className="rounded-lg border border-[rgb(230,230,230)] bg-white p-4">
                <p className="mb-2 text-sm font-medium text-[rgb(64,64,64)]">
                  Employee signature
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={request.signatureDataUrl}
                  alt="Employee signature"
                  className="h-24 w-auto max-w-full object-contain"
                />
              </div>
            )}
          </div>
        )}
        {request.status === "pending" && (
          <div className="space-y-4 py-4">
            {blockReason && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  {blockReason} You can reject the request and add a reason for the employee.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea
                id="remarks"
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder={canApprove ? "Optional remarks (required for rejection)" : "Reason for rejection (required when rejecting)"}
              />
            </div>
            <div className="space-y-2">
              <Label>Reviewer signature</Label>
              <SignaturePad
                value={approverSignatureDataUrl}
                onChange={setApproverSignatureDataUrl}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {request.filledFormContent && (
            <Button
              variant="outline"
              onClick={handleSaveToDocuments}
              disabled={isSavingToDocuments}
            >
              {isSavingToDocuments ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save to Documents
            </Button>
          )}
          {request.filledFormContent && (
            <Button
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
            >
              {isDownloadingPdf ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download PDF
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setReviewRemarks("");
            }}
          >
            Cancel
          </Button>
          {request.status === "pending" && (
            <>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={!reviewRemarks.trim()}
              >
                <X className="mr-2 h-4 w-4" />
                Reject
              </Button>
              <Button onClick={handleApprove}>
                <Check className="mr-2 h-4 w-4" />
                Approve
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
