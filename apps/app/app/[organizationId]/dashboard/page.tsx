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
  Calendar,
  DollarSign,
  UserPlus,
  Clock,
  ArrowRight,
  Bell,
  CheckCircle2,
  Users,
  PlaneTakeoff,
  Sparkles,
} from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  eachDayOfInterval,
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import Link from "next/link";
import {
  DashboardOverviewHeader,
  DashboardMetricCard,
  type DateRangeOption,
} from "@/components/dashboard";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Dashboard view for accounting role: payroll, expense management, announcements */
function AccountingDashboard({
  organizationId,
  recentAnnouncements,
  recentPayrollRuns,
  dateRange,
  onDateRangeChange,
}: {
  organizationId: string;
  recentAnnouncements: any[];
  recentPayrollRuns: any[];
  dateRange: DateRangeOption;
  onDateRangeChange: (v: DateRangeOption) => void;
}) {
  const costItems = useQuery(
    (api as any).accounting.getCostItems,
    organizationId ? { organizationId: organizationId as any } : "skip",
  );
  const items = costItems ?? [];
  const totalPending = items
    .filter((i: any) => i.status !== "paid")
    .reduce(
      (sum: number, i: any) => sum + (i.amount ?? 0) - (i.amountPaid ?? 0),
      0,
    );

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
          exploreHref={getOrganizationPath(organizationId, "/payroll")}
          exploreLabel="Explore"
          moreDetailsHref={getOrganizationPath(organizationId, "/payroll")}
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
          exploreHref={getOrganizationPath(organizationId, "/accounting")}
          exploreLabel="Explore"
          moreDetailsHref={getOrganizationPath(organizationId, "/accounting")}
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
                    href={getOrganizationPath(organizationId, "/payroll")}
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
                  href={getOrganizationPath(organizationId, "/payroll")}
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
                    href={getOrganizationPath(organizationId, "/announcements")}
                    className="block rounded-lg border border-[rgb(230,230,230)] p-3 transition-colors hover:bg-[rgb(250,250,250)]"
                  >
                    <p className="truncate text-sm font-medium text-[rgb(64,64,64)]">
                      {announcement.title}
                    </p>
                    <p className="mt-1 text-xs text-[rgb(133,133,133)]">
                      {format(
                        new Date(announcement.publishedDate),
                        "MMM d, yyyy",
                      )}
                    </p>
                  </Link>
                ))}
                <Link
                  href={getOrganizationPath(organizationId, "/announcements")}
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

const chartPalette = {
  blue: "#4254ff",
  cyan: "#18b5d6",
  mint: "#3ecf8e",
  gold: "#f4b740",
  slate: "#5f6c8d",
  surface: "#ffffff",
  border: "#e7ebf3",
  muted: "#6b7285",
  grid: "#eef2f8",
};

