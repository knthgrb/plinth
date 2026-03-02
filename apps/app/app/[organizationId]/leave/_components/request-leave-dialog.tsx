"use client";

import { useState, useEffect } from "react";
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

// Working days (exclude weekends) – must match server logic
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

function getBalanceForType(leaveCredits: any, type: string): number {
  if (!leaveCredits) return 0;
  if (type === "vacation") return leaveCredits.vacation?.balance ?? 0;
  if (type === "sick") return leaveCredits.sick?.balance ?? 0;
  const custom = leaveCredits.custom?.find((c: any) => c.type === type);
  return custom?.balance ?? 0;
}

export type OrgLeaveType = { type: string; name: string };

interface RequestLeaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  leaveTypes?: OrgLeaveType[];
  leaveCredits?: any;
  onSuccess?: () => void;
}

export function RequestLeaveDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employeeId,
  leaveTypes = [],
  leaveCredits,
  onSuccess,
}: RequestLeaveDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    selectedType: "",
    startDate: "",
    endDate: "",
    reason: "",
  });

  const defaultType = leaveTypes[0]?.type ?? "";
  const selectedType = formData.selectedType || defaultType;

  useEffect(() => {
    if (isOpen && leaveTypes.length > 0 && !formData.selectedType) {
      setFormData((prev) => ({ ...prev, selectedType: leaveTypes[0].type }));
    }
  }, [isOpen, leaveTypes]);

  const availableBalance = getBalanceForType(leaveCredits, selectedType);
  const requestedDays =
    formData.startDate && formData.endDate
      ? workingDaysBetween(
          new Date(formData.startDate),
          new Date(formData.endDate)
        )
      : 0;
  const isValidRange =
    formData.startDate &&
    formData.endDate &&
    new Date(formData.endDate) >= new Date(formData.startDate);
  const insufficientCredits =
    isValidRange && requestedDays > 0 && requestedDays > availableBalance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !employeeId) return;
    if (!selectedType) {
      toast({
        title: "Error",
        description: "Please select a leave type",
        variant: "destructive",
      });
      return;
    }
    if (insufficientCredits) {
      toast({
        title: "Insufficient leave credits",
        description: `Available: ${availableBalance} days. Requested: ${requestedDays} days.`,
        variant: "destructive",
      });
      return;
    }
    const leaveType =
      ["vacation", "sick", "emergency", "maternity", "paternity"].includes(
        selectedType
      )
        ? selectedType
        : "custom";
    const customLeaveType =
      leaveType === "custom" ? selectedType : undefined;

    try {
      await createLeaveRequest({
        organizationId,
        employeeId,
        leaveType: leaveType as any,
        customLeaveType,
        startDate: new Date(formData.startDate).getTime(),
        endDate: new Date(formData.endDate).getTime(),
        reason: formData.reason,
      });
      onOpenChange(false);
      setFormData({
        selectedType: defaultType,
        startDate: "",
        endDate: "",
        reason: "",
      });
      toast({
        title: "Success",
        description: "Leave request submitted successfully",
      });
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create leave request",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Leave</DialogTitle>
          <DialogDescription>Submit a new leave request.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="leaveType">
                Leave Type <span className="text-red-500">*</span>
              </Label>
              {leaveTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No leave types configured. Add leave types in Settings.
                </p>
              ) : (
                <Select
                  value={selectedType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, selectedType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map((lt) => (
                      <SelectItem key={lt.type} value={lt.type}>
                        {lt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {leaveCredits != null && selectedType && (
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
                  <span className="text-destructive font-medium block mt-1">
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                leaveTypes.length === 0 ||
                insufficientCredits ||
                requestedDays <= 0
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
