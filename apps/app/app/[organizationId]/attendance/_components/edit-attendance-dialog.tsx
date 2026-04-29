"use client";

import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
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
  clockOutIsNextCalendarDay,
  formatManilaAttendanceDayLabel,
  formatNextManilaCalendarDayFromAttendanceTs,
  formatTime12Hour,
  scheduleEndsNextCalendarDay,
} from "@/utils/attendance-calculations";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { holidayAppliesToEmployee } from "@/lib/payroll-calculations";

interface EditAttendanceDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  record: any | null;
  employee?: any | null; // Used to backfill schedule when the row has no stored times
  onSuccess?: () => void;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const undertimeHelperText = (
  undertimeMins: number,
  scheduleOut24: string,
): string => {
  const schedLabel = formatTime12Hour(scheduleOut24);
  if (undertimeMins > 0) {
    return `Calculated: ${undertimeMins} min (left before scheduled end ${schedLabel}, after treating overnight clock-out as the next calendar day). Late is from time in only.`;
  }
  return `Calculated: 0 min (no undertime: actual end is at or after scheduled end ${schedLabel}; clock-out at or before time in on the clock counts as the next calendar day). Late is from time in only.`;
};

function getScheduledTimesForDate(
  employee: any,
  dateTs: number,
): { scheduleIn: string; scheduleOut: string } | null {
  if (!employee?.schedule?.defaultSchedule) return null;
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  // Use Manila timezone so the correct per-day schedule is used regardless of user's timezone
  const manilaDay = new Date(dateTs + MANILA_OFFSET_MS).getUTCDay();
  const dayName = dayNames[manilaDay];
  const daySchedule = employee.schedule.defaultSchedule[dayName];
  if (!daySchedule?.in || !daySchedule?.out) return null;
  const scheduleOverrides = employee.schedule?.scheduleOverrides;
  if (Array.isArray(scheduleOverrides)) {
    const manilaParts = (ts: number) => {
      const d = new Date(ts + MANILA_OFFSET_MS);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
    };
    const targetParts = manilaParts(dateTs);
    const override = scheduleOverrides.find((o: any) => {
      if (o.date == null) return false;
      const oTs = typeof o.date === "number" ? o.date : new Date(o.date).getTime();
      const oParts = manilaParts(oTs);
      return oParts.y === targetParts.y && oParts.m === targetParts.m && oParts.d === targetParts.d;
    });
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
  const [editStatus, setEditStatus] = useState<
    "present" | "absent" | "half-day" | "leave" | "leave_with_pay" | "leave_without_pay" | "no_work"
  >("present");
  const [isUpdating, setIsUpdating] = useState(false);
  const [manualLate, setManualLate] = useState<string>("");
  const [manualUndertime, setManualUndertime] = useState<string>("");
  const [useManualLate, setUseManualLate] = useState(false);
  const [useManualUndertime, setUseManualUndertime] = useState(false);

  const updateAttendanceMutation = useMutation(
    (api as any).attendance.updateAttendance,
  );
  const holidays = useQuery(
    (api as any).holidays.getHolidays,
    record?.organizationId ? { organizationId: record.organizationId } : "skip",
  );

  const canUseNoWorkStatus = useMemo(() => {
    if (!record?.date || !employee || !holidays) return false;
    const target = new Date(record.date);
    const targetY = target.getFullYear();
    const targetM = target.getMonth();
    const targetD = target.getDate();
    return holidays.some((h: any) => {
      const holidayTs = h.offsetDate ?? h.date;
      const hd = new Date(holidayTs);
      const yearMatches = h.isRecurring ? true : (h.year == null || h.year === targetY);
      if (!yearMatches) return false;
      const dayMatches = h.isRecurring
        ? hd.getMonth() === targetM && hd.getDate() === targetD
        : hd.getFullYear() === targetY &&
          hd.getMonth() === targetM &&
          hd.getDate() === targetD;
      if (!dayMatches) return false;
      return (
        (h.type === "regular" || h.type === "special") &&
        holidayAppliesToEmployee(h, employee)
      );
    });
  }, [record?.date, employee, holidays]);

  // Re-sync when the dialog opens. Prefer schedule **stored on the attendance row** (shift
  // snapshot for that day). Only fall back to the employee's current default/override for
  // that calendar date if the row has no schedule—so changing an employee's shift later
  // does not rewrite every historical record's displayed times.
  useEffect(() => {
    if (record && isOpen) {
      const inStored = (record.scheduleIn ?? "").toString().trim();
      const outStored = (record.scheduleOut ?? "").toString().trim();
      const hasStoredSchedule = inStored !== "" && outStored !== "";
      if (hasStoredSchedule) {
        setEditScheduleIn(inStored);
        setEditScheduleOut(outStored);
      } else {
        const fromEmployee =
          employee && record.date
            ? getScheduledTimesForDate(employee, record.date)
            : null;
        if (fromEmployee) {
          setEditScheduleIn(fromEmployee.scheduleIn);
          setEditScheduleOut(fromEmployee.scheduleOut);
        } else {
          setEditScheduleIn(record.scheduleIn || "");
          setEditScheduleOut(record.scheduleOut || "");
        }
      }
      setEditTimeIn(record.actualIn || "");
      setEditTimeOut(record.actualOut || "");
      setEditOvertime(record.overtime ? record.overtime.toString() : "");
      setEditStatus(
        record.status === "leave" ? "leave_with_pay" : record.status
      );
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
      // Restore manual override state from explicit flags only
      setUseManualLate(record.lateManualOverride === true);
      setUseManualUndertime(record.undertimeManualOverride === true);
    }
  }, [record, employee, isOpen]);

  useEffect(() => {
    if (editStatus === "no_work" && !canUseNoWorkStatus) {
      setEditStatus("absent");
    }
  }, [editStatus, canUseNoWorkStatus]);

  const lunchStart = record?.lunchStart;
  const lunchEnd = record?.lunchEnd;

  const calculatedLate = useMemo(() => {
    if (!editScheduleIn || !editTimeIn || editStatus !== "present") return 0;
    return calculateLate(editScheduleIn, editTimeIn, lunchStart);
  }, [editScheduleIn, editTimeIn, editStatus, lunchStart]);

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
      lunchStart,
      lunchEnd,
    );
  }, [
    editScheduleIn,
    editScheduleOut,
    editTimeIn,
    editTimeOut,
    editStatus,
    lunchStart,
    lunchEnd,
  ]);

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
      // Clear time in/out and overtime for leave types, absent, or no_work
      const clearsTime =
        editStatus === "leave" ||
        editStatus === "leave_with_pay" ||
        editStatus === "leave_without_pay" ||
        editStatus === "absent" ||
        editStatus === "no_work";
      const finalTimeIn = clearsTime ? undefined : editTimeIn || undefined;
      const finalTimeOut = clearsTime ? undefined : editTimeOut || undefined;
      const finalOvertime = clearsTime
        ? undefined
        : editOvertime
          ? parseFloat(editOvertime)
          : undefined;

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
        remarks: editRemarks?.trim() || undefined,
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
            {record?.date && (
              <span className="block font-medium text-foreground mb-1">
                {format(new Date(record.date), "MMM dd, yyyy")} – {format(new Date(record.date), "EEEE")}
              </span>
            )}
            Scheduled times are the shift for this day (saved on this attendance
            record). Edit them if that day used a different shift than your current
            default. Late and undertime follow these times; you can override them
            manually below.
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
                  {editScheduleIn &&
                    editScheduleOut &&
                    scheduleEndsNextCalendarDay(
                      editScheduleIn,
                      editScheduleOut,
                    ) && (
                      <p className="text-xs text-muted-foreground">
                        Overnight shift: scheduled end is the next calendar day
                        after scheduled start.
                      </p>
                    )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editStatus">Status <span className="text-red-500">*</span></Label>
                <Select
                  value={editStatus}
                  onValueChange={(value: any) => {
                    setEditStatus(value);
                    // Auto-clear time in/out for leave types or absent
                    const clearsTime =
                      value === "leave" ||
                      value === "leave_with_pay" ||
                      value === "leave_without_pay" ||
                      value === "absent" ||
                      value === "no_work";
                    if (clearsTime) {
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
                    <SelectItem value="leave_with_pay">Leave with pay</SelectItem>
                    <SelectItem value="leave_without_pay">Leave without pay</SelectItem>
                    {canUseNoWorkStatus && (
                      <SelectItem value="no_work">No work</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <TimePicker
                    value={editTimeIn}
                    onValueChange={setEditTimeIn}
                    disabled={
                      editStatus === "absent" ||
                      editStatus === "leave" ||
                      editStatus === "leave_with_pay" ||
                      editStatus === "leave_without_pay" ||
                      editStatus === "no_work" ||
                      isUpdating
                    }
                    label="Time In"
                    placeholder="Select time in"
                  />
                  {record?.date != null && editTimeIn && (
                    <p className="text-xs text-muted-foreground">
                      Calendar day (Manila):{" "}
                      {formatManilaAttendanceDayLabel(record.date)}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <TimePicker
                    value={editTimeOut}
                    onValueChange={setEditTimeOut}
                    disabled={
                      editStatus === "absent" ||
                      editStatus === "leave" ||
                      editStatus === "leave_with_pay" ||
                      editStatus === "leave_without_pay" ||
                      editStatus === "no_work" ||
                      isUpdating
                    }
                    label="Time Out"
                    placeholder="Select time out"
                  />
                  {record?.date != null &&
                    editTimeIn &&
                    editTimeOut &&
                    (clockOutIsNextCalendarDay(editTimeIn, editTimeOut) ? (
                      <p className="text-xs text-muted-foreground">
                        Interpreted as next calendar day (Manila):{" "}
                        {formatNextManilaCalendarDayFromAttendanceTs(
                          record.date,
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Same calendar day as time in (Manila).
                      </p>
                    ))}
                </div>
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
                          : undertimeHelperText(
                              Math.round(calculatedUndertime * 60),
                              editScheduleOut,
                            )}
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
                    editStatus === "leave_with_pay" ||
                    editStatus === "leave_without_pay" ||
                    editStatus === "no_work" ||
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
