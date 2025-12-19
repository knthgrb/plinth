"use client";

import { useState, useEffect, Suspense } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Calendar, Edit, TrendingUp } from "lucide-react";
import { getEmployeeLeaveCredits } from "@/app/actions/leave";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { DynamicLeaveTable } from "./_components/dynamic-leave-table";
import { LeaveColumnManagementModal } from "./_components/leave-column-management-modal";

// Lazy load modals and tabs
const RequestLeaveDialog = dynamic(
  () =>
    import("./_components/request-leave-dialog").then(
      (mod) => mod.RequestLeaveDialog
    ),
  { ssr: false }
);

const ReviewLeaveDialog = dynamic(
  () =>
    import("./_components/review-leave-dialog").then(
      (mod) => mod.ReviewLeaveDialog
    ),
  { ssr: false }
);

const AdjustCreditsDialog = dynamic(
  () =>
    import("./_components/adjust-credits-dialog").then(
      (mod) => mod.AdjustCreditsDialog
    ),
  { ssr: false }
);

const CashConversionDialog = dynamic(
  () =>
    import("./_components/cash-conversion-dialog").then(
      (mod) => mod.CashConversionDialog
    ),
  { ssr: false }
);

const EmployeeLeaveHistoryTab = dynamic(
  () =>
    import("./_components/employee-leave-history-tab").then(
      (mod) => mod.EmployeeLeaveHistoryTab
    ),
  { ssr: false }
);

const AdminLeaveRequestsTab = dynamic(
  () =>
    import("./_components/admin-leave-requests-tab").then(
      (mod) => mod.AdminLeaveRequestsTab
    ),
  { ssr: false }
);

const AdminLeaveHistoryTab = dynamic(
  () =>
    import("./_components/admin-leave-history-tab").then(
      (mod) => mod.AdminLeaveHistoryTab
    ),
  { ssr: false }
);

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
  isDefault?: boolean;
  hidden?: boolean;
}

