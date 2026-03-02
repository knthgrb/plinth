"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { createEmployee } from "@/actions/employees";
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
import { DepartmentSelect } from "@/components/ui/department-select";
import {
  EmploymentTypeSelect,
  type EmploymentType,
} from "@/components/ui/employment-type-select";
import {
  SalaryTypeSelect,
  type SalaryType,
} from "@/components/ui/salary-type-select";
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
import { Loader2 } from "lucide-react";
import {
  employeeFormSchema,
  type EmployeeFormValues,
} from "./employee-form-validation";
import { cn } from "@/utils/utils";

const defaultFormData = {
  firstName: "",
  lastName: "",
  middleName: "",
  email: "",
  phone: "",
  position: "",
  department: "",
  employmentType: "probationary" as EmploymentType,
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
  salaryType: "monthly" as SalaryType,
};

const defaultOneTimeSchedule = {
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
};

const defaultScheduleForm = {
  monday: { start: "09:00", end: "18:00", workday: true },
  tuesday: { start: "09:00", end: "18:00", workday: true },
  wednesday: { start: "09:00", end: "18:00", workday: true },
  thursday: { start: "09:00", end: "18:00", workday: true },
  friday: { start: "09:00", end: "18:00", workday: true },
  saturday: { start: "09:00", end: "18:00", workday: false },
  sunday: { start: "09:00", end: "18:00", workday: false },
};

type CreateEmployeeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: Id<"organizations"> | null;
  onSuccess?: (employeeId: string) => void;
  onEditDepartments?: () => void;
};

