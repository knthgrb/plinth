"use client";

import { useState } from "react";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  User,
  Building2,
  Wallet,
  Calendar as CalendarIcon,
  Briefcase,
  LogOut,
  X,
  Mail,
  Shield,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { authClient } from "@/lib/auth-client";
import { UserOrganizationsCard } from "@/components/user-organizations-card";
import { OrganizationManagement } from "@/components/organization-management";
import { PayrollSettingsContent } from "@/components/settings/payroll-settings-content";
import dynamic from "next/dynamic";
import { cn } from "@/utils/utils";

// Dynamically import settings content components to reduce initial bundle size
const LeaveTypesSettingsContent = dynamic(
  () =>
    import("@/components/settings/leave-types-settings-content").then(
      (m) => m.LeaveTypesSettingsContent,
    ),
  { ssr: false },
);
const DepartmentsSettingsContent = dynamic(
  () =>
    import("@/components/settings/departments-settings-content").then(
      (m) => m.DepartmentsSettingsContent,
    ),
  { ssr: false },
);
const HolidaysSettingsContent = dynamic(
  () =>
    import("@/components/settings/holidays-settings-content").then(
      (m) => m.HolidaysSettingsContent,
    ),
  { ssr: false },
);

type SettingsSection =
  | "account"
  | "organizations"
  | "payroll"
  | "leave-types"
  | "departments"
  | "holidays";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialSection: propInitialSection,
}: SettingsModalProps) {
  const { currentOrganizationId, clearOrganization } = useOrganization();
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    propInitialSection || "account",
  );

  // Update active section when initialSection prop changes
  React.useEffect(() => {
    if (propInitialSection && open) {
      setActiveSection(propInitialSection);
    }
  }, [propInitialSection, open]);

  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const handleLogout = async () => {
    clearOrganization();
    onOpenChange(false);
    await authClient.signOut();
    // Full page navigation avoids React "fewer hooks" error (#300) when auth state flips to unauthenticated
    window.location.href = "/login";
  };

  const userInitials =
    user?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ||
    user?.email?.[0].toUpperCase() ||
    "U";

  const isAdmin =
    user?.role === "admin" ||
    user?.role === "hr" ||
    user?.role === "accounting";

  // Helper function to get display role name
  const getDisplayRole = (role: string | undefined) => {
    if (role === "admin" || role === "owner") return "Owner";
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";
  };

  const userSettingsItems = [
    { id: "account" as SettingsSection, name: "Account Settings", icon: User },
  ];

  const organizationSettingsItems = [
    {
      id: "organizations" as SettingsSection,
      name: "Organization",
      icon: Building2,
      roles: ["admin", "hr"],
    },
    {
      id: "payroll" as SettingsSection,
      name: "Payroll Settings",
      icon: Wallet,
      roles: ["admin", "hr", "accounting"],
    },
    {
      id: "leave-types" as SettingsSection,
      name: "Leave Types",
      icon: CalendarIcon,
      roles: ["admin", "hr", "accounting"],
    },
    {
      id: "departments" as SettingsSection,
      name: "Departments",
      icon: Briefcase,
      roles: ["admin", "hr", "accounting"],
    },
    {
      id: "holidays" as SettingsSection,
      name: "Holidays",
      icon: CalendarIcon,
      roles: ["admin", "hr", "accounting"],
    },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case "account":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Account Settings
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Manage your account information
              </p>
            </div>
            <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
              <Card className="border-gray-200">
                <CardHeader className="pb-3 sm:pb-4 px-4 sm:px-6 pt-4 sm:pt-6">
                  <CardTitle className="text-base sm:text-lg">
                    Account Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 sm:space-y-5 px-4 sm:px-6 pb-4 sm:pb-6">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-500">
                      <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>Name</span>
                    </div>
                    <div className="text-sm sm:text-base font-medium text-gray-900 pl-5 sm:pl-6 break-words">
                      {user?.name || user?.email || "-"}
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-3 sm:pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-500">
                      <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>Email</span>
                    </div>
                    <div className="text-sm sm:text-base font-medium text-gray-900 pl-5 sm:pl-6 break-words">
                      {user?.email || "-"}
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-3 sm:pt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-500">
                      <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>Role</span>
                    </div>
                    <div className="pl-5 sm:pl-6">
                      <Badge
                        variant="secondary"
                        className="text-xs sm:text-sm font-medium"
                      >
                        {getDisplayRole(user?.role)}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <UserOrganizationsCard />
            </div>
          </div>
        );
      case "organizations":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Organization Settings
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Manage your organizations
              </p>
            </div>
            <div className="max-w-4xl">
              <OrganizationManagement />
            </div>
          </div>
        );
      case "payroll":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Payroll Settings
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Configure payroll settings
              </p>
            </div>
            <PayrollSettingsContent />
          </div>
        );
      case "leave-types":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Leave Types
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Manage leave types and configurations
              </p>
            </div>
            <LeaveTypesSettingsContent />
          </div>
        );
      case "departments":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Departments
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Manage organization departments
              </p>
            </div>
            <DepartmentsSettingsContent />
          </div>
        );
      case "holidays":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Holidays
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Manage holidays and special dates
              </p>
            </div>
            <HolidaysSettingsContent />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Settings</DialogTitle>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl lg:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="flex flex-col lg:flex-row h-full overflow-hidden">
          {/* Left Sidebar */}
          <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50 flex flex-col shrink-0 max-h-[40vh] lg:max-h-none">
            {/* User Info Header */}
            <div className="p-3 sm:p-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
                  <AvatarFallback className="bg-brand-purple text-white text-xs sm:text-sm">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium truncate">
                    {user?.name || user?.email || "User"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-500 truncate">
                    {getDisplayRole(user?.role)}
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1 mb-3 sm:mb-4">
                <div
                  className="px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  style={{
                    fontFamily:
                      '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  }}
                >
                  User Settings
                </div>
                <div className="flex lg:flex-col gap-1 lg:gap-0 overflow-x-auto lg:overflow-x-visible">
                  {userSettingsItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        className={cn(
                          "flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap lg:w-full",
                          activeSection === item.id
                            ? "bg-gray-100 text-gray-900 font-semibold"
                            : "text-gray-700 hover:bg-gray-100 font-medium",
                        )}
                        style={{
                          fontFamily:
                            '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                        }}
                      >
                        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                        <span className="hidden sm:inline">{item.name}</span>
                        <span className="sm:hidden">
                          {item.name.split(" ")[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {(() => {
                const effectiveRole =
                  user?.role === "owner" ? "admin" : user?.role;
                const visibleOrgItems = organizationSettingsItems.filter(
                  (item) =>
                    !item.roles || item.roles.includes(effectiveRole as any),
                );
                if (visibleOrgItems.length === 0) return null;
                return (
                  <>
                    <Separator className="my-3 sm:my-4" />
                    <div className="space-y-1">
                      <div
                        className="px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider"
                        style={{
                          fontFamily:
                            '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                        }}
                      >
                        Organization Settings
                      </div>
                      <div className="flex lg:flex-col gap-1 lg:gap-0 overflow-x-auto lg:overflow-x-visible">
                        {organizationSettingsItems.map((item) => {
                          const Icon = item.icon;
                          const hasAccess =
                            !item.roles ||
                            item.roles.includes(effectiveRole as any);
                          if (!hasAccess) return null;
                          return (
                            <button
                              key={item.id}
                              onClick={() => setActiveSection(item.id)}
                              className={cn(
                                "flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap lg:w-full",
                                activeSection === item.id
                                  ? "bg-gray-100 text-gray-900 font-semibold"
                                  : "text-gray-700 hover:bg-gray-100 font-medium",
                              )}
                              style={{
                                fontFamily:
                                  '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                              }}
                            >
                              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                              <span className="hidden sm:inline">
                                {item.name}
                              </span>
                              <span className="sm:hidden">
                                {item.name.split(" ")[0]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Log Out */}
            <div className="p-2 border-t border-gray-200 shrink-0">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center lg:justify-start gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-purple-600 hover:bg-purple-50 rounded-md transition-colors font-medium"
                style={{
                  fontFamily:
                    '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                }}
              >
                <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span>Log out</span>
              </button>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {renderContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
