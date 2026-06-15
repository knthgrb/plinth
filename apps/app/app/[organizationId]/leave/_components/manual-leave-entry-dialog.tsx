"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GENERAL_LEAVE_CREDIT_KEY } from "@/lib/leave-constants";

type ManualLeaveEmployee = {
  _id: string;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
  };
};

type ConfiguredLeaveType = {
  type: string;
  name: string;
  isPaid?: boolean;
};

type ManualLeaveEntryDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  employees: ManualLeaveEmployee[];
  leaveTrackerMode: "general" | "by_type";
  configuredLeaveTypes: ConfiguredLeaveType[];
};

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

function getEmployeeName(employee: ManualLeaveEmployee) {
  return (
    `${employee.personalInfo?.lastName ?? ""}, ${employee.personalInfo?.firstName ?? ""}`.trim() ||
    "Employee"
  );
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

export function ManualLeaveEntryDialog({
  isOpen,
  onOpenChange,
  organizationId,
  employees,
  leaveTrackerMode,
  configuredLeaveTypes,
}: ManualLeaveEntryDialogProps) {
  const { toast } = useToast();
  const createManualLeaveRequest = useMutation(
    api.leave.createManualLeaveRequest,
  );
  const [formData, setFormData] = useState({
    employeeId: "",
    leaveTypeKey: GENERAL_LEAVE_CREDIT_KEY,
    startDate: "",
    endDate: "",
    numberOfDays: "",
    reason: "",
    isPaid: true,
  });

  const sortedEmployees = useMemo(
    () => [...employees].sort((left, right) =>
      getEmployeeName(left).localeCompare(getEmployeeName(right)),
    ),
    [employees],
  );
  const byTypeNotConfigured =
    leaveTrackerMode === "by_type" && configuredLeaveTypes.length === 0;
  const requestedDays =
    formData.startDate && formData.endDate
      ? workingDaysBetween(
          new Date(formData.startDate),
          new Date(formData.endDate),
        )
      : 0;

  useEffect(() => {
    if (!isOpen) return;
    const firstEmployee = sortedEmployees[0]?._id ?? "";
    const firstType = configuredLeaveTypes[0];
    const resetTimer = window.setTimeout(() => {
      setFormData({
        employeeId: firstEmployee,
        leaveTypeKey:
          leaveTrackerMode === "by_type" && firstType
            ? firstType.type
            : GENERAL_LEAVE_CREDIT_KEY,
        startDate: "",
        endDate: "",
        numberOfDays: "",
        reason: "",
        isPaid:
          leaveTrackerMode === "by_type" ? firstType?.isPaid ?? true : true,
      });
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [isOpen, sortedEmployees, leaveTrackerMode, configuredLeaveTypes]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organizationId || !formData.employeeId) return;
    if (byTypeNotConfigured) {
      toast({
        title: "No leave types configured",
        description: "Add leave types in settings before creating this entry.",
        variant: "destructive",
      });
      return;
    }

    const numberOfDays = formData.numberOfDays
      ? Number(formData.numberOfDays)
      : undefined;
    if (numberOfDays !== undefined && (!Number.isFinite(numberOfDays) || numberOfDays <= 0)) {
      toast({
        title: "Invalid days",
        description: "Days must be greater than zero.",
        variant: "destructive",
      });
      return;
    }

    const payload = toApiLeavePayload(formData.leaveTypeKey);

    try {
      await createManualLeaveRequest({
        organizationId: organizationId as Id<"organizations">,
        employeeId: formData.employeeId as Id<"employees">,
        leaveType: payload.leaveType,
        customLeaveType: payload.customLeaveType,
        startDate: new Date(formData.startDate).getTime(),
        endDate: new Date(formData.endDate).getTime(),
        numberOfDays,
        reason: formData.reason,
        isPaid: formData.isPaid,
      });
      toast({
        title: "Leave history updated",
        description: "Manual leave entry was added successfully.",
      });
      onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Failed to add leave entry",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add leave history</DialogTitle>
          <DialogDescription>
            Add an approved historical leave entry for an employee.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="manualEmployee">Employee</Label>
              <Select
                value={formData.employeeId}
                onValueChange={(employeeId) =>
                  setFormData({ ...formData, employeeId })
                }
              >
                <SelectTrigger id="manualEmployee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {sortedEmployees.map((employee) => (
                    <SelectItem key={employee._id} value={employee._id}>
                      {getEmployeeName(employee)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {leaveTrackerMode === "general" ? (
              <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] px-3 py-2 text-sm text-[rgb(100,100,100)]">
                Leave type:{" "}
                <span className="font-medium text-[rgb(64,64,64)]">
                  Annual leave (SIL pool)
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="manualLeaveType">Leave type</Label>
                <Select
                  value={formData.leaveTypeKey}
                  onValueChange={(leaveTypeKey) => {
                    const selected = configuredLeaveTypes.find(
                      (type) => type.type === leaveTypeKey,
                    );
                    setFormData({
                      ...formData,
                      leaveTypeKey,
                      isPaid: selected?.isPaid ?? true,
                    });
                  }}
                  disabled={byTypeNotConfigured}
                >
                  <SelectTrigger id="manualLeaveType">
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                  <SelectContent>
                    {configuredLeaveTypes.map((type) => (
                      <SelectItem key={type.type} value={type.type}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="manualPayMode">Pay mode</Label>
              <Select
                value={formData.isPaid ? "paid" : "unpaid"}
                onValueChange={(value) =>
                  setFormData({ ...formData, isPaid: value === "paid" })
                }
              >
                <SelectTrigger id="manualPayMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">With pay</SelectItem>
                  <SelectItem value="unpaid">Without pay</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manualStartDate">Start date</Label>
                <Input
                  id="manualStartDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(event) =>
                    setFormData({ ...formData, startDate: event.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manualEndDate">End date</Label>
                <Input
                  id="manualEndDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(event) =>
                    setFormData({ ...formData, endDate: event.target.value })
                  }
                  min={formData.startDate || undefined}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manualDays">Days</Label>
              <Input
                id="manualDays"
                value={formData.numberOfDays}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    numberOfDays: event.target.value,
                  })
                }
                inputMode="decimal"
                placeholder={requestedDays > 0 ? String(requestedDays) : "Auto"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manualReason">Reason</Label>
              <Textarea
                id="manualReason"
                value={formData.reason}
                onChange={(event) =>
                  setFormData({ ...formData, reason: event.target.value })
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
                !formData.employeeId ||
                !formData.startDate ||
                !formData.endDate ||
                byTypeNotConfigured
              }
            >
              Add entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
