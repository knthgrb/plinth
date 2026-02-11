"use client";

import { useState } from "react";
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

  const [formData, setFormData] = useState(defaultFormData);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [scheduleType, setScheduleType] = useState<"one-time" | "regular">(
    "one-time"
  );
  const [oneTimeSchedule, setOneTimeSchedule] = useState(
    defaultOneTimeSchedule
  );
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || isCreatingEmployee) return;

    setIsCreatingEmployee(true);
    try {
      const newId = await createEmployee({
        organizationId,
        personalInfo: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          middleName: formData.middleName || undefined,
          email: formData.email,
          phone: formData.phone || undefined,
        },
        employment: {
          employeeId: "",
          position: formData.position,
          department: formData.department,
          employmentType: formData.employmentType,
          hireDate: new Date(formData.hireDate).getTime(),
          status: "active",
        },
        compensation: {
          basicSalary: parseFloat(formData.basicSalary),
          allowance: formData.allowance
            ? parseFloat(formData.allowance)
            : undefined,
          salaryType: formData.salaryType,
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
      setFormData(defaultFormData);
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
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Add New Employee
          </DialogTitle>
          <DialogDescription className="text-sm">
            Fill in the employee information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={isCreatingEmployee} className="space-y-4">
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-firstName">First Name *</Label>
                  <Input
                    id="ce-firstName"
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData({ ...formData, firstName: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-lastName">Last Name *</Label>
                  <Input
                    id="ce-lastName"
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData({ ...formData, lastName: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ce-middleName">Middle Name</Label>
                <Input
                  id="ce-middleName"
                  value={formData.middleName}
                  onChange={(e) =>
                    setFormData({ ...formData, middleName: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-email">Email *</Label>
                  <Input
                    id="ce-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-phone">Phone</Label>
                  <Input
                    id="ce-phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-position">Position *</Label>
                  <Input
                    id="ce-position"
                    value={formData.position}
                    onChange={(e) =>
                      setFormData({ ...formData, position: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-department">Department *</Label>
                  <DepartmentSelect
                    departments={departments}
                    value={formData.department}
                    onValueChange={(value) =>
                      setFormData({ ...formData, department: value })
                    }
                    disabled={isCreatingEmployee}
                    onEditDepartments={onEditDepartments}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Employment Type *</Label>
                  <EmploymentTypeSelect
                    value={formData.employmentType}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        employmentType: value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-hireDate">Hire Date *</Label>
                  <DatePicker
                    value={formData.hireDate}
                    onValueChange={(value) =>
                      setFormData({ ...formData, hireDate: value })
                    }
                    placeholder="Select hire date"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ce-basicSalary">Basic Salary *</Label>
                  <Input
                    id="ce-basicSalary"
                    type="number"
                    step="0.01"
                    value={formData.basicSalary}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        basicSalary: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ce-allowance">Non-Taxable Allowance</Label>
                  <Input
                    id="ce-allowance"
                    type="number"
                    step="0.01"
                    value={formData.allowance}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        allowance: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                  <p className="text-xs text-gray-500">
                    Optional: Non-taxable allowance
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Salary Type *</Label>
                  <SalaryTypeSelect
                    value={formData.salaryType}
                    onValueChange={(value) =>
                      setFormData({ ...formData, salaryType: value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
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
                  <div className="space-y-4 pl-6 border-l-2 border-gray-200">
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
                            One Time Schedule (Same for all workdays)
                          </SelectItem>
                          <SelectItem value="regular">
                            Regular Workdays (Different per day)
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
      </DialogContent>
    </Dialog>
  );
}
