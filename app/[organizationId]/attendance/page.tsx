"use client";

import { useState, useEffect, Suspense, lazy } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
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
import {
  Calendar,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  BarChart2,
  Plus,
  Loader2,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfDay,
  getYear,
  eachDayOfInterval,
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/organization-context";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";
import { formatTime12Hour } from "@/utils/attendance-calculations";

// Lazy load modal components
const AddAttendanceDialog = lazy(() =>
  import("./_components/add-attendance-dialog").then((mod) => ({
    default: mod.AddAttendanceDialog,
  })),
);

const BulkAddAttendanceDialog = lazy(() =>
  import("./_components/bulk-add-attendance-dialog").then((mod) => ({
    default: mod.BulkAddAttendanceDialog,
  })),
);

const EditAttendanceDialog = lazy(() =>
  import("./_components/edit-attendance-dialog").then((mod) => ({
    default: mod.EditAttendanceDialog,
  })),
);

const CreateEmployeeDialog = lazy(() =>
  import("../employees/_components/create-employee-dialog").then((mod) => ({
    default: mod.CreateEmployeeDialog,
  })),
);

export default function AttendancePage() {
  const { currentOrganizationId } = useOrganization();
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const isReadOnly = user?.role === "employee";

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20; // min 20 per page

  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

  const [selectedEmployeeFilter, setSelectedEmployeeFilter] =
    useState<string>("");
  const individualPageSize = 20;
  const [individualPage, setIndividualPage] = useState(1);

  // Edit attendance states
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  // Delete confirm dialog
  const [recordToDelete, setRecordToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Create employee modal (when no employees)
  const [isCreateEmployeeOpen, setIsCreateEmployeeOpen] = useState(false);

  // Filter states
  const [selectedMonth, setSelectedMonth] = useState(
    format(new Date(), "yyyy-MM"),
  );
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [timeFormat, setTimeFormat] = useState<"minutes" | "hours">("minutes");
  // Summary modal has its own month/year for tracking back
  const [summaryMonth, setSummaryMonth] = useState(
    format(new Date(), "yyyy-MM"),
  );

  useEffect(() => {
    setIndividualPage(1);
  }, [selectedEmployeeFilter, selectedMonth]);

  // When opening summary modal, default to current page month
  useEffect(() => {
    if (isSummaryModalOpen) setSummaryMonth(selectedMonth);
  }, [isSummaryModalOpen, selectedMonth]);

  // Calculate date range for selected month
  const selectedMonthDate = selectedMonth
    ? new Date(selectedMonth + "-01")
    : new Date();
  const monthStart = startOfMonth(selectedMonthDate).getTime();
  const monthEnd = endOfMonth(selectedMonthDate).getTime();

  // Summary modal month range
  const summaryMonthDate = summaryMonth
    ? new Date(summaryMonth + "-01")
    : new Date();
  const summaryMonthStart = startOfMonth(summaryMonthDate).getTime();
  const summaryMonthEnd = endOfMonth(summaryMonthDate).getTime();
  const summaryMonthDates = eachDayOfInterval({
    start: startOfMonth(summaryMonthDate),
    end: endOfMonth(summaryMonthDate),
  });

  // All employees attendance (for summary modal) — uses summary month when modal open
  const allAttendance = useQuery(
    (api as any).attendance.getAttendance,
    currentOrganizationId && isSummaryModalOpen
      ? {
          organizationId: currentOrganizationId,
          startDate: summaryMonthStart,
          endDate: summaryMonthEnd,
        }
      : "skip",
  );

  // Individual attendance (default view)
  const individualAttendance = useQuery(
    (api as any).attendance.getAttendance,
    currentOrganizationId &&
      selectedEmployeeFilter &&
      selectedEmployeeFilter !== "__create__"
      ? {
          organizationId: currentOrganizationId,
          startDate: monthStart,
          endDate: monthEnd,
          employeeId: selectedEmployeeFilter,
        }
      : "skip",
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
    actualIn?: string,
  ): number | null => {
    if (!actualIn) return null;
    const scheduleMinutes = timeToMinutes(scheduleIn);
    const actualMinutes = timeToMinutes(actualIn);
    const late = actualMinutes - scheduleMinutes;
    return late > 0 ? late : null;
  };

  const calculateUndertime = (
    scheduleOut: string,
    actualOut?: string,
  ): number | null => {
    if (!actualOut) return null;
    const scheduleMinutes = timeToMinutes(scheduleOut);
    const actualMinutes = timeToMinutes(actualOut);
    const undertime = scheduleMinutes - actualMinutes;
    return undertime > 0 ? undertime : null;
  };

  const formatTime = (minutes: number | null): string => {
    if (minutes === null) return "-";
    if (timeFormat === "hours") {
      const hours = (minutes / 60).toFixed(2);
      return `${hours} hrs`;
    }
    return `${minutes} mins`;
  };

  const deleteAttendanceMutation = useMutation(
    (api as any).attendance.deleteAttendance,
  );

  const handleEdit = (record: any) => {
    setEditingRecord(record);
    setIsEditDialogOpen(true);
  };

  const handleDeleteClick = (record: any) => {
    setDeleteError(null);
    setRecordToDelete(record);
  };

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAttendanceMutation({ attendanceId: recordToDelete._id });
      setRecordToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete attendance record.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    if (!isDeleting) {
      setRecordToDelete(null);
      setDeleteError(null);
    }
  };

  // Generate all dates in the selected month
  // Transform attendance data by employee and date (for summary modal — uses summary month)
  const attendanceByEmployeeAndDate = (() => {
    if (!allAttendance || !employees) return {};

    const result: Record<string, Record<number, any>> = {};

    // Initialize all employees
    employees.forEach((emp: any) => {
      result[emp._id] = {};
      summaryMonthDates.forEach((date) => {
        const dateTimestamp = date.getTime();
        result[emp._id][dateTimestamp] = null;
      });
    });

    // Fill in attendance records — key by local start-of-day so stored UTC-midnight dates match (local midnight)
    allAttendance.forEach((record: any) => {
      if (!result[record.employeeId]) {
        result[record.employeeId] = {};
      }
      const dayKey = startOfDay(new Date(record.date)).getTime();
      result[record.employeeId][dayKey] = record;
    });

    return result;
  })();

  // Paginate employees
  const paginatedEmployees = (() => {
    if (!employees) return [];
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return employees.slice(start, end);
  })();

  const totalPages = employees ? Math.ceil(employees.length / pageSize) : 1;

  // Individual view: sort by date descending (most recent first), paginate 20
  const sortedIndividualAttendance = (() => {
    if (!individualAttendance) return [];
    return [...individualAttendance].sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  })();
  const paginatedIndividualAttendance = sortedIndividualAttendance.slice(
    (individualPage - 1) * individualPageSize,
    individualPage * individualPageSize,
  );
  const totalIndividualPages = Math.ceil(
    sortedIndividualAttendance.length / individualPageSize,
  );

  return (
    <MainLayout>
      <div className="p-3 sm:p-4 md:p-6 lg:p-8">
        <div className="mb-4 sm:mb-6 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Attendance
              </h1>
            </div>
            {!isReadOnly && (
              <div className="flex flex-col sm:flex-row gap-2 sm:items-start shrink-0">
                <Button
                  variant="outline"
                  className="h-8 shrink-0 rounded-lg border-[#DDDDDD] bg-white text-sm shadow-sm [&_svg]:text-current hover:bg-[rgb(250,250,250)] hover:border-[rgb(150,150,150)]"
                  style={{ color: "rgb(64,64,64)" }}
                  onClick={() => setIsSummaryModalOpen(true)}
                >
                  <BarChart2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  View month summary
                </Button>
                <Suspense
                  fallback={
                    <Button
                      variant="outline"
                      disabled
                      className="w-full sm:w-auto"
                    >
                      Bulk Add Attendance
                    </Button>
                  }
                >
                  <BulkAddAttendanceDialog
                    employees={employees}
                    currentOrganizationId={currentOrganizationId}
                  />
                </Suspense>
                <Suspense
                  fallback={
                    <Button disabled className="w-full sm:w-auto">
                      Add Attendance
                    </Button>
                  }
                >
                  <AddAttendanceDialog
                    employees={employees}
                    currentOrganizationId={currentOrganizationId}
                  />
                </Suspense>
              </div>
            )}
          </div>
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

          {/* Delete attendance confirm dialog */}
          <Dialog
            open={!!recordToDelete}
            onOpenChange={(open) => {
              if (!open) handleDeleteCancel();
            }}
          >
            <DialogContent
              className="max-w-sm"
              hideCloseIcon={isDeleting}
              onPointerDownOutside={(e) => isDeleting && e.preventDefault()}
              onEscapeKeyDown={(e) => isDeleting && e.preventDefault()}
            >
              <DialogHeader>
                <DialogTitle>Delete attendance record?</DialogTitle>
                <DialogDescription>
                  {recordToDelete
                    ? `This will permanently remove the attendance record for ${format(new Date(recordToDelete.date), "MMM dd, yyyy")}. This cannot be undone.`
                    : ""}
                </DialogDescription>
              </DialogHeader>
              {deleteError && (
                <p className="text-sm text-red-600">{deleteError}</p>
              )}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Attendance Records */}
        <Card className="flex flex-col max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-200px)]">
          <CardHeader className="shrink-0 p-4 sm:p-5 md:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 flex-wrap">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
                  <Select
                    value={selectedEmployeeFilter}
                    onValueChange={(value) => {
                      if (value === "__create__") {
                        setSelectedEmployeeFilter("__create__");
                        setIsCreateEmployeeOpen(true);
                        return;
                      }
                      setSelectedEmployeeFilter(value);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[200px] h-8 text-xs">
                      <SelectValue placeholder="Employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees && employees.length === 0 ? (
                        <SelectItem value="__create__">
                          <span className="flex items-center gap-2 text-brand-purple font-medium">
                            <Plus className="h-4 w-4" />
                            Add employee
                          </span>
                        </SelectItem>
                      ) : (
                        employees?.map((emp: any) => (
                          <SelectItem key={emp._id} value={emp._id}>
                            {emp.personalInfo.firstName}{" "}
                            {emp.personalInfo.lastName}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {employees && employees.length === 0 && (
                    <Suspense fallback={null}>
                      <CreateEmployeeDialog
                        open={isCreateEmployeeOpen}
                        onOpenChange={(open) => {
                          setIsCreateEmployeeOpen(open);
                          if (!open && selectedEmployeeFilter === "__create__")
                            setSelectedEmployeeFilter("");
                        }}
                        organizationId={currentOrganizationId}
                        onSuccess={(newEmployeeId) => {
                          setSelectedEmployeeFilter(newEmployeeId);
                        }}
                      />
                    </Suspense>
                  )}
                  <Popover
                    open={monthPickerOpen}
                    onOpenChange={setMonthPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full sm:w-[140px] h-8 px-3 justify-between text-left font-semibold text-xs rounded-lg border-[#DDDDDD] hover:border-[rgb(120,120,120)] bg-[rgb(250,250,250)] text-[rgb(64,64,64)] hover:bg-[rgb(245,245,245)] hover:text-[rgb(64,64,64)] shadow-sm"
                      >
                        <span className="truncate">
                          {selectedMonth
                            ? format(
                                new Date(selectedMonth + "-01"),
                                "MMMM yyyy",
                              )
                            : "Month"}
                        </span>
                        <Calendar className="h-3.5 w-3.5 shrink-0 ml-1.5 opacity-80" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[90vw] sm:w-auto p-0"
                      align="start"
                    >
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
                                1,
                              );
                              setSelectedMonth(format(prevMonth, "yyyy-MM"));
                            }}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <div className="flex items-center gap-2">
                            <Select
                              value={getYear(
                                new Date(selectedMonth + "-01"),
                              ).toString()}
                              onValueChange={(year) => {
                                const current = new Date(selectedMonth + "-01");
                                const newDate = new Date(
                                  parseInt(year),
                                  current.getMonth(),
                                  1,
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
                                1,
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
                                    1,
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
                  <Select
                    value={timeFormat}
                    onValueChange={(value: "minutes" | "hours") =>
                      setTimeFormat(value)
                    }
                  >
                    <SelectTrigger className="w-full sm:w-[100px] h-8 text-xs">
                      <SelectValue placeholder="Time format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {!selectedEmployeeFilter ||
            selectedEmployeeFilter === "__create__" ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium mb-2">
                  {employees && employees.length === 0
                    ? "No employees yet"
                    : "Please select an employee"}
                </p>
                <p className="text-sm">
                  {employees && employees.length === 0
                    ? "Use the dropdown above to create an employee, then view their attendance here."
                    : "Choose an employee from the list to view their attendance records"}
                </p>
              </div>
            ) : individualAttendance === undefined ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#695eff] mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Loading attendance...</p>
                </div>
              </div>
            ) : (
              <>
                <div className="h-full overflow-y-auto overflow-x-auto -mx-4 sm:mx-0">
                  <div className="min-w-full inline-block align-middle">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead className="min-w-[100px] sm:min-w-[120px]">
                            Date
                          </TableHead>
                          <TableHead className="min-w-[80px] sm:min-w-[100px]">
                            Time In
                          </TableHead>
                          <TableHead className="min-w-[80px] sm:min-w-[100px]">
                            Time Out
                          </TableHead>
                          <TableHead className="min-w-[80px] sm:min-w-[100px]">
                            Status
                          </TableHead>
                          <TableHead className="min-w-[70px] sm:min-w-[80px] hidden sm:table-cell">
                            Late
                          </TableHead>
                          <TableHead className="min-w-[80px] sm:min-w-[100px] hidden md:table-cell">
                            Undertime
                          </TableHead>
                          <TableHead className="min-w-[80px] sm:min-w-[100px] hidden md:table-cell">
                            Overtime
                          </TableHead>
                          {!isReadOnly && (
                            <TableHead className="min-w-[70px] sm:min-w-[80px]">
                              Actions
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedIndividualAttendance.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={isReadOnly ? 7 : 8}
                              className="text-center text-gray-500 py-8"
                            >
                              <p className="text-sm sm:text-base">
                                No attendance records found for selected
                                employee in{" "}
                                {format(selectedMonthDate, "MMMM yyyy")}
                              </p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedIndividualAttendance.map((record: any) => {
                            const isAbsentOrLeave =
                              record.status === "absent" ||
                              record.status === "leave";
                            // Late and undertime: use stored value or auto-calculate (only these are auto-calculated)
                            const late = isAbsentOrLeave
                              ? null
                              : record.late != null
                                ? record.late
                                : calculateLate(
                                    record.scheduleIn,
                                    record.actualIn,
                                  );
                            const undertime = isAbsentOrLeave
                              ? null
                              : record.undertime != null
                                ? Math.round(record.undertime * 60) // stored in hours, display in mins
                                : calculateUndertime(
                                    record.scheduleOut,
                                    record.actualOut,
                                  );
                            const hasLate = late !== null && late > 0;
                            const hasUndertime =
                              undertime !== null && undertime > 0;
                            return (
                              <TableRow key={record._id}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span>
                                        {format(
                                          new Date(record.date),
                                          "MMM dd, yyyy",
                                        )}
                                      </span>
                                      {record.remarks?.trim() ? (
                                        <Popover>
                                          <PopoverTrigger asChild>
                                            <button
                                              type="button"
                                              className="inline-flex items-center justify-center rounded-full w-5 h-5 bg-[#695eff]/15 text-[#695eff] hover:bg-[#695eff]/25 focus:outline-none focus:ring-2 focus:ring-[#695eff] focus:ring-offset-1 shrink-0"
                                              title="View note"
                                            >
                                              <MessageSquare className="h-3 w-3" />
                                            </button>
                                          </PopoverTrigger>
                                          <PopoverContent
                                            className="w-64 sm:w-80 p-3 text-left"
                                            align="start"
                                            side="top"
                                          >
                                            <p className="text-xs font-medium text-[#695eff] mb-1">
                                              Note
                                            </p>
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                              {record.remarks}
                                            </p>
                                          </PopoverContent>
                                        </Popover>
                                      ) : null}
                                    </div>
                                    <span className="text-xs text-gray-500 sm:hidden">
                                      {record.status === "leave" ||
                                      record.status === "absent"
                                        ? "-"
                                        : `${record.actualIn ? formatTime12Hour(record.actualIn) : "-"} - ${record.actualOut ? formatTime12Hour(record.actualOut) : "-"}`}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell
                                  className={`hidden sm:table-cell ${hasLate ? "text-red-600 font-medium" : ""}`}
                                >
                                  {record.status === "leave" ||
                                  record.status === "absent"
                                    ? "-"
                                    : record.actualIn
                                      ? formatTime12Hour(record.actualIn)
                                      : "-"}
                                </TableCell>
                                <TableCell
                                  className={`hidden sm:table-cell ${hasUndertime ? "text-red-600 font-medium" : ""}`}
                                >
                                  {record.status === "leave" ||
                                  record.status === "absent"
                                    ? "-"
                                    : record.actualOut
                                      ? formatTime12Hour(record.actualOut)
                                      : "-"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="secondary"
                                    className={getStatusBadgeClass(
                                      record.status,
                                    )}
                                    style={getStatusBadgeStyle(record.status)}
                                  >
                                    {record.status}
                                  </Badge>
                                </TableCell>
                                <TableCell
                                  className={`hidden sm:table-cell ${late ? "text-red-600 font-medium" : ""}`}
                                >
                                  {formatTime(late)}
                                </TableCell>
                                <TableCell
                                  className={`hidden md:table-cell ${hasUndertime ? "text-red-600 font-medium" : ""}`}
                                >
                                  {formatTime(undertime)}
                                </TableCell>
                                <TableCell
                                  className={`hidden md:table-cell ${!isAbsentOrLeave && record.overtime != null && record.overtime > 0 ? "text-green-600 font-medium" : ""}`}
                                >
                                  {isAbsentOrLeave
                                    ? "-"
                                    : record.overtime != null &&
                                        record.overtime > 0
                                      ? timeFormat === "hours"
                                        ? `${record.overtime.toFixed(2)} hrs`
                                        : `${Math.round(record.overtime * 60)} mins`
                                      : "-"}
                                </TableCell>
                                <TableCell>
                                  {!isReadOnly && (
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleEdit(record)}
                                        className="h-8 w-8 p-0"
                                        title="Edit attendance"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          handleDeleteClick(record)
                                        }
                                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        title="Delete attendance record"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                {sortedIndividualAttendance.length > 0 && (
                  <div className="flex items-center justify-between border-t border-[#DDDDDD] p-4 shrink-0">
                    <div className="text-sm text-gray-600">
                      Showing {(individualPage - 1) * individualPageSize + 1} to{" "}
                      {Math.min(
                        individualPage * individualPageSize,
                        sortedIndividualAttendance.length,
                      )}{" "}
                      of {sortedIndividualAttendance.length} records
                    </div>
                    {totalIndividualPages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setIndividualPage((p) => Math.max(1, p - 1))
                          }
                          disabled={individualPage === 1}
                        >
                          Previous
                        </Button>
                        <div className="text-sm text-gray-600">
                          Page {individualPage} of {totalIndividualPages}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setIndividualPage((p) =>
                              Math.min(totalIndividualPages, p + 1),
                            )
                          }
                          disabled={individualPage === totalIndividualPages}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Attendance Summary Modal */}
        <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
          <DialogContent className="max-w-[96vw] w-full max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-[#DDDDDD]">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <DialogTitle className="text-lg sm:text-xl">
                  Attendance Summary – {format(summaryMonthDate, "MMMM yyyy")}
                </DialogTitle>
                <div className="flex items-center gap-2">
                  <Select
                    value={getYear(summaryMonthDate).toString()}
                    onValueChange={(year) => {
                      const next = new Date(
                        parseInt(year, 10),
                        summaryMonthDate.getMonth(),
                        1,
                      );
                      setSummaryMonth(format(next, "yyyy-MM"));
                    }}
                  >
                    <SelectTrigger className="w-[100px] h-8 text-sm">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => {
                        const y = summaryMonthDate.getFullYear() - 5 + i;
                        return (
                          <SelectItem key={y} value={y.toString()}>
                            {y}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Select
                    value={(summaryMonthDate.getMonth() + 1)
                      .toString()
                      .padStart(2, "0")}
                    onValueChange={(month) => {
                      const next = new Date(
                        summaryMonthDate.getFullYear(),
                        parseInt(month, 10) - 1,
                        1,
                      );
                      setSummaryMonth(format(next, "yyyy-MM"));
                    }}
                  >
                    <SelectTrigger className="w-[120px] h-8 text-sm">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
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
                      ].map((name, i) => (
                        <SelectItem
                          key={name}
                          value={(i + 1).toString().padStart(2, "0")}
                        >
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {allAttendance === undefined ? (
                <div className="flex items-center justify-center flex-1 py-12">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-[#695eff] mx-auto mb-2" />
                    <p className="text-sm text-gray-600">
                      Loading attendance...
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto px-6">
                    <div className="overflow-x-auto relative">
                      <Table className="relative">
                        <TableHeader className="sticky top-0 bg-white z-30 border-b border-[#DDDDDD]">
                          <TableRow>
                            <TableHead className="sticky left-0 bg-white z-40 min-w-[150px] max-w-[150px] border-r border-[#DDDDDD] shadow-[2px_0_4px_rgba(0,0,0,0.08)]">
                              Employee
                            </TableHead>
                            {summaryMonthDates.map((date, index) => {
                              const dateTimestamp = date.getTime();
                              const isLast =
                                index === summaryMonthDates.length - 1;
                              return (
                                <TableHead
                                  key={dateTimestamp}
                                  className={`min-w-[110px] w-[110px] text-center ${!isLast ? "border-r border-[#DDDDDD]" : ""} bg-white`}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-xs font-medium">
                                      {format(date, "EEE")}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {format(date, "MMM dd")}
                                    </span>
                                  </div>
                                </TableHead>
                              );
                            })}
                            <TableHead className="min-w-[100px] w-[100px] text-center border-l border-[#DDDDDD] px-2 bg-white">
                              <span className="text-xs font-semibold whitespace-nowrap">
                                Late
                              </span>
                            </TableHead>
                            <TableHead className="min-w-[100px] w-[100px] text-center px-2 bg-white">
                              <span className="text-xs font-semibold whitespace-nowrap">
                                Undertime
                              </span>
                            </TableHead>
                            <TableHead className="min-w-[100px] w-[100px] text-center px-2 bg-white">
                              <span className="text-xs font-semibold whitespace-nowrap">
                                Overtime
                              </span>
                            </TableHead>
                            <TableHead className="min-w-[90px] w-[90px] text-center px-2 bg-white">
                              <span className="text-xs font-semibold whitespace-nowrap">
                                Freq. of lates
                              </span>
                            </TableHead>
                          </TableRow>
                          <TableRow>
                            <TableHead className="sticky left-0 bg-white z-40 border-r border-[#DDDDDD] shadow-[2px_0_4px_rgba(0,0,0,0.08)]"></TableHead>
                            {summaryMonthDates.map((date, index) => {
                              const dateTimestamp = date.getTime();
                              const isLast =
                                index === summaryMonthDates.length - 1;
                              return (
                                <TableHead
                                  key={dateTimestamp}
                                  className={`min-w-[110px] w-[110px] text-center ${!isLast ? "border-r border-[#DDDDDD]" : ""} bg-white`}
                                >
                                  <div className="grid grid-cols-2 gap-1 text-xs">
                                    <span className="text-gray-600">In</span>
                                    <span className="text-gray-600">Out</span>
                                  </div>
                                </TableHead>
                              );
                            })}
                            <TableHead className="min-w-[100px] w-[100px] border-l border-[#DDDDDD] bg-white"></TableHead>
                            <TableHead className="min-w-[100px] w-[100px] bg-white"></TableHead>
                            <TableHead className="min-w-[100px] w-[100px] bg-white"></TableHead>
                            <TableHead className="min-w-[90px] w-[90px] bg-white"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedEmployees.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={summaryMonthDates.length + 5}
                                className="text-center text-gray-500 py-8"
                              >
                                <p className="text-sm sm:text-base">
                                  No employees found
                                </p>
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginatedEmployees.map((employee: any) => {
                              const empAttendance =
                                attendanceByEmployeeAndDate[employee._id] || {};
                              let totalLate = 0;
                              let totalUndertime = 0;
                              let totalOvertime = 0; // minutes (from user-set overtime only)
                              let frequencyLates = 0;

                              summaryMonthDates.forEach((date) => {
                                const dateTimestamp = date.getTime();
                                const record = empAttendance[dateTimestamp];
                                if (record) {
                                  const isAbsentOrLeave =
                                    record.status === "absent" ||
                                    record.status === "leave";
                                  if (!isAbsentOrLeave) {
                                    const late =
                                      record.late != null
                                        ? record.late
                                        : calculateLate(
                                            record.scheduleIn,
                                            record.actualIn,
                                          );
                                    const undertime =
                                      record.undertime != null
                                        ? Math.round(record.undertime * 60)
                                        : calculateUndertime(
                                            record.scheduleOut,
                                            record.actualOut,
                                          );
                                    if (late) {
                                      totalLate += late;
                                      frequencyLates += 1;
                                    }
                                    if (undertime) totalUndertime += undertime;
                                    // Overtime: user-set only (no auto-calculation)
                                    if (
                                      record.overtime != null &&
                                      record.overtime > 0
                                    ) {
                                      totalOvertime += Math.round(
                                        record.overtime * 60,
                                      );
                                    }
                                  }
                                }
                              });

                              return (
                                <TableRow key={employee._id}>
                                  <TableCell className="sticky left-0 bg-white z-30 border-r border-[#DDDDDD] font-medium shadow-[2px_0_4px_rgba(0,0,0,0.08)] min-w-[150px] max-w-[150px]">
                                    <span className="text-sm whitespace-nowrap truncate block">
                                      {employee.personalInfo.firstName}{" "}
                                      {employee.personalInfo.lastName}
                                    </span>
                                  </TableCell>
                                  {summaryMonthDates.map((date, index) => {
                                    const dateTimestamp = date.getTime();
                                    const record = empAttendance[dateTimestamp];
                                    const isLast =
                                      index === summaryMonthDates.length - 1;
                                    const dayLate =
                                      record &&
                                      record.status !== "absent" &&
                                      record.status !== "leave"
                                        ? record.late != null
                                          ? record.late
                                          : calculateLate(
                                              record.scheduleIn,
                                              record.actualIn,
                                            )
                                        : null;
                                    const dayUndertime =
                                      record &&
                                      record.status !== "absent" &&
                                      record.status !== "leave"
                                        ? record.undertime != null
                                          ? Math.round(record.undertime * 60)
                                          : calculateUndertime(
                                              record.scheduleOut,
                                              record.actualOut,
                                            )
                                        : null;
                                    const hasDayLate =
                                      dayLate != null && dayLate > 0;
                                    const hasDayUndertime =
                                      dayUndertime != null && dayUndertime > 0;
                                    return (
                                      <TableCell
                                        key={dateTimestamp}
                                        className={`relative min-w-[110px] w-[110px] text-center ${!isLast ? "border-r border-[#DDDDDD]" : ""} p-1.5 bg-white`}
                                      >
                                        {record ? (
                                          <>
                                            <div className="grid grid-cols-2 gap-1 text-xs text-left">
                                              <span
                                                className={
                                                  record.status === "leave" ||
                                                  record.status === "absent"
                                                    ? "text-gray-400"
                                                    : hasDayLate
                                                      ? "text-red-600 font-medium"
                                                      : "text-gray-900"
                                                }
                                              >
                                                {record.status === "leave" ||
                                                record.status === "absent"
                                                  ? "-"
                                                  : record.actualIn
                                                    ? formatTime12Hour(
                                                        record.actualIn,
                                                      )
                                                    : "-"}
                                              </span>
                                              <span
                                                className={
                                                  record.status === "leave" ||
                                                  record.status === "absent"
                                                    ? "text-gray-400"
                                                    : hasDayUndertime
                                                      ? "text-red-600 font-medium"
                                                      : "text-gray-900"
                                                }
                                              >
                                                {record.status === "leave" ||
                                                record.status === "absent"
                                                  ? "-"
                                                  : record.actualOut
                                                    ? formatTime12Hour(
                                                        record.actualOut,
                                                      )
                                                    : "-"}
                                              </span>
                                            </div>
                                            {record.remarks?.trim() ? (
                                              <Popover>
                                                <PopoverTrigger asChild>
                                                  <button
                                                    type="button"
                                                    className="absolute top-0.5 right-0.5 inline-flex items-center justify-center rounded-full w-4 h-4 bg-[#695eff]/15 text-[#695eff] hover:bg-[#695eff]/25 focus:outline-none focus:ring-2 focus:ring-[#695eff] focus:ring-offset-1 shrink-0"
                                                    title="View note"
                                                  >
                                                    <MessageSquare className="h-2.5 w-2.5" />
                                                  </button>
                                                </PopoverTrigger>
                                                <PopoverContent
                                                  className="w-64 sm:w-80 p-3 text-left"
                                                  align="end"
                                                  side="top"
                                                >
                                                  <p className="text-xs font-medium text-[#695eff] mb-1">
                                                    Note
                                                  </p>
                                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                                    {record.remarks}
                                                  </p>
                                                </PopoverContent>
                                              </Popover>
                                            ) : null}
                                          </>
                                        ) : (
                                          <div className="grid grid-cols-2 gap-1 text-xs text-gray-300">
                                            <span>-</span>
                                            <span>-</span>
                                          </div>
                                        )}
                                      </TableCell>
                                    );
                                  })}
                                  <TableCell className="min-w-[100px] w-[100px] border-l border-[#DDDDDD] text-center text-xs px-2 py-2 bg-white">
                                    <span className="block">
                                      {totalLate > 0 ? (
                                        <span className="text-red-600 font-medium whitespace-nowrap">
                                          {formatTime(totalLate)}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </span>
                                  </TableCell>
                                  <TableCell className="min-w-[100px] w-[100px] text-center text-xs px-2 py-2 bg-white">
                                    <span className="block">
                                      {totalUndertime > 0 ? (
                                        <span className="text-red-600 font-medium whitespace-nowrap">
                                          {formatTime(totalUndertime)}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </span>
                                  </TableCell>
                                  <TableCell className="min-w-[100px] w-[100px] text-center text-xs px-2 py-2 bg-white">
                                    <span className="block">
                                      {totalOvertime > 0 ? (
                                        <span className="text-green-600 font-medium whitespace-nowrap">
                                          {formatTime(totalOvertime)}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </span>
                                  </TableCell>
                                  <TableCell className="min-w-[90px] w-[90px] text-center text-xs px-2 py-2 bg-white font-medium">
                                    {frequencyLates > 0 ? (
                                      <span className="text-red-600">
                                        {frequencyLates}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">0</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  {(employees?.length ?? 0) > 0 && (
                    <div className="flex items-center justify-between border-t border-[#DDDDDD] p-4 shrink-0 px-6">
                      <div className="text-sm text-gray-600">
                        Showing {(currentPage - 1) * pageSize + 1} to{" "}
                        {Math.min(
                          currentPage * pageSize,
                          employees?.length || 0,
                        )}{" "}
                        of {employees?.length || 0} employees
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCurrentPage((p) => Math.max(1, p - 1))
                            }
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <div className="text-sm text-gray-600">
                            Page {currentPage} of {totalPages}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCurrentPage((p) => Math.min(totalPages, p + 1))
                            }
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
