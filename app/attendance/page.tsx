"use client";

import { useState, Suspense, lazy } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Edit, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, getYear } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOrganization } from "@/hooks/organization-context";

// Lazy load modal components
const AddAttendanceDialog = lazy(() =>
  import("./_components/add-attendance-dialog").then((mod) => ({
    default: mod.AddAttendanceDialog,
  }))
);

const BulkAddAttendanceDialog = lazy(() =>
  import("./_components/bulk-add-attendance-dialog").then((mod) => ({
    default: mod.BulkAddAttendanceDialog,
  }))
);

const EditAttendanceDialog = lazy(() =>
  import("./_components/edit-attendance-dialog").then((mod) => ({
    default: mod.EditAttendanceDialog,
  }))
);

export default function AttendancePage() {
  const { currentOrganizationId } = useOrganization();
  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  // Edit attendance states
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);

  // Filter states
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] =
    useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState(
    format(new Date(), "yyyy-MM")
  );
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [timeFormat, setTimeFormat] = useState<"minutes" | "hours">("minutes");

  // Calculate date range for selected month
  const selectedMonthDate = selectedMonth
    ? new Date(selectedMonth + "-01")
    : new Date();
  const monthStart = startOfMonth(selectedMonthDate).getTime();
  const monthEnd = endOfMonth(selectedMonthDate).getTime();

  const attendance = useQuery(
    (api as any).attendance.getAttendance,
    currentOrganizationId && selectedEmployeeFilter
      ? {
          organizationId: currentOrganizationId,
          startDate: monthStart,
          endDate: monthEnd,
          employeeId: selectedEmployeeFilter,
        }
      : "skip"
  );

  // Helper functions for time calculations
  const timeToMinutes = (time: string): number => {
    if (!time) return 0;
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  const calculateLate = (
    scheduleIn: string,
    actualIn?: string
  ): number | null => {
    if (!actualIn) return null;
    const scheduleMinutes = timeToMinutes(scheduleIn);
    const actualMinutes = timeToMinutes(actualIn);
    const late = actualMinutes - scheduleMinutes;
    return late > 0 ? late : null;
  };

  const calculateUndertime = (
    scheduleOut: string,
    actualOut?: string
  ): number | null => {
    if (!actualOut) return null;
    const scheduleMinutes = timeToMinutes(scheduleOut);
    const actualMinutes = timeToMinutes(actualOut);
    const undertime = scheduleMinutes - actualMinutes;
    return undertime > 0 ? undertime : null;
  };

  const calculateOvertime = (
    scheduleOut: string,
    actualOut?: string
  ): number | null => {
    if (!actualOut) return null;
    const scheduleMinutes = timeToMinutes(scheduleOut);
    const actualMinutes = timeToMinutes(actualOut);
    const overtime = actualMinutes - scheduleMinutes;
    return overtime > 0 ? overtime : null;
  };

  const formatTime = (minutes: number | null): string => {
    if (minutes === null) return "-";
    if (timeFormat === "hours") {
      const hours = (minutes / 60).toFixed(2);
      return `${hours} hrs`;
    }
    return `${minutes} mins`;
  };

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    setIsEditDialogOpen(true);
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Attendance</h1>
            <p className="text-gray-600 mt-2">
              Manage employee attendance records
            </p>
          </div>
          <div className="flex gap-2">
            <Suspense fallback={<Button disabled>Add Attendance</Button>}>
              <AddAttendanceDialog
                employees={employees}
                currentOrganizationId={currentOrganizationId}
              />
            </Suspense>
            <Suspense
              fallback={
                <Button variant="outline" disabled>
                  Bulk Add Attendance
                </Button>
              }
            >
              <BulkAddAttendanceDialog
                employees={employees}
                currentOrganizationId={currentOrganizationId}
              />
            </Suspense>
            <Suspense fallback={null}>
              <EditAttendanceDialog
                isOpen={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                record={editingRecord}
                onSuccess={() => {
                  setEditingRecord(null);
                }}
              />
            </Suspense>
          </div>
        </div>

        {/* Attendance Records */}
        <Card className="flex flex-col max-h-[calc(100vh-200px)]">
          <CardHeader className="shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-gray-600">Employee:</Label>
                  <Select
                    value={selectedEmployeeFilter}
                    onValueChange={(value) => setSelectedEmployeeFilter(value)}
                  >
                    <SelectTrigger className="w-[250px]">
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map((emp: any) => (
                        <SelectItem key={emp._id} value={emp._id}>
                          {emp.personalInfo.firstName}{" "}
                          {emp.personalInfo.lastName} -{" "}
                          {emp.employment.employeeId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-gray-600">Month:</Label>
                  <Popover
                    open={monthPickerOpen}
                    onOpenChange={setMonthPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-[180px] justify-start text-left font-normal h-9 px-3 gap-2"
                      >
                        <span>
                          {selectedMonth
                            ? format(
                                new Date(selectedMonth + "-01"),
                                "MMMM yyyy"
                              )
                            : "Select month"}
                        </span>
                        <Calendar className="h-4 w-4 shrink-0 ml-auto" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-4">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              const current = new Date(selectedMonth + "-01");
                              const prevMonth = new Date(
                                current.getFullYear(),
                                current.getMonth() - 1,
                                1
                              );
                              setSelectedMonth(format(prevMonth, "yyyy-MM"));
                            }}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <div className="flex items-center gap-2">
                            <Select
                              value={getYear(
                                new Date(selectedMonth + "-01")
                              ).toString()}
                              onValueChange={(year) => {
                                const current = new Date(selectedMonth + "-01");
                                const newDate = new Date(
                                  parseInt(year),
                                  current.getMonth(),
                                  1
                                );
                                setSelectedMonth(format(newDate, "yyyy-MM"));
                              }}
                            >
                              <SelectTrigger className="w-[100px] h-7 text-sm font-medium">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 10 }, (_, i) => {
                                  const year = new Date().getFullYear() - 5 + i;
                                  return (
                                    <SelectItem
                                      key={year}
                                      value={year.toString()}
                                    >
                                      {year}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              const current = new Date(selectedMonth + "-01");
                              const nextMonth = new Date(
                                current.getFullYear(),
                                current.getMonth() + 1,
                                1
                              );
                              setSelectedMonth(format(nextMonth, "yyyy-MM"));
                            }}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            "January",
                            "February",
                            "March",
                            "April",
                            "May",
                            "June",
                            "July",
                            "August",
                            "September",
                            "October",
                            "November",
                            "December",
                          ].map((month, index) => {
                            const current = new Date(selectedMonth + "-01");
                            const isSelected = current.getMonth() === index;
                            return (
                              <Button
                                key={month}
                                variant={isSelected ? "default" : "ghost"}
                                className="h-9 text-sm"
                                onClick={() => {
                                  const newDate = new Date(
                                    current.getFullYear(),
                                    index,
                                    1
                                  );
                                  setSelectedMonth(format(newDate, "yyyy-MM"));
                                  setMonthPickerOpen(false);
                                }}
                              >
                                {month.slice(0, 3)}
                              </Button>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-3 border-t">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => {
                              setSelectedMonth(format(new Date(), "yyyy-MM"));
                              setMonthPickerOpen(false);
                            }}
                          >
                            This month
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => {
                              setSelectedMonth(format(new Date(), "yyyy-MM"));
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-600">Time Format:</Label>
                <Select
                  value={timeFormat}
                  onValueChange={(value: "minutes" | "hours") =>
                    setTimeFormat(value)
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {!selectedEmployeeFilter ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium mb-2">
                  Please select an employee
                </p>
                <p className="text-sm">
                  Choose an employee from the list to view their attendance
                  records
                </p>
              </div>
            ) : attendance === undefined ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
                  <p className="text-sm text-gray-600">Loading attendance...</p>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Time In</TableHead>
                      <TableHead>Time Out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>Undertime</TableHead>
                      <TableHead>Overtime</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance?.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center text-gray-500"
                        >
                          No attendance records found for selected employee in{" "}
                          {format(selectedMonthDate, "MMMM yyyy")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      attendance?.map((record: any) => {
                        // Don't calculate late, undertime, or overtime for absent or leave
                        const isAbsentOrLeave =
                          record.status === "absent" ||
                          record.status === "leave";
                        const late = isAbsentOrLeave
                          ? null
                          : calculateLate(record.scheduleIn, record.actualIn);
                        const undertime = isAbsentOrLeave
                          ? null
                          : calculateUndertime(
                              record.scheduleOut,
                              record.actualOut
                            );
                        const overtime = isAbsentOrLeave
                          ? null
                          : calculateOvertime(
                              record.scheduleOut,
                              record.actualOut
                            );
                        return (
                          <TableRow key={record._id}>
                            <TableCell>
                              {format(new Date(record.date), "MMM dd, yyyy")}
                            </TableCell>
                            <TableCell>
                              {record.status === "leave" ||
                              record.status === "absent"
                                ? "-"
                                : record.actualIn || "-"}
                            </TableCell>
                            <TableCell>
                              {record.status === "leave" ||
                              record.status === "absent"
                                ? "-"
                                : record.actualOut || "-"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={
                                  record.status === "present"
                                    ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none"
                                    : record.status === "leave"
                                      ? "bg-blue-100 text-blue-800 border-blue-300 font-normal rounded-md hover:bg-blue-100 focus:ring-0 focus:ring-offset-0 transition-none"
                                      : record.status === "absent"
                                        ? "bg-red-100 text-red-800 border-red-300 font-normal rounded-md hover:bg-red-100 focus:ring-0 focus:ring-offset-0 transition-none"
                                        : "rounded-md focus:ring-0 focus:ring-offset-0 transition-none font-normal"
                                }
                              >
                                {record.status}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className={late ? "text-red-600 font-medium" : ""}
                            >
                              {formatTime(late)}
                            </TableCell>
                            <TableCell
                              className={
                                undertime ? "text-orange-600 font-medium" : ""
                              }
                            >
                              {formatTime(undertime)}
                            </TableCell>
                            <TableCell
                              className={
                                !isAbsentOrLeave &&
                                (record.overtime || overtime)
                                  ? "text-green-600 font-medium"
                                  : ""
                              }
                            >
                              {isAbsentOrLeave
                                ? "-"
                                : record.overtime
                                  ? timeFormat === "hours"
                                    ? `${record.overtime.toFixed(2)} hrs`
                                    : `${Math.round(record.overtime * 60)} mins`
                                  : formatTime(overtime)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(record)}
                                className="h-8 w-8 p-0"
                                title="Edit attendance"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
