"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Calendar, CreditCard, Gift, TrendingDown, Pencil } from "lucide-react";
import { format } from "date-fns";
import { updateEmployee } from "@/actions/employees";
import { updateEmployeeLeaveCredits } from "@/actions/leave";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import { EmploymentTypeSelect } from "@/components/ui/employment-type-select";
import { SalaryTypeSelect } from "@/components/ui/salary-type-select";
import { DepartmentSelect } from "@/components/ui/department-select";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  employeeFormSchema,
  type EmployeeFormValues,
} from "./employee-form-validation";
import { cn } from "@/utils/utils";

interface EmployeeDetailModalProps {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "view" | "edit";
  onModeChange?: (mode: "view" | "edit") => void;
  onMessageClick: (employeeId: string) => void;
  employeeData?: any; // Optional pre-fetched employee data to avoid refetching
}

export function EmployeeDetailModal({
  employeeId,
  open,
  onOpenChange,
  mode,
  onModeChange,
  onMessageClick,
  employeeData,
}: EmployeeDetailModalProps) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const isEditing = mode === "edit";

  const defaultEditValues: EmployeeFormValues = {
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    employmentType: "probationary",
    hireDate: "",
    basicSalary: "",
    allowance: "",
    regularHolidayRate: "",
    specialHolidayRate: "",
    nightDiffPercent: "",
    overtimeRegularRate: "",
    overtimeRestDayRate: "",
    regularHolidayOtRate: "",
    specialHolidayOtRate: "",
    salaryType: "monthly",
  };

  const editForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaultEditValues,
  });
  const {
    register,
    handleSubmit: editFormHandleSubmit,
    formState: { errors },
    control,
    reset,
  } = editForm;

  const [vacationTotal, setVacationTotal] = useState("");
  const [sickTotal, setSickTotal] = useState("");

  const [scheduleType, setScheduleType] = useState<"one-time" | "regular">(
    "one-time",
  );

  const [oneTimeSchedule, setOneTimeSchedule] = useState({
    startTime: "09:00",
    endTime: "18:00",
    workdays: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    },
  });

  const [scheduleForm, setScheduleForm] = useState({
    monday: { start: "09:00", end: "18:00", workday: true },
    tuesday: { start: "09:00", end: "18:00", workday: true },
    wednesday: { start: "09:00", end: "18:00", workday: true },
    thursday: { start: "09:00", end: "18:00", workday: true },
    friday: { start: "09:00", end: "18:00", workday: true },
    saturday: { start: "09:00", end: "18:00", workday: false },
    sunday: { start: "09:00", end: "18:00", workday: false },
  });

  // Use pre-fetched data if available, otherwise fetch
  const fetchedEmployee = useQuery(
    (api as any).employees.getEmployee,
    employeeData || !employeeId
      ? "skip"
      : { employeeId: employeeId as Id<"employees"> }
  );
  const employee = employeeData || fetchedEmployee;

  const settings = useQuery(
    (api as any).settings.getSettings,
    employee
      ? ({ organizationId: employee.organizationId } as {
          organizationId: Id<"organizations">;
        })
      : "skip",
  );

  const departments =
    settings?.departments && settings.departments.length > 0
      ? typeof settings.departments[0] === "string"
        ? (settings.departments as string[]).map((name, index) => ({
            name,
            color: [
              "#9CA3AF",
              "#EF4444",
              "#F97316",
              "#EAB308",
              "#22C55E",
              "#3B82F6",
              "#A855F7",
              "#EC4899",
            ][index % 8],
          }))
        : (settings.departments as { name: string; color: string }[])
      : [];

  // Populate edit form when opening in edit mode
  useEffect(() => {
    if (!open || mode !== "edit" || !employee) return;
    const daysOrder = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ] as const;
    const defaultSchedule = employee.schedule.defaultSchedule;
    const firstWorkdayKey =
      (daysOrder.find((day) => defaultSchedule[day].isWorkday) as
        | (typeof daysOrder)[number]
        | undefined) ?? "monday";
    const firstWorkdaySchedule = defaultSchedule[firstWorkdayKey];

    const baseIn = firstWorkdaySchedule?.in ?? "09:00";
    const baseOut = firstWorkdaySchedule?.out ?? "18:00";

    const allSameTime = daysOrder.every(
      (day) =>
        defaultSchedule[day].in === baseIn &&
        defaultSchedule[day].out === baseOut,
    );

    if (allSameTime) {
      setScheduleType("one-time");
      setOneTimeSchedule({
        startTime: baseIn,
        endTime: baseOut,
        workdays: {
          monday: defaultSchedule.monday.isWorkday,
          tuesday: defaultSchedule.tuesday.isWorkday,
          wednesday: defaultSchedule.wednesday.isWorkday,
          thursday: defaultSchedule.thursday.isWorkday,
          friday: defaultSchedule.friday.isWorkday,
          saturday: defaultSchedule.saturday.isWorkday,
          sunday: defaultSchedule.sunday.isWorkday,
        },
      });
    } else {
      setScheduleType("regular");
      setScheduleForm({
        monday: {
          start: defaultSchedule.monday.in,
          end: defaultSchedule.monday.out,
          workday: defaultSchedule.monday.isWorkday,
        },
        tuesday: {
          start: defaultSchedule.tuesday.in,
          end: defaultSchedule.tuesday.out,
          workday: defaultSchedule.tuesday.isWorkday,
        },
        wednesday: {
          start: defaultSchedule.wednesday.in,
          end: defaultSchedule.wednesday.out,
          workday: defaultSchedule.wednesday.isWorkday,
        },
        thursday: {
          start: defaultSchedule.thursday.in,
          end: defaultSchedule.thursday.out,
          workday: defaultSchedule.thursday.isWorkday,
        },
        friday: {
          start: defaultSchedule.friday.in,
          end: defaultSchedule.friday.out,
          workday: defaultSchedule.friday.isWorkday,
        },
        saturday: {
          start: defaultSchedule.saturday.in,
          end: defaultSchedule.saturday.out,
          workday: defaultSchedule.saturday.isWorkday,
        },
        sunday: {
          start: defaultSchedule.sunday.in,
          end: defaultSchedule.sunday.out,
          workday: defaultSchedule.sunday.isWorkday,
        },
      });
    }

    const orgRegularRateDecimal =
      settings?.payrollSettings?.regularHolidayRate ?? 1.0;
    const orgSpecialRateDecimal =
      settings?.payrollSettings?.specialHolidayRate ?? 0.3;
    const orgNightDiffDecimal =
      settings?.payrollSettings?.nightDiffPercent ?? 0.1;
    const orgOvertimeRegularDecimal =
      settings?.payrollSettings?.overtimeRegularRate ?? 1.25;
    const orgOvertimeRestDayDecimal =
      settings?.payrollSettings?.overtimeRestDayRate ?? 1.69;
    const orgRegularHolidayOtDecimal =
      settings?.payrollSettings?.regularHolidayOtRate ?? 2.0;
    const orgSpecialHolidayOtDecimal =
      settings?.payrollSettings?.specialHolidayOtRate ?? 1.69;

    const employeeRegularDecimal =
      employee.compensation.regularHolidayRate ?? orgRegularRateDecimal;
    const employeeSpecialDecimal =
      employee.compensation.specialHolidayRate ?? orgSpecialRateDecimal;
    const employeeNightDiffDecimal =
      employee.compensation.nightDiffPercent ?? orgNightDiffDecimal;
    const employeeOvertimeRegularDecimal =
      employee.compensation.overtimeRegularRate ?? orgOvertimeRegularDecimal;
    const employeeOvertimeRestDayDecimal =
      employee.compensation.overtimeRestDayRate ?? orgOvertimeRestDayDecimal;
    const employeeRegularHolidayOtDecimal =
      employee.compensation.regularHolidayOtRate ?? orgRegularHolidayOtDecimal;
    const employeeSpecialHolidayOtDecimal =
      employee.compensation.specialHolidayOtRate ??
      orgSpecialHolidayOtDecimal;

    const hireDateStr = employee.employment.hireDate
      ? new Date(employee.employment.hireDate).toISOString().slice(0, 10)
      : "";

    reset({
      firstName: employee.personalInfo.firstName,
      lastName: employee.personalInfo.lastName,
      middleName: employee.personalInfo.middleName || "",
      email: employee.personalInfo.email,
      phone: employee.personalInfo.phone || "",
      position: employee.employment.position,
      department: employee.employment.department,
      employmentType: employee.employment.employmentType,
      hireDate: hireDateStr,
      basicSalary: employee.compensation.basicSalary.toString(),
      allowance: (employee.compensation.allowance || 0).toString(),
      salaryType: employee.compensation.salaryType,
      regularHolidayRate: (employeeRegularDecimal * 100).toString(),
      specialHolidayRate: (employeeSpecialDecimal * 100).toString(),
      nightDiffPercent: (employeeNightDiffDecimal * 100).toString(),
      overtimeRegularRate: (employeeOvertimeRegularDecimal * 100).toString(),
      overtimeRestDayRate: (employeeOvertimeRestDayDecimal * 100).toString(),
      regularHolidayOtRate: (employeeRegularHolidayOtDecimal * 100).toString(),
      specialHolidayOtRate: (employeeSpecialHolidayOtDecimal * 100).toString(),
    });
    setVacationTotal(employee.leaveCredits?.vacation?.total?.toString() || "");
    setSickTotal(employee.leaveCredits?.sick?.total?.toString() || "");
  }, [open, mode, employee, settings, reset]);

  const onValidSave = async (data: EmployeeFormValues) => {
    if (!employeeId || !employee) return;

    try {
      const orgRegularRateDecimal =
        settings?.payrollSettings?.regularHolidayRate ?? 1.0;
      const orgSpecialRateDecimal =
        settings?.payrollSettings?.specialHolidayRate ?? 0.3;
      const orgNightDiffDecimal =
        settings?.payrollSettings?.nightDiffPercent ?? 0.1;
      const orgOvertimeRegularDecimal =
        settings?.payrollSettings?.overtimeRegularRate ?? 1.25;
      const orgOvertimeRestDayDecimal =
        settings?.payrollSettings?.overtimeRestDayRate ?? 1.69;
      const orgRegularHolidayOtDecimal =
        settings?.payrollSettings?.regularHolidayOtRate ?? 2.0;
      const orgSpecialHolidayOtDecimal =
        settings?.payrollSettings?.specialHolidayOtRate ?? 1.69;

      const regularHolidayRateDecimal = data.regularHolidayRate
        ? parseFloat(data.regularHolidayRate) / 100
        : employee.compensation.regularHolidayRate ?? orgRegularRateDecimal;

      const specialHolidayRateDecimal = data.specialHolidayRate
        ? parseFloat(data.specialHolidayRate) / 100
        : employee.compensation.specialHolidayRate ?? orgSpecialRateDecimal;

      const nightDiffPercentDecimal = data.nightDiffPercent
        ? parseFloat(data.nightDiffPercent) / 100
        : employee.compensation.nightDiffPercent ?? orgNightDiffDecimal;

      const overtimeRegularRateDecimal = data.overtimeRegularRate
        ? parseFloat(data.overtimeRegularRate) / 100
        : employee.compensation.overtimeRegularRate ??
          orgOvertimeRegularDecimal;

      const overtimeRestDayRateDecimal = data.overtimeRestDayRate
        ? parseFloat(data.overtimeRestDayRate) / 100
        : employee.compensation.overtimeRestDayRate ??
          orgOvertimeRestDayDecimal;

      const regularHolidayOtRateDecimal = data.regularHolidayOtRate
        ? parseFloat(data.regularHolidayOtRate) / 100
        : employee.compensation.regularHolidayOtRate ??
          orgRegularHolidayOtDecimal;

      const specialHolidayOtRateDecimal = data.specialHolidayOtRate
        ? parseFloat(data.specialHolidayOtRate) / 100
        : employee.compensation.specialHolidayOtRate ??
          orgSpecialHolidayOtDecimal;

      const newDefaultSchedule =
        scheduleType === "one-time"
          ? {
              monday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.monday,
              },
              tuesday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.tuesday,
              },
              wednesday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.wednesday,
              },
              thursday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.thursday,
              },
              friday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.friday,
              },
              saturday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.saturday,
              },
              sunday: {
                in: oneTimeSchedule.startTime,
                out: oneTimeSchedule.endTime,
                isWorkday: oneTimeSchedule.workdays.sunday,
              },
            }
          : {
              monday: {
                in: scheduleForm.monday.start,
                out: scheduleForm.monday.end,
                isWorkday: scheduleForm.monday.workday,
              },
              tuesday: {
                in: scheduleForm.tuesday.start,
                out: scheduleForm.tuesday.end,
                isWorkday: scheduleForm.tuesday.workday,
              },
              wednesday: {
                in: scheduleForm.wednesday.start,
                out: scheduleForm.wednesday.end,
                isWorkday: scheduleForm.wednesday.workday,
              },
              thursday: {
                in: scheduleForm.thursday.start,
                out: scheduleForm.thursday.end,
                isWorkday: scheduleForm.thursday.workday,
              },
              friday: {
                in: scheduleForm.friday.start,
                out: scheduleForm.friday.end,
                isWorkday: scheduleForm.friday.workday,
              },
              saturday: {
                in: scheduleForm.saturday.start,
                out: scheduleForm.saturday.end,
                isWorkday: scheduleForm.saturday.workday,
              },
              sunday: {
                in: scheduleForm.sunday.start,
                out: scheduleForm.sunday.end,
                isWorkday: scheduleForm.sunday.workday,
              },
            };

      await updateEmployee(employeeId, {
        personalInfo: {
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName || undefined,
          email: data.email,
          phone: data.phone || undefined,
        },
        employment: {
          ...employee.employment,
          position: data.position,
          department: data.department,
          employmentType: data.employmentType as "regular" | "probationary" | "contractual" | "part-time",
          hireDate: data.hireDate
            ? new Date(data.hireDate).getTime()
            : employee.employment.hireDate,
        },
        compensation: {
          ...employee.compensation,
          basicSalary: parseFloat(data.basicSalary),
          allowance: data.allowance
            ? parseFloat(data.allowance)
            : undefined,
          salaryType: data.salaryType as "monthly" | "daily" | "hourly",
          regularHolidayRate: regularHolidayRateDecimal,
          specialHolidayRate: specialHolidayRateDecimal,
          nightDiffPercent: nightDiffPercentDecimal,
          overtimeRegularRate: overtimeRegularRateDecimal,
          overtimeRestDayRate: overtimeRestDayRateDecimal,
          regularHolidayOtRate: regularHolidayOtRateDecimal,
          specialHolidayOtRate: specialHolidayOtRateDecimal,
        },
        schedule: {
          ...employee.schedule,
          defaultSchedule: newDefaultSchedule,
        },
      });

      // Optionally update leave credits totals if changed
      if (currentOrganizationId) {
        const vacTotal = parseFloat(vacationTotal);
        if (!Number.isNaN(vacTotal)) {
          await updateEmployeeLeaveCredits({
            organizationId: currentOrganizationId,
            employeeId,
            leaveType: "vacation",
            total: vacTotal,
          });
        }

        const sickTotalVal = parseFloat(sickTotal);
        if (!Number.isNaN(sickTotalVal)) {
          await updateEmployeeLeaveCredits({
            organizationId: currentOrganizationId,
            employeeId,
            leaveType: "sick",
            total: sickTotalVal,
          });
        }
      }
      onModeChange?.("view");
      router.refresh();
    } catch (error) {
      console.error("Error updating employee:", error);
      alert("Failed to update employee. Please try again.");
    }
  };

  const handleCancel = () => {
    onModeChange?.("view");
  };

  const capitalize = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

  // Don't render anything if dialog is closed
  if (!open) return null;

  // Show loading state while employee data is being fetched
  if (!employee) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[95vw] sm:max-w-2xl overflow-hidden flex flex-col p-0"
        >
          <div className="overflow-y-auto flex-1 px-4 sm:px-6 pb-4 sm:pb-6 pr-12">
            <div className="space-y-6 pt-4 sm:pt-6">
              {/* Header skeleton */}
              <div className="space-y-4">
                <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="h-px bg-gray-200" />
              {/* Info sections skeleton */}
              <div className="space-y-4">
                <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
                <div className="space-y-3">
                  <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-px bg-gray-200" />
              <div className="space-y-4">
                <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
                <div className="space-y-3">
                  <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[95vw] sm:max-w-2xl overflow-hidden flex flex-col p-0"
      >
        <div className="overflow-y-auto flex-1 px-4 sm:px-5 pb-4 sm:pb-5 pr-12">
          <SheetHeader className="pt-4 sm:pt-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
                    {employee.personalInfo.firstName}{" "}
                    {employee.personalInfo.lastName}
                  </SheetTitle>
                  <SheetDescription className="text-sm text-muted-foreground truncate mt-0.5">
                    {employee.employment.position} •{" "}
                    {employee.employment.department}
                  </SheetDescription>
                  {!isEditing && (
                    <div className="mt-1.5">
                      <Badge
                        className={
                          employee.employment.status === "active"
                            ? "bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-800"
                            : "bg-muted text-muted-foreground"
                        }
                        variant="secondary"
                      >
                        {capitalize(employee.employment.status)}
                      </Badge>
                    </div>
                  )}
                </div>
                {!isEditing && onModeChange && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onModeChange("edit")}
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* Personal Information */}
            <div>
              {!isEditing ? (
                <Card className="border-gray-100">
                  <CardHeader className="py-2.5 px-3 sm:px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      Personal Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Full Name
                          </p>
                          <p className="text-sm font-medium">
                            {employee.personalInfo.firstName}{" "}
                            {employee.personalInfo.middleName}{" "}
                            {employee.personalInfo.lastName}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Email
                          </p>
                          <p className="text-sm font-medium">
                            {employee.personalInfo.email}
                          </p>
                        </div>
                      </div>
                    </div>
                    {(employee.personalInfo.phone ||
                      employee.personalInfo.address) && (
                      <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-gray-100">
                        {employee.personalInfo.phone && (
                          <div className="flex gap-1.5 items-start min-w-0">
                            <span
                              className="w-2 shrink-0 flex justify-center pt-0.5"
                              aria-hidden
                            >
                              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            </span>
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Phone
                              </p>
                              <p className="text-sm">
                                {employee.personalInfo.phone}
                              </p>
                            </div>
                          </div>
                        )}
                        {employee.personalInfo.address && (
                          <div className="flex gap-1.5 items-start min-w-0">
                            <span
                              className="w-2 shrink-0 flex justify-center pt-0.5"
                              aria-hidden
                            >
                              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            </span>
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Address
                              </p>
                              <p className="text-sm">
                                {employee.personalInfo.address}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {(employee.personalInfo.dateOfBirth ||
                      employee.personalInfo.civilStatus) && (
                      <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-gray-100">
                        {employee.personalInfo.dateOfBirth && (
                          <div className="flex gap-1.5 items-start min-w-0">
                            <span
                              className="w-2 shrink-0 flex justify-center pt-0.5"
                              aria-hidden
                            >
                              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            </span>
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Date of Birth
                              </p>
                              <p className="text-sm">
                                {format(
                                  new Date(employee.personalInfo.dateOfBirth),
                                  "MMM dd, yyyy"
                                )}
                              </p>
                            </div>
                          </div>
                        )}
                        {employee.personalInfo.civilStatus && (
                          <div className="flex gap-1.5 items-start min-w-0">
                            <span className="w-2 shrink-0" aria-hidden />
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Civil Status
                              </p>
                              <p className="text-sm">
                                {employee.personalInfo.civilStatus}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {employee.personalInfo.emergencyContact && (
                      <div className="pt-2 border-t border-gray-100 space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Emergency Contact
                        </p>
                        <p className="text-sm">
                          {employee.personalInfo.emergencyContact.name} (
                          {employee.personalInfo.emergencyContact.relationship})
                          — {employee.personalInfo.emergencyContact.phone}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-firstName" className="text-sm">
                        First Name
                      </Label>
                      <Input
                        id="edit-firstName"
                        {...register("firstName")}
                        className={cn(errors.firstName && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.firstName?.message && (
                        <p className="text-xs text-red-600">{errors.firstName.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-middleName" className="text-sm">
                        Middle Name
                      </Label>
                      <Input
                        id="edit-middleName"
                        {...register("middleName")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-lastName" className="text-sm">
                        Last Name
                      </Label>
                      <Input
                        id="edit-lastName"
                        {...register("lastName")}
                        className={cn(errors.lastName && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.lastName?.message && (
                        <p className="text-xs text-red-600">{errors.lastName.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-email" className="text-sm">
                        Email
                      </Label>
                      <Input
                        id="edit-email"
                        type="email"
                        {...register("email")}
                        className={cn(errors.email && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.email?.message && (
                        <p className="text-xs text-red-600">{errors.email.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-phone" className="text-sm">
                        Phone
                      </Label>
                      <Input
                        id="edit-phone"
                        type="tel"
                        {...register("phone")}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isEditing && <div className="border-t border-gray-100" />}

            {/* Employment Information */}
            <div>
              {!isEditing ? (
                <Card className="border-gray-100">
                  <CardHeader className="py-2.5 px-3 sm:px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      Employment Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Employee ID
                          </p>
                          <p className="text-sm font-medium">
                            {employee.employment.employeeId}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Position
                          </p>
                          <p className="text-sm font-medium">
                            {employee.employment.position}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Department
                          </p>
                          <p className="text-sm">
                            {employee.employment.department}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span className="w-2 shrink-0" aria-hidden />
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Employment Type
                          </p>
                          <Badge variant="secondary" className="font-normal">
                            {capitalize(employee.employment.employmentType)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-gray-100">
                      <div className="flex gap-1.5 items-start min-w-0">
                        <span
                          className="w-2 shrink-0 flex justify-center pt-0.5"
                          aria-hidden
                        >
                          <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                        </span>
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Hire Date
                          </p>
                          <p className="text-sm">
                            {format(
                              new Date(employee.employment.hireDate),
                              "MMM dd, yyyy"
                            )}
                          </p>
                        </div>
                      </div>
                      {employee.employment.regularizationDate && (
                        <div className="flex gap-1.5 items-start min-w-0">
                          <span
                            className="w-2 shrink-0 flex justify-center pt-0.5"
                            aria-hidden
                          >
                            <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                          </span>
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Regularization Date
                            </p>
                            <p className="text-sm">
                              {format(
                                new Date(
                                  employee.employment.regularizationDate
                                ),
                                "MMM dd, yyyy"
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-position" className="text-sm">
                        Position
                      </Label>
                      <Input
                        id="edit-position"
                        {...register("position")}
                        className={cn(errors.position && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.position?.message && (
                        <p className="text-xs text-red-600">{errors.position.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-department" className="text-sm">
                        Department
                      </Label>
                      <Controller
                        name="department"
                        control={control}
                        render={({ field }) => (
                          <DepartmentSelect
                            departments={departments}
                            value={field.value}
                            onValueChange={field.onChange}
                          />
                        )}
                      />
                      {errors.department?.message && (
                        <p className="text-xs text-red-600">{errors.department.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-employmentType" className="text-sm">
                        Employment Type
                      </Label>
                      <Controller
                        name="employmentType"
                        control={control}
                        render={({ field }) => (
                          <EmploymentTypeSelect
                            value={field.value as "regular" | "probationary" | "contractual" | "part-time"}
                            onValueChange={field.onChange}
                          />
                        )}
                      />
                      {errors.employmentType?.message && (
                        <p className="text-xs text-red-600">{errors.employmentType.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-hireDate" className="text-sm">
                        Hire Date
                      </Label>
                      <Controller
                        name="hireDate"
                        control={control}
                        render={({ field }) => (
                          <DatePicker
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Select hire date"
                          />
                        )}
                      />
                      {errors.hireDate?.message && (
                        <p className="text-xs text-red-600">{errors.hireDate.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isEditing && <div className="border-t border-gray-100" />}

            {/* Compensation */}
            <div>
              {!isEditing ? (
                <Card className="border-gray-100">
                  <CardHeader className="py-2.5 px-3 sm:px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      Compensation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Basic Salary
                        </p>
                        <p className="text-lg font-semibold">
                          ₱{employee.compensation.basicSalary.toLocaleString()}
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Salary Type
                        </p>
                        <p className="text-sm font-medium capitalize">
                          {employee.compensation.salaryType}
                        </p>
                      </div>
                    </div>
                    {(employee.compensation.allowance ?? 0) > 0 && (
                      <div className="pt-2 border-t border-gray-100 space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Non-Taxable Allowance
                        </p>
                        <p className="text-sm font-medium">
                          ₱{employee.compensation.allowance!.toLocaleString()}
                        </p>
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-gray-100">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Regular Holiday Rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.regularHolidayRate ?? 1.0) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Special non-working holiday rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.specialHolidayRate ?? 0.3) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Night Differential
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.nightDiffPercent ?? 0.1) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Overtime Regular Rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.overtimeRegularRate ?? 1.25) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Overtime Rest Day Rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.overtimeRestDayRate ?? 1.69) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Regular Holiday OT Rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.regularHolidayOtRate ?? 2.0) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Special non-working holiday OT rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.specialHolidayOtRate ?? 1.69) *
                            100
                          ).toFixed(0)}
                          %
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Compensation
                  </h3>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-basicSalary" className="text-sm">
                      Basic Salary *
                    </Label>
                    <Input
                      id="edit-basicSalary"
                      type="number"
                      step="0.01"
                      {...register("basicSalary")}
                      className={cn(errors.basicSalary && "border-red-500 focus-visible:ring-red-500")}
                    />
                    {errors.basicSalary?.message && (
                      <p className="text-xs text-red-600">{errors.basicSalary.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-allowance" className="text-sm">
                      Non-Taxable Allowance
                    </Label>
                    <Input
                      id="edit-allowance"
                      type="number"
                      step="0.01"
                      {...register("allowance")}
                      placeholder="0.00"
                      className={cn(errors.allowance && "border-red-500 focus-visible:ring-red-500")}
                    />
                    {errors.allowance?.message && (
                      <p className="text-xs text-red-600">{errors.allowance.message}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      Optional: Non-taxable allowance (e.g., transportation,
                      meal allowance)
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-salaryType" className="text-sm">
                      Salary Type
                    </Label>
                    <Controller
                      name="salaryType"
                      control={control}
                      render={({ field }) => (
                        <SalaryTypeSelect
                          value={field.value as "monthly" | "daily" | "hourly"}
                          onValueChange={field.onChange}
                        />
                      )}
                    />
                    {errors.salaryType?.message && (
                      <p className="text-xs text-red-600">{errors.salaryType.message}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-regularHolidayRate"
                        className="text-sm"
                      >
                        Regular Holiday Rate (%)
                      </Label>
                      <Input
                        id="edit-regularHolidayRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("regularHolidayRate")}
                        placeholder="100"
                        className={cn(errors.regularHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.regularHolidayRate?.message && (
                        <p className="text-xs text-red-600">{errors.regularHolidayRate.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-specialHolidayRate"
                        className="text-sm"
                      >
                        Special non-working holiday rate (%)
                      </Label>
                      <Input
                        id="edit-specialHolidayRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("specialHolidayRate")}
                        placeholder="30"
                        className={cn(errors.specialHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.specialHolidayRate?.message && (
                        <p className="text-xs text-red-600">{errors.specialHolidayRate.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-nightDiffPercent"
                        className="text-sm"
                      >
                        Night Differential (%)
                      </Label>
                      <Input
                        id="edit-nightDiffPercent"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("nightDiffPercent")}
                        placeholder="10"
                        className={cn(errors.nightDiffPercent && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.nightDiffPercent?.message && (
                        <p className="text-xs text-red-600">{errors.nightDiffPercent.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-overtimeRegularRate"
                        className="text-sm"
                      >
                        Overtime Regular Rate (%)
                      </Label>
                      <Input
                        id="edit-overtimeRegularRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("overtimeRegularRate")}
                        placeholder="125"
                        className={cn(errors.overtimeRegularRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.overtimeRegularRate?.message && (
                        <p className="text-xs text-red-600">{errors.overtimeRegularRate.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-overtimeRestDayRate"
                        className="text-sm"
                      >
                        Overtime Rest Day Rate (%)
                      </Label>
                      <Input
                        id="edit-overtimeRestDayRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("overtimeRestDayRate")}
                        placeholder="169"
                        className={cn(errors.overtimeRestDayRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.overtimeRestDayRate?.message && (
                        <p className="text-xs text-red-600">{errors.overtimeRestDayRate.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-regularHolidayOtRate"
                        className="text-sm"
                      >
                        Regular Holiday OT Rate (%)
                      </Label>
                      <Input
                        id="edit-regularHolidayOtRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("regularHolidayOtRate")}
                        placeholder="200"
                        className={cn(errors.regularHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.regularHolidayOtRate?.message && (
                        <p className="text-xs text-red-600">{errors.regularHolidayOtRate.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-specialHolidayOtRate"
                        className="text-sm"
                      >
                        Special non-working holiday OT rate (%)
                      </Label>
                      <Input
                        id="edit-specialHolidayOtRate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register("specialHolidayOtRate")}
                        placeholder="169"
                        className={cn(errors.specialHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                      />
                      {errors.specialHolidayOtRate?.message && (
                        <p className="text-xs text-red-600">{errors.specialHolidayOtRate.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!isEditing && <div className="border-t border-gray-100" />}

            {/* Bank Details */}
            {employee.compensation.bankDetails && !isEditing && (
              <Card className="border-gray-100">
                <CardHeader className="py-2.5 px-3 sm:px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                    Bank Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Bank Name
                      </p>
                      <p className="text-sm font-medium">
                        {employee.compensation.bankDetails.bankName}
                      </p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Account Number
                      </p>
                      <p className="text-sm font-mono">
                        {employee.compensation.bankDetails.accountNumber}
                      </p>
                    </div>
                    <div className="space-y-0.5 sm:col-span-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Account Name
                      </p>
                      <p className="text-sm">
                        {employee.compensation.bankDetails.accountName}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Leave Credits */}
            {employee.leaveCredits && (
              <div>
                {!isEditing ? (
                  <Card className="border-gray-100">
                    <CardHeader className="py-2.5 px-3 sm:px-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        Leave Credits
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 space-y-0.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Vacation Leave
                          </p>
                          <p className="text-sm font-semibold">
                            {employee.leaveCredits.vacation?.balance ?? 0} /{" "}
                            {employee.leaveCredits.vacation?.total ?? 0} days
                          </p>
                        </div>
                        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 space-y-0.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Sick Leave
                          </p>
                          <p className="text-sm font-semibold">
                            {employee.leaveCredits.sick?.balance ?? 0} /{" "}
                            {employee.leaveCredits.sick?.total ?? 0} days
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Leave Credits
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-vacationTotal" className="text-sm">
                          Vacation Leave Total (days)
                        </Label>
                        <Input
                          id="edit-vacationTotal"
                          type="number"
                          step="0.1"
                          value={vacationTotal}
                          onChange={(e) => setVacationTotal(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-sickTotal" className="text-sm">
                          Sick Leave Total (days)
                        </Label>
                        <Input
                          id="edit-sickTotal"
                          type="number"
                          step="0.1"
                          value={sickTotal}
                          onChange={(e) => setSickTotal(e.target.value)}
                        />
                      </div>
                      <p className="col-span-1 sm:col-span-2 text-xs text-gray-500">
                        Balances will be recalculated automatically from totals
                        and used days.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isEditing && <div className="border-t border-gray-100" />}

            {/* Work Schedule / Rest Days */}
            <div>
              {!isEditing ? (
                <Card className="border-gray-100">
                  <CardHeader className="py-2.5 px-3 sm:px-4">
                    <CardTitle className="text-sm font-medium">
                      Work Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Workdays
                        </p>
                        <p className="text-sm font-medium">
                          {(
                            [
                              "monday",
                              "tuesday",
                              "wednesday",
                              "thursday",
                              "friday",
                              "saturday",
                              "sunday",
                            ] as const
                          )
                            .filter(
                              (day) =>
                                employee.schedule.defaultSchedule[day].isWorkday
                            )
                            .map((day) => day.slice(0, 3).toUpperCase())
                            .join(", ") || "None"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Time
                        </p>
                        <p className="text-sm font-medium">
                          {(() => {
                            const daysOrder = [
                              "monday",
                              "tuesday",
                              "wednesday",
                              "thursday",
                              "friday",
                              "saturday",
                              "sunday",
                            ] as const;
                            const firstWorkday =
                              (daysOrder.find(
                                (day) =>
                                  employee.schedule.defaultSchedule[day]
                                    .isWorkday
                              ) as (typeof daysOrder)[number]) ?? "monday";
                            const sched =
                              employee.schedule.defaultSchedule[firstWorkday];
                            return sched?.in && sched?.out
                              ? `${sched.in} – ${sched.out}`
                              : "—";
                          })()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3 text-sm">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Work Schedule
                  </h3>
                  <p className="text-xs text-gray-500">
                    Choose whether this employee has the same time for all work
                    days or different times per day.
                  </p>
                  <div className="space-y-2">
                    <Label className="text-sm">Schedule Type</Label>
                    <Select
                      value={scheduleType}
                      onValueChange={(value: "one-time" | "regular") =>
                        setScheduleType(value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one-time">
                          Same time for all work days
                        </SelectItem>
                        <SelectItem value="regular">
                          Different time per day
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {scheduleType === "one-time" ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <TimePicker
                          value={oneTimeSchedule.startTime}
                          onValueChange={(value) =>
                            setOneTimeSchedule({
                              ...oneTimeSchedule,
                              startTime: value,
                            })
                          }
                          label="Start Time"
                          placeholder="Select start time"
                        />
                        <TimePicker
                          value={oneTimeSchedule.endTime}
                          onValueChange={(value) =>
                            setOneTimeSchedule({
                              ...oneTimeSchedule,
                              endTime: value,
                            })
                          }
                          label="End Time"
                          placeholder="Select end time"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-600">
                          Workdays
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {(
                            [
                              "monday",
                              "tuesday",
                              "wednesday",
                              "thursday",
                              "friday",
                              "saturday",
                              "sunday",
                            ] as const
                          ).map((day) => (
                            <div
                              key={day}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={`edit-workday-${day}`}
                                checked={
                                  oneTimeSchedule.workdays[
                                    day as keyof typeof oneTimeSchedule.workdays
                                  ]
                                }
                                onCheckedChange={(checked) =>
                                  setOneTimeSchedule({
                                    ...oneTimeSchedule,
                                    workdays: {
                                      ...oneTimeSchedule.workdays,
                                      [day]: checked as boolean,
                                    },
                                  })
                                }
                              />
                              <Label
                                htmlFor={`edit-workday-${day}`}
                                className="text-sm font-normal cursor-pointer capitalize"
                              >
                                {day}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(
                        [
                          "monday",
                          "tuesday",
                          "wednesday",
                          "thursday",
                          "friday",
                          "saturday",
                          "sunday",
                        ] as const
                      ).map((day) => (
                        <div
                          key={day}
                          className="space-y-2 p-3 border rounded-lg"
                        >
                          <div className="flex items-center space-x-2 mb-2">
                            <Checkbox
                              id={`edit-regular-${day}`}
                              checked={scheduleForm[day].workday}
                              onCheckedChange={(checked) =>
                                setScheduleForm({
                                  ...scheduleForm,
                                  [day]: {
                                    ...scheduleForm[day],
                                    workday: checked as boolean,
                                  },
                                })
                              }
                            />
                            <Label
                              htmlFor={`edit-regular-${day}`}
                              className="text-sm font-medium cursor-pointer capitalize"
                            >
                              {day}
                            </Label>
                          </div>
                          {scheduleForm[day].workday && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
                              <TimePicker
                                value={scheduleForm[day].start}
                                onValueChange={(value) =>
                                  setScheduleForm({
                                    ...scheduleForm,
                                    [day]: {
                                      ...scheduleForm[day],
                                      start: value,
                                    },
                                  })
                                }
                                label="Start Time"
                                placeholder="Select start time"
                                showLabel={true}
                              />
                              <TimePicker
                                value={scheduleForm[day].end}
                                onValueChange={(value) =>
                                  setScheduleForm({
                                    ...scheduleForm,
                                    [day]: {
                                      ...scheduleForm[day],
                                      end: value,
                                    },
                                  })
                                }
                                label="End Time"
                                placeholder="Select end time"
                                showLabel={true}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Active Deductions */}
            {!isEditing &&
              employee.deductions &&
              employee.deductions.filter((d: any) => d.isActive).length > 0 && (
                <>
                  <div className="border-t border-gray-100" />
                  <Card className="border-gray-100">
                    <CardHeader className="py-2.5 px-3 sm:px-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                        Active Deductions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {employee.deductions
                          .filter((d: any) => d.isActive)
                          .map((deduction: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-sm p-3 rounded-lg border bg-muted/30"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {deduction.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="text-xs font-normal"
                                >
                                  {deduction.type}
                                </Badge>
                              </div>
                              <span className="font-semibold">
                                ₱{deduction.amount.toLocaleString()}
                              </span>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

            {/* Active Incentives */}
            {!isEditing &&
              employee.incentives &&
              employee.incentives.filter((i: any) => i.isActive).length > 0 && (
                <>
                  <div className="border-t border-gray-100" />
                  <Card className="border-gray-100">
                    <CardHeader className="py-2.5 px-3 sm:px-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Gift className="h-3.5 w-3.5 text-muted-foreground" />
                        Active Incentives
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {employee.incentives
                          .filter((i: any) => i.isActive)
                          .map((incentive: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-sm p-3 rounded-lg border bg-muted/30"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {incentive.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="text-xs font-normal"
                                >
                                  {incentive.frequency}
                                </Badge>
                              </div>
                              <span className="font-semibold">
                                ₱{incentive.amount.toLocaleString()}
                              </span>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

            {isEditing && (
              <div className="flex flex-col sm:flex-row gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="button" onClick={() => editFormHandleSubmit(onValidSave)()} className="flex-1">
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
