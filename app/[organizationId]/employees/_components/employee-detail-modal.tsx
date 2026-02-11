"use client";

import { useState, useEffect } from "react";
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
import { Mail, Calendar, CreditCard, Gift, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { updateEmployee } from "@/actions/employees";
import { updateEmployeeLeaveCredits } from "@/actions/leave";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import { EmploymentTypeSelect } from "@/components/ui/employment-type-select";
import { SalaryTypeSelect } from "@/components/ui/salary-type-select";

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
  const [editFormData, setEditFormData] = useState({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    employmentType: "probationary" as
      | "regular"
      | "probationary"
      | "contractual"
      | "part-time",
    basicSalary: "",
    allowance: "",
    salaryType: "monthly" as "monthly" | "daily" | "hourly",
    regularHolidayRate: "",
    specialHolidayRate: "",
    scheduleStart: "",
    scheduleEnd: "",
    workdays: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    } as {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    },
    vacationTotal: "",
    sickTotal: "",
  });

  // Use pre-fetched data if available, otherwise fetch
  const fetchedEmployee = useQuery(
    (api as any).employees.getEmployee,
    employeeData || !employeeId
      ? "skip"
      : { employeeId: employeeId as Id<"employees"> }
  );
  const employee = employeeData || fetchedEmployee;

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
    const firstWorkdayKey =
      (daysOrder.find(
        (day) => employee.schedule.defaultSchedule[day].isWorkday
      ) as (typeof daysOrder)[number]) ?? "monday";
    const firstWorkdaySchedule =
      employee.schedule.defaultSchedule[firstWorkdayKey];

    setEditFormData({
      firstName: employee.personalInfo.firstName,
      lastName: employee.personalInfo.lastName,
      middleName: employee.personalInfo.middleName || "",
      email: employee.personalInfo.email,
      phone: employee.personalInfo.phone || "",
      position: employee.employment.position,
      department: employee.employment.department,
      employmentType: employee.employment.employmentType,
      basicSalary: employee.compensation.basicSalary.toString(),
      allowance: (employee.compensation.allowance || 0).toString(),
      salaryType: employee.compensation.salaryType,
      regularHolidayRate: (
        employee.compensation.regularHolidayRate ?? 1.0
      ).toString(),
      specialHolidayRate: (
        employee.compensation.specialHolidayRate ?? 0.3
      ).toString(),
      scheduleStart: firstWorkdaySchedule?.in || "",
      scheduleEnd: firstWorkdaySchedule?.out || "",
      workdays: {
        monday: employee.schedule.defaultSchedule.monday.isWorkday,
        tuesday: employee.schedule.defaultSchedule.tuesday.isWorkday,
        wednesday: employee.schedule.defaultSchedule.wednesday.isWorkday,
        thursday: employee.schedule.defaultSchedule.thursday.isWorkday,
        friday: employee.schedule.defaultSchedule.friday.isWorkday,
        saturday: employee.schedule.defaultSchedule.saturday.isWorkday,
        sunday: employee.schedule.defaultSchedule.sunday.isWorkday,
      },
      vacationTotal: employee.leaveCredits?.vacation?.total?.toString() || "",
      sickTotal: employee.leaveCredits?.sick?.total?.toString() || "",
    });
  }, [open, mode, employee]);

  const handleSave = async () => {
    if (!employeeId || !employee) return;

    try {
      await updateEmployee(employeeId, {
        personalInfo: {
          firstName: editFormData.firstName,
          lastName: editFormData.lastName,
          middleName: editFormData.middleName || undefined,
          email: editFormData.email,
          phone: editFormData.phone || undefined,
        },
        employment: {
          ...employee.employment,
          position: editFormData.position,
          department: editFormData.department,
          employmentType: editFormData.employmentType,
        },
        compensation: {
          ...employee.compensation,
          basicSalary: parseFloat(editFormData.basicSalary),
          allowance: editFormData.allowance
            ? parseFloat(editFormData.allowance)
            : undefined,
          salaryType: editFormData.salaryType,
          regularHolidayRate: editFormData.regularHolidayRate
            ? parseFloat(editFormData.regularHolidayRate)
            : undefined,
          specialHolidayRate: editFormData.specialHolidayRate
            ? parseFloat(editFormData.specialHolidayRate)
            : undefined,
        },
        schedule: {
          ...employee.schedule,
          defaultSchedule: {
            ...employee.schedule.defaultSchedule,
            monday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.monday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.monday.out,
              isWorkday: editFormData.workdays.monday,
            },
            tuesday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.tuesday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.tuesday.out,
              isWorkday: editFormData.workdays.tuesday,
            },
            wednesday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.wednesday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.wednesday.out,
              isWorkday: editFormData.workdays.wednesday,
            },
            thursday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.thursday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.thursday.out,
              isWorkday: editFormData.workdays.thursday,
            },
            friday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.friday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.friday.out,
              isWorkday: editFormData.workdays.friday,
            },
            saturday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.saturday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.saturday.out,
              isWorkday: editFormData.workdays.saturday,
            },
            sunday: {
              in:
                editFormData.scheduleStart ||
                employee.schedule.defaultSchedule.sunday.in,
              out:
                editFormData.scheduleEnd ||
                employee.schedule.defaultSchedule.sunday.out,
              isWorkday: editFormData.workdays.sunday,
            },
          },
        },
      });

      // Optionally update leave credits totals if changed
      if (currentOrganizationId) {
        const vacTotal = parseFloat(editFormData.vacationTotal);
        if (!Number.isNaN(vacTotal)) {
          await updateEmployeeLeaveCredits({
            organizationId: currentOrganizationId,
            employeeId,
            leaveType: "vacation",
            total: vacTotal,
          });
        }

        const sickTotal = parseFloat(editFormData.sickTotal);
        if (!Number.isNaN(sickTotal)) {
          await updateEmployeeLeaveCredits({
            organizationId: currentOrganizationId,
            employeeId,
            leaveType: "sick",
            total: sickTotal,
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
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-firstName" className="text-sm">
                        First Name
                      </Label>
                      <Input
                        id="edit-firstName"
                        value={editFormData.firstName}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            firstName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-lastName" className="text-sm">
                        Last Name
                      </Label>
                      <Input
                        id="edit-lastName"
                        value={editFormData.lastName}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            lastName: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-middleName" className="text-sm">
                      Middle Name
                    </Label>
                    <Input
                      id="edit-middleName"
                      value={editFormData.middleName}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          middleName: e.target.value,
                        })
                      }
                    />
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
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-position" className="text-sm">
                      Position
                    </Label>
                    <Input
                      id="edit-position"
                      value={editFormData.position}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          position: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-department" className="text-sm">
                      Department
                    </Label>
                    <Input
                      id="edit-department"
                      value={editFormData.department}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          department: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-employmentType" className="text-sm">
                      Employment Type
                    </Label>
                    <EmploymentTypeSelect
                      value={editFormData.employmentType}
                      onValueChange={(value) =>
                        setEditFormData({
                          ...editFormData,
                          employmentType: value,
                        })
                      }
                    />
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
                          Special Holiday Rate
                        </p>
                        <p className="text-sm">
                          {(
                            (employee.compensation.specialHolidayRate ?? 0.3) *
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
                      value={editFormData.basicSalary}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          basicSalary: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-allowance" className="text-sm">
                      Non-Taxable Allowance
                    </Label>
                    <Input
                      id="edit-allowance"
                      type="number"
                      step="0.01"
                      value={editFormData.allowance}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          allowance: e.target.value,
                        })
                      }
                      placeholder="0.00"
                    />
                    <p className="text-xs text-gray-500">
                      Optional: Non-taxable allowance (e.g., transportation,
                      meal allowance)
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-salaryType" className="text-sm">
                      Salary Type
                    </Label>
                    <SalaryTypeSelect
                      value={editFormData.salaryType}
                      onValueChange={(value) =>
                        setEditFormData({
                          ...editFormData,
                          salaryType: value,
                        })
                      }
                    />
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
                        max="2"
                        value={editFormData.regularHolidayRate}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            regularHolidayRate: e.target.value,
                          })
                        }
                        placeholder="100"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="edit-specialHolidayRate"
                        className="text-sm"
                      >
                        Special Holiday Rate (%)
                      </Label>
                      <Input
                        id="edit-specialHolidayRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="2"
                        value={editFormData.specialHolidayRate}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            specialHolidayRate: e.target.value,
                          })
                        }
                        placeholder="30"
                      />
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
                          value={editFormData.vacationTotal}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              vacationTotal: e.target.value,
                            })
                          }
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
                          value={editFormData.sickTotal}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              sickTotal: e.target.value,
                            })
                          }
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
                <div className="space-y-2 text-sm">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Work Schedule
                  </h3>
                  <p className="text-xs text-gray-500">
                    Set a single daily time range and choose which days are
                    workdays.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-scheduleStart" className="text-sm">
                        Start time
                      </Label>
                      <Input
                        id="edit-scheduleStart"
                        type="time"
                        value={editFormData.scheduleStart}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            scheduleStart: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-scheduleEnd" className="text-sm">
                        End time
                      </Label>
                      <Input
                        id="edit-scheduleEnd"
                        type="time"
                        value={editFormData.scheduleEnd}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            scheduleEnd: e.target.value,
                          })
                        }
                      />
                    </div>
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
                        <label
                          key={day}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-purple"
                            checked={editFormData.workdays[day]}
                            onChange={(e) =>
                              setEditFormData({
                                ...editFormData,
                                workdays: {
                                  ...editFormData.workdays,
                                  [day]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span className="capitalize">{day}</span>
                        </label>
                      ))}
                    </div>
                  </div>
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
                <Button onClick={handleSave} className="flex-1">
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
