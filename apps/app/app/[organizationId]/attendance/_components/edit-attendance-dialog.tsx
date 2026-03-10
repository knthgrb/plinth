"use client";

import { useState, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  employee?: any | null; // When provided, scheduled times are pre-filled from employee's schedule for this date
  onSuccess?: () => void;
}

function getScheduledTimesForDate(
  employee: any,
  dateTs: number,
): { scheduleIn: string; scheduleOut: string } | null {
  if (!employee?.schedule?.defaultSchedule) return null;
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const dateObj = new Date(dateTs);
  const dayName = dayNames[dateObj.getDay()];
  const daySchedule = employee.schedule.defaultSchedule[dayName];
  if (!daySchedule?.in || !daySchedule?.out) return null;
  const scheduleOverrides = employee.schedule?.scheduleOverrides;
  if (Array.isArray(scheduleOverrides)) {
    const override = scheduleOverrides.find(
      (o: any) => o.date != null && new Date(o.date).toDateString() === dateObj.toDateString(),
    );
    if (override?.in && override?.out) return { scheduleIn: override.in, scheduleOut: override.out };
  }
  return { scheduleIn: daySchedule.in, scheduleOut: daySchedule.out };
}

export function EditAttendanceDialog({
  isOpen,
  onOpenChange,
  record,
  employee,
  onSuccess,
}: EditAttendanceDialogProps) {
  const { toast } = useToast();
  const [editScheduleIn, setEditScheduleIn] = useState("");
  const [editScheduleOut, setEditScheduleOut] = useState("");
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editOvertime, setEditOvertime] = useState("");
  const [editRemarks, setEditRemarks] = useState("");
  const [editStatus, setEditStatus] = useState<"present" | "absent" | "leave" | "no_work">(
    "present",
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [manualLate, setManualLate] = useState<string>("");
  const [manualUndertime, setManualUndertime] = useState<string>("");
  const [useManualLate, setUseManualLate] = useState(false);
  const [useManualUndertime, setUseManualUndertime] = useState(false);

  const updateAttendanceMutation = useMutation(
    (api as any).attendance.updateAttendance,
  );

  // Re-sync from record whenever the dialog opens or record changes. Use employee's schedule for that date when available so wrong stored schedule (e.g. 9–6) is corrected.
  useEffect(() => {
    if (record && isOpen) {
      const fromEmployee = employee && record.date && getScheduledTimesForDate(employee, record.date);
      if (fromEmployee) {
        setEditScheduleIn(fromEmployee.scheduleIn);
        setEditScheduleOut(fromEmployee.scheduleOut);
      } else {
        setEditScheduleIn(record.scheduleIn || "");
        setEditScheduleOut(record.scheduleOut || "");
      }
      setEditTimeIn(record.actualIn || "");
      setEditTimeOut(record.actualOut || "");
      setEditOvertime(record.overtime ? record.overtime.toString() : "");
      setEditStatus(record.status);
      setEditRemarks(record.remarks || "");
      // Seed manual fields from stored values (late in mins, undertime stored in hours → show as mins)
      setManualLate(
        record.late !== undefined && record.late !== null
          ? record.late.toString()
          : "",
      );
      setManualUndertime(
        record.undertime !== undefined && record.undertime !== null
          ? Math.round(record.undertime * 60).toString()
          : "",
      );
      // Restore manual override state from explicit flags or stored values (including 0)
      setUseManualLate(
        record.lateManualOverride === true ||
          (record.late !== undefined && record.late !== null),
      );
      setUseManualUndertime(
        record.undertimeManualOverride === true ||
          (record.undertime !== undefined && record.undertime !== null),
      );
    }
  }, [record, employee, isOpen]);

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
    return calculateLate(editScheduleIn, editTimeIn);
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
  // finalUndertime for API is in hours (backend); UI state manualUndertime is in minutes
  const finalUndertime =
    useManualUndertime
      ? (parseFloat(manualUndertime) || 0) / 60
      : calculatedUndertime;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;

    setIsUpdating(true);
    try {
      // Clear time in/out and overtime for leave, absent, or no_work
      const finalTimeIn =
        editStatus === "leave" || editStatus === "absent" || editStatus === "no_work"
          ? undefined
          : editTimeIn || undefined;
      const finalTimeOut =
        editStatus === "leave" || editStatus === "absent" || editStatus === "no_work"
          ? undefined
          : editTimeOut || undefined;
      const finalOvertime =
        editStatus === "leave" || editStatus === "absent" || editStatus === "no_work"
          ? undefined
          : editOvertime
            ? parseFloat(editOvertime)
            : undefined;

      // When manual override is used, append specific note(s): "Late manually overridden." and/or "Undertime manually overridden."
      const overrideNotes: string[] = [];
      if (useManualLate) overrideNotes.push("Late manually overridden.");
      if (useManualUndertime) overrideNotes.push("Undertime manually overridden.");
      let remarksToSave = editRemarks?.trim() || "";
      for (const phrase of overrideNotes) {
        if (!remarksToSave.includes(phrase)) {
          remarksToSave = remarksToSave ? `${remarksToSave} ${phrase}` : phrase;
        }
      }

      await updateAttendanceMutation({
        attendanceId: record._id as Id<"attendance">,
        scheduleIn: editScheduleIn || undefined,
        scheduleOut: editScheduleOut || undefined,
        actualIn: finalTimeIn,
        actualOut: finalTimeOut,
        overtime: finalOvertime,
        late: useManualLate ? finalLate : null,
        undertime: useManualUndertime ? finalUndertime : null,
        lateManualOverride: useManualLate ? true : undefined,
        undertimeManualOverride: useManualUndertime ? true : undefined,
        remarks: remarksToSave || undefined,
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
            Update attendance record details. Late and undertime are based on this
            employee's scheduled time in/out; you can override them manually.
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
                <Label htmlFor="editStatus">Status <span className="text-red-500">*</span></Label>
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
                    <SelectItem value="no_work">No work</SelectItem>
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
                        <Label htmlFor="editUndertime">Undertime (minutes)</Label>
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
                                  Math.round(calculatedUndertime * 60).toString(),
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
                        step="1"
                        min="0"
                        value={
                          useManualUndertime
                            ? manualUndertime
                            : Math.round(calculatedUndertime * 60).toString()
                        }
                        onChange={(e) => setManualUndertime(e.target.value)}
                        placeholder="0"
                        disabled={!useManualUndertime || isUpdating}
                        readOnly={!useManualUndertime}
                        className={!useManualUndertime ? "bg-gray-50" : ""}
                      />
                      <p className="text-xs text-gray-500">
                        {useManualUndertime
                          ? "Manually enter undertime minutes (set to 0 to remove undertime)"
                          : `Calculated: ${Math.round(calculatedUndertime * 60)} min from scheduled time out (${formatTime12Hour(editScheduleOut)}). Update scheduled times above if they don't match this employee's work schedule.`}
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
