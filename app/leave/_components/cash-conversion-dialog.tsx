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
import { convertLeaveToCash } from "@/app/actions/leave";

interface CashConversionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employeeId: string;
  convertibleCredits?: {
    vacation?: { convertible: number };
    sick?: { convertible: number };
  };
  onSuccess?: () => void;
}

export function CashConversionDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employeeId,
  convertibleCredits,
  onSuccess,
}: CashConversionDialogProps) {
  const { toast } = useToast();
  const [cashConversionData, setCashConversionData] = useState({
    leaveType: "vacation" as "vacation" | "sick",
    daysToConvert: 0,
    reason: "",
  });

  const handleSubmit = async () => {
    if (!organizationId || !employeeId) return;
    if (
      !cashConversionData.daysToConvert ||
      cashConversionData.daysToConvert <= 0
    ) {
      toast({
        title: "Error",
        description: "Please enter a valid number of days to convert",
        variant: "destructive",
      });
      return;
    }

    try {
      await convertLeaveToCash({
        organizationId,
        employeeId,
        leaveType: cashConversionData.leaveType,
        daysToConvert: cashConversionData.daysToConvert,
        reason: cashConversionData.reason,
      });
      onOpenChange(false);
      setCashConversionData({
        leaveType: "vacation",
        daysToConvert: 0,
        reason: "",
      });
      toast({
        title: "Success",
        description: `${cashConversionData.daysToConvert} days converted to cash successfully`,
      });
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to convert leave to cash",
        variant: "destructive",
      });
    }
  };

  const maxDays =
    cashConversionData.leaveType === "vacation"
      ? convertibleCredits?.vacation?.convertible || 0
      : convertibleCredits?.sick?.convertible || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert Leave to Cash</DialogTitle>
          <DialogDescription>
            Convert leave credits to cash. Only the first 5 days are
            convertible.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="convertLeaveType">Leave Type</Label>
            <Select
              value={cashConversionData.leaveType}
              onValueChange={(value: any) =>
                setCashConversionData({
                  ...cashConversionData,
                  leaveType: value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">
                  Vacation ({convertibleCredits?.vacation?.convertible || 0}{" "}
                  convertible)
                </SelectItem>
                <SelectItem value="sick">
                  Sick ({convertibleCredits?.sick?.convertible || 0}{" "}
                  convertible)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daysToConvert">
              Days to Convert (Max: {maxDays})
            </Label>
            <Input
              id="daysToConvert"
              type="number"
              min="1"
              max={maxDays}
              value={
                cashConversionData.daysToConvert === 0
                  ? ""
                  : cashConversionData.daysToConvert
              }
              onChange={(e) =>
                setCashConversionData({
                  ...cashConversionData,
                  daysToConvert: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="Enter days to convert"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="convertReason">Reason (Optional)</Label>
            <Textarea
              id="convertReason"
              value={cashConversionData.reason}
              onChange={(e) =>
                setCashConversionData({
                  ...cashConversionData,
                  reason: e.target.value,
                })
              }
              placeholder="Reason for conversion"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setCashConversionData({
                leaveType: "vacation",
                daysToConvert: 0,
                reason: "",
              });
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Convert to Cash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
