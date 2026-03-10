"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { createLeaveRequest } from "@/actions/leave";
import { SignaturePad } from "@/components/signature-pad";
import { TiptapViewer } from "@/components/tiptap-viewer";
import {
  DEFAULT_LEAVE_REQUEST_TEMPLATE,
  fillLeaveRequestTemplate,
} from "@/components/leave/leave-request-template";

function workingDaysBetween(startDate: Date, endDate: Date): number {
  let days = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days++;
  }
  return days;
}

type LeaveCreditsData = {
  vacation?: { balance?: number };
  sick?: { balance?: number };
  custom?: Array<{ type: string; balance?: number }>;
};

function getBalanceForType(
  leaveCredits: LeaveCreditsData | null | undefined,
  type: string,
): number | null {
  if (!leaveCredits) return 0;
  if (type === "vacation") return leaveCredits.vacation?.balance ?? 0;
  if (type === "sick") return leaveCredits.sick?.balance ?? 0;
  if (["maternity", "paternity", "emergency", "custom"].includes(type)) {
    return null;
  }
  const custom = leaveCredits.custom?.find((c) => c.type === type);
  return custom?.balance ?? 0;
}

const LEAVE_REQUEST_OPTIONS = [
  { value: "sick", label: "Sick Leave" },
  { value: "vacation", label: "Vacation Leave" },
  { value: "maternity", label: "Maternity Leave" },
  { value: "paternity", label: "Parental Leave" },
  { value: "emergency", label: "Emergency Leave" },
  { value: "custom", label: "Others" },
] as const;

type RequestingEmployee = {
  personalInfo?: {
    firstName?: string;
    lastName?: string;
  };
  employment?: {
    department?: string;
    position?: string;
  };
};

interface RequestLeaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  leaveCredits?: LeaveCreditsData | null;
  employee?: RequestingEmployee | null;
  leaveRequestFormTemplate?: string;
  onSuccess?: () => void;
}

export function RequestLeaveDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employeeId,
  leaveCredits,
  employee,
  leaveRequestFormTemplate,
  onSuccess,
}: RequestLeaveDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    selectedType: "sick",
    customLeaveType: "",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [signatureDataUrl, setSignatureDataUrl] = useState("");

  const availableBalance = getBalanceForType(leaveCredits, formData.selectedType);
  const requestedDays =
    formData.startDate && formData.endDate
      ? workingDaysBetween(
          new Date(formData.startDate),
          new Date(formData.endDate),
        )
      : 0;
  const isValidRange =
    formData.startDate &&
    formData.endDate &&
    new Date(formData.endDate) >= new Date(formData.startDate);
  const insufficientCredits =
    isValidRange &&
    requestedDays > 0 &&
    availableBalance != null &&
    requestedDays > availableBalance;

  const leaveTypeLabel =
    LEAVE_REQUEST_OPTIONS.find((option) => option.value === formData.selectedType)
      ?.label ?? "Leave";
  const employeeName =
    `${employee?.personalInfo?.firstName ?? ""} ${employee?.personalInfo?.lastName ?? ""}`.trim() ||
    "Employee";
  const filledFormContent = fillLeaveRequestTemplate(
    leaveRequestFormTemplate ?? DEFAULT_LEAVE_REQUEST_TEMPLATE,
    {
      "{{employeeName}}": employeeName,
      "{{department}}": employee?.employment?.department ?? "—",
      "{{position}}": employee?.employment?.position ?? "—",
      "{{dateRequested}}": format(new Date(), "MM/dd/yyyy"),
      "{{leaveType}}":
        formData.selectedType === "custom"
          ? formData.customLeaveType || "Others"
          : leaveTypeLabel,
      "{{startDate}}": formData.startDate
        ? format(new Date(formData.startDate), "MM/dd/yyyy")
        : "—",
      "{{endDate}}": formData.endDate
        ? format(new Date(formData.endDate), "MM/dd/yyyy")
        : "—",
      "{{requestedDays}}": requestedDays > 0 ? String(requestedDays) : "—",
      "{{reason}}": formData.reason || "—",
      "{{signatureName}}": signatureDataUrl ? employeeName : "Pending signature",
    },
  );

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !employeeId) return;
    if (!formData.selectedType) {
      toast({
        title: "Error",
        description: "Please select a leave type",
        variant: "destructive",
      });
      return;
    }
    if (formData.selectedType === "custom" && !formData.customLeaveType.trim()) {
      toast({
        title: "Error",
        description: "Please specify the leave type",
        variant: "destructive",
      });
      return;
    }
    if (!signatureDataUrl) {
      toast({
        title: "Signature required",
        description: "Please sign the leave request form before submitting.",
        variant: "destructive",
      });
      return;
    }
    if (insufficientCredits) {
      toast({
        title: "Insufficient leave credits",
        description: `Available: ${availableBalance ?? 0} days. Requested: ${requestedDays} days.`,
        variant: "destructive",
      });
      return;
    }

    const leaveType = formData.selectedType as
      | "vacation"
      | "sick"
      | "emergency"
      | "maternity"
      | "paternity"
      | "custom";

    try {
      await createLeaveRequest({
        organizationId,
        employeeId,
        leaveType,
        customLeaveType:
          leaveType === "custom" ? formData.customLeaveType.trim() : undefined,
        startDate: new Date(formData.startDate).getTime(),
        endDate: new Date(formData.endDate).getTime(),
        reason: formData.reason,
        formTemplateContent:
          leaveRequestFormTemplate ?? DEFAULT_LEAVE_REQUEST_TEMPLATE,
        filledFormContent,
        signatureDataUrl,
      });
      onOpenChange(false);
      setFormData({
        selectedType: "sick",
        customLeaveType: "",
        startDate: "",
        endDate: "",
        reason: "",
      });
      setSignatureDataUrl("");
      toast({
        title: "Success",
        description: "Leave request submitted successfully",
      });
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to create leave request",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Leave</DialogTitle>
          <DialogDescription>
            Fill out the leave request form and add your signature before
            submitting.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="leaveType">
                Leave Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.selectedType}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    selectedType: value,
                    customLeaveType:
                      value === "custom" ? formData.customLeaveType : "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_REQUEST_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.selectedType === "custom" && (
                <Input
                  value={formData.customLeaveType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      customLeaveType: e.target.value,
                    })
                  }
                  placeholder="Specify other leave type"
                />
              )}
              {availableBalance != null && formData.selectedType && (
                <p className="text-xs text-muted-foreground">
                  Available: {availableBalance} days
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  Start Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) =>
                    setFormData({ ...formData, startDate: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">
                  End Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) =>
                    setFormData({ ...formData, endDate: e.target.value })
                  }
                  required
                  min={formData.startDate || undefined}
                />
              </div>
            </div>

            {formData.startDate && formData.endDate && (
              <p className="text-sm text-muted-foreground">
                Requested: {requestedDays} working day
                {requestedDays !== 1 ? "s" : ""}
                {insufficientCredits && (
                  <span className="mt-1 block font-medium text-destructive">
                    Insufficient credits (available: {availableBalance} days)
                  </span>
                )}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="reason">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="reason"
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Leave request form</Label>
              <div className="overflow-hidden rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
                <TiptapViewer content={filledFormContent} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Signature <span className="text-red-500">*</span>
              </Label>
              <SignaturePad
                value={signatureDataUrl}
                onChange={setSignatureDataUrl}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={insufficientCredits || requestedDays <= 0}
            >
              Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
