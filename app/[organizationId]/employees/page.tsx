"use client";

import { useMemo, useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Plus, Loader2, Columns2, FileSpreadsheet } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  employeeFormSchema,
  type EmployeeFormValues,
} from "./_components/employee-form-validation";
import { cn } from "@/utils/utils";
const EmployeesTable = dynamic(
  () => import("./_components/employees-table").then((m) => m.EmployeesTable),
  {
    loading: () => (
      <div className="p-4 text-center text-gray-500">Loading employees...</div>
    ),
    ssr: false,
  },
);

const EmployeeDetailPanel = dynamic(
  () =>
    import("./_components/employee-detail-modal").then(
      (m) => m.EmployeeDetailModal,
    ),
  {
    loading: () => null, // Don't show loading skeleton - panel will handle its own loading state
    ssr: false,
  },
);

const BulkAddEmployeesDialog = dynamic(
  () =>
    import("./_components/bulk-add-employees-dialog").then(
      (m) => m.BulkAddEmployeesDialog,
    ),
  { ssr: false },
);

type EmployeeColumnId =
  | "name"
  | "email"
  | "position"
  | "department"
  | "status"
  | "phone"
  | "createdAt";

type CreatedDateFilter = {
  mode: "inLast";
  value: number;
  unit: "days" | "weeks" | "months";
};

