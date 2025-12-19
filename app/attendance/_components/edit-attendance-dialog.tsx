"use client";

import { useState, useEffect } from "react";
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
import { updateAttendance } from "@/app/actions/attendance";
import { useToast } from "@/components/ui/use-toast";

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
    "present"
  );
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (record) {
      setEditScheduleIn(record.scheduleIn || "");
      setEditScheduleOut(record.scheduleOut || "");
      setEditTimeIn(record.actualIn || "");
      setEditTimeOut(record.actualOut || "");
      setEditOvertime(record.overtime ? record.overtime.toString() : "");
      setEditStatus(record.status);
      setEditRemarks(record.remarks || "");
    }
  }, [record]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Attendance Record</DialogTitle>
          <DialogDescription>
            Update attendance record details.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleUpdate}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editScheduleIn">Scheduled Time In</Label>
                <Input
                  id="editScheduleIn"
                  type="time"
                  value={editScheduleIn}
                  onChange={(e) => setEditScheduleIn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editScheduleOut">Scheduled Time Out</Label>
                <Input
                  id="editScheduleOut"
                  type="time"
                  value={editScheduleOut}
                  onChange={(e) => setEditScheduleOut(e.target.value)}
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
                <Label htmlFor="editTimeIn">Time In</Label>
                <Input
                  id="editTimeIn"
                  type="time"
                  value={editTimeIn}
                  onChange={(e) => setEditTimeIn(e.target.value)}
                  disabled={editStatus === "absent" || editStatus === "leave"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editTimeOut">Time Out</Label>
                <Input
                  id="editTimeOut"
                  type="time"
                  value={editTimeOut}
                  onChange={(e) => setEditTimeOut(e.target.value)}
                  disabled={editStatus === "absent" || editStatus === "leave"}
                />
              </div>
            </div>
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
                disabled={editStatus === "absent" || editStatus === "leave"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRemarks">Notes</Label>
              <Input
                id="editRemarks"
                type="text"
                value={editRemarks}
                onChange={(e) => setEditRemarks(e.target.value)}
                placeholder="Optional note for this date"
              />
            </div>
          </div>
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
              {isUpdating ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}






