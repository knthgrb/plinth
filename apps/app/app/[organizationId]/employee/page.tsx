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
import { Receipt, Calendar, FileText, Bell, MessageCircle } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function EmployeePage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  // Redirect if not employee
  useEffect(() => {
    if (user !== undefined && user && user.role !== "employee") {
      router.push("/forbidden");
    }
  }, [user, router]);

  // Get employee's payslips count
  const payslips = useQuery(
    (api as any).payroll.getEmployeePayslips,
    user?.employeeId
      ? {
          employeeId: user.employeeId,
        }
      : "skip"
  );

  // Get employee's leave requests
  const leaveRequests = useQuery(
    (api as any).leave.getLeaveRequests,
    currentOrganizationId && user?.employeeId
      ? {
          organizationId: currentOrganizationId,
          employeeId: user.employeeId,
        }
      : "skip"
  );

  if (!currentOrganizationId) return null;

  // Show loading or redirect if not employee
  if (user === undefined) {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </MainLayout>
    );
  }

  if (!user || user.role !== "employee") {
    return null; // Will redirect to forbidden
  }

  const quickLinks = [
    {
      title: "View Payslips",
      description: "Access your payslip history",
      icon: Receipt,
      href: "/payslips",
      color: "text-blue-600",
    },
    {
      title: "Request Leave",
      description: "Submit a leave request",
      icon: Calendar,
      href: "/leave",
      color: "text-green-600",
    },
    {
      title: "Documents",
      description: "View your documents",
      icon: FileText,
      href: "/documents",
      color: "text-purple-600",
    },
    {
      title: "Announcements",
      description: "View company announcements",
      icon: Bell,
      href: "/documents",
      color: "text-orange-600",
    },
    {
      title: "Chat",
      description: "Message your colleagues",
      icon: MessageCircle,
      href: "/chat",
      color: "text-indigo-600",
    },
  ];

  const stats = [
    {
      title: "Total Payslips",
      value: payslips?.length || 0,
      icon: Receipt,
      color: "text-blue-600",
    },
    {
      title: "Pending Leave Requests",
      value:
        leaveRequests?.filter((req: any) => req.status === "pending").length ||
        0,
      icon: Calendar,
      color: "text-orange-600",
    },
  ];

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome</h1>
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-8">
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

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {quickLinks.map((link) => (
              <Card
                key={link.title}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <link.icon className={`h-5 w-5 ${link.color}`} />
                    <CardTitle className="text-lg">{link.title}</CardTitle>
                  </div>
                  <CardDescription>{link.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={link.href}>
                    <Button variant="outline" className="w-full">
                      Go to {link.title}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your recent activity and updates</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-500">
              {payslips && payslips.length > 0 ? (
                <div className="space-y-2">
                  <p>Latest payslip: {payslips[0]?.period || "N/A"}</p>
                </div>
              ) : (
                "No recent activity"
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
