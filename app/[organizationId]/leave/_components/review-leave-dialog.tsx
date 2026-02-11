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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { approveLeaveRequest, rejectLeaveRequest } from "@/actions/leave";

interface ReviewLeaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  request: any | null;
  employees?: any[];
  onSuccess?: () => void;
}

export function ReviewLeaveDialog({
  isOpen,
  onOpenChange,
  request,
  employees,
  onSuccess,
}: ReviewLeaveDialogProps) {
  const { toast } = useToast();
  const [reviewRemarks, setReviewRemarks] = useState("");

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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to approve leave request",
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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reject leave request",
        variant: "destructive",
      });
    }
  };

  if (!request) return null;

  const employee = employees?.find((e: any) => e._id === request.employeeId);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
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
                {employee
                  ? `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`
                  : "Unknown"}
              </p>
              <p>
                <strong>Leave Type:</strong> {request.leaveType}
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
            </div>
          </DialogDescription>
        </DialogHeader>
        {request.status === "pending" && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea
                id="remarks"
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Add remarks (required for rejection)"
              />
            </div>
          </div>
        )}
        <DialogFooter>
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
