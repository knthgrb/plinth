"use client";

import { useState, useEffect, useMemo } from "react";
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
import {
  Mail,
  Calendar,
  CreditCard,
  Gift,
  TrendingDown,
  Pencil,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

/** Parse a value to a Date; return null if invalid (avoids "Invalid time value" in prod). */
function safeDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Manila start-of-day UTC timestamp; used as cutoff so past attendance is not rewritten on schedule edits. */
function getManilaTodayStartUtcMs(): number {
  const offsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(Date.now() + offsetMs);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}
import { updateEmployee } from "@/actions/employees";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import { EmploymentTypeSelect } from "@/components/ui/employment-type-select";
import { SalaryTypeSelect } from "@/components/ui/salary-type-select";
import { DepartmentSelect } from "@/components/ui/department-select";
import { DatePicker } from "@/components/ui/date-picker";
import { PH_PROVINCES } from "@/utils/ph-provinces";
import { formatTime12Hour } from "@/utils/attendance-calculations";
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
import { recalculateEmployeeAttendance } from "@/actions/attendance";
import { useToast } from "@/components/ui/use-toast";

// BASE CONFIGS: 5 rates as % additional (on top of regular). Stored as multiplier in DB; UI shows additional.
const BASE_RATE_FIELD_CONFIG: Record<
  string,
  { label: string; placeholder: string; step: string }
> = {
  nightDiffPercent: {
    label: "Night Differential (% additional)",
    placeholder: "10",
    step: "0.01",
  },
  regularHolidayRate: {
    label: "Regular Holiday (% additional)",
    placeholder: "100",
    step: "0.01",
  },
  specialHolidayRate: {
    label: "Special non-working holiday (% additional)",
    placeholder: "30",
    step: "0.01",
  },
  overtimeRegularRate: {
    label: "Overtime Regular (% additional)",
    placeholder: "25",
    step: "0.01",
  },
  overtimeRestDayRate: {
    label: "Rest Day Premium (% additional)",
    placeholder: "30",
    step: "0.01",
  },
};

interface EmployeeDetailModalProps {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "view" | "edit";
  onModeChange?: (mode: "view" | "edit") => void;
  onMessageClick: (employeeId: string) => void;
  employeeData?: any; // Optional pre-fetched employee data to avoid refetching
  hasUserAccount?: boolean; // When true, email cannot be edited (tied to auth account)
}

export function EmployeeDetailModal({
  employeeId,
  open,
  onOpenChange,
  mode,
  onModeChange,
  onMessageClick,
  employeeData,
  hasUserAccount = false,
}: EmployeeDetailModalProps) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const isEditing = mode === "edit";

  const defaultEditValues: EmployeeFormValues = {
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phone: "",
    province: "",
    position: "",
    department: "",
    employmentType: "probationary",
    hireDate: "",
    regularizationDate: "",
    basicSalary: "",
    allowance: "",
    regularHolidayRate: "",
    specialHolidayRate: "",
    nightDiffPercent: "",
    overtimeRegularRate: "",
    overtimeRestDayRate: "",
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
  const SHIFT_NONE = "__none__";
  const [editShiftId, setEditShiftId] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [showAllRateFields, setShowAllRateFields] = useState(false);

  // Use pre-fetched data if available, otherwise fetch
  const fetchedEmployee = useQuery(
    (api as any).employees.getEmployee,
    employeeData || !employeeId
      ? "skip"
      : { employeeId: employeeId as Id<"employees"> },
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

  const orgRates = {
    regularHolidayRate: settings?.payrollSettings?.regularHolidayRate ?? 2.0,
    specialHolidayRate: settings?.payrollSettings?.specialHolidayRate ?? 1.3,
    nightDiffPercent: settings?.payrollSettings?.nightDiffPercent ?? 1.1,
    overtimeRegularRate: settings?.payrollSettings?.overtimeRegularRate ?? 1.25,
    overtimeRestDayRate: settings?.payrollSettings?.overtimeRestDayRate ?? 1.3,
  };

  const BASE_RATE_KEYS = [
    "regularHolidayRate",
    "specialHolidayRate",
    "nightDiffPercent",
    "overtimeRegularRate",
    "overtimeRestDayRate",
  ] as const;

  const overriddenRateKeys: (keyof typeof orgRates)[] = employee
    ? BASE_RATE_KEYS.filter((key) => {
        const empVal = (employee.compensation as any)[key];
        if (empVal == null) return false;
        const orgVal = orgRates[key];
        return Math.abs(Number(empVal) - Number(orgVal)) > 0.0001;
      })
    : [];
  const hasAnyOverrides = overriddenRateKeys.length > 0;

  const shifts = useQuery(
    (api as any).shifts.listShifts,
    employee && currentOrganizationId
      ? { organizationId: currentOrganizationId as Id<"organizations"> }
      : "skip",
  );

  // When "Different time per day", workdays without a matching shift get red border + error (no lunch context).
  const daysWithoutMatchingShift = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (scheduleType !== "regular" || !shifts) return out;
    const days: Array<
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday"
      | "sunday"
    > = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    for (const day of days) {
      const { start, end, workday } = scheduleForm[day];
      if (!workday) continue;
      const matched = shifts.find(
        (s: any) => s.scheduleIn === start && s.scheduleOut === end,
      );
      if (!matched) out[day] = true;
    }
    return out;
  }, [scheduleType, scheduleForm, shifts]);

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
    const sid = (employee as any).shiftId;
    setEditShiftId(sid != null && sid !== "" ? String(sid) : null);
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
      settings?.payrollSettings?.regularHolidayRate ?? 2.0;
    const orgSpecialRateDecimal =
      settings?.payrollSettings?.specialHolidayRate ?? 1.3;
    const orgNightDiffDecimal =
      settings?.payrollSettings?.nightDiffPercent ?? 1.1;
    const orgOvertimeRegularDecimal =
      settings?.payrollSettings?.overtimeRegularRate ?? 1.25;
    const orgOvertimeRestDayDecimal =
      settings?.payrollSettings?.overtimeRestDayRate ?? 1.3;

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

    const hireDate = safeDate(employee.employment.hireDate);
    const regularizationDate = safeDate(employee.employment.regularizationDate);
    const hireDateStr = hireDate ? hireDate.toISOString().slice(0, 10) : "";
    const regularizationDateStr = regularizationDate
      ? regularizationDate.toISOString().slice(0, 10)
      : "";

    reset({
      firstName: employee.personalInfo.firstName,
      lastName: employee.personalInfo.lastName,
      middleName: employee.personalInfo.middleName || "",
      email: employee.personalInfo.email,
      phone: employee.personalInfo.phone || "",
      province: employee.personalInfo.province || "",
      position: employee.employment.position,
      department: employee.employment.department,
      employmentType: employee.employment.employmentType,
      hireDate: hireDateStr,
      regularizationDate: regularizationDateStr,
      basicSalary: employee.compensation.basicSalary.toString(),
      allowance: (employee.compensation.allowance || 0).toString(),
      salaryType: employee.compensation.salaryType,
      regularHolidayRate: Math.round(
        (employeeRegularDecimal - 1) * 100,
      ).toString(),
      specialHolidayRate: Math.round(
        (employeeSpecialDecimal - 1) * 100,
      ).toString(),
      nightDiffPercent: Math.round(
        (employeeNightDiffDecimal - 1) * 100,
      ).toString(),
      overtimeRegularRate: Math.round(
        (employeeOvertimeRegularDecimal - 1) * 100,
      ).toString(),
      overtimeRestDayRate: Math.round(
        (employeeOvertimeRestDayDecimal - 1) * 100,
      ).toString(),
    });
  }, [open, mode, employee, settings, reset]);

  useEffect(() => {
    if (!open) setShowAllRateFields(false);
  }, [open]);

  const onValidSave = async (data: EmployeeFormValues) => {
    if (!employeeId || !employee) return;

    try {
      // When using different time per day, every workday must have a shift whose
      // start/end times match, so lunch (and late/undertime) are well-defined.
      if (scheduleType === "regular") {
        const days: Array<
          | "monday"
          | "tuesday"
          | "wednesday"
          | "thursday"
          | "friday"
          | "saturday"
          | "sunday"
        > = [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ];
        const nextErrors: Record<string, boolean> = {};
        let hasError = false;

        for (const day of days) {
          const { start, end, workday } = scheduleForm[day];
          if (!workday) continue;
          const matchedShift = (shifts ?? []).find(
            (s: any) => s.scheduleIn === start && s.scheduleOut === end,
          );
          if (!matchedShift) {
            nextErrors[day] = true;
            hasError = true;
          }
        }

        if (hasError) {
          toast({
            variant: "destructive",
            title: "Missing shift for some workdays",
            description:
              "One or more workdays have start/end times that do not match any shift. Open Attendance → Shifts in Settings and add a shift that matches each schedule.",
          });
          return;
        }
      }

      setIsSaving(true);
      const orgRegularRateDecimal =
        settings?.payrollSettings?.regularHolidayRate ?? 2.0;
      const orgSpecialRateDecimal =
        settings?.payrollSettings?.specialHolidayRate ?? 1.3;
      const orgNightDiffDecimal =
        settings?.payrollSettings?.nightDiffPercent ?? 1.1;
      const orgOvertimeRegularDecimal =
        settings?.payrollSettings?.overtimeRegularRate ?? 1.25;
      const orgOvertimeRestDayDecimal =
        settings?.payrollSettings?.overtimeRestDayRate ?? 1.3;

      const regularHolidayRateDecimal = data.regularHolidayRate
        ? 1 + parseFloat(data.regularHolidayRate) / 100
        : (employee.compensation.regularHolidayRate ?? orgRegularRateDecimal);

      const specialHolidayRateDecimal = data.specialHolidayRate
        ? 1 + parseFloat(data.specialHolidayRate) / 100
        : (employee.compensation.specialHolidayRate ?? orgSpecialRateDecimal);

      const nightDiffPercentDecimal = data.nightDiffPercent
        ? 1 + parseFloat(data.nightDiffPercent) / 100
        : (employee.compensation.nightDiffPercent ?? orgNightDiffDecimal);

      const overtimeRegularRateDecimal = data.overtimeRegularRate
        ? 1 + parseFloat(data.overtimeRegularRate) / 100
        : (employee.compensation.overtimeRegularRate ??
          orgOvertimeRegularDecimal);

      const overtimeRestDayRateDecimal = data.overtimeRestDayRate
        ? 1 + parseFloat(data.overtimeRestDayRate) / 100
        : (employee.compensation.overtimeRestDayRate ??
          orgOvertimeRestDayDecimal);

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
          province: data.province || undefined,
        },
        employment: {
          ...employee.employment,
          position: data.position,
          department: data.department,
          employmentType: data.employmentType as
            | "regular"
            | "probationary"
            | "contractual"
            | "part-time",
          hireDate: data.hireDate
            ? new Date(data.hireDate).getTime()
            : employee.employment.hireDate,
          regularizationDate: data.regularizationDate
            ? new Date(data.regularizationDate).getTime()
            : null,
        },
        compensation: {
          ...employee.compensation,
          basicSalary: parseFloat(data.basicSalary),
          allowance: data.allowance ? parseFloat(data.allowance) : undefined,
          salaryType: data.salaryType as "monthly" | "daily" | "hourly",
          regularHolidayRate: regularHolidayRateDecimal,
          specialHolidayRate: specialHolidayRateDecimal,
          nightDiffPercent: nightDiffPercentDecimal,
          overtimeRegularRate: overtimeRegularRateDecimal,
          overtimeRestDayRate: overtimeRestDayRateDecimal,
        },
        schedule: {
          ...employee.schedule,
          defaultSchedule: newDefaultSchedule,
        },
        shiftId:
          !editShiftId || editShiftId === SHIFT_NONE
            ? null
            : (editShiftId as Id<"shifts">),
      });

      // Recalculate attendance records based on the updated schedule
      if (currentOrganizationId) {
        await recalculateEmployeeAttendance({
          organizationId: currentOrganizationId,
          employeeId,
          // Only re-evaluate from today onward; keep historical attendance tied to previous schedule.
          startDate: getManilaTodayStartUtcMs(),
        });
      }
      onModeChange?.("view");
      router.refresh();
      toast({ title: "Saved", description: "Employee updated successfully." });
    } catch (error: any) {
      console.error("Error updating employee:", error);
      toast({
        title: "Failed to update employee",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
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
                      employee.personalInfo.address ||
                      employee.personalInfo.province) && (
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
                        {employee.personalInfo.province && (
                          <div className="flex gap-1.5 items-start min-w-0">
                            <span
                              className="w-2 shrink-0 flex justify-center pt-0.5"
                              aria-hidden
                            >
                              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            </span>
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Province
                              </p>
                              <p className="text-sm">
                                {employee.personalInfo.province}
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
                                {(() => {
                                  const d = safeDate(
                                    employee.personalInfo.dateOfBirth,
                                  );
                                  return d ? format(d, "MMM dd, yyyy") : "—";
                                })()}
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
                        className={cn(
                          errors.firstName &&
                            "border-red-500 focus-visible:ring-red-500",
                        )}
                      />
                      {errors.firstName?.message && (
                        <p className="text-xs text-red-600">
                          {errors.firstName.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-middleName" className="text-sm">
                        Middle Name
                      </Label>
                      <Input id="edit-middleName" {...register("middleName")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-lastName" className="text-sm">
                        Last Name
                      </Label>
                      <Input
                        id="edit-lastName"
                        {...register("lastName")}
                        className={cn(
                          errors.lastName &&
                            "border-red-500 focus-visible:ring-red-500",
                        )}
                      />
                      {errors.lastName?.message && (
                        <p className="text-xs text-red-600">
                          {errors.lastName.message}
                        </p>
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
                        disabled={hasUserAccount}
                        className={cn(
                          errors.email &&
                            "border-red-500 focus-visible:ring-red-500",
                          hasUserAccount && "bg-muted cursor-not-allowed",
                        )}
                      />
                      {hasUserAccount && (
                        <p className="text-xs text-muted-foreground">
                          Email cannot be changed because a user account is
                          linked to this employee.
                        </p>
                      )}
                      {errors.email?.message && (
                        <p className="text-xs text-red-600">
                          {errors.email.message}
                        </p>
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
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-province" className="text-sm">
                        Province
                      </Label>
                      <Controller
                        name="province"
                        control={control}
                        render={({ field }) => (
                          <Select
                            value={field.value || "none"}
                            onValueChange={(v) =>
                              field.onChange(v === "none" ? "" : v)
                            }
                          >
                            <SelectTrigger id="edit-province">
                              <SelectValue placeholder="Select province (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {PH_PROVINCES.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {p}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        For province-specific holiday pay (e.g. Cebu-only
                        holidays).
                      </p>
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
                            {(() => {
                              const d = safeDate(employee.employment.hireDate);
                              return d ? format(d, "MMM dd, yyyy") : "—";
                            })()}
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
                              {(() => {
                                const d = safeDate(
                                  employee.employment.regularizationDate,
                                );
                                return d ? format(d, "MMM dd, yyyy") : "—";
                              })()}
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
                        className={cn(
                          errors.position &&
                            "border-red-500 focus-visible:ring-red-500",
                        )}
                      />
                      {errors.position?.message && (
                        <p className="text-xs text-red-600">
                          {errors.position.message}
                        </p>
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
                        <p className="text-xs text-red-600">
                          {errors.department.message}
                        </p>
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
                            value={
                              field.value as
                                | "regular"
                                | "probationary"
                                | "contractual"
                                | "part-time"
                            }
                            onValueChange={field.onChange}
                          />
                        )}
                      />
                      {errors.employmentType?.message && (
                        <p className="text-xs text-red-600">
                          {errors.employmentType.message}
                        </p>
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
                        <p className="text-xs text-red-600">
                          {errors.hireDate.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-regularizationDate"
                        className="text-sm"
                      >
                        Date of regularization
                      </Label>
                      <Controller
                        name="regularizationDate"
                        control={control}
                        render={({ field }) => (
                          <DatePicker
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Optional"
                          />
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. Affects leave proration when enabled in Leave
                        settings.
                      </p>
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
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2 border-t border-gray-100">
                      BASE CONFIGS (% additional)
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 pt-2">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Night Differential
                        </p>
                        <p className="text-sm">
                          {(
                            ((employee.compensation.nightDiffPercent ?? 1.1) -
                              1) *
                            100
                          ).toFixed(0)}
                          % additional
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Regular Holiday
                        </p>
                        <p className="text-sm">
                          {(
                            ((employee.compensation.regularHolidayRate ?? 2.0) -
                              1) *
                            100
                          ).toFixed(0)}
                          % additional
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Special non-working holiday
                        </p>
                        <p className="text-sm">
                          {(
                            ((employee.compensation.specialHolidayRate ?? 1.3) -
                              1) *
                            100
                          ).toFixed(0)}
                          % additional
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Overtime Regular
                        </p>
                        <p className="text-sm">
                          {(
                            ((employee.compensation.overtimeRegularRate ??
                              1.25) -
                              1) *
                            100
                          ).toFixed(0)}
                          % additional
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Rest Day Premium
                        </p>
                        <p className="text-sm">
                          {(
                            ((employee.compensation.overtimeRestDayRate ??
                              1.3) -
                              1) *
                            100
                          ).toFixed(0)}
                          % additional
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
                      className={cn(
                        errors.basicSalary &&
                          "border-red-500 focus-visible:ring-red-500",
                      )}
                    />
                    {errors.basicSalary?.message && (
                      <p className="text-xs text-red-600">
                        {errors.basicSalary.message}
                      </p>
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
                      className={cn(
                        errors.allowance &&
                          "border-red-500 focus-visible:ring-red-500",
                      )}
                    />
                    {errors.allowance?.message && (
                      <p className="text-xs text-red-600">
                        {errors.allowance.message}
                      </p>
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
                      <p className="text-xs text-red-600">
                        {errors.salaryType.message}
                      </p>
                    )}
                  </div>
                  {!showAllRateFields && (
                    <button
                      type="button"
                      className="text-sm text-brand-purple underline hover:no-underline hover:text-brand-purple-hover"
                      onClick={() => setShowAllRateFields(true)}
                    >
                      {hasAnyOverrides
                        ? "Edit pay rates"
                        : "Override pay rates"}
                    </button>
                  )}
                  {showAllRateFields && (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        BASE CONFIGS (% additional)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="edit-nightDiffPercent"
                            className="text-sm"
                          >
                            Night Differential (% additional)
                          </Label>
                          <Input
                            id="edit-nightDiffPercent"
                            type="number"
                            step="0.01"
                            min="0"
                            {...register("nightDiffPercent")}
                            placeholder="10"
                            className={cn(
                              errors.nightDiffPercent &&
                                "border-red-500 focus-visible:ring-red-500",
                            )}
                          />
                          {errors.nightDiffPercent?.message && (
                            <p className="text-xs text-red-600">
                              {errors.nightDiffPercent.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="edit-regularHolidayRate"
                            className="text-sm"
                          >
                            Regular Holiday (% additional)
                          </Label>
                          <Input
                            id="edit-regularHolidayRate"
                            type="number"
                            step="0.01"
                            min="0"
                            {...register("regularHolidayRate")}
                            placeholder="100"
                            className={cn(
                              errors.regularHolidayRate &&
                                "border-red-500 focus-visible:ring-red-500",
                            )}
                          />
                          {errors.regularHolidayRate?.message && (
                            <p className="text-xs text-red-600">
                              {errors.regularHolidayRate.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="edit-specialHolidayRate"
                            className="text-sm"
                          >
                            Special non-working holiday (% additional)
                          </Label>
                          <Input
                            id="edit-specialHolidayRate"
                            type="number"
                            step="0.01"
                            min="0"
                            {...register("specialHolidayRate")}
                            placeholder="30"
                            className={cn(
                              errors.specialHolidayRate &&
                                "border-red-500 focus-visible:ring-red-500",
                            )}
                          />
                          {errors.specialHolidayRate?.message && (
                            <p className="text-xs text-red-600">
                              {errors.specialHolidayRate.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="edit-overtimeRegularRate"
                            className="text-sm"
                          >
                            Overtime Regular (% additional)
                          </Label>
                          <Input
                            id="edit-overtimeRegularRate"
                            type="number"
                            step="0.01"
                            min="0"
                            {...register("overtimeRegularRate")}
                            placeholder="25"
                            className={cn(
                              errors.overtimeRegularRate &&
                                "border-red-500 focus-visible:ring-red-500",
                            )}
                          />
                          {errors.overtimeRegularRate?.message && (
                            <p className="text-xs text-red-600">
                              {errors.overtimeRegularRate.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="edit-overtimeRestDayRate"
                            className="text-sm"
                          >
                            Rest Day Premium (% additional)
                          </Label>
                          <Input
                            id="edit-overtimeRestDayRate"
                            type="number"
                            step="0.01"
                            min="0"
                            {...register("overtimeRestDayRate")}
                            placeholder="30"
                            className={cn(
                              errors.overtimeRestDayRate &&
                                "border-red-500 focus-visible:ring-red-500",
                            )}
                          />
                          {errors.overtimeRestDayRate?.message && (
                            <p className="text-xs text-red-600">
                              {errors.overtimeRestDayRate.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
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
                      const workdays = daysOrder.filter(
                        (day) =>
                          employee.schedule.defaultSchedule[day].isWorkday,
                      );
                      const workdaySchedules = workdays.map((day) => ({
                        day,
                        ...employee.schedule.defaultSchedule[day],
                      }));
                      const firstIn = workdaySchedules[0]?.in;
                      const firstOut = workdaySchedules[0]?.out;
                      const sameTimeEveryDay =
                        workdaySchedules.length > 0 &&
                        workdaySchedules.every(
                          (s) => s.in === firstIn && s.out === firstOut,
                        );

                      if (workdays.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground">
                            No workdays set
                          </p>
                        );
                      }

                      if (sameTimeEveryDay) {
                        return (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Workdays
                              </p>
                              <p className="text-sm font-medium">
                                {workdays
                                  .map((day) => day.slice(0, 3).toUpperCase())
                                  .join(", ")}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Time
                              </p>
                              <p className="text-sm font-medium">
                                {firstIn && firstOut
                                  ? `${formatTime12Hour(firstIn)} – ${formatTime12Hour(firstOut)}`
                                  : "—"}
                              </p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Schedule per day
                          </p>
                          <ul className="text-sm font-medium space-y-1.5">
                            {workdaySchedules.map(
                              ({ day, in: inTime, out: outTime }) =>
                                inTime && outTime ? (
                                  <li
                                    key={day}
                                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                                  >
                                    <span className="capitalize min-w-[5.5rem]">
                                      {day}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {formatTime12Hour(inTime)} –{" "}
                                      {formatTime12Hour(outTime)}
                                    </span>
                                  </li>
                                ) : null,
                            )}
                          </ul>
                        </div>
                      );
                    })()}
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
                  <p className="text-xs text-gray-500">
                    When using different time per day, each day’s lunch is
                    auto-matched from a shift with the same start/end (from
                    Settings). Otherwise the shift below is used as fallback.
                  </p>
                  <div className="space-y-2">
                    <Label className="text-sm">
                      Shift (default lunch / fallback when no match)
                    </Label>
                    <Select
                      value={editShiftId ?? SHIFT_NONE}
                      onValueChange={(v) =>
                        setEditShiftId(v === SHIFT_NONE ? null : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="None (use default lunch)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SHIFT_NONE}>
                          None (use default lunch)
                        </SelectItem>
                        {(shifts ?? []).map((s: any) => (
                          <SelectItem key={String(s._id)} value={String(s._id)}>
                            {s.name} ({s.scheduleIn}–{s.scheduleOut}, lunch{" "}
                            {formatTime12Hour(s.lunchStart)} –{" "}
                            {formatTime12Hour(s.lunchEnd)})
                          </SelectItem>
                        ))}
                        {editShiftId &&
                          editShiftId !== SHIFT_NONE &&
                          !(shifts ?? []).some(
                            (s: any) => String(s._id) === editShiftId,
                          ) && (
                            <SelectItem value={editShiftId}>
                              Unknown shift (no longer in list)
                            </SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                    {editShiftId &&
                      editShiftId !== SHIFT_NONE &&
                      (() => {
                        const selected = (shifts ?? []).find(
                          (s: any) => String(s._id) === editShiftId,
                        );
                        return selected ? (
                          <p className="text-xs text-muted-foreground">
                            Lunch: {formatTime12Hour(selected.lunchStart)} –{" "}
                            {formatTime12Hour(selected.lunchEnd)}
                          </p>
                        ) : null;
                      })()}
                  </div>
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
                          className={cn(
                            "space-y-2 p-3 border rounded-lg",
                            scheduleForm[day].workday &&
                              daysWithoutMatchingShift[day] &&
                              "border-red-500",
                          )}
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
                            <div className="space-y-1 pl-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                              {(() => {
                                const matched = (shifts ?? []).find(
                                  (s: any) =>
                                    s.scheduleIn === scheduleForm[day].start &&
                                    s.scheduleOut === scheduleForm[day].end,
                                );
                                if (matched) {
                                  return (
                                    <p className="text-xs text-muted-foreground">
                                      Lunch: {formatTime12Hour(matched.lunchStart)}{" "}
                                      – {formatTime12Hour(matched.lunchEnd)} (
                                      {matched.name})
                                    </p>
                                  );
                                }
                                if (daysWithoutMatchingShift[day]) {
                                  return (
                                    <p className="text-xs text-red-600">
                                      No shift matches this start/end time. Open
                                      Attendance → Shifts in Settings and add a
                                      shift that matches this schedule.
                                    </p>
                                  );
                                }
                                return null;
                              })()}
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
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => editFormHandleSubmit(onValidSave)()}
                  className="flex-1"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
