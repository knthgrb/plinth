"use client";

import { useState, useMemo, useEffect } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { createAttendance } from "@/actions/attendance";
import { useToast } from "@/components/ui/use-toast";
import { EmployeeSelect } from "@/components/ui/employee-select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateLate,
  calculateUndertime,
  formatTime12Hour,
} from "@/utils/attendance-calculations";

interface AddAttendanceDialogProps {
  employees: any[] | undefined;
  currentOrganizationId: string | null;
  onSuccess?: () => void;
}

export function AddAttendanceDialog({
  employees,
  currentOrganizationId,
  onSuccess,
}: AddAttendanceDialogProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [overtime, setOvertime] = useState("");
  const [status, setStatus] = useState<"present" | "absent" | "leave">(
    "present",
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualLate, setManualLate] = useState<string>("");
  const [manualUndertime, setManualUndertime] = useState<string>("");
  const [useManualLate, setUseManualLate] = useState(false);
  const [useManualUndertime, setUseManualUndertime] = useState(false);
  const [notes, setNotes] = useState("");

  const getDayName = (date: Date): string => {
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return days[date.getDay()];
  };

  // Get employee schedule for calculations
  const employeeSchedule = useMemo(() => {
    if (!selectedEmployee) return null;
    const employee = employees?.find((e: any) => e._id === selectedEmployee);
    if (!employee) return null;
    const dayName = getDayName(new Date(selectedDate));
    return employee.schedule.defaultSchedule[
      dayName as keyof typeof employee.schedule.defaultSchedule
    ];
  }, [selectedEmployee, selectedDate, employees]);

  // Calculate late and undertime automatically
  const calculatedLate = useMemo(() => {
    if (!employeeSchedule || !timeIn || status !== "present") return 0;
    const calculatedUndertime = calculateUndertime(
      employeeSchedule.in,
      employeeSchedule.out,
      timeIn,
      timeOut,
    );
    // If employee has undertime, don't count as late
    return calculateLate(employeeSchedule.in, timeIn, calculatedUndertime > 0);
  }, [employeeSchedule, timeIn, timeOut, status]);

  const calculatedUndertime = useMemo(() => {
    if (!employeeSchedule || !timeIn || !timeOut || status !== "present")
      return 0;
    return calculateUndertime(
      employeeSchedule.in,
      employeeSchedule.out,
      timeIn,
      timeOut,
    );
  }, [employeeSchedule, timeIn, timeOut, status]);

  // Use manual values if enabled, otherwise use calculated
  const finalLate =
    useManualLate && manualLate ? parseFloat(manualLate) : calculatedLate;
  const finalUndertime =
    useManualUndertime && manualUndertime
      ? parseFloat(manualUndertime)
      : calculatedUndertime;

  // Set default schedule times when employee/date changes and status is present
  useEffect(() => {
    if (
      selectedEmployee &&
      selectedDate &&
      status === "present" &&
      employeeSchedule?.isWorkday
    ) {
      // Only set defaults if times are empty
      if (!timeIn && employeeSchedule.in) {
        setTimeIn(employeeSchedule.in);
      }
      if (!timeOut && employeeSchedule.out) {
        setTimeOut(employeeSchedule.out);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedEmployee,
    selectedDate,
    status,
    employeeSchedule?.in,
    employeeSchedule?.out,
    employeeSchedule?.isWorkday,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !selectedEmployee) return;

    try {
      const employee = employees?.find((e: any) => e._id === selectedEmployee);
      if (!employee) return;

      // For present, at least one time should be provided
      if (status === "present" && !timeIn && !timeOut) {
        toast({
          title: "Error",
          description:
            "Please provide at least time in or time out when status is present",
          variant: "destructive",
        });
        return;
      }

      const dayName = getDayName(new Date(selectedDate));
      const daySchedule =
        employee.schedule.defaultSchedule[
          dayName as keyof typeof employee.schedule.defaultSchedule
        ];

      // Clear time in/out for leave or absent
      const finalTimeIn =
        status === "leave" || status === "absent"
          ? undefined
          : timeIn || undefined;
      const finalTimeOut =
        status === "leave" || status === "absent"
          ? undefined
          : timeOut || undefined;
      const finalOvertime =
        status === "leave" || status === "absent"
          ? undefined
          : overtime
            ? parseFloat(overtime)
            : undefined;

      const dateTimestamp = new Date(selectedDate).getTime();

      await createAttendance({
        organizationId: currentOrganizationId,
        employeeId: selectedEmployee,
        date: dateTimestamp,
        scheduleIn: daySchedule.in,
        scheduleOut: daySchedule.out,
        actualIn: finalTimeIn,
        actualOut: finalTimeOut,
        overtime: finalOvertime,
        late: useManualLate
          ? finalLate > 0
            ? finalLate
            : undefined
          : undefined,
        undertime: useManualUndertime
          ? finalUndertime > 0
            ? finalUndertime
            : undefined
          : undefined,
        status: status,
        remarks: notes.trim() || undefined,
      });
      setIsDialogOpen(false);
      setSelectedEmployee("");
      setTimeIn("");
      setTimeOut("");
      setOvertime("");
      setStatus("present");
      setNotes("");
      setManualLate("");
      setManualUndertime("");
      setUseManualLate(false);
      setUseManualUndertime(false);
      toast({
        title: "Success",
        description: "Attendance record created successfully",
        variant: "success",
      });
      onSuccess?.();
    } catch (error) {
      console.error("Error creating attendance:", error);
      toast({
        title: "Error",
        description: "Failed to create attendance record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Attendance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Add Attendance Record
          </DialogTitle>
          <DialogDescription className="text-sm">
            Record employee attendance for a specific date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Date <span className="text-red-500">*</span></Label>
                  <DatePicker
                    value={selectedDate}
                    onValueChange={setSelectedDate}
                    placeholder="Select date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employee">Employee <span className="text-red-500">*</span></Label>
                  <EmployeeSelect
                    employees={employees}
                    value={selectedEmployee}
                    onValueChange={setSelectedEmployee}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status <span className="text-red-500">*</span></Label>
                <Select
                  value={status}
                  onValueChange={(value: any) => {
                    setStatus(value);
                    // Auto-clear time in/out for leave or absent
                    if (value === "leave" || value === "absent") {
                      setTimeIn("");
                      setTimeOut("");
                      setOvertime("");
                    } else if (
                      value === "present" &&
                      employeeSchedule?.isWorkday
                    ) {
                      // Set default schedule times when changing to present
                      if (!timeIn && employeeSchedule.in) {
                        setTimeIn(employeeSchedule.in);
                      }
                      if (!timeOut && employeeSchedule.out) {
                        setTimeOut(employeeSchedule.out);
                      }
                    }
                  }}
                  disabled={isSubmitting}
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
                  value={timeIn}
                  onValueChange={setTimeIn}
                  disabled={
                    status === "absent" || status === "leave" || isSubmitting
                  }
                  label="Time In"
                  placeholder="Select time in"
                />
                <TimePicker
                  value={timeOut}
                  onValueChange={setTimeOut}
                  disabled={
                    status === "absent" || status === "leave" || isSubmitting
                  }
                  label="Time Out"
                  placeholder="Select time out"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overtime">Overtime (hours)</Label>
                <Input
                  id="overtime"
                  type="number"
                  step="0.01"
                  min="0"
                  value={overtime}
                  onChange={(e) => setOvertime(e.target.value)}
                  placeholder="0.00"
                  disabled={
                    status === "absent" || status === "leave" || isSubmitting
                  }
                />
                <p className="text-xs text-gray-500">
                  Optional: Enter overtime hours worked
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note for this attendance record"
                  disabled={isSubmitting}
                  rows={2}
                  className="resize-none"
                />
              </div>
              {status === "present" && employeeSchedule && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <Label htmlFor="late">Late (minutes)</Label>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={useManualLate}
                            onChange={(e) => {
                              setUseManualLate(e.target.checked);
                              if (!e.target.checked) setManualLate("");
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <span className="whitespace-nowrap">
                            Manual override
                          </span>
                        </label>
                      </div>
                      <Input
                        id="late"
                        type="number"
                        step="1"
                        min="0"
                        value={
                          useManualLate ? manualLate : calculatedLate.toString()
                        }
                        onChange={(e) => setManualLate(e.target.value)}
                        placeholder="0"
                        disabled={
                          !useManualLate || isSubmitting
                        }
                        readOnly={!useManualLate}
                        className={!useManualLate ? "bg-gray-50" : ""}
                      />
                      <p className="text-xs text-gray-500">
                        {useManualLate
                          ? "Manually enter late minutes"
                          : `Calculated: ${calculatedLate} minutes (based on schedule ${formatTime12Hour(employeeSchedule.in)})`}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <Label htmlFor="undertime">Undertime (hours)</Label>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={useManualUndertime}
                            onChange={(e) => {
                              setUseManualUndertime(e.target.checked);
                              if (!e.target.checked) setManualUndertime("");
                            }}
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <span className="whitespace-nowrap">
                            Manual override
                          </span>
                        </label>
                      </div>
                      <Input
                        id="undertime"
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
                        disabled={
                          !useManualUndertime || isSubmitting
                        }
                        readOnly={!useManualUndertime}
                        className={!useManualUndertime ? "bg-gray-50" : ""}
                      />
                      <p className="text-xs text-gray-500">
                        {useManualUndertime
                          ? "Manually enter undertime hours"
                          : `Calculated: ${calculatedUndertime.toFixed(2)} hours (8 hours work = ${formatTime12Hour(employeeSchedule.in)} to ${formatTime12Hour(employeeSchedule.out)} with 1hr lunch)`}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Add Attendance"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