function StripeKpiCard({
  title,
  value,
  meta,
  accent,
}: {
  title: string;
  value: React.ReactNode;
  meta: React.ReactNode;
  accent: React.ReactNode;
}) {
  return (
    <Card className="border-[#dfe3ea] bg-[#f7f8fb] shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b7285]">
              {title}
            </p>
            <div className="text-3xl font-semibold tracking-tight text-[#101828]">
              {value}
            </div>
            <p className="text-sm text-[#667085]">{meta}</p>
          </div>
          <div className="rounded-2xl border border-[#e3e7ef] bg-[#f1f4f8] p-3 text-[#4254ff]">
            {accent}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPanel({
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-[#dfe3ea] bg-white shadow-none ${className}`}>
      <CardHeader className="space-y-3 border-b border-[#e6eaf1] pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7b8298]">
              {eyebrow}
            </p>
            <CardTitle className="mt-2 text-xl font-semibold text-[#101828]">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-sm text-[#667085]">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { effectiveOrganizationId, currentOrganization } = useOrganization();

  // Get user first - needed for conditional queries below
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  // Only query employees if user has HR/admin/accounting role
  // This prevents "Not authorized" errors for employees
  const allowedRolesForEmployees = ["admin", "hr", "accounting", "owner"];
  const employees = useQuery(
    (api as any).employees.getEmployees,
    effectiveOrganizationId &&
      user &&
      user.role &&
      allowedRolesForEmployees.includes(user.role)
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  const canViewOrgLeaveQueue = (role: string | undefined) =>
    role === "admin" ||
    role === "hr" ||
    role === "owner" ||
    role === "accounting";

  const leaveQueryArgs =
    effectiveOrganizationId && user
      ? canViewOrgLeaveQueue(user.role)
        ? {
            organizationId: effectiveOrganizationId,
            status: "pending" as const,
          }
        : user.role === "employee" && user.employeeId
          ? {
              organizationId: effectiveOrganizationId,
              employeeId: user.employeeId,
              status: "pending" as const,
            }
          : null
      : null;

  const leaveRequests = useQuery(
    (api as any).leave.getLeaveRequests,
    leaveQueryArgs ?? "skip",
  );

  // Get recent announcements
  const announcements = useQuery(
    (api as any).announcements.getAnnouncements,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  const canViewEvaluations = (role: string | undefined) =>
    role === "admin" ||
    role === "hr" ||
    role === "owner" ||
    role === "accounting";

  const evaluations = useQuery(
    (api as any).evaluations.getEvaluations,
    effectiveOrganizationId && user && canViewEvaluations(user.role)
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  // Only query payroll runs if user has HR/admin/accounting role
  const allowedRolesForPayroll = ["admin", "hr", "accounting", "owner"];
  const payrollRuns = useQuery(
    (api as any).payroll.getPayrollRuns,
    effectiveOrganizationId &&
      user &&
      user.role &&
      allowedRolesForPayroll.includes(user.role)
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  // Redirect employee and accounting to announcements (admin/owner/hr stay on dashboard)
  useEffect(() => {
    if (
      user &&
      effectiveOrganizationId &&
      (user.role === "employee" || user.role === "accounting")
    ) {
      router.replace(
        getOrganizationPath(effectiveOrganizationId, "/announcements"),
      );
    }
  }, [user, effectiveOrganizationId, router]);

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

  type UpcomingEvalItem = {
    employeeId: string;
    employeeName: string;
    date: number;
    label: string;
  };

  const upcomingEvaluations = useMemo((): UpcomingEvalItem[] => {
    if (!evaluations || !employees) return [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getTime();
    const today = now.getTime();

    return (evaluations || [])
      .filter(
        (e: any) =>
          e.evaluationDate > today &&
          e.evaluationDate >= monthStart &&
          e.evaluationDate <= monthEnd,
      )
      .map((e: any) => {
        const emp = employees?.find((em: any) => em._id === e.employeeId);
        const first = emp?.personalInfo?.firstName ?? "";
        const last = emp?.personalInfo?.lastName ?? "";
        const name = `${first} ${last}`.trim();
        return {
          employeeId: e.employeeId,
          employeeName: name || "Unknown",
          date: e.evaluationDate,
          label: e.label,
        };
      })
      .sort((a: UpcomingEvalItem, b: UpcomingEvalItem) => a.date - b.date);
  }, [evaluations, employees]);

  const [dateRange, setDateRange] = useState<DateRangeOption>("7");
  const rangeDays = Number(dateRange);

  const now = useMemo(() => new Date(), []);
  const rangeStart = useMemo(
    () => startOfDay(subDays(now, rangeDays - 1)).getTime(),
    [now, rangeDays],
  );
  const previousRangeStart = useMemo(
    () => startOfDay(subDays(now, rangeDays * 2 - 1)).getTime(),
    [now, rangeDays],
  );
  const previousRangeEnd = useMemo(
    () => endOfDay(subDays(now, rangeDays)).getTime(),
    [now, rangeDays],
  );

  const inRange = (value: number | undefined, start: number, end: number) =>
    typeof value === "number" && value >= start && value <= end;

  const totalEmployees = employees?.length ?? 0;
  const recentHireCount = (employees ?? []).filter((employee: any) =>
    inRange(employee?.employment?.hireDate, rangeStart, Date.now()),
  ).length;
  const previousHireCount = (employees ?? []).filter((employee: any) =>
    inRange(
      employee?.employment?.hireDate,
      previousRangeStart,
      previousRangeEnd,
    ),
  ).length;
  const payrollInRange = (payrollRuns ?? []).filter((run: any) =>
    inRange(run?.createdAt, rangeStart, Date.now()),
  );
  const previousPayrollInRange = (payrollRuns ?? []).filter((run: any) =>
    inRange(run?.createdAt, previousRangeStart, previousRangeEnd),
  );
  const pendingLeaveCount = recentLeaveRequests.length;

  const activitySeries = useMemo(() => {
    const dayBuckets = eachDayOfInterval({
      start: startOfDay(subDays(now, rangeDays - 1)),
      end: startOfDay(now),
    });

    return dayBuckets.map((bucketDate) => {
      const bucketStart = startOfDay(bucketDate).getTime();
      const bucketEnd = endOfDay(bucketDate).getTime();
      const hires = (employees ?? []).filter((employee: any) =>
        inRange(employee?.employment?.hireDate, bucketStart, bucketEnd),
      ).length;
      const payroll = (payrollRuns ?? []).filter((run: any) =>
        inRange(run?.createdAt, bucketStart, bucketEnd),
      ).length;
      const leave = recentLeaveRequests.filter((request: any) =>
        inRange(
          request?.createdAt ?? request?.startDate,
          bucketStart,
          bucketEnd,
        ),
      ).length;

      return {
        label: format(bucketDate, rangeDays <= 30 ? "MMM d" : "MMM d"),
        hires,
        payroll,
        leave,
      };
    });
  }, [employees, now, payrollRuns, rangeDays, recentLeaveRequests]);

  const leaveTypeData = useMemo(() => {
    const counts = new Map<string, number>();
    recentLeaveRequests.forEach((request: any) => {
      const key = request?.leaveType || "Other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [recentLeaveRequests]);

  const payrollStatusData = useMemo(() => {
    const source =
      payrollInRange.length > 0 ? payrollInRange : (payrollRuns ?? []);
    const buckets = ["draft", "processing", "finalized", "paid", "archived"];
    return buckets
      .map((status) => ({
        status,
        value: source.filter((run: any) => run.status === status).length,
      }))
      .filter((item) => item.value > 0);
  }, [payrollInRange, payrollRuns]);

  const operationsShareData = useMemo(
    () =>
      [
        {
          name: "Team",
          value: totalEmployees,
          color: chartPalette.blue,
        },
        {
          name: "Pending leave",
          value: pendingLeaveCount,
          color: chartPalette.cyan,
        },
        {
          name: "Payroll runs",
          value: payrollInRange.length,
          color: chartPalette.mint,
        },
        {
          name: "Announcements",
          value: recentAnnouncements.length,
          color: chartPalette.gold,
        },
      ].filter((item) => item.value > 0),
    [
      pendingLeaveCount,
      payrollInRange.length,
      recentAnnouncements.length,
      totalEmployees,
    ],
  );

  if (!effectiveOrganizationId) return null;

  // Avoid rendering HR/accounting dashboard before role is known (prevents post-login races / errors).
  if (user === undefined) {
    return (
      <MainLayout>
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <p className="text-sm text-[rgb(133,133,133)]">Loading…</p>
        </div>
      </MainLayout>
    );
  }

  if (user === null) {
    return (
      <MainLayout>
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <p className="text-sm text-[rgb(133,133,133)]">
            Unable to load your account.
          </p>
        </div>
      </MainLayout>
    );
  }

  // Employee: redirecting (handled in useEffect)
  if (user.role === "employee") {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-[rgb(133,133,133)]">Redirecting...</div>
        </div>
      </MainLayout>
    );
  }

  // Accounting: separate dashboard (payroll, expense management, announcements)
  if (user.role === "accounting") {
    return (
      <MainLayout>
        <AccountingDashboard
          organizationId={effectiveOrganizationId}
          recentAnnouncements={recentAnnouncements}
          recentPayrollRuns={recentPayrollRuns}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-white p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="border-b border-[#e6eaf1] pb-4">
            <h1 className="text-3xl font-semibold tracking-tight text-[#101828]">
              Your overview
            </h1>
          </div>

          <div className="bg-[#f7f8fb] rounded-lg p-2">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StripeKpiCard
                title="Headcount"
                value={totalEmployees.toLocaleString()}
                meta={`${recentHireCount} joined in the last ${rangeDays} days`}
                accent={<Users className="h-5 w-5" />}
              />
              <StripeKpiCard
                title="New hires"
                value={recentHireCount.toLocaleString()}
                meta={`${Math.max(recentHireCount - previousHireCount, 0)} more than previous period`}
                accent={<UserPlus className="h-5 w-5" />}
              />
              <StripeKpiCard
                title="Pending leave"
                value={pendingLeaveCount.toLocaleString()}
                meta="Open requests still waiting on action"
                accent={<PlaneTakeoff className="h-5 w-5" />}
              />
              <StripeKpiCard
                title="Payroll flow"
                value={payrollInRange.length.toLocaleString()}
                meta={`${previousPayrollInRange.length} runs in the previous period`}
                accent={<DollarSign className="h-5 w-5" />}
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-12">
              <DashboardPanel
                eyebrow="Activity"
                title="People and operations trend"
                description="Daily movement across hires, payroll runs, and pending leave demand."
                className="xl:col-span-8"
              >
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activitySeries}>
                      <defs>
                        <linearGradient
                          id="hiresFill"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={chartPalette.blue}
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="100%"
                            stopColor={chartPalette.blue}
                            stopOpacity={0.03}
                          />
                        </linearGradient>
                        <linearGradient
                          id="payrollFill"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={chartPalette.mint}
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="100%"
                            stopColor={chartPalette.mint}
                            stopOpacity={0.03}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke={chartPalette.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 16,
                          border: `1px solid ${chartPalette.border}`,
                          boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="hires"
                        stroke={chartPalette.blue}
                        strokeWidth={2.5}
                        fill="url(#hiresFill)"
                      />
                      <Area
                        type="monotone"
                        dataKey="payroll"
                        stroke={chartPalette.mint}
                        strokeWidth={2.5}
                        fill="url(#payrollFill)"
                      />
                      <Area
                        type="monotone"
                        dataKey="leave"
                        stroke={chartPalette.cyan}
                        strokeWidth={2.2}
                        fillOpacity={0}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </DashboardPanel>

              <DashboardPanel
                eyebrow="Composition"
                title="Operations mix"
                description="A compact read on where the current workload is concentrated."
                className="xl:col-span-4"
              >
                <div className="grid gap-5">
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={operationsShareData}
                          dataKey="value"
                          innerRadius={54}
                          outerRadius={82}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {operationsShareData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            borderRadius: 16,
                            border: `1px solid ${chartPalette.border}`,
                            boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-3">
                    {operationsShareData.map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center justify-between rounded-2xl border border-[#e3e7ed] bg-[#f3f4f6] px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-sm font-medium text-[#344054]">
                            {item.name}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-[#101828]">
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </DashboardPanel>

              <DashboardPanel
                eyebrow="Leave"
                title="Pending leave by type"
                description="Where your current approval queue is clustering."
                className="xl:col-span-4"
              >
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leaveTypeData}>
                      <CartesianGrid
                        stroke={chartPalette.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 16,
                          border: `1px solid ${chartPalette.border}`,
                        }}
                      />
                      <Bar
                        dataKey="value"
                        fill={chartPalette.cyan}
                        radius={[10, 10, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardPanel>

              <DashboardPanel
                eyebrow="Payroll"
                title="Run status spread"
                description="How runs are currently distributed across the payroll pipeline."
                className="xl:col-span-4"
              >
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={payrollStatusData}>
                      <CartesianGrid
                        stroke={chartPalette.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="status"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        tick={{ fill: chartPalette.muted, fontSize: 12 }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 16,
                          border: `1px solid ${chartPalette.border}`,
                        }}
                      />
                      <Bar
                        dataKey="value"
                        fill={chartPalette.blue}
                        radius={[10, 10, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardPanel>

              <DashboardPanel
                eyebrow="Calendar"
                title="Upcoming evaluations"
                description="The next check-ins that need attention this month."
                className="xl:col-span-4"
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-[#4254ff] hover:bg-[#eef1ff]"
                  >
                    <Link
                      href={getOrganizationPath(
                        effectiveOrganizationId,
                        "/evaluations",
                      )}
                    >
                      View all
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-3">
                  {upcomingEvaluations.length > 0 ? (
                    upcomingEvaluations.slice(0, 4).map((item) => (
                      <button
                        key={`${item.employeeId}-${item.label}-${item.date}`}
                        type="button"
                        onClick={() => {
                          const base = getOrganizationPath(
                            effectiveOrganizationId,
                            "/evaluations",
                          );
                          const url = `${base}?employeeId=${encodeURIComponent(
                            item.employeeId,
                          )}&label=${encodeURIComponent(
                            item.label,
                          )}&evaluationDate=${item.date}`;
                          router.push(url);
                        }}
                        className="flex w-full items-center justify-between rounded-2xl border border-[#e3e7ed] bg-[#f3f4f6] px-4 py-3 text-left transition-colors hover:bg-[#f7f8fb]"
                      >
                        <div>
                          <p className="text-sm font-medium text-[#101828]">
                            {item.employeeName}
                          </p>
                          <p className="mt-1 text-xs text-[#667085]">
                            {item.label}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[#344054]">
                            {format(new Date(item.date), "MMM d")}
                          </p>
                          <p className="mt-1 text-xs text-[#98a2b3]">
                            {format(new Date(item.date), "yyyy")}
                          </p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#d8dee7] bg-[#f3f4f6] px-4 py-8 text-center text-sm text-[#667085]">
                      No evaluations due this month.
                    </div>
                  )}
                </div>
              </DashboardPanel>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <DashboardPanel
                eyebrow="Queue"
                title="Pending leave requests"
                description="The specific requests sitting in your approval queue."
                action={
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-[#4254ff] hover:bg-[#eef1ff]"
                  >
                    <Link
                      href={getOrganizationPath(
                        effectiveOrganizationId,
                        "/leave",
                      )}
                    >
                      Open leave
                    </Link>
                  </Button>
                }
              >
                <div className="space-y-3">
                  {recentLeaveRequests.length > 0 ? (
                    recentLeaveRequests.map((request: any) => {
                      const employee = employees?.find(
                        (emp: any) => emp._id === request.employeeId,
                      );
                      return (
                        <Link
                          key={request._id}
                          href={getOrganizationPath(
                            effectiveOrganizationId,
                            "/leave",
                          )}
                          className="flex items-start justify-between rounded-2xl border border-[#e3e7ed] bg-[#f3f4f6] px-4 py-3 transition-colors hover:bg-[#f7f8fb]"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#101828]">
                              {employee?.personalInfo?.firstName}{" "}
                              {employee?.personalInfo?.lastName}
                            </p>
                            <p className="mt-1 text-xs text-[#667085]">
                              {request.leaveType} ·{" "}
                              {format(new Date(request.startDate), "MMM d")} -{" "}
                              {format(new Date(request.endDate), "MMM d")}
                            </p>
                          </div>
                          <Badge className="rounded-full bg-[#fff3e8] px-2.5 py-1 text-[#b54708] hover:bg-[#fff3e8]">
                            Pending
                          </Badge>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#d8dee7] bg-[#f3f4f6] px-4 py-8 text-center text-sm text-[#667085]">
                      No pending leave requests right now.
                    </div>
                  )}
                </div>
              </DashboardPanel>

              <DashboardPanel
                eyebrow="Updates"
                title="Payroll and company updates"
                description="Recent payroll runs and announcements in one place."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#101828]">
                      <CheckCircle2 className="h-4 w-4 text-[#3ecf8e]" />
                      Recent payroll runs
                    </div>
                    {recentPayrollRuns.length > 0 ? (
                      recentPayrollRuns.map((run: any) => (
                        <Link
                          key={run._id}
                          href={getOrganizationPath(
                            effectiveOrganizationId,
                            "/payroll",
                          )}
                          className="block rounded-2xl border border-[#e3e7ed] bg-[#f3f4f6] px-4 py-3 transition-colors hover:bg-[#f7f8fb]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-[#101828]">
                                {format(new Date(run.cutoffStart), "MMM d")} -{" "}
                                {format(new Date(run.cutoffEnd), "MMM d, yyyy")}
                              </p>
                              <p className="mt-1 text-xs text-[#667085]">
                                Created{" "}
                                {format(new Date(run.createdAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-[#d9e0ee] bg-white text-[#475467]"
                            >
                              {run.status}
                            </Badge>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[#d8dee7] bg-[#f3f4f6] px-4 py-8 text-center text-sm text-[#667085]">
                        No payroll runs yet.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#101828]">
                      <Sparkles className="h-4 w-4 text-[#4254ff]" />
                      Recent announcements
                    </div>
                    {recentAnnouncements.length > 0 ? (
                      recentAnnouncements
                        .slice(0, 4)
                        .map((announcement: any) => (
                          <Link
                            key={announcement._id}
                            href={getOrganizationPath(
                              effectiveOrganizationId,
                              "/announcements",
                            )}
                            className="block rounded-2xl border border-[#e3e7ed] bg-[#f3f4f6] px-4 py-3 transition-colors hover:bg-[#f7f8fb]"
                          >
                            <p className="truncate text-sm font-medium text-[#101828]">
                              {announcement.title}
                            </p>
                            <p className="mt-1 text-xs text-[#667085]">
                              {format(
                                new Date(announcement.publishedDate),
                                "MMM d, yyyy",
                              )}
                            </p>
                          </Link>
                        ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[#d8dee7] bg-[#f3f4f6] px-4 py-8 text-center text-sm text-[#667085]">
                        No announcements published yet.
                      </div>
                    )}
                  </div>
                </div>
              </DashboardPanel>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
