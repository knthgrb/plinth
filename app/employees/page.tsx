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
} from "@/app/actions/employees";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import {
  removeUserFromOrganization,
  updateUserRoleInOrganization,
} from "@/app/actions/organizations";
import { sendMessageToEmployee } from "@/app/actions/chat";
import { createInvitation } from "@/app/actions/invitations";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import dynamic from "next/dynamic";
import { EmployeesFilters } from "./_components/employees-filters";
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
    import("./_components/employee-detail-panel").then(
      (m) => m.EmployeeDetailPanel
    ),
  {
    loading: () => (
      <div className="fixed inset-y-0 right-0 w-full sm:w-[600px] border-l bg-white shadow-lg animate-in slide-in-from-right">
        <div className="h-full overflow-y-auto p-6">
          <div className="space-y-6">
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
            <div className="h-px bg-gray-200" />
            <div className="space-y-4">
              <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
              <div className="space-y-3">
                <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "resigned" | "terminated"
  >("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [departmentDropdownOpen, setDepartmentDropdownOpen] =
    useState<boolean>(false);

  const settingsForDepartments = useQuery(
    (api as any).settings.getSettings,
    departmentDropdownOpen && currentOrganizationId
      ? { organizationId: currentOrganizationId }
      : "skip"
  );

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
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phone: "",
    employeeId: "",
    position: "",
    department: "",
    employmentType: "probationary" as const,
    hireDate: "",
    basicSalary: "",
    allowance: "",
    salaryType: "monthly" as const,
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

  const isAdmin = user?.role === "admin" || user?.role === "hr";

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

  const handleRemove = async (employee: any, e: React.MouseEvent) => {
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
        console.log("No user account found, proceeding with employee deletion");
      }

      // Delete the employee record
      await deleteEmployee(employee._id);
      alert("Employee deleted successfully");
      window.location.reload();
    } catch (error: any) {
      alert(error.message || "Failed to delete employee");
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
        description: "Employee email is required to send an invitation",
        variant: "destructive",
      });
      return;
    }

    setSendingInvite(employee._id);
    try {
      await createInvitation({
        organizationId: currentOrganizationId,
        email: employee.personalInfo.email,
        role: "employee",
        employeeId: employee._id,
      });
      toast({
        title: "Success",
        description: `Invitation sent to ${employee.personalInfo.email}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to send invitation. The employee may already be invited or a member.",
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
          employeeId: formData.employeeId,
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
        schedule: {
          defaultSchedule: {
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
        employeeId: "",
        position: "",
        department: "",
        employmentType: "probationary",
        hireDate: "",
        basicSalary: "",
        allowance: "",
        salaryType: "monthly",
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
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Employees</h1>
            <p className="text-gray-600 mt-2">
              Manage your organization's employees
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Employee</DialogTitle>
                <DialogDescription>
                  Fill in the employee information below.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <fieldset disabled={isCreatingEmployee} className="space-y-4">
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="space-y-2">
                      <Label htmlFor="employeeId">Employee ID *</Label>
                      <Input
                        id="employeeId"
                        value={formData.employeeId}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            employeeId: e.target.value,
                          })
                        }
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
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
                        <Input
                          id="department"
                          value={formData.department}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              department: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employmentType">
                          Employment Type *
                        </Label>
                        <select
                          id="employmentType"
                          className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                          value={formData.employmentType}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              employmentType: e.target.value as any,
                            })
                          }
                          required
                        >
                          <option value="probationary">Probationary</option>
                          <option value="regular">Regular</option>
                          <option value="contractual">Contractual</option>
                          <option value="part-time">Part-time</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="hireDate">Hire Date *</Label>
                        <Input
                          id="hireDate"
                          type="date"
                          value={formData.hireDate}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              hireDate: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="salaryType">Salary Type *</Label>
                        <select
                          id="salaryType"
                          className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
                          value={formData.salaryType}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              salaryType: e.target.value as any,
                            })
                          }
                          required
                        >
                          <option value="monthly">Monthly</option>
                          <option value="daily">Daily</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </div>
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
          <CardHeader>
            <EmployeesFilters
              search={search}
              setSearch={setSearch}
              departmentFilter={departmentFilter}
              setDepartmentFilter={setDepartmentFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              settingsForDepartments={settingsForDepartments}
              setDepartmentDropdownOpen={setDepartmentDropdownOpen}
            />
          </CardHeader>
          <CardContent className="relative">
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
                setIsPanelOpen(true);
              }}
              onMessage={handleMessage}
              onUpdateStatus={handleUpdateStatus}
              onUpdateRole={handleUpdateRole}
              onRemove={handleRemove}
              onInvite={handleInvite}
              sendingInvite={sendingInvite}
              page={page}
              pageSize={pageSize}
              totalEmployees={totalEmployees}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      </div>

      {/* Quick Message Dialog */}
      <Dialog open={isMessageDialogOpen} onOpenChange={setIsMessageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Message</DialogTitle>
            <DialogDescription>
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

      <EmployeeDetailPanel
        employeeId={selectedEmployeeId}
        open={isPanelOpen}
        onOpenChange={setIsPanelOpen}
        onMessageClick={(employeeId) => {
          setIsPanelOpen(false);
          router.push(`/chat?employeeId=${employeeId}`);
        }}
      />
    </MainLayout>
  );
}
