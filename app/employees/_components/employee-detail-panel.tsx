"use client";

import { useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import {
  Pencil,
  MessageSquare,
  Mail,
  Phone,
  MapPin,
  Calendar,
  CreditCard,
  Gift,
  TrendingDown,
} from "lucide-react";
import { format } from "date-fns";
import { updateEmployee, getUserByEmployeeId } from "@/app/actions/employees";
import { updateEmployeeLeaveCredits } from "@/app/actions/leave";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import {
  removeUserFromOrganization,
  updateUserRoleInOrganization,
} from "@/app/actions/organizations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trash2, UserCog } from "lucide-react";

interface EmployeeDetailPanelProps {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMessageClick: (employeeId: string) => void;
}

export function EmployeeDetailPanel({
  employeeId,
  open,
  onOpenChange,
  onMessageClick,
}: EmployeeDetailPanelProps) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
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

  const employee = useQuery(
    (api as any).employees.getEmployee,
    employeeId ? { employeeId: employeeId as Id<"employees"> } : "skip"
  );

  const employeeUser = useQuery(
    (api as any).chat.getUserByEmployeeId,
    employeeId && currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          employeeId: employeeId as Id<"employees">,
        }
      : "skip"
  );

  const handleEdit = () => {
    if (employee) {
      // Derive a single common time range from the existing schedule (use first workday or Monday as fallback)
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
      setIsEditing(true);
    }
  };

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
      setIsEditing(false);
      router.refresh();
    } catch (error) {
      console.error("Error updating employee:", error);
      alert("Failed to update employee. Please try again.");
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const isAdmin = user?.role === "admin" || user?.role === "hr";

  const handleRemove = async () => {
    if (!currentOrganizationId || !employee || !isAdmin) return;

    if (
      !confirm(
        `Are you sure you want to remove ${employee.personalInfo.firstName} ${employee.personalInfo.lastName} from the organization?`
      )
    )
      return;

    setIsRemoving(true);
    try {
      const employeeUser = await getUserByEmployeeId({
        organizationId: currentOrganizationId,
        employeeId: employee._id,
      });

      if (employeeUser) {
        await removeUserFromOrganization(
          currentOrganizationId,
          employeeUser._id
        );
        alert("Employee removed successfully");
        onOpenChange(false);
        window.location.reload();
      } else {
        alert("No user account found for this employee");
      }
    } catch (error: any) {
      alert(error.message || "Failed to remove employee");
    } finally {
      setIsRemoving(false);
    }
  };

  const handleUpdateRole = async (newRole: "admin" | "hr" | "employee") => {
    if (!currentOrganizationId || !employee || !isAdmin) return;

    setIsUpdatingRole(true);
    try {
      const employeeUser = await getUserByEmployeeId({
        organizationId: currentOrganizationId,
        employeeId: employee._id,
      });

      if (employeeUser) {
        await updateUserRoleInOrganization({
          organizationId: currentOrganizationId,
          userId: employeeUser._id,
          role: newRole,
        });
        alert(`Role updated to ${newRole} successfully`);
        window.location.reload();
      } else {
        alert(
          "No user account found for this employee. Please invite them first."
        );
      }
    } catch (error: any) {
      alert(error.message || "Failed to update role");
    } finally {
      setIsUpdatingRole(false);
    }
  };

  if (!employee) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>
                {employee.personalInfo.firstName}{" "}
                {employee.personalInfo.lastName}
              </SheetTitle>
              <SheetDescription>
                {employee.employment.position} •{" "}
                {employee.employment.department}
              </SheetDescription>
            </div>
            <div className="flex gap-2">
              {employeeUser && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMessageClick(employee._id)}
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Message
                </Button>
              )}
              {!isEditing && (
                <>
                  <Button variant="outline" size="sm" onClick={handleEdit}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  {isAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <UserCog className="h-4 w-4 mr-2" />
                          Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleUpdateRole("admin")}
                          disabled={isUpdatingRole}
                        >
                          <UserCog className="h-4 w-4 mr-2" />
                          Set as Admin
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleUpdateRole("hr")}
                          disabled={isUpdatingRole}
                        >
                          <UserCog className="h-4 w-4 mr-2" />
                          Set as HR
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleUpdateRole("employee")}
                          disabled={isUpdatingRole}
                        >
                          <UserCog className="h-4 w-4 mr-2" />
                          Set as Employee
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleRemove}
                          disabled={isRemoving}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove from Organization
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Personal Information */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Personal Information
            </h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-firstName">First Name</Label>
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
                    <div className="space-y-2">
                      <Label htmlFor="edit-lastName">Last Name</Label>
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-middleName">Middle Name</Label>
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
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Name:</span>
                    <span className="font-medium">
                      {employee.personalInfo.firstName}{" "}
                      {employee.personalInfo.middleName}{" "}
                      {employee.personalInfo.lastName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-500">Email:</span>
                    <span>{employee.personalInfo.email}</span>
                  </div>
                  {employee.personalInfo.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">Phone:</span>
                      <span>{employee.personalInfo.phone}</span>
                    </div>
                  )}
                  {employee.personalInfo.address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">Address:</span>
                      <span>{employee.personalInfo.address}</span>
                    </div>
                  )}
                  {employee.personalInfo.dateOfBirth && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">Date of Birth:</span>
                      <span>
                        {format(
                          new Date(employee.personalInfo.dateOfBirth),
                          "MMM dd, yyyy"
                        )}
                      </span>
                    </div>
                  )}
                  {employee.personalInfo.civilStatus && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Civil Status:</span>
                      <span>{employee.personalInfo.civilStatus}</span>
                    </div>
                  )}
                  {employee.personalInfo.emergencyContact && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">Emergency Contact:</span>
                      <span>
                        {employee.personalInfo.emergencyContact.name} (
                        {employee.personalInfo.emergencyContact.relationship}) -{" "}
                        {employee.personalInfo.emergencyContact.phone}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Employment Information */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Employment Information
            </h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="edit-position">Position</Label>
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-department">Department</Label>
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-employmentType">Employment Type</Label>
                    <select
                      id="edit-employmentType"
                      className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                      value={editFormData.employmentType}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          employmentType: e.target
                            .value as (typeof editFormData)["employmentType"],
                        })
                      }
                    >
                      <option value="probationary">Probationary</option>
                      <option value="regular">Regular</option>
                      <option value="contractual">Contractual</option>
                      <option value="part-time">Part-time</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Employee ID:</span>
                    <span className="font-medium">
                      {employee.employment.employeeId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Position:</span>
                    <span>{employee.employment.position}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Department:</span>
                    <span>{employee.employment.department}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Employment Type:</span>
                    <Badge variant="secondary">
                      {employee.employment.employmentType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-500">Hire Date:</span>
                    <span>
                      {format(
                        new Date(employee.employment.hireDate),
                        "MMM dd, yyyy"
                      )}
                    </span>
                  </div>
                  {employee.employment.regularizationDate && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">
                        Regularization Date:
                      </span>
                      <span>
                        {format(
                          new Date(employee.employment.regularizationDate),
                          "MMM dd, yyyy"
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Status:</span>
                    <Badge
                      className={
                        employee.employment.status === "active"
                          ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none"
                          : "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none"
                      }
                    >
                      {employee.employment.status}
                    </Badge>
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Compensation */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Compensation
            </h3>
            <div className="space-y-3">
              {isEditing ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="edit-basicSalary">Basic Salary *</Label>
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-allowance">
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-salaryType">Salary Type</Label>
                    <select
                      id="edit-salaryType"
                      className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                      value={editFormData.salaryType}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          salaryType: e.target.value as any,
                        })
                      }
                    >
                      <option value="monthly">Monthly</option>
                      <option value="daily">Daily</option>
                      <option value="hourly">Hourly</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-regularHolidayRate">
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
                      <p className="text-xs text-gray-500">
                        Additional % for regular holidays (default: 100%).
                        Example: 1.0 = 100% additional pay
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-specialHolidayRate">
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
                      <p className="text-xs text-gray-500">
                        Additional % for special holidays (default: 30%).
                        Example: 0.3 = 30% additional pay, 1.0 = 100%
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Basic Salary:</span>
                    <span className="font-medium">
                      ₱{employee.compensation.basicSalary.toLocaleString()}
                    </span>
                  </div>
                  {employee.compensation.allowance && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">
                        Non-Taxable Allowance:
                      </span>
                      <span className="font-medium">
                        ₱{employee.compensation.allowance.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Salary Type:</span>
                    <span>{employee.compensation.salaryType}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Regular Holiday Rate:</span>
                    <span>
                      {(
                        (employee.compensation.regularHolidayRate ?? 1.0) * 100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Special Holiday Rate:</span>
                    <span>
                      {(
                        (employee.compensation.specialHolidayRate ?? 0.3) * 100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Bank Details */}
          {employee.compensation.bankDetails && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Bank Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">Bank Name:</span>
                  <span>{employee.compensation.bankDetails.bankName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Account Number:</span>
                  <span>{employee.compensation.bankDetails.accountNumber}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Account Name:</span>
                  <span>{employee.compensation.bankDetails.accountName}</span>
                </div>
              </div>
            </div>
          )}

          {/* Leave Credits */}
          {employee.leaveCredits && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Leave Credits
              </h3>
              {isEditing ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <Label htmlFor="edit-vacationTotal">
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-sickTotal">
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
                  <p className="col-span-2 text-xs text-gray-500">
                    Balances will be recalculated automatically from totals and
                    used days.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Vacation Leave:</span>
                    <span>
                      {employee.leaveCredits.vacation?.balance || 0} /{" "}
                      {employee.leaveCredits.vacation?.total || 0} days
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Sick Leave:</span>
                    <span>
                      {employee.leaveCredits.sick?.balance || 0} /{" "}
                      {employee.leaveCredits.sick?.total || 0} days
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Work Schedule / Rest Days */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Work Schedule
            </h3>
            {isEditing ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-gray-500">
                  Set a single daily time range and choose which days are
                  workdays. The same time range will apply to all selected
                  workdays.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-scheduleStart">Start time</Label>
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
                  <div className="space-y-1">
                    <Label htmlFor="edit-scheduleEnd">End time</Label>
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
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Workdays</p>
                  <div className="grid grid-cols-2 gap-2">
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
                          className="h-4 w-4 accent-purple-600"
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
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Workdays:</span>
                  <span className="font-medium">
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
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Time:</span>
                  <span className="font-medium">
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
                            employee.schedule.defaultSchedule[day].isWorkday
                        ) as (typeof daysOrder)[number]) ?? "monday";
                      const sched =
                        employee.schedule.defaultSchedule[firstWorkday];
                      return sched?.in && sched?.out
                        ? `${sched.in} - ${sched.out}`
                        : "—";
                    })()}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Active Deductions */}
          {employee.deductions && employee.deductions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Active Deductions
              </h3>
              <div className="space-y-2">
                {employee.deductions
                  .filter((d: any) => d.isActive)
                  .map((deduction: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-gray-400" />
                        <span>{deduction.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {deduction.type}
                        </Badge>
                      </div>
                      <span className="font-medium">
                        ₱{deduction.amount.toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Active Incentives */}
          {employee.incentives && employee.incentives.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Active Incentives
              </h3>
              <div className="space-y-2">
                {employee.incentives
                  .filter((i: any) => i.isActive)
                  .map((incentive: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-gray-400" />
                        <span>{incentive.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {incentive.frequency}
                        </Badge>
                      </div>
                      <span className="font-medium">
                        ₱{incentive.amount.toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {isEditing && (
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} className="flex-1">
                Save Changes
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
