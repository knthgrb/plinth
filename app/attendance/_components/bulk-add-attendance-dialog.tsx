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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { bulkCreateAttendance } from "@/app/actions/attendance";
import { useToast } from "@/components/ui/use-toast";

interface BulkAddAttendanceDialogProps {
  employees: any[] | undefined;
  currentOrganizationId: string | null;
  onSuccess?: () => void;
}

export function BulkAddAttendanceDialog({
  employees,
  currentOrganizationId,
  onSuccess,
}: BulkAddAttendanceDialogProps) {
  const { toast } = useToast();
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [bulkEndDate, setBulkEndDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [bulkSelectedEmployee, setBulkSelectedEmployee] = useState("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [includeSunday, setIncludeSunday] = useState(false);
  // Map of date timestamp to { timeIn, timeOut, status, overtime }
  const [bulkDayTimes, setBulkDayTimes] = useState<
    Record<
      number,
      {
        timeIn: string;
        timeOut: string;
        status: "present" | "absent" | "leave";
        overtime: string;
      }
    >
  >({});
  // Set of excluded date timestamps
  const [excludedDates, setExcludedDates] = useState<Set<number>>(new Set());

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

  // Generate list of all dates that could be included (before filtering excluded ones)
  const getAllBulkDates = () => {
    if (!bulkSelectedEmployee || !bulkStartDate || !bulkEndDate) return [];

    const employee = employees?.find(
      (e: any) => e._id === bulkSelectedEmployee
    );
    if (!employee) return [];

    const startDate = new Date(bulkStartDate);
    const endDate = new Date(bulkEndDate);
    const dates: Array<{ date: Date; timestamp: number; dayName: string }> = [];

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayName = getDayName(currentDate);
      const daySchedule =
        employee.schedule.defaultSchedule[
          dayName as keyof typeof employee.schedule.defaultSchedule
        ];

      const isSaturday = dayName === "saturday";
      const isSunday = dayName === "sunday";
      const shouldInclude =
        daySchedule.isWorkday ||
        (isSaturday && includeSaturday) ||
        (isSunday && includeSunday);

      if (shouldInclude) {
        const dateTimestamp = new Date(currentDate);
        dateTimestamp.setHours(0, 0, 0, 0);
        dates.push({
          date: new Date(currentDate),
          timestamp: dateTimestamp.getTime(),
          dayName,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  };

  // Get filtered dates (excluding removed ones)
  const getBulkDates = () => {
    return getAllBulkDates().filter(
      (dateInfo) => !excludedDates.has(dateInfo.timestamp)
    );
  };

  // Get excluded dates info
  const getExcludedDates = () => {
    const allDates = getAllBulkDates();
    return allDates.filter((dateInfo) => excludedDates.has(dateInfo.timestamp));
  };

  // Initialize times when dates change
  useEffect(() => {
    if (!employees || !bulkSelectedEmployee || !bulkStartDate || !bulkEndDate) {
      return;
    }

    const dates = getAllBulkDates();

    // Clean up excluded dates that are no longer in the range
    setExcludedDates((prev) => {
      const dateTimestamps = new Set(dates.map((d) => d.timestamp));
      const newExcluded = new Set<number>();
      prev.forEach((timestamp) => {
        if (dateTimestamps.has(timestamp)) {
          newExcluded.add(timestamp);
        }
      });
      return newExcluded;
    });

    // Initialize times for new dates
    setBulkDayTimes((prev) => {
      // Merge existing times with new ones, preserving user input
      const merged = { ...prev };
      dates.forEach((dateInfo) => {
        if (!merged[dateInfo.timestamp]) {
          merged[dateInfo.timestamp] = {
            timeIn: "",
            timeOut: "",
            status: "present",
            overtime: "",
          };
        }
      });
      return merged;
    });
  }, [
    bulkStartDate,
    bulkEndDate,
    bulkSelectedEmployee,
    includeSaturday,
    includeSunday,
    employees,
  ]);

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !bulkSelectedEmployee) return;

    setIsSubmittingBulk(true);
    try {
      const employee = employees?.find(
        (e: any) => e._id === bulkSelectedEmployee
      );
      if (!employee) {
        toast({
          title: "Error",
          description: "Employee not found",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      const startDate = new Date(bulkStartDate);
      const endDate = new Date(bulkEndDate);

      if (startDate > endDate) {
        toast({
          title: "Error",
          description: "Start date must be before or equal to end date",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      // Generate entries for each day in the range
      const dates = getBulkDates();
      const entries: Array<{
        organizationId: string;
        employeeId: string;
        date: number;
        scheduleIn: string;
        scheduleOut: string;
        actualIn?: string;
        actualOut?: string;
        overtime?: number;
        status: "present" | "absent" | "leave";
      }> = [];

      for (const dateInfo of dates) {
        const daySchedule =
          employee.schedule.defaultSchedule[
            dateInfo.dayName as keyof typeof employee.schedule.defaultSchedule
          ];
        const dayTimes = bulkDayTimes[dateInfo.timestamp];

        if (!dayTimes || !dayTimes.status) {
          toast({
            title: "Error",
            description: `Please provide status for ${format(dateInfo.date, "MMM dd, yyyy")}`,
            variant: "destructive",
          });
          setIsSubmittingBulk(false);
          return;
        }

        // For absent or leave, times are optional
        // For present, at least one time should be provided
        if (
          dayTimes.status === "present" &&
          !dayTimes.timeIn &&
          !dayTimes.timeOut
        ) {
          toast({
            title: "Error",
            description: `Please provide at least time in or time out for ${format(dateInfo.date, "MMM dd, yyyy")} when status is present`,
            variant: "destructive",
          });
          setIsSubmittingBulk(false);
          return;
        }

        // Clear time in/out for leave or absent
        const finalTimeIn =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.timeIn || undefined;
        const finalTimeOut =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.timeOut || undefined;
        const finalOvertime =
          dayTimes.status === "leave" || dayTimes.status === "absent"
            ? undefined
            : dayTimes.overtime
              ? parseFloat(dayTimes.overtime)
              : undefined;

        entries.push({
          organizationId: currentOrganizationId,
          employeeId: bulkSelectedEmployee,
          date: dateInfo.timestamp,
          scheduleIn: daySchedule.in,
          scheduleOut: daySchedule.out,
          actualIn: finalTimeIn,
          actualOut: finalTimeOut,
          overtime: finalOvertime,
          status: dayTimes.status,
        });
      }

      if (entries.length === 0) {
        toast({
          title: "Error",
          description: "No workdays found in the selected date range",
          variant: "destructive",
        });
        setIsSubmittingBulk(false);
        return;
      }

      await bulkCreateAttendance(entries);

      setIsBulkDialogOpen(false);
      setBulkSelectedEmployee("");
      setIncludeSaturday(false);
      setIncludeSunday(false);
      setBulkDayTimes({});
      setExcludedDates(new Set());
      toast({
        title: "Success",
        description: `Successfully created ${entries.length} attendance record(s)`,
        variant: "success",
      });
      onSuccess?.();
    } catch (error) {
      console.error("Error creating bulk attendance:", error);
      toast({
        title: "Error",
        description:
          "Failed to create bulk attendance records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  return (
    <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Bulk Add Attendance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Add Attendance Records</DialogTitle>
          <DialogDescription>
            Add attendance records for an employee across a date range. Only
            workdays based on the employee's schedule will be included. You can
            optionally include Saturdays and Sundays. Enter time in and time out
            for each day below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleBulkSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bulkEmployee">Employee *</Label>
              <select
                id="bulkEmployee"
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                value={bulkSelectedEmployee}
                onChange={(e) => setBulkSelectedEmployee(e.target.value)}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bulkStartDate">Start Date *</Label>
                <Input
                  id="bulkStartDate"
                  type="date"
                  value={bulkStartDate}
                  onChange={(e) => setBulkStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bulkEndDate">End Date *</Label>
                <Input
                  id="bulkEndDate"
                  type="date"
                  value={bulkEndDate}
                  onChange={(e) => setBulkEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-3">
              <Label>Include Weekends</Label>
              <div className="flex gap-6">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="includeSaturday"
                    checked={includeSaturday}
                    onChange={(e) => setIncludeSaturday(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label
                    htmlFor="includeSaturday"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Saturday
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="includeSunday"
                    checked={includeSunday}
                    onChange={(e) => setIncludeSunday(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label
                    htmlFor="includeSunday"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Sunday
                  </Label>
                </div>
              </div>
            </div>
            {bulkSelectedEmployee && bulkStartDate && bulkEndDate && (
              <div className="space-y-3">
                <Label>Enter Time In/Out for Each Day *</Label>
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[150px]">Date</TableHead>
                          <TableHead className="w-[100px]">Day</TableHead>
                          <TableHead className="w-[120px]">Time In</TableHead>
                          <TableHead className="w-[120px]">Time Out</TableHead>
                          <TableHead className="w-[120px]">Status *</TableHead>
                          <TableHead className="w-[120px]">
                            Overtime (hrs)
                          </TableHead>
                          <TableHead className="w-[80px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {getBulkDates().map((dateInfo) => {
                          const dayTimes = bulkDayTimes[dateInfo.timestamp] || {
                            timeIn: "",
                            timeOut: "",
                            status: "present",
                            overtime: "",
                          };
                          return (
                            <TableRow key={dateInfo.timestamp}>
                              <TableCell className="font-medium">
                                {format(dateInfo.date, "MMM dd, yyyy")}
                              </TableCell>
                              <TableCell className="text-gray-600 capitalize">
                                {dateInfo.dayName}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={dayTimes.timeIn}
                                  onChange={(e) =>
                                    setBulkDayTimes((prev) => ({
                                      ...prev,
                                      [dateInfo.timestamp]: {
                                        timeIn: e.target.value,
                                        timeOut:
                                          prev[dateInfo.timestamp]?.timeOut ||
                                          "",
                                        status:
                                          prev[dateInfo.timestamp]?.status ||
                                          "present",
                                        overtime:
                                          prev[dateInfo.timestamp]?.overtime ||
                                          "",
                                      },
                                    }))
                                  }
                                  className="w-full"
                                  disabled={
                                    dayTimes.status === "absent" ||
                                    dayTimes.status === "leave"
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={dayTimes.timeOut}
                                  onChange={(e) =>
                                    setBulkDayTimes((prev) => ({
                                      ...prev,
                                      [dateInfo.timestamp]: {
                                        timeIn:
                                          prev[dateInfo.timestamp]?.timeIn ||
                                          "",
                                        timeOut: e.target.value,
                                        status:
                                          prev[dateInfo.timestamp]?.status ||
                                          "present",
                                        overtime:
                                          prev[dateInfo.timestamp]?.overtime ||
                                          "",
                                      },
                                    }))
                                  }
                                  className="w-full"
                                  disabled={
                                    dayTimes.status === "absent" ||
                                    dayTimes.status === "leave"
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={dayTimes.status}
                                  onValueChange={(value: any) => {
                                    // Auto-clear time in/out for leave or absent
                                    setBulkDayTimes((prev) => ({
                                      ...prev,
                                      [dateInfo.timestamp]: {
                                        timeIn:
                                          value === "leave" ||
                                          value === "absent"
                                            ? ""
                                            : prev[dateInfo.timestamp]
                                                ?.timeIn || "",
                                        timeOut:
                                          value === "leave" ||
                                          value === "absent"
                                            ? ""
                                            : prev[dateInfo.timestamp]
                                                ?.timeOut || "",
                                        status: value,
                                        overtime:
                                          value === "leave" ||
                                          value === "absent"
                                            ? ""
                                            : prev[dateInfo.timestamp]
                                                ?.overtime || "",
                                      },
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="present">
                                      Present
                                    </SelectItem>
                                    <SelectItem value="absent">
                                      Absent
                                    </SelectItem>
                                    <SelectItem value="leave">Leave</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={dayTimes.overtime}
                                  onChange={(e) =>
                                    setBulkDayTimes((prev) => ({
                                      ...prev,
                                      [dateInfo.timestamp]: {
                                        timeIn:
                                          prev[dateInfo.timestamp]?.timeIn ||
                                          "",
                                        timeOut:
                                          prev[dateInfo.timestamp]?.timeOut ||
                                          "",
                                        status:
                                          prev[dateInfo.timestamp]?.status ||
                                          "present",
                                        overtime: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full"
                                  placeholder="0.00"
                                  disabled={
                                    dayTimes.status === "absent" ||
                                    dayTimes.status === "leave"
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setExcludedDates((prev) => {
                                      const newSet = new Set(prev);
                                      newSet.add(dateInfo.timestamp);
                                      return newSet;
                                    });
                                  }}
                                  className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600"
                                  title="Remove this date"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                {getBulkDates().length === 0 &&
                  getExcludedDates().length === 0 && (
                    <p className="text-sm text-gray-500">
                      No days to include. Please check your date range and
                      weekend options.
                    </p>
                  )}
                {getExcludedDates().length > 0 && (
                  <div className="mt-4 space-y-2">
                    <Label className="text-sm text-gray-600">
                      Removed Dates (Click to restore)
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {getExcludedDates().map((dateInfo) => (
                        <Button
                          key={dateInfo.timestamp}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setExcludedDates((prev) => {
                              const newSet = new Set(prev);
                              newSet.delete(dateInfo.timestamp);
                              return newSet;
                            });
                          }}
                          className="text-xs h-8 gap-1.5 hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                        >
                          <RotateCcw className="h-3 w-3" />
                          {format(dateInfo.date, "MMM dd")} (
                          {dateInfo.dayName.slice(0, 3)})
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBulkDialogOpen(false)}
              disabled={isSubmittingBulk}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmittingBulk}>
              {isSubmittingBulk ? "Creating..." : "Create Bulk Attendance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}








