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
import { updateEmployeeLeaveCredits } from "@/actions/leave";

export type OrgLeaveType = { type: string; name: string };

interface AdjustCreditsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  leaveTypes?: OrgLeaveType[];
  onSuccess?: () => void;
}

export function AdjustCreditsDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employeeId,
  leaveTypes = [],
  onSuccess,
}: AdjustCreditsDialogProps) {
  const { toast } = useToast();
  const [adjustmentData, setAdjustmentData] = useState({
    selectedType: "",
    adjustment: 0,
    reason: "",
  });

  useEffect(() => {
    if (isOpen && leaveTypes.length > 0) {
      const first = leaveTypes[0].type;
      setAdjustmentData((prev) => ({
        ...prev,
        selectedType: prev.selectedType && leaveTypes.some((lt) => lt.type === prev.selectedType)
          ? prev.selectedType
          : first,
      }));
    }
  }, [isOpen, leaveTypes]);

  const handleSubmit = async () => {
    if (!organizationId || !employeeId) return;
    if (!adjustmentData.selectedType) {
      toast({
        title: "Error",
        description: "Please select a leave type",
        variant: "destructive",
      });
      return;
    }
    if (!adjustmentData.reason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason for the adjustment",
        variant: "destructive",
      });
      return;
    }

    const leaveType =
      adjustmentData.selectedType === "vacation"
        ? "vacation"
        : adjustmentData.selectedType === "sick"
          ? "sick"
          : "custom";
    const customType =
      leaveType === "custom" ? adjustmentData.selectedType : undefined;

    try {
      await updateEmployeeLeaveCredits({
        organizationId,
        employeeId,
        leaveType,
        customType,
        adjustment: adjustmentData.adjustment,
        reason: adjustmentData.reason,
      });
      onOpenChange(false);
      setAdjustmentData({
        selectedType: leaveTypes[0]?.type ?? "",
        adjustment: 0,
        reason: "",
      });
      toast({
        title: "Success",
        description: "Leave credits updated successfully",
      });
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update leave credits",
        variant: "destructive",
      });
    }
  };

  const defaultSelected = leaveTypes[0]?.type ?? "";
  const selectedType = adjustmentData.selectedType || defaultSelected;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Leave Credits</DialogTitle>
          <DialogDescription>
            Add or subtract leave credits for the selected employee.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="adjustLeaveType">Leave Type</Label>
            {leaveTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No leave types configured. Add leave types in Settings.
              </p>
            ) : (
              <Select
                value={selectedType}
                onValueChange={(value) =>
                  setAdjustmentData({ ...adjustmentData, selectedType: value })
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment">
              Adjustment (positive to add, negative to subtract)
            </Label>
            <Input
              id="adjustment"
              type="number"
              value={
                adjustmentData.adjustment === 0 ? "" : adjustmentData.adjustment
              }
              onChange={(e) =>
                setAdjustmentData({
                  ...adjustmentData,
                  adjustment: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="e.g., 5 or -2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustReason">Reason <span className="text-red-500">*</span></Label>
            <Textarea
              id="adjustReason"
              value={adjustmentData.reason}
              onChange={(e) =>
                setAdjustmentData({
                  ...adjustmentData,
                  reason: e.target.value,
                })
              }
              placeholder="Reason for adjustment"
              required
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setAdjustmentData({
                selectedType: leaveTypes[0]?.type ?? "",
                adjustment: 0,
                reason: "",
              });
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={leaveTypes.length === 0}>
            Save Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
