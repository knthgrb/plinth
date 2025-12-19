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
import { updateEmployeeLeaveCredits } from "@/app/actions/leave";

interface AdjustCreditsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  onSuccess?: () => void;
}

export function AdjustCreditsDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employeeId,
  onSuccess,
}: AdjustCreditsDialogProps) {
  const { toast } = useToast();
  const [adjustmentData, setAdjustmentData] = useState({
    leaveType: "vacation" as "vacation" | "sick" | "custom",
    customType: "",
    adjustment: 0,
    reason: "",
  });

  const handleSubmit = async () => {
    if (!organizationId || !employeeId) return;
    if (!adjustmentData.reason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason for the adjustment",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateEmployeeLeaveCredits({
        organizationId,
        employeeId,
        leaveType: adjustmentData.leaveType,
        customType:
          adjustmentData.leaveType === "custom"
            ? adjustmentData.customType
            : undefined,
        adjustment: adjustmentData.adjustment,
        reason: adjustmentData.reason,
      });
      onOpenChange(false);
      setAdjustmentData({
        leaveType: "vacation",
        customType: "",
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
            <Select
              value={adjustmentData.leaveType}
              onValueChange={(value: any) =>
                setAdjustmentData({
                  ...adjustmentData,
                  leaveType: value,
                  customType: "",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">Vacation</SelectItem>
                <SelectItem value="sick">Sick</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adjustmentData.leaveType === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="customType">Custom Leave Type Name</Label>
              <Input
                id="customType"
                value={adjustmentData.customType}
                onChange={(e) =>
                  setAdjustmentData({
                    ...adjustmentData,
                    customType: e.target.value,
                  })
                }
                placeholder="e.g., Emergency, Maternity"
              />
            </div>
          )}
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
            <Label htmlFor="adjustReason">Reason *</Label>
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
                leaveType: "vacation",
                customType: "",
                adjustment: 0,
                reason: "",
              });
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Save Adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