export default function LeavePage() {
  const { currentOrganizationId, currentOrganization } = useOrganization();
  const { toast } = useToast();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const leaveRequests = useQuery(
    (api as any).leave.getLeaveRequests,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const isEmployee = user?.role === "employee";
  const isAdminOrHr = user?.role === "admin" || user?.role === "hr";
  const userEmployeeId = user?.employeeId || currentOrganization?.employeeId;
  // HR always has employeeId, Admin may or may not have one
  const canRequestLeave = isEmployee || (isAdminOrHr && userEmployeeId);

  // Column management states
  const [isRequestsColumnModalOpen, setIsRequestsColumnModalOpen] =
    useState(false);
  const [isHistoryColumnModalOpen, setIsHistoryColumnModalOpen] =
    useState(false);
  const [requestsTableColumns, setRequestsTableColumns] = useState<Column[]>(
    []
  );
  const [historyTableColumns, setHistoryTableColumns] = useState<Column[]>([]);

  // Employee view states
  const [employeeLeaveCredits, setEmployeeLeaveCredits] = useState<any>(null);
  const [employeeLeaveHistory, setEmployeeLeaveHistory] = useState<any[]>([]);

  // Admin/HR view states
  const [selectedEmployeeForCredits, setSelectedEmployeeForCredits] =
    useState<string>("");
  const [selectedEmployeeCredits, setSelectedEmployeeCredits] =
    useState<any>(null);
  const [isAdjustCreditsOpen, setIsAdjustCreditsOpen] = useState(false);

  // Leave request dialog states
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Review dialog states
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<any>(null);

  // Cash conversion dialog states
  const [isCashConversionOpen, setIsCashConversionOpen] = useState(false);

  // Initialize columns from settings
  useEffect(() => {
    const DEFAULT_REQUESTS: Column[] = [
      {
        id: "employee",
        label: "Employee",
        field: "employee",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "leaveType",
        label: "Leave Type",
        field: "leaveType",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "startDate",
        label: "Start Date",
        field: "startDate",
        type: "date",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "endDate",
        label: "End Date",
        field: "endDate",
        type: "date",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "days",
        label: "Days",
        field: "numberOfDays",
        type: "number",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "status",
        label: "Status",
        field: "status",
        type: "badge",
        sortable: true,
        width: "120px",
        isDefault: true,
        hidden: false,
      },
    ];

    const DEFAULT_HISTORY: Column[] = [
      {
        id: "employee",
        label: "Employee",
        field: "employee",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "leaveType",
        label: "Leave Type",
        field: "leaveType",
        type: "text",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "startDate",
        label: "Start Date",
        field: "startDate",
        type: "date",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "endDate",
        label: "End Date",
        field: "endDate",
        type: "date",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "days",
        label: "Days",
        field: "numberOfDays",
        type: "number",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
      {
        id: "status",
        label: "Status",
        field: "status",
        type: "badge",
        sortable: true,
        width: "120px",
        isDefault: true,
        hidden: false,
      },
      {
        id: "reason",
        label: "Reason",
        field: "reason",
        type: "text",
        sortable: false,
        isDefault: true,
        hidden: false,
      },
      {
        id: "filedDate",
        label: "Filed Date",
        field: "filedDate",
        type: "date",
        sortable: true,
        isDefault: true,
        hidden: false,
      },
    ];

    if (settings?.leaveTableColumns) {
      // Merge saved columns with defaults - ensure all defaults are present
      const savedColumns = settings.leaveTableColumns.filter(
        (c: Column) => !c.isDefault
      );
      const savedDefaultColumns = settings.leaveTableColumns.filter(
        (c: Column) => c.isDefault
      );

      // Merge defaults with saved defaults (preserve hidden state)
      const mergedRequestsDefaults = DEFAULT_REQUESTS.map((def) => {
        const saved = savedDefaultColumns.find((c: Column) => c.id === def.id);
        return saved ? { ...def, ...saved } : def;
      });

      const mergedHistoryDefaults = DEFAULT_HISTORY.map((def) => {
        const saved = savedDefaultColumns.find((c: Column) => c.id === def.id);
        return saved ? { ...def, ...saved } : def;
      });

      setRequestsTableColumns([...mergedRequestsDefaults, ...savedColumns]);
      setHistoryTableColumns([...mergedHistoryDefaults, ...savedColumns]);
    } else {
      setRequestsTableColumns(DEFAULT_REQUESTS);
      setHistoryTableColumns(DEFAULT_HISTORY);
    }
  }, [settings]);

  // Load employee leave credits and history (for employees and HR/Admin who are employees)
  useEffect(() => {
    if (canRequestLeave && userEmployeeId && currentOrganizationId) {
      loadEmployeeData();
    }
  }, [canRequestLeave, userEmployeeId, currentOrganizationId, leaveRequests]);

  const loadEmployeeData = async () => {
    if (!currentOrganizationId || !userEmployeeId) return;
    try {
      const credits = await getEmployeeLeaveCredits(
        currentOrganizationId,
        userEmployeeId
      );
      setEmployeeLeaveCredits(credits);

      // Filter leave history for this employee
      const history = leaveRequests?.filter(
        (req: any) => req.employeeId === userEmployeeId
      );
      setEmployeeLeaveHistory(history || []);
    } catch (error) {
      console.error("Error loading employee data:", error);
    }
  };

  // Load selected employee credits for admin/hr
  useEffect(() => {
    if (isAdminOrHr && selectedEmployeeForCredits && currentOrganizationId) {
      loadEmployeeCredits();
    }
  }, [selectedEmployeeForCredits, currentOrganizationId, isAdminOrHr]);

  const loadEmployeeCredits = async () => {
    if (!currentOrganizationId || !selectedEmployeeForCredits) return;
    try {
      const credits = await getEmployeeLeaveCredits(
        currentOrganizationId,
        selectedEmployeeForCredits
      );
      setSelectedEmployeeCredits(credits);
    } catch (error) {
      console.error("Error loading employee credits:", error);
      toast({
        title: "Error",
        description: "Failed to load employee leave credits",
        variant: "destructive",
      });
    }
  };

  // Employee View (or HR/Admin who are employees)
  if (canRequestLeave && !isAdminOrHr) {
    return (
      <MainLayout>
        <div className="p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">My Leaves</h1>
              <p className="text-gray-600 mt-2">
                View your leave credits and request time off
              </p>
            </div>
            <Suspense fallback={<Button disabled>Request Leave</Button>}>
              <RequestLeaveDialog
                isOpen={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                organizationId={currentOrganizationId || ""}
                employeeId={userEmployeeId || ""}
                onSuccess={() => {
                  if (canRequestLeave && userEmployeeId) {
                    loadEmployeeData();
                  }
                }}
              />
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Request Leave
              </Button>
            </Suspense>
          </div>

          <Tabs defaultValue="credits" className="space-y-4">
            <TabsList>
              <TabsTrigger value="credits">Leave Credits</TabsTrigger>
              <TabsTrigger value="history">Leave History</TabsTrigger>
            </TabsList>

            <TabsContent value="credits">
              {employeeLeaveCredits && employeeLeaveCredits.calculations && (
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Leave Calculations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Prorated Leave:</span>
                        <span className="font-semibold">
                          {employeeLeaveCredits.calculations.proratedLeave.toFixed(
                            2
                          )}{" "}
                          days
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">
                          Anniversary Leave:
                        </span>
                        <span className="font-semibold">
                          {employeeLeaveCredits.calculations.anniversaryLeave}{" "}
                          days
                        </span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-medium">Total Entitlement:</span>
                        <span className="font-bold text-purple-600">
                          {employeeLeaveCredits.calculations.totalEntitlement.toFixed(
                            2
                          )}{" "}
                          days
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {employeeLeaveCredits && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          Vacation Leave
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">
                              Total:
                            </span>
                            <span className="font-semibold">
                              {employeeLeaveCredits.vacation.total} days
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Used:</span>
                            <span className="font-semibold">
                              {employeeLeaveCredits.vacation.used} days
                            </span>
                          </div>
                          <div className="flex justify-between border-t pt-2">
                            <span className="text-sm font-medium">
                              Balance:
                            </span>
                            <span className="text-lg font-bold text-purple-600">
                              {employeeLeaveCredits.vacation.balance} days
                            </span>
                          </div>
                          {employeeLeaveCredits.convertible && (
                            <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                              <div className="flex justify-between">
                                <span>Convertible to cash:</span>
                                <span className="font-medium text-green-600">
                                  {
                                    employeeLeaveCredits.convertible.vacation
                                      .convertible
                                  }{" "}
                                  days
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          Sick Leave
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">
                              Total:
                            </span>
                            <span className="font-semibold">
                              {employeeLeaveCredits.sick.total} days
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Used:</span>
                            <span className="font-semibold">
                              {employeeLeaveCredits.sick.used} days
                            </span>
                          </div>
                          <div className="flex justify-between border-t pt-2">
                            <span className="text-sm font-medium">
                              Balance:
                            </span>
                            <span className="text-lg font-bold text-purple-600">
                              {employeeLeaveCredits.sick.balance} days
                            </span>
                          </div>
                          {employeeLeaveCredits.convertible && (
                            <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                              <div className="flex justify-between">
                                <span>Convertible to cash:</span>
                                <span className="font-medium text-green-600">
                                  {
                                    employeeLeaveCredits.convertible.sick
                                      .convertible
                                  }{" "}
                                  days
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {employeeLeaveCredits.custom &&
                      employeeLeaveCredits.custom.length > 0 &&
                      employeeLeaveCredits.custom.map((custom: any) => (
                        <Card key={custom.type}>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Calendar className="h-5 w-5" />
                              {custom.type}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">
                                  Total:
                                </span>
                                <span className="font-semibold">
                                  {custom.total} days
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">
                                  Used:
                                </span>
                                <span className="font-semibold">
                                  {custom.used} days
                                </span>
                              </div>
                              <div className="flex justify-between border-t pt-2">
                                <span className="text-sm font-medium">
                                  Balance:
                                </span>
                                <span className="text-lg font-bold text-purple-600">
                                  {custom.balance} days
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="history">
              <Suspense
                fallback={
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center text-gray-500">
                        Loading leave history...
                      </div>
                    </CardContent>
                  </Card>
                }
              >
                <EmployeeLeaveHistoryTab
                  leaveHistory={employeeLeaveHistory}
                  columns={historyTableColumns}
                />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      </MainLayout>
    );
  }

  // Admin/HR View
  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Leave Management
            </h1>
            <p className="text-gray-600 mt-2">
              Manage employee leave requests and credits
            </p>
          </div>
          {/* HR always has employeeId, so they can request leave for themselves */}
          {isAdminOrHr && canRequestLeave && (
            <Suspense fallback={<Button disabled>Request Leave</Button>}>
              <RequestLeaveDialog
                isOpen={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                organizationId={currentOrganizationId || ""}
                employeeId={userEmployeeId || ""}
                onSuccess={() => {
                  if (canRequestLeave && userEmployeeId) {
                    loadEmployeeData();
                  }
                }}
              />
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Request Leave
              </Button>
            </Suspense>
          )}
        </div>

        <Tabs defaultValue="requests" className="space-y-4">
          <TabsList>
            <TabsTrigger value="requests">Leave Requests</TabsTrigger>
            <TabsTrigger value="history">Leave History</TabsTrigger>
            <TabsTrigger value="credits">Leave Credits</TabsTrigger>
          </TabsList>

          <TabsContent value="requests">
            <Suspense
              fallback={
                <Card>
                  <CardContent className="p-4">
                    <div className="text-center text-gray-500">
                      Loading leave requests...
                    </div>
                  </CardContent>
                </Card>
              }
            >
              <AdminLeaveRequestsTab
                leaveRequests={leaveRequests || []}
                columns={requestsTableColumns}
                employees={employees}
                onManageColumns={() => setIsRequestsColumnModalOpen(true)}
                onReviewRequest={(request) => {
                  setReviewingRequest(request);
                  setIsReviewDialogOpen(true);
                }}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="history">
            <Suspense
              fallback={
                <Card>
                  <CardContent className="p-4">
                    <div className="text-center text-gray-500">
                      Loading leave history...
                    </div>
                  </CardContent>
                </Card>
              }
            >
              <AdminLeaveHistoryTab
                leaveRequests={
                  leaveRequests?.sort(
                    (a: any, b: any) => b.filedDate - a.filedDate
                  ) || []
                }
                columns={historyTableColumns}
                employees={employees}
                onManageColumns={() => setIsHistoryColumnModalOpen(true)}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="credits">
            <Card>
              <CardHeader>
                <CardTitle>Manage Leave Credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Employee</Label>
                  <Select
                    value={selectedEmployeeForCredits}
                    onValueChange={setSelectedEmployeeForCredits}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map((emp: any) => (
                        <SelectItem key={emp._id} value={emp._id}>
                          {emp.personalInfo.firstName}{" "}
                          {emp.personalInfo.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedEmployeeCredits && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">
                            Vacation Leave
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Total:
                              </span>
                              <span className="font-semibold">
                                {selectedEmployeeCredits.vacation.total} days
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Used:
                              </span>
                              <span className="font-semibold">
                                {selectedEmployeeCredits.vacation.used} days
                              </span>
                            </div>
                            <div className="flex justify-between border-t pt-2">
                              <span className="text-sm font-medium">
                                Balance:
                              </span>
                              <span className="text-lg font-bold text-purple-600">
                                {selectedEmployeeCredits.vacation.balance} days
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Sick Leave</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Total:
                              </span>
                              <span className="font-semibold">
                                {selectedEmployeeCredits.sick.total} days
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">
                                Used:
                              </span>
                              <span className="font-semibold">
                                {selectedEmployeeCredits.sick.used} days
                              </span>
                            </div>
                            <div className="flex justify-between border-t pt-2">
                              <span className="text-sm font-medium">
                                Balance:
                              </span>
                              <span className="text-lg font-bold text-purple-600">
                                {selectedEmployeeCredits.sick.balance} days
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {selectedEmployeeCredits.custom &&
                      selectedEmployeeCredits.custom.length > 0 && (
                        <div className="mt-4">
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">
                                Custom Leave Types
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {selectedEmployeeCredits.custom.map(
                                  (custom: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex flex-col gap-1 border-b last:border-b-0 pb-2 last:pb-0"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium capitalize">
                                          {custom.type}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                          Custom
                                        </span>
                                      </div>
                                      <div className="flex justify-between text-sm text-gray-600">
                                        <span>Total:</span>
                                        <span className="font-semibold">
                                          {custom.total} days
                                        </span>
                                      </div>
                                      <div className="flex justify-between text-sm text-gray-600">
                                        <span>Used:</span>
                                        <span className="font-semibold">
                                          {custom.used} days
                                        </span>
                                      </div>
                                      <div className="flex justify-between text-sm border-t pt-1">
                                        <span className="font-medium">
                                          Balance:
                                        </span>
                                        <span className="font-bold text-purple-600">
                                          {custom.balance} days
                                        </span>
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                    <div className="flex gap-2 mt-4">
                      <Button
                        onClick={() => setIsAdjustCreditsOpen(true)}
                        variant="outline"
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Adjust Leave Credits
                      </Button>
                      {((selectedEmployeeCredits?.convertible?.vacation
                        ?.convertible ?? 0) > 0 ||
                        (selectedEmployeeCredits?.convertible?.sick
                          ?.convertible ?? 0) > 0) && (
                        <Button
                          onClick={() => setIsCashConversionOpen(true)}
                          variant="outline"
                        >
                          <TrendingUp className="mr-2 h-4 w-4" />
                          Convert to Cash
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Review Dialog */}
        <Suspense fallback={null}>
          <ReviewLeaveDialog
            isOpen={isReviewDialogOpen}
            onOpenChange={setIsReviewDialogOpen}
            request={reviewingRequest}
            employees={employees}
            onSuccess={() => {
              setReviewingRequest(null);
              if (canRequestLeave && userEmployeeId) {
                loadEmployeeData();
              }
            }}
          />
        </Suspense>

        {/* Cash Conversion Dialog */}
        <Suspense fallback={null}>
          <CashConversionDialog
            isOpen={isCashConversionOpen}
            onOpenChange={setIsCashConversionOpen}
            organizationId={currentOrganizationId || ""}
            employeeId={selectedEmployeeForCredits}
            convertibleCredits={selectedEmployeeCredits?.convertible}
            onSuccess={() => {
              loadEmployeeCredits();
              if (canRequestLeave && userEmployeeId) {
                loadEmployeeData();
              }
            }}
          />
        </Suspense>

        {/* Adjust Credits Dialog */}
        <Suspense fallback={null}>
          <AdjustCreditsDialog
            isOpen={isAdjustCreditsOpen}
            onOpenChange={setIsAdjustCreditsOpen}
            organizationId={currentOrganizationId || ""}
            employeeId={selectedEmployeeForCredits}
            onSuccess={() => {
              loadEmployeeCredits();
            }}
          />
        </Suspense>

        {/* Column Management Modals */}
        <LeaveColumnManagementModal
          isOpen={isRequestsColumnModalOpen}
          onOpenChange={setIsRequestsColumnModalOpen}
          columns={requestsTableColumns}
          onColumnsChange={setRequestsTableColumns}
          tableType="requests"
        />
        <LeaveColumnManagementModal
          isOpen={isHistoryColumnModalOpen}
          onOpenChange={setIsHistoryColumnModalOpen}
          columns={historyTableColumns}
          onColumnsChange={setHistoryTableColumns}
          tableType="history"
        />
      </div>
    </MainLayout>
  );
}
