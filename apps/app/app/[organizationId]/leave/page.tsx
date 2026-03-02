"use client";

import { useState, useEffect, Suspense, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Calendar, Edit } from "lucide-react";
import { getEmployeeLeaveCredits } from "@/actions/leave";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { DynamicLeaveTable } from "./_components/dynamic-leave-table";
import { LeaveColumnManagementModal } from "./_components/leave-column-management-modal";
import { LeaveCreditsTable } from "./_components/leave-credits-table";

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

const EMPLOYEE_TABS = ["credits", "history"] as const;
const ADMIN_TABS = ["requests", "history", "credits"] as const;

export default function LeavePage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganizationId, currentOrganization } = useOrganization();
  const { toast } = useToast();

  const setTabParam = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );
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

  // Only show records for active employees (requests, history, credits table)
  const activeEmployees = useMemo(() => {
    const list = employees ?? [];
    return list.filter((e: any) => e.employment?.status === "active");
  }, [employees]);
  const activeEmployeeIds = useMemo(
    () => new Set(activeEmployees.map((e: any) => e._id)),
    [activeEmployees]
  );
  const leaveRequestsActiveOnly = useMemo(() => {
    const list = leaveRequests ?? [];
    return list.filter((r: any) => activeEmployeeIds.has(r.employeeId));
  }, [leaveRequests, activeEmployeeIds]);

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
  const [isAdjustCreditsOpen, setIsAdjustCreditsOpen] = useState(false);

  // Leave request dialog states
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Review dialog states
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<any>(null);

  const [creditsTableRefreshKey, setCreditsTableRefreshKey] = useState(0);

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

      // Filter leave history for this employee (newest first)
      const history = (leaveRequests?.filter(
        (req: any) => req.employeeId === userEmployeeId
      ) || []).sort((a: any, b: any) => (b.filedDate ?? 0) - (a.filedDate ?? 0));
      setEmployeeLeaveHistory(history);
    } catch (error) {
      console.error("Error loading employee data:", error);
    }
  };

  // Employee View (or HR/Admin who are employees)
  if (canRequestLeave && !isAdminOrHr) {
    return (
      <MainLayout>
        <div className="p-8">
          {/* Header: title + action (Transactions-style) */}
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-[rgb(64,64,64)] tracking-tight">
              My Leaves
            </h1>
            <Suspense
              fallback={
                <div className="h-10 w-10 rounded-lg bg-[rgb(245,245,245)] animate-pulse" />
              }
            >
              <RequestLeaveDialog
                isOpen={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                organizationId={currentOrganizationId || ""}
                employeeId={userEmployeeId || ""}
                leaveTypes={settings?.leaveTypes ?? []}
                leaveCredits={employeeLeaveCredits}
                onSuccess={() => {
                  if (canRequestLeave && userEmployeeId) {
                    loadEmployeeData();
                  }
                }}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white shrink-0"
                onClick={() => setIsDialogOpen(true)}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </Suspense>
          </div>

          {/* Underline tabs + separator */}
          <Tabs
            value={
              EMPLOYEE_TABS.includes(
                searchParams?.get("tab") as (typeof EMPLOYEE_TABS)[number]
              )
                ? (searchParams?.get("tab") ?? "credits")
                : "credits"
            }
            onValueChange={setTabParam}
            className="space-y-0"
          >
            <div className="flex items-end gap-6 border-b border-[rgb(230,230,230)]">
              <TabsList className="h-auto w-auto rounded-none bg-transparent p-0 gap-6 border-0 shadow-none">
                <TabsTrigger
                  value="credits"
                  className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-semibold text-[rgb(133,133,133)] data-[state=active]:border-brand-purple data-[state=active]:text-brand-purple data-[state=active]:shadow-none data-[state=active]:bg-transparent -mb-px"
                >
                  Leave credits
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-semibold text-[rgb(133,133,133)] data-[state=active]:border-brand-purple data-[state=active]:text-brand-purple data-[state=active]:shadow-none data-[state=active]:bg-transparent -mb-px"
                >
                  Leave history
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="mt-6" />

            <TabsContent value="credits" className="mt-0">
              <div className="space-y-6">
                {employeeLeaveCredits && employeeLeaveCredits.calculations && (
                  <Card className="border-[rgb(230,230,230)] shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
                        Leave calculations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex justify-between text-[rgb(64,64,64)]">
                        <span className="text-[rgb(133,133,133)]">
                          Prorated leave
                        </span>
                        <span className="font-medium">
                          {employeeLeaveCredits.calculations.proratedLeave.toFixed(
                            2
                          )}{" "}
                          days
                        </span>
                      </div>
                      <div className="flex justify-between text-[rgb(64,64,64)]">
                        <span className="text-[rgb(133,133,133)]">
                          Anniversary leave
                        </span>
                        <span className="font-medium">
                          {employeeLeaveCredits.calculations.anniversaryLeave}{" "}
                          days
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-3">
                        <span className="font-medium text-[rgb(64,64,64)]">
                          Total entitlement
                        </span>
                        <span className="font-semibold text-brand-purple">
                          {employeeLeaveCredits.calculations.totalEntitlement.toFixed(
                            2
                          )}{" "}
                          days
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  {employeeLeaveCredits && (
                    <>
                      <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
                        <CardHeader className="pb-2 pt-5">
                          <CardTitle className="flex items-center gap-2 text-base font-semibold text-[rgb(64,64,64)]">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                              <Calendar className="h-4 w-4" />
                            </span>
                            Vacation leave
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pb-6 text-sm">
                          <div className="flex justify-between">
                            <span className="text-[rgb(133,133,133)]">
                              Total
                            </span>
                            <span className="font-medium">
                              {employeeLeaveCredits.vacation.total} days
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[rgb(133,133,133)]">
                              Used
                            </span>
                            <span className="font-medium">
                              {employeeLeaveCredits.vacation.used} days
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-3">
                            <span className="font-medium">Balance</span>
                            <span className="font-semibold text-brand-purple">
                              {employeeLeaveCredits.vacation.balance} days
                            </span>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
                        <CardHeader className="pb-2 pt-5">
                          <CardTitle className="flex items-center gap-2 text-base font-semibold text-[rgb(64,64,64)]">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                              <Calendar className="h-4 w-4" />
                            </span>
                            Sick leave
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pb-6 text-sm">
                          <div className="flex justify-between">
                            <span className="text-[rgb(133,133,133)]">
                              Total
                            </span>
                            <span className="font-medium">
                              {employeeLeaveCredits.sick.total} days
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[rgb(133,133,133)]">
                              Used
                            </span>
                            <span className="font-medium">
                              {employeeLeaveCredits.sick.used} days
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-3">
                            <span className="font-medium">Balance</span>
                            <span className="font-semibold text-brand-purple">
                              {employeeLeaveCredits.sick.balance} days
                            </span>
                          </div>
                        </CardContent>
                      </Card>

                      {employeeLeaveCredits.custom &&
                        employeeLeaveCredits.custom.length > 0 &&
                        employeeLeaveCredits.custom.map((custom: any) => (
                          <Card
                            key={custom.type}
                            className="border-[rgb(230,230,230)] shadow-sm overflow-hidden sm:col-span-2"
                          >
                            <CardHeader className="pb-2 pt-5">
                              <CardTitle className="flex items-center gap-2 text-base font-semibold text-[rgb(64,64,64)]">
                                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgb(245,245,245)] text-[rgb(107,107,107)]">
                                  <Calendar className="h-4 w-4" />
                                </span>
                                {custom.type}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 pb-6 text-sm">
                              <div className="flex justify-between">
                                <span className="text-[rgb(133,133,133)]">
                                  Total
                                </span>
                                <span className="font-medium">
                                  {custom.total} days
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[rgb(133,133,133)]">
                                  Used
                                </span>
                                <span className="font-medium">
                                  {custom.used} days
                                </span>
                              </div>
                              <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-3">
                                <span className="font-medium">Balance</span>
                                <span className="font-semibold text-brand-purple">
                                  {custom.balance} days
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                    </>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <Suspense
                fallback={
                  <Card className="border-[rgb(230,230,230)]">
                    <CardContent className="py-12">
                      <div className="text-center text-sm text-[rgb(133,133,133)]">
                        Loading leave history…
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
        {/* Header: title + action (Transactions-style) */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[rgb(64,64,64)] tracking-tight">
            Leave
          </h1>
          {isAdminOrHr && canRequestLeave && (
            <Suspense
              fallback={
                <div className="h-10 w-10 rounded-lg bg-[rgb(245,245,245)] animate-pulse" />
              }
            >
              <RequestLeaveDialog
                isOpen={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                organizationId={currentOrganizationId || ""}
                employeeId={userEmployeeId || ""}
                leaveTypes={settings?.leaveTypes ?? []}
                leaveCredits={employeeLeaveCredits}
                onSuccess={() => {
                  if (canRequestLeave && userEmployeeId) {
                    loadEmployeeData();
                  }
                }}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white shrink-0"
                onClick={() => setIsDialogOpen(true)}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </Suspense>
          )}
        </div>

        {/* Underline tabs + separator */}
        <Tabs
          value={
            ADMIN_TABS.includes(
              searchParams?.get("tab") as (typeof ADMIN_TABS)[number]
            )
              ? (searchParams?.get("tab") ?? "requests")
              : "requests"
          }
          onValueChange={setTabParam}
          className="space-y-0"
        >
          <div className="flex items-end gap-6 border-b border-[rgb(230,230,230)]">
            <TabsList className="h-auto w-auto rounded-none bg-transparent p-0 gap-6 border-0 shadow-none">
              <TabsTrigger
                value="requests"
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-semibold text-[rgb(133,133,133)] data-[state=active]:border-brand-purple data-[state=active]:text-brand-purple data-[state=active]:shadow-none data-[state=active]:bg-transparent -mb-px"
              >
                Leave requests
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-semibold text-[rgb(133,133,133)] data-[state=active]:border-brand-purple data-[state=active]:text-brand-purple data-[state=active]:shadow-none data-[state=active]:bg-transparent -mb-px"
              >
                Leave history
              </TabsTrigger>
              <TabsTrigger
                value="credits"
                className="rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-semibold text-[rgb(133,133,133)] data-[state=active]:border-brand-purple data-[state=active]:text-brand-purple data-[state=active]:shadow-none data-[state=active]:bg-transparent -mb-px"
              >
                Leave credits
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="mt-6" />

          <TabsContent value="requests" className="mt-0">
            <Suspense
              fallback={
                <Card className="border-[rgb(230,230,230)]">
                  <CardContent className="py-12">
                    <div className="text-center text-sm text-[rgb(133,133,133)]">
                      Loading leave requests…
                    </div>
                  </CardContent>
                </Card>
              }
            >
              <AdminLeaveRequestsTab
                leaveRequests={leaveRequestsActiveOnly}
                columns={requestsTableColumns}
                employees={activeEmployees}
                onManageColumns={() => setIsRequestsColumnModalOpen(true)}
                onReviewRequest={(request) => {
                  setReviewingRequest(request);
                  setIsReviewDialogOpen(true);
                }}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <Suspense
              fallback={
                <Card className="border-[rgb(230,230,230)]">
                  <CardContent className="py-12">
                    <div className="text-center text-sm text-[rgb(133,133,133)]">
                      Loading leave history…
                    </div>
                  </CardContent>
                </Card>
              }
            >
              <AdminLeaveHistoryTab
                leaveRequests={[...leaveRequestsActiveOnly].sort(
                  (a: any, b: any) => b.filedDate - a.filedDate
                )}
                columns={historyTableColumns}
                employees={activeEmployees}
                onManageColumns={() => setIsHistoryColumnModalOpen(true)}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="credits" className="mt-0">
            <Card className="border-[rgb(230,230,230)] shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
                  Leave credits
                </CardTitle>
                <p className="text-sm text-[rgb(133,133,133)] mt-1">
                  View and edit leave balances by employee. Use Edit on a row to
                  adjust credits.
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <LeaveCreditsTable
                  key={creditsTableRefreshKey}
                  employees={activeEmployees}
                  organizationId={currentOrganizationId || ""}
                  onEdit={(employeeId) => {
                    setSelectedEmployeeForCredits(employeeId);
                    setIsAdjustCreditsOpen(true);
                  }}
                />
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

        {/* Adjust Credits Dialog */}
        <Suspense fallback={null}>
          <AdjustCreditsDialog
            isOpen={isAdjustCreditsOpen}
            onOpenChange={setIsAdjustCreditsOpen}
            organizationId={currentOrganizationId || ""}
            employeeId={selectedEmployeeForCredits}
            leaveTypes={settings?.leaveTypes ?? []}
            onSuccess={() => {
              setCreditsTableRefreshKey((k) => k + 1);
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
