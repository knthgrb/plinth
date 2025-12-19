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
import { Users, Calendar, FileText, Briefcase } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganization();

  const employees = useQuery(
    (api as any).employees.getEmployees,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const leaveRequests = useQuery(
    (api as any).leave.getLeaveRequests,
    currentOrganizationId
      ? { organizationId: currentOrganizationId, status: "pending" }
      : "skip"
  );
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  // Redirect based on role
  useEffect(() => {
    if (user && currentOrganizationId) {
      if (user.role === "employee") {
        router.replace("/announcements");
        return;
      } else if (user.role === "accounting") {
        router.replace("/accounting");
        return;
      }
    }
  }, [user, currentOrganizationId, router]);

  if (!currentOrganizationId) return null;

  // Don't render dashboard content if user should be redirected
  if (user?.role === "employee" || user?.role === "accounting") {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-gray-500">Redirecting...</div>
        </div>
      </MainLayout>
    );
  }

  const stats = [
    {
      title: "Total Employees",
      value: employees?.length || 0,
      icon: Users,
      color: "text-blue-600",
    },
    {
      title: "Pending Leave Requests",
      value: leaveRequests?.length || 0,
      icon: Calendar,
      color: "text-orange-600",
    },
    {
      title: "Active Jobs",
      value: 0,
      icon: Briefcase,
      color: "text-green-600",
    },
    {
      title: "Recent Memos",
      value: 0,
      icon: FileText,
      color: "text-purple-600",
    },
  ];

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Welcome back{user?.name ? `, ${user.name}` : ""} -{" "}
            {currentOrganization?.name}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {stats.map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Latest updates in your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-500">No recent activity</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm text-gray-600">• Add new employee</div>
                <div className="text-sm text-gray-600">• Process payroll</div>
                <div className="text-sm text-gray-600">• Create memo</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
