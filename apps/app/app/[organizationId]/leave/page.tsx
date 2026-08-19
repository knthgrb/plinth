"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import {
  CalendarRange,
  ClipboardCheck,
  Landmark,
  WalletCards,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { useOrganization } from "@/hooks/organization-context";
import {
  getLeaveAdminTabs,
  getLeaveWorkspaceMode,
  shouldShowEmployeeLeaveWorkspace,
  type LeaveAdminTab,
  type OrganizationRole,
} from "@/lib/leave/admin-workspace";
import { EmployeeBalanceLedger } from "./_components/employee-balance-ledger";
import { EmployeeLeaveDashboard } from "./_components/employee-leave-dashboard";
import { LeaveApprovalInbox } from "./_components/leave-approval-inbox";
import { LeaveBenefitReconciliation } from "./_components/leave-benefit-reconciliation";
import { LeaveCalendar } from "./_components/leave-calendar";
import { LeaveConversionQueue } from "./_components/leave-conversion-queue";
import { LegacyLeaveWorkspace } from "./_components/legacy-leave-workspace";

const adminTabDetails: Record<
  LeaveAdminTab,
  { label: string; icon: typeof ClipboardCheck }
> = {
  approvals: { label: "Approval inbox", icon: ClipboardCheck },
  balances: { label: "Balance ledger", icon: WalletCards },
  conversions: { label: "Conversions", icon: Landmark },
  calendar: { label: "Calendar", icon: CalendarRange },
};

export default function LeavePage() {
  const { currentOrganizationId, currentOrganization } = useOrganization();
  const { effectiveSelfEmployeeId, isEmployeeExperienceUI } = useEmployeeView();
  const [activeTab, setActiveTab] = useState<LeaveAdminTab>("approvals");
  const user = useQuery(
    api.organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const engineStatus = useQuery(
    api.leave.getLeaveEngineStatus,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const role = user?.role as OrganizationRole | undefined;
  const adminTabs = role ? getLeaveAdminTabs(role) : [];
  const isAdministrator = adminTabs.length > 0;
  const employeeId =
    effectiveSelfEmployeeId ??
    user?.employeeId ??
    currentOrganization?.employeeId ??
    null;
  const showEmployeeWorkspace = shouldShowEmployeeLeaveWorkspace({
    role,
    isEmployeeExperienceUI,
  });

  if (
    !currentOrganizationId ||
    user === undefined ||
    engineStatus === undefined
  ) {
    return (
      <MainLayout>
        <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
          Loading leave workspace…
        </div>
      </MainLayout>
    );
  }

  if (getLeaveWorkspaceMode(engineStatus.isActive) === "legacy_compatibility") {
    return <LegacyLeaveWorkspace />;
  }

  if (showEmployeeWorkspace) {
    return (
      <MainLayout>
        {employeeId ? (
          <EmployeeLeaveDashboard
            organizationId={currentOrganizationId}
            employeeId={employeeId as Id<"employees">}
          />
        ) : (
          <div className="p-8">
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Link this organization membership to an employee record to use
                leave self-service.
              </CardContent>
            </Card>
          </div>
        )}
      </MainLayout>
    );
  }

  if (!isAdministrator || !user) {
    return (
      <MainLayout>
        <div className="p-8">
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Leave administration is available only to the Owner, Admin, and
              HR.
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  const reviewerRole = role as "owner" | "admin" | "hr";

  return (
    <MainLayout>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <p className="text-sm font-medium text-brand-purple">
            Leave operations
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[rgb(64,64,64)]">
            Leave administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review requests, audit balances, manage conversions, and coordinate
            availability.
          </p>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as LeaveAdminTab)}
        >
          <div className="overflow-x-auto border-b">
            <TabsList className="h-auto w-max gap-5 rounded-none bg-transparent p-0">
              {adminTabs.map((tab) => {
                const Icon = adminTabDetails[tab].icon;
                return (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="-mb-px gap-2 rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 data-[state=active]:border-brand-purple data-[state=active]:bg-transparent data-[state=active]:text-brand-purple data-[state=active]:shadow-none"
                  >
                    <Icon className="h-4 w-4" /> {adminTabDetails[tab].label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <TabsContent value="approvals" className="mt-5">
            <LeaveApprovalInbox
              organizationId={currentOrganizationId}
              reviewer={{
                displayName: user.name?.trim() || user.email,
                role: reviewerRole,
              }}
              signatureRequired={engineStatus.approvalSignatureMode !== "none"}
            />
          </TabsContent>
          <TabsContent value="balances" className="mt-5">
            <EmployeeBalanceLedger organizationId={currentOrganizationId} />
          </TabsContent>
          <TabsContent value="conversions" className="mt-5">
            <div className="space-y-5">
              <LeaveConversionQueue organizationId={currentOrganizationId} />
              <LeaveBenefitReconciliation organizationId={currentOrganizationId} />
            </div>
          </TabsContent>
          <TabsContent value="calendar" className="mt-5">
            <LeaveCalendar organizationId={currentOrganizationId} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
