"use client";

import { useState } from "react";
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
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { createAttendance } from "@/app/actions/attendance";
import { useToast } from "@/components/ui/use-toast";

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
    format(new Date(), "yyyy-MM-dd")
  );
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [overtime, setOvertime] = useState("");
  const [status, setStatus] = useState<"present" | "absent" | "leave">(
    "present"
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
        status: status,
      });
      setIsDialogOpen(false);
      setSelectedEmployee("");
      setTimeIn("");
      setTimeOut("");
      setOvertime("");
      setStatus("present");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Attendance Record</DialogTitle>
          <DialogDescription>
            Record employee attendance for a specific date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee">Employee *</Label>
              <select
                id="employee"
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                required
              >
                <option value="">Select employee</option>
                {employees?.map((emp: any) => (
                  <option key={emp._id} value={emp._id}>
                    {emp.personalInfo.firstName} {emp.personalInfo.lastName} -{" "}
                    {emp.employment.employeeId}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select
                value={status}
                onValueChange={(value: any) => {
                  setStatus(value);
                  // Auto-clear time in/out for leave or absent
                  if (value === "leave" || value === "absent") {
                    setTimeIn("");
                    setTimeOut("");
                    setOvertime("");
                  }
                }}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeIn">Time In</Label>
                <Input
                  id="timeIn"
                  type="time"
                  value={timeIn}
                  onChange={(e) => setTimeIn(e.target.value)}
                  disabled={status === "absent" || status === "leave"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeOut">Time Out</Label>
                <Input
                  id="timeOut"
                  type="time"
                  value={timeOut}
                  onChange={(e) => setTimeOut(e.target.value)}
                  disabled={status === "absent" || status === "leave"}
                />
              </div>
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
                disabled={status === "absent" || status === "leave"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Add Attendance</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}