export function CreateEmployeeDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
  onEditDepartments,
}: CreateEmployeeDialogProps) {
  const settings = useQuery(
    (api as any).settings.getSettings,
    organizationId ? { organizationId } : "skip"
  );

  const departments = settings?.departments
    ? settings.departments.length > 0 &&
      typeof settings.departments[0] === "string"
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

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaultFormData,
  });
  const {
    register,
    handleSubmit: formHandleSubmit,
    formState: { errors },
    control,
    reset,
  } = form;

  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [scheduleType, setScheduleType] = useState<"one-time" | "regular">(
    "one-time"
  );
  const [oneTimeSchedule, setOneTimeSchedule] = useState(
    defaultOneTimeSchedule
  );
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);

  const onValidSubmit = async (data: EmployeeFormValues) => {
    if (!organizationId || isCreatingEmployee) return;

    setIsCreatingEmployee(true);
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
        : orgRegularRateDecimal;
      const specialHolidayRateDecimal = data.specialHolidayRate
        ? parseFloat(data.specialHolidayRate) / 100
        : orgSpecialRateDecimal;
      const nightDiffPercentDecimal = data.nightDiffPercent
        ? parseFloat(data.nightDiffPercent) / 100
        : orgNightDiffDecimal;
      const overtimeRegularRateDecimal = data.overtimeRegularRate
        ? parseFloat(data.overtimeRegularRate) / 100
        : orgOvertimeRegularDecimal;
      const overtimeRestDayRateDecimal = data.overtimeRestDayRate
        ? parseFloat(data.overtimeRestDayRate) / 100
        : orgOvertimeRestDayDecimal;
      const regularHolidayOtRateDecimal = data.regularHolidayOtRate
        ? parseFloat(data.regularHolidayOtRate) / 100
        : orgRegularHolidayOtDecimal;
      const specialHolidayOtRateDecimal = data.specialHolidayOtRate
        ? parseFloat(data.specialHolidayOtRate) / 100
        : orgSpecialHolidayOtDecimal;

      const newId = await createEmployee({
        organizationId,
        personalInfo: {
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName || undefined,
          email: data.email,
          phone: data.phone || undefined,
        },
        employment: {
          employeeId: "",
          position: data.position,
          department: data.department,
          employmentType: data.employmentType as "regular" | "probationary" | "contractual" | "part-time",
          hireDate: new Date(data.hireDate).getTime(),
          status: "active",
        },
        compensation: {
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
        schedule: enableSchedule
          ? {
              defaultSchedule: (() => {
                if (scheduleType === "one-time") {
                  return {
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
                  };
                }
                return {
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
              })(),
            }
          : {
              defaultSchedule: {
                monday: { in: "09:00", out: "18:00", isWorkday: true },
                tuesday: { in: "09:00", out: "18:00", isWorkday: true },
                wednesday: { in: "09:00", out: "18:00", isWorkday: true },
                thursday: { in: "09:00", out: "18:00", isWorkday: true },
                friday: { in: "09:00", out: "18:00", isWorkday: true },
                saturday: { in: "09:00", out: "18:00", isWorkday: false },
                sunday: { in: "09:00", out: "18:00", isWorkday: false },
              },
            },
      });
      onSuccess?.(newId as string);
      onOpenChange(false);
      reset(defaultFormData);
      setEnableSchedule(false);
      setScheduleType("one-time");
      setOneTimeSchedule(defaultOneTimeSchedule);
      setScheduleForm(defaultScheduleForm);
    } catch (error) {
      console.error("Error creating employee:", error);
      alert("Failed to create employee. Please try again.");
    } finally {
      setIsCreatingEmployee(false);
    }
  };

  const handleClose = () => {
    if (!isCreatingEmployee) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="dialog-thin-scrollbar min-h-0 overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Add New Employee
          </DialogTitle>
          <DialogDescription className="text-sm">
            Fill in the employee information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={formHandleSubmit(onValidSubmit)}>
          <fieldset disabled={isCreatingEmployee} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-firstName" required>First Name</Label>
                  <Input
                    id="ce-firstName"
                    {...register("firstName")}
                    className={cn(errors.firstName && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.firstName?.message && (
                    <p className="text-xs text-red-600">
                      {errors.firstName.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-middleName">Middle Name</Label>
                  <Input
                    id="ce-middleName"
                    {...register("middleName")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-lastName" required>Last Name</Label>
                  <Input
                    id="ce-lastName"
                    {...register("lastName")}
                    className={cn(errors.lastName && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.lastName?.message && (
                    <p className="text-xs text-red-600">
                      {errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-email" required>Email</Label>
                  <Input
                    id="ce-email"
                    type="email"
                    {...register("email")}
                    className={cn(errors.email && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.email?.message && (
                    <p className="text-xs text-red-600">{errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-phone">Phone</Label>
                  <Input
                    id="ce-phone"
                    type="tel"
                    {...register("phone")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-position" required>Position</Label>
                  <Input
                    id="ce-position"
                    {...register("position")}
                    className={cn(errors.position && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.position?.message && (
                    <p className="text-xs text-red-600">
                      {errors.position.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-department" required>Department</Label>
                  <Controller
                    name="department"
                    control={control}
                    render={({ field }) => (
                      <DepartmentSelect
                        departments={departments}
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isCreatingEmployee}
                        onEditDepartments={onEditDepartments}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label required>Employment Type</Label>
                  <Controller
                    name="employmentType"
                    control={control}
                    render={({ field }) => (
                      <EmploymentTypeSelect
                        value={field.value as EmploymentType}
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
                <div className="space-y-2">
                  <Label htmlFor="ce-hireDate" required>Hire Date</Label>
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
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-basicSalary" required>Basic Salary</Label>
                  <Input
                    id="ce-basicSalary"
                    type="number"
                    step="0.01"
                    {...register("basicSalary")}
                    className={cn(errors.basicSalary && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.basicSalary?.message && (
                    <p className="text-xs text-red-600">
                      {errors.basicSalary.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-allowance">Non-Taxable Allowance</Label>
                  <Input
                    id="ce-allowance"
                    type="number"
                    step="0.01"
                    {...register("allowance")}
                    placeholder="0.00"
                    className={cn(errors.allowance && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.allowance?.message && (
                    <p className="text-xs text-red-600">
                      {errors.allowance.message}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    Optional: Non-taxable allowance
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-regularHolidayRate">
                    Regular Holiday Rate (%)
                  </Label>
                  <Input
                    id="ce-regularHolidayRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.regularHolidayRate ?? 1.0) *
                        100
                      ).toString()
                    }
                    {...register("regularHolidayRate")}
                    className={cn(errors.regularHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.regularHolidayRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.regularHolidayRate.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-specialHolidayRate">
                    Special non-working holiday rate (%)
                  </Label>
                  <Input
                    id="ce-specialHolidayRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.specialHolidayRate ?? 0.3) *
                        100
                      ).toString()
                    }
                    {...register("specialHolidayRate")}
                    className={cn(errors.specialHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.specialHolidayRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.specialHolidayRate.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-nightDiffPercent">
                    Night Differential (%)
                  </Label>
                  <Input
                    id="ce-nightDiffPercent"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.nightDiffPercent ?? 0.1) *
                        100
                      ).toString()
                    }
                    {...register("nightDiffPercent")}
                    className={cn(errors.nightDiffPercent && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.nightDiffPercent?.message && (
                    <p className="text-xs text-red-600">
                      {errors.nightDiffPercent.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-overtimeRegularRate">
                    Overtime Regular Rate (%)
                  </Label>
                  <Input
                    id="ce-overtimeRegularRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.overtimeRegularRate ??
                        1.25) *
                        100
                      ).toString()
                    }
                    {...register("overtimeRegularRate")}
                    className={cn(errors.overtimeRegularRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.overtimeRegularRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.overtimeRegularRate.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-overtimeRestDayRate">
                    Overtime Rest Day Rate (%)
                  </Label>
                  <Input
                    id="ce-overtimeRestDayRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.overtimeRestDayRate ??
                        1.69) *
                        100
                      ).toString()
                    }
                    {...register("overtimeRestDayRate")}
                    className={cn(errors.overtimeRestDayRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.overtimeRestDayRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.overtimeRestDayRate.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-regularHolidayOtRate">
                    Regular Holiday OT Rate (%)
                  </Label>
                  <Input
                    id="ce-regularHolidayOtRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.regularHolidayOtRate ??
                        2.0) *
                        100
                      ).toString()
                    }
                    {...register("regularHolidayOtRate")}
                    className={cn(errors.regularHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.regularHolidayOtRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.regularHolidayOtRate.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-specialHolidayOtRate">
                    Special non-working holiday OT rate (%)
                  </Label>
                  <Input
                    id="ce-specialHolidayOtRate"
                    type="number"
                    step="0.01"
                    placeholder={
                      ((settings?.payrollSettings?.specialHolidayOtRate ??
                        1.69) *
                        100
                      ).toString()
                    }
                    {...register("specialHolidayOtRate")}
                    className={cn(errors.specialHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                  />
                  {errors.specialHolidayOtRate?.message && (
                    <p className="text-xs text-red-600">
                      {errors.specialHolidayOtRate.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label required>Salary Type</Label>
                  <Controller
                    name="salaryType"
                    control={control}
                    render={({ field }) => (
                      <SalaryTypeSelect
                        value={field.value as SalaryType}
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
              </div>

              <div className="space-y-4 pt-4 border-t border-[#DDDDDD]">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ce-enableSchedule"
                    checked={enableSchedule}
                    onCheckedChange={(checked) =>
                      setEnableSchedule(checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="ce-enableSchedule"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Set Work Schedule (Optional)
                  </Label>
                </div>

                {enableSchedule && (
                  <div className="space-y-4 pl-6 border-l border-[#DDDDDD]">
                    <div className="space-y-2">
                      <Label>Schedule Type</Label>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <div className="space-y-2">
                          <Label>Workdays</Label>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                              { key: "monday", label: "Monday" },
                              { key: "tuesday", label: "Tuesday" },
                              { key: "wednesday", label: "Wednesday" },
                              { key: "thursday", label: "Thursday" },
                              { key: "friday", label: "Friday" },
                              { key: "saturday", label: "Saturday" },
                              { key: "sunday", label: "Sunday" },
                            ].map((day) => (
                              <div
                                key={day.key}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`ce-workday-${day.key}`}
                                  checked={
                                    oneTimeSchedule.workdays[
                                      day.key as keyof typeof oneTimeSchedule.workdays
                                    ]
                                  }
                                  onCheckedChange={(checked) =>
                                    setOneTimeSchedule({
                                      ...oneTimeSchedule,
                                      workdays: {
                                        ...oneTimeSchedule.workdays,
                                        [day.key]: checked as boolean,
                                      },
                                    })
                                  }
                                />
                                <Label
                                  htmlFor={`ce-workday-${day.key}`}
                                  className="text-sm font-normal cursor-pointer"
                                >
                                  {day.label}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[
                          { key: "monday", label: "Monday" },
                          { key: "tuesday", label: "Tuesday" },
                          { key: "wednesday", label: "Wednesday" },
                          { key: "thursday", label: "Thursday" },
                          { key: "friday", label: "Friday" },
                          { key: "saturday", label: "Saturday" },
                          { key: "sunday", label: "Sunday" },
                        ].map((day) => (
                          <div
                            key={day.key}
                            className="space-y-2 p-3 border rounded-lg"
                          >
                            <div className="flex items-center space-x-2 mb-2">
                              <Checkbox
                                id={`ce-regular-${day.key}`}
                                checked={
                                  scheduleForm[
                                    day.key as keyof typeof scheduleForm
                                  ].workday
                                }
                                onCheckedChange={(checked) =>
                                  setScheduleForm({
                                    ...scheduleForm,
                                    [day.key]: {
                                      ...scheduleForm[
                                        day.key as keyof typeof scheduleForm
                                      ],
                                      workday: checked as boolean,
                                    },
                                  })
                                }
                              />
                              <Label
                                htmlFor={`ce-regular-${day.key}`}
                                className="text-sm font-medium cursor-pointer"
                              >
                                {day.label}
                              </Label>
                            </div>
                            {scheduleForm[
                              day.key as keyof typeof scheduleForm
                            ].workday && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
                                <TimePicker
                                  value={
                                    scheduleForm[
                                      day.key as keyof typeof scheduleForm
                                    ].start
                                  }
                                  onValueChange={(value) =>
                                    setScheduleForm({
                                      ...scheduleForm,
                                      [day.key]: {
                                        ...scheduleForm[
                                          day.key as keyof typeof scheduleForm
                                        ],
                                        start: value,
                                      },
                                    })
                                  }
                                  label="Start Time"
                                  placeholder="Select start time"
                                  showLabel={true}
                                />
                                <TimePicker
                                  value={
                                    scheduleForm[
                                      day.key as keyof typeof scheduleForm
                                    ].end
                                  }
                                  onValueChange={(value) =>
                                    setScheduleForm({
                                      ...scheduleForm,
                                      [day.key]: {
                                        ...scheduleForm[
                                          day.key as keyof typeof scheduleForm
                                        ],
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
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose()}
                disabled={isCreatingEmployee}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingEmployee}>
                {isCreatingEmployee ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Employee"
                )}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
