"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Calendar,
  DollarSign,
  UserPlus,
  Clock,
  ArrowRight,
  Bell,
  Receipt,
  Calculator,
} from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getOrganizationPath } from "@/utils/organization-routing";
import { format } from "date-fns";
import Link from "next/link";
import {
  DashboardOverviewHeader,
  DashboardMetricCard,
  type DateRangeOption,
} from "@/components/dashboard";

/** Dashboard view for accounting role: payroll, expense management, announcements */
function AccountingDashboard({
  currentOrganizationId,
  recentAnnouncements,
  recentPayrollRuns,
  dateRange,
  onDateRangeChange,
}: {
  currentOrganizationId: string;
  recentAnnouncements: any[];
  recentPayrollRuns: any[];
  dateRange: DateRangeOption;
  onDateRangeChange: (v: DateRangeOption) => void;
}) {
  const costItems = useQuery(
    (api as any).accounting.getCostItems,
    currentOrganizationId ? { organizationId: currentOrganizationId as any } : "skip"
  );
  const items = costItems ?? [];
  const totalPending = items
    .filter((i: any) => i.status !== "paid")
    .reduce((sum: number, i: any) => sum + (i.amount ?? 0) - (i.amountPaid ?? 0), 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <DashboardOverviewHeader
        title="Your overview"
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        compareLabel="Previous period"
      />

      <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2">
        <DashboardMetricCard
          title="Payroll"
          value={`${recentPayrollRuns.length} recent run${recentPayrollRuns.length !== 1 ? "s" : ""}`}
          secondary="View and manage payroll"
          exploreHref={getOrganizationPath(currentOrganizationId, "/payroll")}
          exploreLabel="Explore"
          moreDetailsHref={getOrganizationPath(currentOrganizationId, "/payroll")}
          moreDetailsLabel="More details"
        />
        <DashboardMetricCard
          title="Expense Management"
          value={`${items.length} cost item${items.length !== 1 ? "s" : ""}`}
          secondary={
            totalPending > 0
              ? `₱${totalPending.toLocaleString()} pending`
              : "Manage expenses"
          }
          exploreHref={getOrganizationPath(currentOrganizationId, "/accounting")}
          exploreLabel="Explore"
          moreDetailsHref={getOrganizationPath(currentOrganizationId, "/accounting")}
          moreDetailsLabel="More details"
        />
      </div>

      <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-[rgb(230,230,230)] md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
            <div>
              <CardTitle className="text-base font-semibold sm:text-lg">
                Recent Payroll Runs
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Latest processed
              </CardDescription>
            </div>
            <DollarSign className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {recentPayrollRuns.length > 0 ? (
              <div className="space-y-3">
                {recentPayrollRuns.map((run: any) => (
                  <Link
                    key={run._id}
                    href={getOrganizationPath(currentOrganizationId, "/payroll")}
                    className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[rgb(64,64,64)]">
                          {format(new Date(run.cutoffStart), "MMM d")} -{" "}
                          {format(new Date(run.cutoffEnd), "MMM d, yyyy")}
                        </p>
                        <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                          {format(new Date(run.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <Badge
                        className={
                          run.status === "completed"
                            ? "bg-green-100 text-green-800 hover:bg-green-100"
                            : run.status === "processing"
                              ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-100"
                        }
                        variant="outline"
                      >
                        {run.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
                <Link
                  href={getOrganizationPath(currentOrganizationId, "/payroll")}
                  className="mt-2 flex items-center gap-1 text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-[rgb(133,133,133)]">
                No payroll runs yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[rgb(230,230,230)]">
          <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
            <div>
              <CardTitle className="text-base font-semibold sm:text-lg">
                Recent Announcements
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Latest updates
              </CardDescription>
            </div>
            <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-[rgb(133,133,133)]" />
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {recentAnnouncements.length > 0 ? (
              <div className="space-y-3">
                {recentAnnouncements.slice(0, 3).map((announcement: any) => (
                  <Link
                    key={announcement._id}
                    href={getOrganizationPath(currentOrganizationId, "/announcements")}
                    className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                  >
                    <p className="truncate text-sm font-medium text-[rgb(64,64,64)]">
                      {announcement.title}
                    </p>
                    <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                      {format(new Date(announcement.publishedDate), "MMM d, yyyy")}
                    </p>
                  </Link>
                ))}
                <Link
                  href={getOrganizationPath(currentOrganizationId, "/announcements")}
                  className="mt-2 flex items-center gap-1 text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-[rgb(133,133,133)]">
                No announcements yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganization();

  // Get user first - needed for conditional queries below
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  // Only query employees if user has HR/admin/accounting role
  // This prevents "Not authorized" errors for employees
  const allowedRolesForEmployees = ["admin", "hr", "accounting", "owner"];
  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId &&
      user &&
      user.role &&
      allowedRolesForEmployees.includes(user.role)
      ? { organizationId: currentOrganizationId }
      : "skip"
  );

  const leaveRequests = useQuery(
    (api as any).leave.getLeaveRequests,
    currentOrganizationId
      ? { organizationId: currentOrganizationId, status: "pending" }
      : "skip"
  );

  // Get recent announcements
  const announcements = useQuery(
    (api as any).announcements.getAnnouncements,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  // Only query payroll runs if user has HR/admin/accounting role
  const allowedRolesForPayroll = ["admin", "hr", "accounting", "owner"];
  const payrollRuns = useQuery(
    (api as any).payroll.getPayrollRuns,
    currentOrganizationId &&
      user &&
      user.role &&
      allowedRolesForPayroll.includes(user.role)
      ? { organizationId: currentOrganizationId }
      : "skip"
  );

  // Redirect employees to announcements (accounting stays on dashboard with own view)
  useEffect(() => {
    if (user && currentOrganizationId && user.role === "employee") {
      router.replace(
        getOrganizationPath(currentOrganizationId, "/announcements")
      );
    }
  }, [user, currentOrganizationId, router]);

  // All hooks must run before any conditional return (React rules of hooks)
  const recentAnnouncements = useMemo(() => {
    if (!announcements) return [];
    return announcements.slice(0, 5);
  }, [announcements]);

  const recentPayrollRuns = useMemo(() => {
    if (!payrollRuns) return [];
    return payrollRuns.slice(0, 3);
  }, [payrollRuns]);

  const recentLeaveRequests = useMemo(() => {
    if (!leaveRequests) return [];
    return leaveRequests.slice(0, 5);
  }, [leaveRequests]);

  const [dateRange, setDateRange] = useState<DateRangeOption>("7");

  if (!currentOrganizationId) return null;

  // Employee: redirecting (handled in useEffect)
  if (user && user.role === "employee") {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-[rgb(133,133,133)]">Redirecting...</div>
        </div>
      </MainLayout>
    );
  }

  // Accounting: separate dashboard (payroll, expense management, announcements)
  if (user && user.role === "accounting") {
    return (
      <MainLayout>
        <AccountingDashboard
          currentOrganizationId={currentOrganizationId}
          recentAnnouncements={recentAnnouncements}
          recentPayrollRuns={recentPayrollRuns}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />
      </MainLayout>
    );
  }

  const stats = [
    {
      title: "Total Employees",
      value: employees?.length || 0,
      icon: Users,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      link: getOrganizationPath(currentOrganizationId, "/employees"),
    },
    {
      title: "Pending Leave Requests",
      value: leaveRequests?.length || 0,
      icon: Calendar,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      link: getOrganizationPath(currentOrganizationId, "/leave"),
    },
  ];

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <DashboardOverviewHeader
          title="Your overview"
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          compareLabel="Previous period"
          actions={
            <>
              <Link href={getOrganizationPath(currentOrganizationId, "/employees")}>
                <Button size="sm" className="bg-brand-purple hover:bg-brand-purple-hover text-white">
                  + Add
                </Button>
              </Link>
              <Button size="sm" variant="outline" className="border-[rgb(230,230,230)]">
                Edit
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2">
          <DashboardMetricCard
            title="Total Employees"
            value={employees?.length ?? 0}
            secondary="0 previous period"
            asLink={getOrganizationPath(currentOrganizationId, "/employees")}
            exploreHref={getOrganizationPath(currentOrganizationId, "/employees")}
            moreDetailsHref={getOrganizationPath(currentOrganizationId, "/employees")}
          />
          <DashboardMetricCard
            title="Pending Leave Requests"
            value={leaveRequests?.length ?? 0}
            secondary="0 previous period"
            asLink={getOrganizationPath(currentOrganizationId, "/leave")}
            exploreHref={getOrganizationPath(currentOrganizationId, "/leave")}
            moreDetailsHref={getOrganizationPath(currentOrganizationId, "/leave")}
          />
        </div>

        <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Recent Announcements */}
          <Card className="border-[rgb(230,230,230)]">
            <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
              <div>
                <CardTitle className="text-base font-semibold sm:text-lg">
                  Recent Announcements
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Latest updates
                </CardDescription>
              </div>
              <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-[rgb(133,133,133)]" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              {recentAnnouncements && recentAnnouncements.length > 0 ? (
                <div className="space-y-3">
                  {recentAnnouncements.map((announcement: any) => (
                    <Link
                      key={announcement._id}
                      href={getOrganizationPath(
                        currentOrganizationId,
                        "/announcements"
                      )}
                      className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[rgb(64,64,64)]">
                            {announcement.title}
                          </p>
                          <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                            {format(
                              new Date(announcement.publishedDate),
                              "MMM d, yyyy"
                            )}
                          </p>
                        </div>
                        {announcement.priority === "urgent" && (
                          <Badge variant="destructive" className="text-xs shrink-0">
                            Urgent
                          </Badge>
                        )}
                        {announcement.priority === "important" && (
                          <Badge className="shrink-0 bg-orange-100 text-orange-800 hover:bg-orange-100 text-xs">
                            Important
                          </Badge>
                        )}
                      </div>
                    </Link>
                  ))}
                  <Link
                    href={getOrganizationPath(
                      currentOrganizationId,
                      "/announcements"
                    )}
                    className="mt-2 flex items-center gap-1 text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-[rgb(133,133,133)]">
                  No announcements yet
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card className="border-[rgb(230,230,230)]">
            <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
              <div>
                <CardTitle className="text-base font-semibold sm:text-lg">
                  Pending Leave Requests
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Requires your attention
                </CardDescription>
              </div>
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              {recentLeaveRequests && recentLeaveRequests.length > 0 ? (
                <div className="space-y-3">
                  {recentLeaveRequests.map((request: any) => {
                    const employee = employees?.find(
                      (emp: any) => emp._id === request.employeeId
                    );
                    return (
                      <Link
                        key={request._id}
                        href={getOrganizationPath(
                          currentOrganizationId,
                          "/leave"
                        )}
                        className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[rgb(64,64,64)]">
                              {employee?.personalInfo?.firstName}{" "}
                              {employee?.personalInfo?.lastName}
                            </p>
                            <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                              {request.leaveType} •{" "}
                              {format(new Date(request.startDate), "MMM d")} -{" "}
                              {format(new Date(request.endDate), "MMM d")}
                            </p>
                          </div>
                          <Badge className="shrink-0 bg-orange-100 text-orange-800 hover:bg-orange-100 text-xs">
                            Pending
                          </Badge>
                        </div>
                      </Link>
                    );
                  })}
                  <Link
                    href={getOrganizationPath(currentOrganizationId, "/leave")}
                    className="mt-2 flex items-center gap-1 text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-[rgb(133,133,133)]">
                  No pending leave requests
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Payroll Runs */}
          <Card className="border-[rgb(230,230,230)]">
            <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
              <div>
                <CardTitle className="text-base font-semibold sm:text-lg">
                  Recent Payroll Runs
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Latest processed
                </CardDescription>
              </div>
              <DollarSign className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              {recentPayrollRuns && recentPayrollRuns.length > 0 ? (
                <div className="space-y-3">
                  {recentPayrollRuns.map((run: any) => (
                    <Link
                      key={run._id}
                      href={getOrganizationPath(
                        currentOrganizationId,
                        "/payroll"
                      )}
                      className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[rgb(64,64,64)]">
                            {format(new Date(run.cutoffStart), "MMM d")} -{" "}
                            {format(new Date(run.cutoffEnd), "MMM d, yyyy")}
                          </p>
                          <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                            {format(new Date(run.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge
                          className={
                            run.status === "completed"
                              ? "bg-green-100 text-green-800 hover:bg-green-100"
                              : run.status === "processing"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                : "bg-gray-100 text-gray-800 hover:bg-gray-100"
                          }
                          variant="outline"
                        >
                          {run.status}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                  <Link
                    href={getOrganizationPath(
                      currentOrganizationId,
                      "/payroll"
                    )}
                    className="mt-2 flex items-center gap-1 text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-[rgb(133,133,133)]">
                  No payroll runs yet
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mt-6 border-[rgb(230,230,230)]">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base font-semibold sm:text-lg">
              Quick Actions
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Link
                href={getOrganizationPath(currentOrganizationId, "/employees")}
              >
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start border-[rgb(230,230,230)] py-4 hover:bg-[rgb(250,250,250)]"
                >
                  <UserPlus className="mr-3 h-5 w-5 text-blue-600" />
                  <div className="text-left">
                    <div className="font-medium">Add Employee</div>
                    <div className="text-xs text-[rgb(133,133,133)]">
                      Add a new team member
                    </div>
                  </div>
                </Button>
              </Link>
              <Link
                href={getOrganizationPath(currentOrganizationId, "/payroll")}
              >
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start border-[rgb(230,230,230)] py-4 hover:bg-[rgb(250,250,250)]"
                >
                  <DollarSign className="mr-3 h-5 w-5 text-green-600" />
                  <div className="text-left">
                    <div className="font-medium">Process Payroll</div>
                    <div className="text-xs text-[rgb(133,133,133)]">
                      Create a new payroll run
                    </div>
                  </div>
                </Button>
              </Link>
              <Link
                href={getOrganizationPath(
                  currentOrganizationId,
                  "/announcements"
                )}
              >
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start border-[rgb(230,230,230)] py-4 hover:bg-[rgb(250,250,250)]"
                >
                  <Bell className="mr-3 h-5 w-5 text-brand-purple" />
                  <div className="text-left">
                    <div className="font-medium">Create Announcement</div>
                    <div className="text-xs text-[rgb(133,133,133)]">
                      Share updates with team
                    </div>
                  </div>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
