"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Loader2 } from "lucide-react";
import {
  createEmployee,
  getUserByEmployeeId,
  updateEmployee,
  deleteEmployee,
} from "@/actions/employees";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import { useRouter } from "next/navigation";
import {
  removeUserFromOrganization,
  updateUserRoleInOrganization,
} from "@/actions/organizations";
import { sendMessageToEmployee } from "@/actions/chat";
import { createUserForEmployee } from "@/actions/employees";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import dynamic from "next/dynamic";
import { EmployeesFilters } from "./_components/employees-filters";
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
const EmployeesTable = dynamic(
  () => import("./_components/employees-table").then((m) => m.EmployeesTable),
  {
    loading: () => (
      <div className="p-4 text-center text-gray-500">Loading employees...</div>
    ),
    ssr: false,
  }
);

const EmployeeDetailPanel = dynamic(
  () =>
    import("./_components/employee-detail-modal").then(
      (m) => m.EmployeeDetailModal
    ),
  {
    loading: () => null, // Don't show loading skeleton - panel will handle its own loading state
    ssr: false,
  }
);

export default function EmployeesPage() {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const router = useRouter();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null
  );
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"view" | "edit">("view");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "resigned" | "terminated"
  >("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  // Handle migration from old format to new format
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

  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          status: statusFilter,
          department: departmentFilter !== "all" ? departmentFilter : undefined,
          search: search || undefined,
        }
      : "skip"
  );

  // Check which employees have user accounts
  const employeesUserAccounts: Record<string, boolean> | undefined = useQuery(
    (api as any).employees.checkEmployeesUserAccounts,
    currentOrganizationId && employees && employees.length > 0
      ? {
          organizationId: currentOrganizationId,
          employeeIds: employees.map((emp: any) => emp._id),
        }
      : "skip"
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [isMessageDialogOpen, setIsMessageDialogOpen] = useState(false);
  const [messageEmployeeId, setMessageEmployeeId] = useState<string | null>(
    null
  );
  const [messageContent, setMessageContent] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    firstName: string;
    lastName: string;
    middleName: string;
    email: string;
    phone: string;
    position: string;
    department: string;
    employmentType: EmploymentType;
    hireDate: string;
    basicSalary: string;
    allowance: string;
    salaryType: SalaryType;
  }>({
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
    salaryType: "monthly",
  });
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [scheduleType, setScheduleType] = useState<"one-time" | "regular">(
    "one-time"
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
  const [page, setPage] = useState(1);

  const filteredEmployees = employees;
  const totalEmployees = filteredEmployees?.length || 0;
  const pageSize = 10;

  // Owner has all admin privileges - treat owner the same as admin
  const isAdmin =
    user?.role === "admin" || user?.role === "hr" || user?.role === "owner";

  useEffect(() => {
    // Reset to first page when filters or search change
    setPage(1);
  }, [search, statusFilter, departmentFilter]);

  const handleMessage = (employeeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMessageEmployeeId(employeeId);
    setIsMessageDialogOpen(true);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageContent.trim() || !messageEmployeeId || !currentOrganizationId)
      return;

    setSendingMessage(true);
    try {
      await sendMessageToEmployee({
        organizationId: currentOrganizationId,
        employeeId: messageEmployeeId,
        content: messageContent.trim(),
      });
      setMessageContent("");
      setIsMessageDialogOpen(false);
      setMessageEmployeeId(null);
      alert("Message sent successfully!");
    } catch (error: any) {
      console.error("Error sending message:", error);
      alert(error.message || "Failed to send message. Please try again.");
    } finally {
      setSendingMessage(false);
    }
  };

  const handleRemoveFromOrganization = async (
    employee: any,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (!currentOrganizationId || !isAdmin) return;

    if (
      !confirm(
        `Remove ${employee.personalInfo.firstName} ${employee.personalInfo.lastName} from this organization? They will no longer have access but their employee record will remain.`
      )
    )
      return;

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
        toast({
          title: "Removed from organization",
          description: `${employee.personalInfo.firstName} ${employee.personalInfo.lastName} has been removed from this organization.`,
        });
        router.refresh();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove from organization",
        variant: "destructive",
      });
    }
  };

  const handleDeleteEmployee = async (employee: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentOrganizationId || !isAdmin) return;

    if (
      !confirm(
        `Are you sure you want to permanently delete ${employee.personalInfo.firstName} ${employee.personalInfo.lastName}? This action cannot be undone and will remove all employee records.`
      )
    )
      return;

    try {
      // First, try to remove user from organization if they have an account
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
        }
      } catch (error) {
        // User might not have an account, continue with deletion
      }

      await deleteEmployee(employee._id);
      toast({
        title: "Employee deleted",
        description: "The employee has been permanently removed.",
      });
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employee",
        variant: "destructive",
      });
    }
  };

  const handleUpdateRole = async (
    employee: any,
    newRole: "admin" | "hr" | "employee",
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (!currentOrganizationId || !isAdmin) return;

    setUpdatingRole(employee._id);
    try {
      // Get user linked to this employee
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
      setUpdatingRole(null);
    }
  };

  const handleUpdateStatus = async (
    employee: any,
    newStatus: "active" | "inactive" | "resigned" | "terminated",
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (!currentOrganizationId) return;

    setUpdatingStatus(employee._id);
    try {
      await updateEmployee(employee._id, {
        employment: {
          ...employee.employment,
          status: newStatus,
        },
      });
      alert(`Employee status updated to ${newStatus} successfully`);
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to update status");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleInvite = async (employee: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentOrganizationId || !isAdmin) return;

    if (!employee.personalInfo?.email) {
      toast({
        title: "Error",
        description: "Employee email is required to create a user account",
        variant: "destructive",
      });
      return;
    }

    setSendingInvite(employee._id);
    try {
      await createUserForEmployee({
        organizationId: currentOrganizationId,
        employeeId: employee._id,
        role: "employee",
      });
      toast({
        title: "Success",
        description: `User account created and invitation sent to ${employee.personalInfo.email}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to create user account. The employee may already have a user account.",
        variant: "destructive",
      });
    } finally {
      setSendingInvite(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || isCreatingEmployee) return;

    setIsCreatingEmployee(true);
    try {
      await createEmployee({
        organizationId: currentOrganizationId,
        personalInfo: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          middleName: formData.middleName || undefined,
          email: formData.email,
          phone: formData.phone || undefined,
        },
        employment: {
          employeeId: "", // Auto-generated on backend from document id
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
                  // Convert one-time schedule to all days
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
                } else {
                  // Regular schedule - use scheduleForm
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
                }
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
      setIsDialogOpen(false);
      setFormData({
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
        salaryType: "monthly",
      });
      setEnableSchedule(false);
      setScheduleType("one-time");
      setOneTimeSchedule({
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
      setScheduleForm({
        monday: { start: "09:00", end: "18:00", workday: true },
        tuesday: { start: "09:00", end: "18:00", workday: true },
        wednesday: { start: "09:00", end: "18:00", workday: true },
        thursday: { start: "09:00", end: "18:00", workday: true },
        friday: { start: "09:00", end: "18:00", workday: true },
        saturday: { start: "09:00", end: "18:00", workday: false },
        sunday: { start: "09:00", end: "18:00", workday: false },
      });
      setIsDialogOpen(false);
      // Refresh the router to show new employee without full page reload
      router.refresh();
    } catch (error) {
      console.error("Error creating employee:", error);
      alert("Failed to create employee. Please try again.");
    } finally {
      setIsCreatingEmployee(false);
    }
  };

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Employees
            </h1>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Employee
              </Button>
            </DialogTrigger>
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
                        <Label htmlFor="firstName">First Name *</Label>
                        <Input
                          id="firstName"
                          value={formData.firstName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              firstName: e.target.value,
                            })
                          }
                          disabled={isCreatingEmployee}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name *</Label>
                        <Input
                          id="lastName"
                          value={formData.lastName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              lastName: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="middleName">Middle Name</Label>
                      <Input
                        id="middleName"
                        value={formData.middleName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            middleName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) =>
                            setFormData({ ...formData, email: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
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
                        <Label htmlFor="position">Position *</Label>
                        <Input
                          id="position"
                          value={formData.position}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              position: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="department">Department *</Label>
                        <DepartmentSelect
                          departments={departments}
                          value={formData.department}
                          onValueChange={(value) =>
                            setFormData({
                              ...formData,
                              department: value,
                            })
                          }
                          disabled={isCreatingEmployee}
                          onEditDepartments={() => setIsDialogOpen(false)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employmentType">
                          Employment Type *
                        </Label>
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
                        <Label htmlFor="hireDate">Hire Date *</Label>
                        <DatePicker
                          value={formData.hireDate}
                          onValueChange={(value) =>
                            setFormData({
                              ...formData,
                              hireDate: value,
                            })
                          }
                          placeholder="Select hire date"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="basicSalary">Basic Salary *</Label>
                        <Input
                          id="basicSalary"
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
                        <Label htmlFor="allowance">Non-Taxable Allowance</Label>
                        <Input
                          id="allowance"
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
                          Optional: Non-taxable allowance (e.g., transportation,
                          meal allowance)
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="salaryType">Salary Type *</Label>
                        <SalaryTypeSelect
                          value={formData.salaryType}
                          onValueChange={(value) =>
                            setFormData({
                              ...formData,
                              salaryType: value,
                            })
                          }
                        />
                      </div>
                    </div>

                    {/* Schedule Section - Optional */}
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="enableSchedule"
                          checked={enableSchedule}
                          onCheckedChange={(checked) =>
                            setEnableSchedule(checked as boolean)
                          }
                        />
                        <Label
                          htmlFor="enableSchedule"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Set Work Schedule (Optional)
                        </Label>
                      </div>

                      {enableSchedule && (
                        <div className="space-y-4 pl-6 border-l-2 border-gray-200">
                          <div className="space-y-2">
                            <Label htmlFor="scheduleType">Schedule Type</Label>
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
                                <div className="space-y-2">
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
                                </div>
                                <div className="space-y-2">
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
                                        id={`workday-${day.key}`}
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
                                        htmlFor={`workday-${day.key}`}
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
                                      id={`workday-regular-${day.key}`}
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
                                      htmlFor={`workday-regular-${day.key}`}
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
                </fieldset>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
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
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="shrink-0 p-4 sm:p-5 md:p-6">
            <EmployeesFilters
              search={search}
              setSearch={setSearch}
              departmentFilter={departmentFilter}
              setDepartmentFilter={setDepartmentFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              settingsForDepartments={settings}
            />
          </CardHeader>
          <CardContent className="relative p-3 sm:p-4 pt-0">
            {isCreatingEmployee && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                  <p className="text-sm text-gray-600">Creating employee...</p>
                </div>
              </div>
            )}
            <EmployeesTable
              employees={filteredEmployees}
              isCreatingEmployee={isCreatingEmployee}
              isAdmin={isAdmin}
              updatingStatus={updatingStatus}
              updatingRole={updatingRole}
              onRowClick={(employeeId: string) => {
                setSelectedEmployeeId(employeeId);
                setPanelMode("view");
                setIsPanelOpen(true);
              }}
              onEdit={(employeeId: string) => {
                setSelectedEmployeeId(employeeId);
                setPanelMode("edit");
                setIsPanelOpen(true);
              }}
              onMessage={handleMessage}
              onUpdateStatus={handleUpdateStatus}
              onUpdateRole={handleUpdateRole}
              onRemoveFromOrganization={handleRemoveFromOrganization}
              onDeleteEmployee={handleDeleteEmployee}
              onInvite={handleInvite}
              sendingInvite={sendingInvite}
              page={page}
              pageSize={pageSize}
              totalEmployees={totalEmployees}
              onPageChange={setPage}
              employeesUserAccounts={employeesUserAccounts ?? {}}
            />
          </CardContent>
        </Card>
      </div>

      {/* Quick Message Dialog */}
      <Dialog open={isMessageDialogOpen} onOpenChange={setIsMessageDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl">
              Send Message
            </DialogTitle>
            <DialogDescription className="text-sm">
              Send a quick message to this employee
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSendMessage}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  placeholder="Type your message here..."
                  rows={5}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsMessageDialogOpen(false);
                  setMessageContent("");
                  setMessageEmployeeId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!messageContent.trim() || sendingMessage}
              >
                {sendingMessage ? "Sending..." : "Send Message"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isPanelOpen && (
        <EmployeeDetailPanel
          employeeId={selectedEmployeeId}
          open={isPanelOpen}
          onOpenChange={setIsPanelOpen}
          mode={panelMode}
          onModeChange={setPanelMode}
          onMessageClick={(employeeId) => {
            setIsPanelOpen(false);
            router.push(
              getOrganizationPath(
                currentOrganizationId,
                `/chat?employeeId=${employeeId}`
              )
            );
          }}
          employeeData={
            selectedEmployeeId
              ? filteredEmployees?.find(
                  (emp: any) => emp._id === selectedEmployeeId
                )
              : undefined
          }
        />
      )}
    </MainLayout>
  );
}
