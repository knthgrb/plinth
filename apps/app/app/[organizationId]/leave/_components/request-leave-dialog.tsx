"use client";

import { useEffect, useMemo, useState } from "react";
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
import { GENERAL_LEAVE_CREDIT_KEY } from "@/lib/leave-constants";

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
  generalLeave?: { available?: number };
};

function resolveAvailableBalance(
  leaveCredits: LeaveCreditsData | null | undefined,
  leaveTypeKey: string,
  leaveTrackerMode: "general" | "by_type",
): number | null {
  if (!leaveCredits) return 0;
  if (leaveTrackerMode === "general") {
    if (leaveTypeKey === GENERAL_LEAVE_CREDIT_KEY) {
      return leaveCredits.generalLeave?.available ?? 0;
    }
    return null;
  }
  if (leaveTypeKey === "vacation") return leaveCredits.vacation?.balance ?? 0;
  if (leaveTypeKey === "sick") return leaveCredits.sick?.balance ?? 0;
  if (["maternity", "paternity", "emergency"].includes(leaveTypeKey)) {
    return null;
  }
  const custom = leaveCredits.custom?.find((c) => c.type === leaveTypeKey);
  return custom?.balance ?? 0;
}

function toApiLeavePayload(leaveTypeKey: string): {
  leaveType:
    | "vacation"
    | "sick"
    | "emergency"
    | "maternity"
    | "paternity"
    | "custom";
  customLeaveType?: string;
} {
  if (leaveTypeKey === GENERAL_LEAVE_CREDIT_KEY) {
    return {
      leaveType: "custom",
      customLeaveType: GENERAL_LEAVE_CREDIT_KEY,
    };
  }
  if (leaveTypeKey === "vacation") return { leaveType: "vacation" };
  if (leaveTypeKey === "sick") return { leaveType: "sick" };
  if (leaveTypeKey === "emergency") return { leaveType: "emergency" };
  if (leaveTypeKey === "maternity") return { leaveType: "maternity" };
  if (leaveTypeKey === "paternity") return { leaveType: "paternity" };
  return { leaveType: "custom", customLeaveType: leaveTypeKey };
}

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

type ConfiguredLeaveType = { type: string; name: string };

interface RequestLeaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  leaveCredits?: LeaveCreditsData | null;
  employee?: RequestingEmployee | null;
  leaveRequestFormTemplate?: string;
  onSuccess?: () => void;
  leaveTrackerMode?: "general" | "by_type";
  configuredLeaveTypes?: ConfiguredLeaveType[];
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
  leaveTrackerMode = "general",
  configuredLeaveTypes = [],
}: RequestLeaveDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    leaveTypeKey: GENERAL_LEAVE_CREDIT_KEY,
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [signatureDataUrl, setSignatureDataUrl] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const firstByType = configuredLeaveTypes[0]?.type;
    setFormData({
      leaveTypeKey:
        leaveTrackerMode === "by_type" && firstByType
          ? firstByType
          : GENERAL_LEAVE_CREDIT_KEY,
      startDate: "",
      endDate: "",
      reason: "",
    });
    setSignatureDataUrl("");
  }, [isOpen, leaveTrackerMode, configuredLeaveTypes]);

  const availableBalance = resolveAvailableBalance(
    leaveCredits,
    formData.leaveTypeKey,
    leaveTrackerMode,
  );
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

  const leaveTypeLabel = useMemo(() => {
    if (leaveTrackerMode === "general") {
      return "Annual leave";
    }
    const lt = configuredLeaveTypes.find(
      (t) => t.type === formData.leaveTypeKey,
    );
    return lt?.name ?? "Leave";
  }, [leaveTrackerMode, configuredLeaveTypes, formData.leaveTypeKey]);

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
      "{{leaveType}}": leaveTypeLabel,
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

  const byTypeNotConfigured =
    leaveTrackerMode === "by_type" && configuredLeaveTypes.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !employeeId) return;
    if (byTypeNotConfigured) {
      toast({
        title: "No leave types configured",
        description:
          "Ask HR to add leave types in organization settings before filing.",
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

    const payload = toApiLeavePayload(formData.leaveTypeKey);

    try {
      await createLeaveRequest({
        organizationId,
        employeeId,
        leaveType: payload.leaveType,
        customLeaveType: payload.customLeaveType,
        startDate: new Date(formData.startDate).getTime(),
        endDate: new Date(formData.endDate).getTime(),
        reason: formData.reason,
        formTemplateContent:
          leaveRequestFormTemplate ?? DEFAULT_LEAVE_REQUEST_TEMPLATE,
        filledFormContent,
        signatureDataUrl,
      });
      onOpenChange(false);
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
            {leaveTrackerMode === "general" ? (
              <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] px-3 py-2 text-sm text-[rgb(100,100,100)]">
                Leave type: <span className="font-medium text-[rgb(64,64,64)]">Annual leave (SIL pool)</span>
                {availableBalance != null && (
                  <span className="block text-xs mt-1 text-muted-foreground">
                    Available: {availableBalance} days (incl. anniversary when
                    enabled)
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="leaveType">
                  Leave type <span className="text-red-500">*</span>
                </Label>
                {byTypeNotConfigured ? (
                  <p className="text-sm text-destructive">
                    No leave types are configured for this organization.
                  </p>
                ) : (
                  <Select
                    value={formData.leaveTypeKey}
                    onValueChange={(value) =>
                      setFormData({ ...formData, leaveTypeKey: value })
                    }
                  >
                    <SelectTrigger id="leaveType">
                      <SelectValue placeholder="Select leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      {configuredLeaveTypes.map((lt) => (
                        <SelectItem key={lt.type} value={lt.type}>
                          {lt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {availableBalance != null && !byTypeNotConfigured && (
                  <p className="text-xs text-muted-foreground">
                    Available: {availableBalance} days
                  </p>
                )}
              </div>
            )}

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
              disabled={
                insufficientCredits ||
                requestedDays <= 0 ||
                byTypeNotConfigured
              }
            >
              Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