export default function EmployeesPage() {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const router = useRouter();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"view" | "edit">("view");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "resigned" | "terminated"
  >("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [createdDateFilter, setCreatedDateFilter] =
    useState<CreatedDateFilter | null>(null);

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
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
        }
      : "skip",
  );

  // Check which employees have user accounts
  const employeesUserAccounts: Record<string, boolean> | undefined = useQuery(
    (api as any).employees.checkEmployeesUserAccounts,
    currentOrganizationId && employees && employees.length > 0
      ? {
          organizationId: currentOrganizationId,
          employeeIds: employees.map((emp: any) => emp._id),
        }
      : "skip",
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBulkAddOpen, setIsBulkAddOpen] = useState(false);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [isMessageDialogOpen, setIsMessageDialogOpen] = useState(false);
  const [messageEmployeeId, setMessageEmployeeId] = useState<string | null>(
    null,
  );
  const [messageContent, setMessageContent] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);
  const defaultAddFormValues: EmployeeFormValues = {
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
  const addEmployeeForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaultAddFormValues,
  });
  const {
    register: registerAdd,
    handleSubmit: handleAddSubmit,
    formState: { errors: addFormErrors },
    control: addFormControl,
    reset: resetAddForm,
  } = addEmployeeForm;
  const [enableSchedule, setEnableSchedule] = useState(false);
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
  const [page, setPage] = useState(1);
  const [visibleColumns, setVisibleColumns] = useState<EmployeeColumnId[]>([
    "name",
    "email",
    "position",
    "department",
    "status",
  ]);

  const filteredEmployees = useMemo(() => {
    let list = employees || [];

    if (nameFilter.trim()) {
      const term = nameFilter.toLowerCase();
      list = list.filter((e: any) => {
        const first = e.personalInfo.firstName?.toLowerCase() || "";
        const last = e.personalInfo.lastName?.toLowerCase() || "";
        return (
          first.includes(term) ||
          last.includes(term) ||
          `${first} ${last}`.includes(term)
        );
      });
    }

    if (positionFilter.trim()) {
      const term = positionFilter.toLowerCase();
      list = list.filter((e: any) =>
        e.employment.position.toLowerCase().includes(term),
      );
    }

    if (phoneFilter.trim()) {
      const term = phoneFilter.toLowerCase();
      list = list.filter((e: any) =>
        (e.personalInfo.phone || "").toLowerCase().includes(term),
      );
    }

    if (createdDateFilter) {
      const now = Date.now();
      const unitDays =
        createdDateFilter.unit === "days"
          ? 1
          : createdDateFilter.unit === "weeks"
            ? 7
            : 30;
      const threshold =
        now - createdDateFilter.value * unitDays * 24 * 60 * 60 * 1000;
      list = list.filter((e: any) => (e.createdAt || 0) >= threshold);
    }

    return list;
  }, [employees, nameFilter, positionFilter, phoneFilter, createdDateFilter]);
  const totalEmployees = filteredEmployees?.length || 0;
  const pageSize = 10;

  // Owner has all admin privileges - treat owner the same as admin
  const isAdmin =
    user?.role === "admin" || user?.role === "hr" || user?.role === "owner";

  useEffect(() => {
    // Reset to first page when filters or search change
    setPage(1);
  }, [
    statusFilter,
    departmentFilter,
    nameFilter,
    positionFilter,
    phoneFilter,
    createdDateFilter,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?._id || !currentOrganizationId) {
      return;
    }
    const key = `employeesTableColumns:${user._id}:${currentOrganizationId}`;
    const stored = window.localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as EmployeeColumnId[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVisibleColumns(parsed);
        }
      } catch {
        // ignore
      }
    }
  }, [user?._id, currentOrganizationId]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?._id || !currentOrganizationId) {
      return;
    }
    const key = `employeesTableColumns:${user._id}:${currentOrganizationId}`;
    window.localStorage.setItem(key, JSON.stringify(visibleColumns));
  }, [visibleColumns, user?._id, currentOrganizationId]);

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
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!currentOrganizationId || !isAdmin) return;

    if (
      !confirm(
        `Remove ${employee.personalInfo.firstName} ${employee.personalInfo.lastName} from this organization? They will no longer have access but their employee record will remain.`,
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
          employeeUser._id,
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
        `Are you sure you want to permanently delete ${employee.personalInfo.firstName} ${employee.personalInfo.lastName}? This action cannot be undone and will remove all employee records.`,
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
            employeeUser._id,
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
    e: React.MouseEvent,
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
          "No user account found for this employee. Please invite them first.",
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
    e: React.MouseEvent,
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

  const onValidAddSubmit = async (data: EmployeeFormValues) => {
    if (!currentOrganizationId || isCreatingEmployee) return;

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

      await createEmployee({
        organizationId: currentOrganizationId,
        personalInfo: {
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName || undefined,
          email: data.email,
          phone: data.phone || undefined,
        },
        employment: {
          employeeId: "", // Auto-generated on backend from document id
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
      resetAddForm(defaultAddFormValues);
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setIsBulkAddOpen(true)}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Add from CSV
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Employee
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-[95vw] sm:max-w-2xl overflow-hidden">
              <div className="dialog-thin-scrollbar max-h-[90vh] overflow-y-auto overscroll-contain">
                <DialogHeader>
                  <DialogTitle className="text-lg sm:text-xl">
                    Add New Employee
                  </DialogTitle>
                  <DialogDescription className="text-sm">
                    Fill in the employee information below.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddSubmit(onValidAddSubmit)}>
                  <fieldset disabled={isCreatingEmployee} className="space-y-4">
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName" required>
                            First Name
                          </Label>
                          <Input
                            id="firstName"
                            {...registerAdd("firstName")}
                            disabled={isCreatingEmployee}
                            className={cn(addFormErrors.firstName && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.firstName?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.firstName.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="middleName">Middle Name</Label>
                          <Input
                            id="middleName"
                            {...registerAdd("middleName")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName" required>
                            Last Name
                          </Label>
                          <Input
                            id="lastName"
                            {...registerAdd("lastName")}
                            className={cn(addFormErrors.lastName && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.lastName?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.lastName.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="email" required>
                            Email
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            {...registerAdd("email")}
                            className={cn(addFormErrors.email && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.email?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.email.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="phone">Phone</Label>
                          <Input
                            id="phone"
                            type="tel"
                            {...registerAdd("phone")}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="position" required>
                            Position
                          </Label>
                          <Input
                            id="position"
                            {...registerAdd("position")}
                            className={cn(addFormErrors.position && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.position?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.position.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="department" required>
                            Department
                          </Label>
                          <Controller
                            name="department"
                            control={addFormControl}
                            render={({ field }) => (
                              <DepartmentSelect
                                departments={departments}
                                value={field.value}
                                onValueChange={field.onChange}
                                disabled={isCreatingEmployee}
                                onEditDepartments={() => setIsDialogOpen(false)}
                              />
                            )}
                          />
                          {addFormErrors.department?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.department.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="employmentType" required>
                            Employment Type
                          </Label>
                          <Controller
                            name="employmentType"
                            control={addFormControl}
                            render={({ field }) => (
                              <EmploymentTypeSelect
                                value={field.value as EmploymentType}
                                onValueChange={field.onChange}
                              />
                            )}
                          />
                          {addFormErrors.employmentType?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.employmentType.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="hireDate" required>
                            Hire Date
                          </Label>
                          <Controller
                            name="hireDate"
                            control={addFormControl}
                            render={({ field }) => (
                              <DatePicker
                                value={field.value}
                                onValueChange={field.onChange}
                                placeholder="Select hire date"
                              />
                            )}
                          />
                          {addFormErrors.hireDate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.hireDate.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="basicSalary" required>
                            Basic Salary
                          </Label>
                          <Input
                            id="basicSalary"
                            type="number"
                            step="0.01"
                            {...registerAdd("basicSalary")}
                            className={cn(addFormErrors.basicSalary && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.basicSalary?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.basicSalary.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="allowance">
                            Non-Taxable Allowance
                          </Label>
                          <Input
                            id="allowance"
                            type="number"
                            step="0.01"
                            {...registerAdd("allowance")}
                            placeholder="0.00"
                            className={cn(addFormErrors.allowance && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.allowance?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.allowance.message}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">
                            Optional: Non-taxable allowance (e.g.,
                            transportation, meal allowance)
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="regularHolidayRate">
                            Regular Holiday Rate (%)
                          </Label>
                          <Input
                            id="regularHolidayRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings?.regularHolidayRate ??
                                1.0) * 100
                            ).toString()}
                            {...registerAdd("regularHolidayRate")}
                            className={cn(addFormErrors.regularHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.regularHolidayRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.regularHolidayRate.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="specialHolidayRate">
                            Special Holiday Rate (%)
                          </Label>
                          <Input
                            id="specialHolidayRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings?.specialHolidayRate ??
                                0.3) * 100
                            ).toString()}
                            {...registerAdd("specialHolidayRate")}
                            className={cn(addFormErrors.specialHolidayRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.specialHolidayRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.specialHolidayRate.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="nightDiffPercent">
                            Night Differential (%)
                          </Label>
                          <Input
                            id="nightDiffPercent"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings?.nightDiffPercent ??
                                0.1) * 100
                            ).toString()}
                            {...registerAdd("nightDiffPercent")}
                            className={cn(addFormErrors.nightDiffPercent && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.nightDiffPercent?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.nightDiffPercent.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="overtimeRegularRate">
                            Overtime Regular Rate (%)
                          </Label>
                          <Input
                            id="overtimeRegularRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings?.overtimeRegularRate ??
                                1.25) * 100
                            ).toString()}
                            {...registerAdd("overtimeRegularRate")}
                            className={cn(addFormErrors.overtimeRegularRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.overtimeRegularRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.overtimeRegularRate.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="overtimeRestDayRate">
                            Overtime Rest Day Rate (%)
                          </Label>
                          <Input
                            id="overtimeRestDayRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings?.overtimeRestDayRate ??
                                1.69) * 100
                            ).toString()}
                            {...registerAdd("overtimeRestDayRate")}
                            className={cn(addFormErrors.overtimeRestDayRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.overtimeRestDayRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.overtimeRestDayRate.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="regularHolidayOtRate">
                            Regular Holiday OT Rate (%)
                          </Label>
                          <Input
                            id="regularHolidayOtRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings
                                ?.regularHolidayOtRate ?? 2.0) * 100
                            ).toString()}
                            {...registerAdd("regularHolidayOtRate")}
                            className={cn(addFormErrors.regularHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.regularHolidayOtRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.regularHolidayOtRate.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="specialHolidayOtRate">
                            Special Holiday OT Rate (%)
                          </Label>
                          <Input
                            id="specialHolidayOtRate"
                            type="number"
                            step="0.01"
                            placeholder={(
                              (settings?.payrollSettings
                                ?.specialHolidayOtRate ?? 1.69) * 100
                            ).toString()}
                            {...registerAdd("specialHolidayOtRate")}
                            className={cn(addFormErrors.specialHolidayOtRate && "border-red-500 focus-visible:ring-red-500")}
                          />
                          {addFormErrors.specialHolidayOtRate?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.specialHolidayOtRate.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="salaryType" required>
                            Salary Type
                          </Label>
                          <Controller
                            name="salaryType"
                            control={addFormControl}
                            render={({ field }) => (
                              <SalaryTypeSelect
                                value={field.value as SalaryType}
                                onValueChange={field.onChange}
                              />
                            )}
                          />
                          {addFormErrors.salaryType?.message && (
                            <p className="text-xs text-red-600">
                              {addFormErrors.salaryType.message}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Schedule Section - Optional */}
                      <div className="space-y-4 pt-4 border-t border-[#DDDDDD]">
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
                          <div className="space-y-4 pl-6 border-l border-[#DDDDDD]">
                            <div className="space-y-2">
                              <Label htmlFor="scheduleType">
                                Schedule Type
                              </Label>
                              <Select
                                value={scheduleType}
                                onValueChange={(
                                  value: "one-time" | "regular",
                                ) => setScheduleType(value)}
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
              </div>
            </DialogContent>
          </Dialog>
            <BulkAddEmployeesDialog
              open={isBulkAddOpen}
              onOpenChange={setIsBulkAddOpen}
              organizationId={currentOrganizationId}
              onSuccess={() => router.refresh()}
            />
          </div>
        </div>

        <Card>
          <CardHeader className="shrink-0 p-4 sm:p-4 md:p-5 pb-1.5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <EmployeesFilters
                departmentFilter={departmentFilter}
                setDepartmentFilter={setDepartmentFilter}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                settingsForDepartments={settings}
                nameFilter={nameFilter}
                setNameFilter={setNameFilter}
                positionFilter={positionFilter}
                setPositionFilter={setPositionFilter}
                phoneFilter={phoneFilter}
                setPhoneFilter={setPhoneFilter}
                createdDateFilter={createdDateFilter}
                setCreatedDateFilter={setCreatedDateFilter}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-3 self-start"
                  >
                    <Columns2 className="h-3.5 w-3.5 mr-1.5" />
                    Edit columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="end" sideOffset={8}>
                  <h4 className="text-xs font-semibold text-[rgb(64,64,64)] mb-2">
                    Columns
                  </h4>
                  <div className="space-y-1.5">
                    {(
                      [
                        { id: "name", label: "Name" },
                        { id: "email", label: "Email" },
                        { id: "position", label: "Position" },
                        { id: "department", label: "Department" },
                        { id: "phone", label: "Phone" },
                        { id: "createdAt", label: "Created date" },
                        { id: "status", label: "Status" },
                      ] as { id: EmployeeColumnId; label: string }[]
                    ).map((col) => (
                      <label
                        key={col.id}
                        className="flex items-center gap-2 text-xs text-[rgb(64,64,64)] cursor-pointer"
                      >
                        <Checkbox
                          checked={visibleColumns.includes(col.id)}
                          onCheckedChange={(checked) => {
                            setVisibleColumns((prev) => {
                              const isChecked = checked === true;
                              if (isChecked) {
                                if (prev.includes(col.id)) return prev;
                                return [...prev, col.id];
                              }
                              const next = prev.filter((c) => c !== col.id);
                              return next.length === 0 ? prev : next;
                            });
                          }}
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeader>
          <CardContent className="relative p-3 sm:p-4 pt-0 sm:pt-0">
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
              visibleColumns={visibleColumns}
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
                `/chat?employeeId=${employeeId}`,
              ),
            );
          }}
          employeeData={
            selectedEmployeeId
              ? filteredEmployees?.find(
                  (emp: any) => emp._id === selectedEmployeeId,
                )
              : undefined
          }
        />
      )}
    </MainLayout>
  );
}
