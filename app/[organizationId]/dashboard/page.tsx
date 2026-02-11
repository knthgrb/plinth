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
import { useEffect, useMemo } from "react";
import { getOrganizationPath } from "@/utils/organization-routing";
import { format } from "date-fns";
import Link from "next/link";

/** Dashboard view for accounting role: payroll, expense management, announcements */
function AccountingDashboard({
  currentOrganizationId,
  recentAnnouncements,
  recentPayrollRuns,
}: {
  currentOrganizationId: string;
  recentAnnouncements: any[];
  recentPayrollRuns: any[];
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
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-[rgb(64,64,64)]">
          Accounting Dashboard
        </h1>
        <p className="text-sm text-[rgb(133,133,133)] mt-1">
          Payroll, expenses, and announcements
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 mb-6 sm:mb-8">
        <Link href={getOrganizationPath(currentOrganizationId, "/payroll")}>
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[rgb(133,133,133)]">
                Payroll
              </CardTitle>
              <Receipt className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[rgb(64,64,64)]">
                {recentPayrollRuns.length} recent run{recentPayrollRuns.length !== 1 ? "s" : ""}
              </div>
              <p className="text-xs text-[rgb(133,133,133)] mt-1">View and manage payroll</p>
            </CardContent>
          </Card>
        </Link>
        <Link href={getOrganizationPath(currentOrganizationId, "/accounting")}>
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[rgb(133,133,133)]">
                Expense Management
              </CardTitle>
              <Calculator className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[rgb(64,64,64)]">
                {items.length} cost item{items.length !== 1 ? "s" : ""}
              </div>
              <p className="text-xs text-[rgb(133,133,133)] mt-1">
                {totalPending > 0 ? `₱${totalPending.toLocaleString()} pending` : "Manage expenses"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
            <div>
              <CardTitle className="text-base sm:text-lg">Recent Payroll Runs</CardTitle>
              <CardDescription className="text-xs sm:text-sm">Latest processed</CardDescription>
            </div>
            <DollarSign className="h-5 w-5 text-green-400" />
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {recentPayrollRuns.length > 0 ? (
              <div className="space-y-3">
                {recentPayrollRuns.map((run: any) => (
                  <Link
                    key={run._id}
                    href={getOrganizationPath(currentOrganizationId, "/payroll")}
                    className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {format(new Date(run.cutoffStart), "MMM d")} -{" "}
                          {format(new Date(run.cutoffEnd), "MMM d, yyyy")}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
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
                  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="text-sm text-[rgb(133,133,133)] text-center py-4">
                No payroll runs yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
            <div>
              <CardTitle className="text-base sm:text-lg">Recent Announcements</CardTitle>
              <CardDescription className="text-xs sm:text-sm">Latest updates</CardDescription>
            </div>
            <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {recentAnnouncements.length > 0 ? (
              <div className="space-y-3">
                {recentAnnouncements.slice(0, 3).map((announcement: any) => (
                  <Link
                    key={announcement._id}
                    href={getOrganizationPath(currentOrganizationId, "/announcements")}
                    className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {announcement.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {format(new Date(announcement.publishedDate), "MMM d, yyyy")}
                    </p>
                  </Link>
                ))}
                <Link
                  href={getOrganizationPath(currentOrganizationId, "/announcements")}
                  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="text-sm text-[rgb(133,133,133)] text-center py-4">
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
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-[rgb(64,64,64)]">
            Dashboard
          </h1>
        </div>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 mb-6 sm:mb-8">
          {stats.map((stat) => (
            <Link key={stat.title} href={stat.link || "#"}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-[rgb(133,133,133)]">
                    {stat.title}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[rgb(64,64,64)]">
                    {stat.value}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Recent Announcements */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
              <div>
                <CardTitle className="text-base sm:text-lg">
                  Recent Announcements
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Latest updates
                </CardDescription>
              </div>
              <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {recentAnnouncements && recentAnnouncements.length > 0 ? (
                <div className="space-y-3">
                  {recentAnnouncements.map((announcement: any) => (
                    <Link
                      key={announcement._id}
                      href={getOrganizationPath(
                        currentOrganizationId,
                        "/announcements"
                      )}
                      className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {announcement.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {format(
                              new Date(announcement.publishedDate),
                              "MMM d, yyyy"
                            )}
                          </p>
                        </div>
                        {announcement.priority === "urgent" && (
                          <Badge variant="destructive" className="text-xs">
                            Urgent
                          </Badge>
                        )}
                        {announcement.priority === "important" && (
                          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 text-xs">
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
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="text-sm text-[rgb(133,133,133)] text-center py-4">
                  No announcements yet
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Leave Requests */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between p-4 sm:p-6">
              <div>
                <CardTitle className="text-base sm:text-lg">
                  Pending Leave Requests
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Requires your attention
                </CardDescription>
              </div>
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-orange-400" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
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
                        className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {employee?.personalInfo?.firstName}{" "}
                              {employee?.personalInfo?.lastName}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {request.leaveType} •{" "}
                              {format(new Date(request.startDate), "MMM d")} -{" "}
                              {format(new Date(request.endDate), "MMM d")}
                            </p>
                          </div>
                          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 text-xs">
                            Pending
                          </Badge>
                        </div>
                      </Link>
                    );
                  })}
                  <Link
                    href={getOrganizationPath(currentOrganizationId, "/leave")}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="text-sm text-[rgb(133,133,133)] text-center py-4">
                  No pending leave requests
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Payroll Runs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Payroll Runs</CardTitle>
                <CardDescription>Latest processed</CardDescription>
              </div>
              <DollarSign className="h-5 w-5 text-green-400" />
            </CardHeader>
            <CardContent>
              {recentPayrollRuns && recentPayrollRuns.length > 0 ? (
                <div className="space-y-3">
                  {recentPayrollRuns.map((run: any) => (
                    <Link
                      key={run._id}
                      href={getOrganizationPath(
                        currentOrganizationId,
                        "/payroll"
                      )}
                      className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {format(new Date(run.cutoffStart), "MMM d")} -{" "}
                            {format(new Date(run.cutoffEnd), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
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
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="text-sm text-[rgb(133,133,133)] text-center py-4">
                  No payroll runs yet
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card className="mt-4 sm:mt-6">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">
              Quick Actions
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Link
                href={getOrganizationPath(currentOrganizationId, "/employees")}
              >
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                >
                  <UserPlus className="h-5 w-5 mr-3 text-blue-600" />
                  <div className="text-left">
                    <div className="font-medium">Add Employee</div>
                    <div className="text-xs text-gray-500">
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
                  className="w-full justify-start h-auto py-4"
                >
                  <DollarSign className="h-5 w-5 mr-3 text-green-600" />
                  <div className="text-left">
                    <div className="font-medium">Process Payroll</div>
                    <div className="text-xs text-gray-500">
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
                  className="w-full justify-start h-auto py-4"
                >
                  <Bell className="h-5 w-5 mr-3 text-purple-600" />
                  <div className="text-left">
                    <div className="font-medium">Create Announcement</div>
                    <div className="text-xs text-gray-500">
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
