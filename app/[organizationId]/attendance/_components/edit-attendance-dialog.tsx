"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateAttendance } from "@/actions/attendance";
import { useToast } from "@/components/ui/use-toast";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateLate,
  calculateUndertime,
  formatTime12Hour,
} from "@/utils/attendance-calculations";
import { Loader2 } from "lucide-react";

interface EditAttendanceDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  record: any | null;
  onSuccess?: () => void;
}

export function EditAttendanceDialog({
  isOpen,
  onOpenChange,
  record,
  onSuccess,
}: EditAttendanceDialogProps) {
  const { toast } = useToast();
  const [editScheduleIn, setEditScheduleIn] = useState("");
  const [editScheduleOut, setEditScheduleOut] = useState("");
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editOvertime, setEditOvertime] = useState("");
  const [editRemarks, setEditRemarks] = useState("");
  const [editStatus, setEditStatus] = useState<"present" | "absent" | "leave">(
    "present",
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [manualLate, setManualLate] = useState<string>("");
  const [manualUndertime, setManualUndertime] = useState<string>("");
  const [useManualLate, setUseManualLate] = useState(false);
  const [useManualUndertime, setUseManualUndertime] = useState(false);

  useEffect(() => {
    if (record) {
      setEditScheduleIn(record.scheduleIn || "");
      setEditScheduleOut(record.scheduleOut || "");
      setEditTimeIn(record.actualIn || "");
      setEditTimeOut(record.actualOut || "");
      setEditOvertime(record.overtime ? record.overtime.toString() : "");
      setEditStatus(record.status);
      setEditRemarks(record.remarks || "");
      // Set manual values if they exist, otherwise use calculated
      setManualLate(record.late ? record.late.toString() : "");
      setManualUndertime(record.undertime ? record.undertime.toString() : "");
      // If record has late/undertime, assume they were manually set (enable override)
      setUseManualLate(!!record.late);
      setUseManualUndertime(!!record.undertime);
    }
  }, [record]);

  // Calculate late and undertime automatically when times change
  const calculatedLate = useMemo(() => {
    if (!editScheduleIn || !editTimeIn || editStatus !== "present") return 0;
    const calculatedUndertime = calculateUndertime(
      editScheduleIn,
      editScheduleOut,
      editTimeIn,
      editTimeOut,
    );
    // If employee has undertime, don't count as late
    return calculateLate(editScheduleIn, editTimeIn, calculatedUndertime > 0);
  }, [editScheduleIn, editScheduleOut, editTimeIn, editTimeOut, editStatus]);

  const calculatedUndertime = useMemo(() => {
    if (
      !editScheduleIn ||
      !editScheduleOut ||
      !editTimeIn ||
      !editTimeOut ||
      editStatus !== "present"
    )
      return 0;
    return calculateUndertime(
      editScheduleIn,
      editScheduleOut,
      editTimeIn,
      editTimeOut,
    );
  }, [editScheduleIn, editScheduleOut, editTimeIn, editTimeOut, editStatus]);

  // Use manual values if enabled, otherwise use calculated
  const finalLate = useManualLate
    ? manualLate
      ? parseFloat(manualLate)
      : 0
    : calculatedLate;
  const finalUndertime = useManualUndertime
    ? manualUndertime
      ? parseFloat(manualUndertime)
      : 0
    : calculatedUndertime;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;

    setIsUpdating(true);
    try {
      // Clear time in/out and overtime for leave or absent
      const finalTimeIn =
        editStatus === "leave" || editStatus === "absent"
          ? undefined
          : editTimeIn || undefined;
      const finalTimeOut =
        editStatus === "leave" || editStatus === "absent"
          ? undefined
          : editTimeOut || undefined;
      const finalOvertime =
        editStatus === "leave" || editStatus === "absent"
          ? undefined
          : editOvertime
            ? parseFloat(editOvertime)
            : undefined;

      await updateAttendance(record._id, {
        scheduleIn: editScheduleIn || undefined,
        scheduleOut: editScheduleOut || undefined,
        actualIn: finalTimeIn,
        actualOut: finalTimeOut,
        overtime: finalOvertime,
        late: useManualLate ? (finalLate > 0 ? finalLate : 0) : null, // null means recalculate, 0 means explicitly set to 0
        undertime: useManualUndertime
          ? finalUndertime > 0
            ? finalUndertime
            : 0
          : null, // null means recalculate, 0 means explicitly set to 0
        remarks: editRemarks || undefined,
        status: editStatus,
      });
      onOpenChange(false);
      setEditScheduleIn("");
      setEditScheduleOut("");
      setEditTimeIn("");
      setEditTimeOut("");
      setEditOvertime("");
      setEditRemarks("");
      setEditStatus("present");
      toast({
        title: "Success",
        description: "Attendance record updated successfully",
        variant: "success",
      });
      onSuccess?.();
    } catch (error) {
      console.error("Error updating attendance:", error);
      toast({
        title: "Error",
        description: "Failed to update attendance record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Edit Attendance Record
          </DialogTitle>
          <DialogDescription className="text-sm">
            Update attendance record details. Late and undertime are calculated
            automatically, but you can override them manually.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleUpdate}>
          <fieldset disabled={isUpdating} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="editScheduleIn">Scheduled Time In</Label>
                  <TimePicker
                    value={editScheduleIn}
                    onValueChange={setEditScheduleIn}
                    placeholder="Select scheduled time in"
                    showLabel={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editScheduleOut">Scheduled Time Out</Label>
                  <TimePicker
                    value={editScheduleOut}
                    onValueChange={setEditScheduleOut}
                    placeholder="Select scheduled time out"
                    showLabel={false}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editStatus">Status *</Label>
                <Select
                  value={editStatus}
                  onValueChange={(value: any) => {
                    setEditStatus(value);
                    // Auto-clear time in/out for leave or absent
                    if (value === "leave" || value === "absent") {
                      // Keep schedule, but clear actual times and overtime
                      setEditTimeIn("");
                      setEditTimeOut("");
                      setEditOvertime("");
                      setManualLate("");
                      setManualUndertime("");
                      setUseManualLate(false);
                      setUseManualUndertime(false);
                    }
                  }}
                  disabled={isUpdating}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="leave">Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TimePicker
                  value={editTimeIn}
                  onValueChange={setEditTimeIn}
                  disabled={
                    editStatus === "absent" ||
                    editStatus === "leave" ||
                    isUpdating
                  }
                  label="Time In"
                  placeholder="Select time in"
                />
                <TimePicker
                  value={editTimeOut}
                  onValueChange={setEditTimeOut}
                  disabled={
                    editStatus === "absent" ||
                    editStatus === "leave" ||
                    isUpdating
                  }
                  label="Time Out"
                  placeholder="Select time out"
                />
              </div>
              {editStatus === "present" &&
                editScheduleIn &&
                editScheduleOut && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="editLate">Late (minutes)</Label>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={useManualLate}
                            onChange={(e) => {
                              setUseManualLate(e.target.checked);
                              if (!e.target.checked) {
                                setManualLate("");
                              } else {
                                setManualLate(calculatedLate.toString());
                              }
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                            disabled={isUpdating}
                          />
                          <span>Manual override</span>
                        </label>
                      </div>
                      <Input
                        id="editLate"
                        type="number"
                        step="1"
                        min="0"
                        value={
                          useManualLate ? manualLate : calculatedLate.toString()
                        }
                        onChange={(e) => setManualLate(e.target.value)}
                        placeholder="0"
                        disabled={!useManualLate || isUpdating}
                        readOnly={!useManualLate}
                        className={!useManualLate ? "bg-gray-50" : ""}
                      />
                      <p className="text-xs text-gray-500">
                        {useManualLate
                          ? "Manually enter late minutes (set to 0 to remove late)"
                          : `Calculated: ${calculatedLate} minutes (based on schedule ${formatTime12Hour(editScheduleIn)})`}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <Label htmlFor="editUndertime">Undertime (hours)</Label>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={useManualUndertime}
                            onChange={(e) => {
                              setUseManualUndertime(e.target.checked);
                              if (!e.target.checked) {
                                setManualUndertime("");
                              } else {
                                setManualUndertime(
                                  calculatedUndertime.toFixed(2),
                                );
                              }
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                            disabled={isUpdating}
                          />
                          <span>Manual override</span>
                        </label>
                      </div>
                      <Input
                        id="editUndertime"
                        type="number"
                        step="0.01"
                        min="0"
                        value={
                          useManualUndertime
                            ? manualUndertime
                            : calculatedUndertime.toFixed(2)
                        }
                        onChange={(e) => setManualUndertime(e.target.value)}
                        placeholder="0.00"
                        disabled={!useManualUndertime || isUpdating}
                        readOnly={!useManualUndertime}
                        className={!useManualUndertime ? "bg-gray-50" : ""}
                      />
                      <p className="text-xs text-gray-500">
                        {useManualUndertime
                          ? "Manually enter undertime hours (set to 0 to remove undertime)"
                          : `Calculated: ${calculatedUndertime.toFixed(2)} hours (8 hours work = ${formatTime12Hour(editScheduleIn)} to ${formatTime12Hour(editScheduleOut)} with 1hr lunch)`}
                      </p>
                    </div>
                  </div>
                )}
              <div className="space-y-2">
                <Label htmlFor="editOvertime">Overtime (hours)</Label>
                <Input
                  id="editOvertime"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editOvertime}
                  onChange={(e) => setEditOvertime(e.target.value)}
                  placeholder="0.00"
                  disabled={
                    editStatus === "absent" ||
                    editStatus === "leave" ||
                    isUpdating
                  }
                />
                <p className="text-xs text-gray-500">
                  Optional: Enter overtime hours worked
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editRemarks">Notes</Label>
                <Textarea
                  id="editRemarks"
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="Optional note for this attendance record"
                  disabled={isUpdating}
                  rows={2}
                  className="resize-none"
                />
              </div>
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
