"use client";

import { useState } from "react";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User,
  Building2,
  Wallet,
  Calendar as CalendarIcon,
  Briefcase,
  LogOut,
  Mail,
  Clock,
  KeyRound,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import type { Id } from "@/convex/_generated/dataModel";
import { authClient, signOutAndRedirectToLogin } from "@/lib/auth-client";
import { UserOrganizationsCard } from "@/components/user-organizations-card";
import { OrganizationManagement } from "@/components/organization-management";
import { PayrollSettingsContent } from "@/components/settings/payroll-settings-content";
import dynamic from "next/dynamic";
import { cn } from "@/utils/utils";
import { validateChangePasswordInput } from "@/utils/account-settings";
import { useToast } from "@/components/ui/use-toast";

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
const AttendanceShiftsSettingsContent = dynamic(
  () =>
    import("@/components/settings/attendance-shifts-settings-content").then(
      (m) => m.AttendanceShiftsSettingsContent,
    ),
  { ssr: false },
);

type SettingsSection =
  | "account"
  | "organizations"
  | "payroll"
  | "leave-types"
  | "departments"
  | "holidays"
  | "attendance-shifts";

type OrganizationRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "accounting"
  | "employee";

const ORG_ONLY_SETTINGS_SECTIONS = new Set<SettingsSection>([
  "organizations",
  "payroll",
  "leave-types",
  "departments",
  "holidays",
  "attendance-shifts",
]);

type ChangePasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  revokeOtherSessions: boolean;
};

const EMPTY_CHANGE_PASSWORD_FORM: ChangePasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  revokeOtherSessions: false,
};

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
  const { toast } = useToast();
  const { currentOrganizationId, clearOrganization } = useOrganization();
  const { effectiveSelfEmployeeId, isEmployeeExperienceUI } = useEmployeeView();
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    propInitialSection || "account",
  );
  const [passwordForm, setPasswordForm] = useState<ChangePasswordForm>(
    EMPTY_CHANGE_PASSWORD_FORM,
  );
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Update active section when initialSection prop changes
  React.useEffect(() => {
    if (propInitialSection && open) {
      setActiveSection(propInitialSection);
    }
  }, [propInitialSection, open]);

  React.useEffect(() => {
    if (
      open &&
      isEmployeeExperienceUI &&
      ORG_ONLY_SETTINGS_SECTIONS.has(activeSection)
    ) {
      setActiveSection("account");
    }
  }, [open, isEmployeeExperienceUI, activeSection]);

  React.useEffect(() => {
    if (!open) {
      setPasswordForm(EMPTY_CHANGE_PASSWORD_FORM);
      setIsChangingPassword(false);
    }
  }, [open]);

  const user = useQuery(
    api.organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const employeeRecord = useQuery(
    api.employees.getEmployee,
    currentOrganizationId && effectiveSelfEmployeeId
      ? {
          employeeId: effectiveSelfEmployeeId as Id<"employees">,
        }
      : "skip",
  );
  const companyEmployeeId = employeeRecord?.employment?.employeeId;

  const handleLogout = () => {
    onOpenChange(false);
    void signOutAndRedirectToLogin(clearOrganization);
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
      name: "Payroll",
      icon: Wallet,
      roles: ["admin", "hr", "accounting"],
    },
    {
      id: "leave-types" as SettingsSection,
      name: "Leave",
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
    {
      id: "attendance-shifts" as SettingsSection,
      name: "Attendance & Shifts",
      icon: Clock,
      roles: ["admin", "hr", "accounting"],
    },
  ];

  const updatePasswordForm = (
    field: keyof ChangePasswordForm,
    value: string,
  ) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isChangingPassword) return;

    const validation = validateChangePasswordInput(passwordForm);
    if (!validation.ok) {
      toast({
        title: "Password not updated",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: validation.value.currentPassword,
        newPassword: validation.value.newPassword,
        revokeOtherSessions: passwordForm.revokeOtherSessions,
      });

      if (result.error) {
        throw new Error(result.error.message || "Failed to change password.");
      }

      setPasswordForm(EMPTY_CHANGE_PASSWORD_FORM);
      toast({
        title: "Password updated",
        description: "Your account password has been changed.",
      });
    } catch (error: unknown) {
      toast({
        title: "Password not updated",
        description:
          error instanceof Error
            ? error.message
            : "Failed to change password.",
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

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
              <div className="space-y-4 sm:space-y-6">
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
                    {isEmployeeExperienceUI && (
                      <div className="border-t border-gray-100 pt-3 sm:pt-4 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-500">
                          <Briefcase className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          <span>Employee ID</span>
                        </div>
                        <div className="text-sm sm:text-base font-medium text-gray-900 pl-5 sm:pl-6 break-words">
                          {companyEmployeeId || "-"}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card className="border-gray-200">
                  <CardHeader className="pb-3 sm:pb-4 px-4 sm:px-6 pt-4 sm:pt-6">
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                      <KeyRound className="h-4 w-4 text-gray-500" />
                      <span>Change Password</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
                    <form
                      className="space-y-3 sm:space-y-4"
                      onSubmit={handleChangePassword}
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="current-password">
                          Current password
                        </Label>
                        <Input
                          id="current-password"
                          type="password"
                          autoComplete="current-password"
                          value={passwordForm.currentPassword}
                          onChange={(event) =>
                            updatePasswordForm(
                              "currentPassword",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="new-password">New password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          value={passwordForm.newPassword}
                          onChange={(event) =>
                            updatePasswordForm(
                              "newPassword",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="confirm-new-password">
                          Confirm new password
                        </Label>
                        <Input
                          id="confirm-new-password"
                          type="password"
                          autoComplete="new-password"
                          value={passwordForm.confirmPassword}
                          onChange={(event) =>
                            updatePasswordForm(
                              "confirmPassword",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="revoke-other-sessions"
                          checked={passwordForm.revokeOtherSessions}
                          onCheckedChange={(checked) =>
                            setPasswordForm((current) => ({
                              ...current,
                              revokeOtherSessions: checked === true,
                            }))
                          }
                        />
                        <Label
                          htmlFor="revoke-other-sessions"
                          className="cursor-pointer font-normal leading-5"
                        >
                          Sign out other sessions
                        </Label>
                      </div>
                      <Button
                        type="submit"
                        disabled={isChangingPassword}
                        className="w-full sm:w-auto"
                      >
                        {isChangingPassword ? "Updating..." : "Update Password"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
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
                Payroll
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Configure payroll
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
                Leave
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Configure proration rules used by the leave tracker.
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
      case "attendance-shifts":
        return (
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">
                Attendance & Shifts
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Default lunch break and shift-specific lunch windows for late/undertime and paid hours
              </p>
            </div>
            <AttendanceShiftsSettingsContent />
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
                if (isEmployeeExperienceUI) return null;
                const effectiveRole: OrganizationRole | undefined =
                  user?.role === "owner"
                    ? "admin"
                    : (user?.role as OrganizationRole | undefined);
                const visibleOrgItems = organizationSettingsItems.filter(
                  (item) =>
                    !item.roles ||
                    (!!effectiveRole && item.roles.includes(effectiveRole)),
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
                        {visibleOrgItems.map((item) => {
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
                className={cn(
                  "w-full flex items-center justify-center lg:justify-start gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap lg:w-full",
                  "text-gray-700 hover:bg-gray-100 font-medium",
                )}
                style={{
                  fontFamily:
                    '-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                }}
              >
                <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
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
