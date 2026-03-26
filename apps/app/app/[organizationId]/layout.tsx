"use client";

import { useParams, useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import {
  EmployeeViewProvider,
  useEmployeeView,
} from "@/hooks/employee-view-context";
import { Id } from "@/convex/_generated/dataModel";
import { removeOrganizationId } from "@/utils/organization-routing";
import { canAccessRoute } from "@/utils/role-access";
import { OrganizationSwitchingOverlay } from "@/components/organization-switching-overlay";

function OrganizationLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const organizationId = params.organizationId as string;
  const {
    organizations,
    switchOrganization,
    currentOrganizationId,
    isLoading,
    switchingToOrganizationId,
    isLoggingOut,
  } = useOrganization();
  const { isEmployeeExperienceUI } = useEmployeeView();
  const updateLastActive = useMutation(
    (api as any).organizations.updateLastActiveOrganization,
  );
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    organizationId && !isLoggingOut ? { organizationId } : "skip",
  );

  useEffect(() => {
    if (isLoggingOut || isLoading || !organizations.length) return;
    if (!organizationId) return;

    const orgId = organizationId as Id<"organizations">;
    const isValidOrg = organizations.some((org) => org._id === orgId);

    if (!isValidOrg) {
      if (organizations.length > 0) {
        const firstOrg = organizations[0];
        const cleanPath = removeOrganizationId(pathname || "") || "/dashboard";
        router.replace(`/${firstOrg._id}${cleanPath}`);
      }
      return;
    }

    if (currentOrganizationId !== orgId && !switchingToOrganizationId) {
      switchOrganization(orgId);
    }

    updateLastActive({ organizationId: orgId }).catch((err) => {
      console.error("Failed to update last active organization:", err);
    });
  }, [
    isLoggingOut,
    organizationId,
    organizations,
    currentOrganizationId,
    switchOrganization,
    switchingToOrganizationId,
    router,
    updateLastActive,
    isLoading,
    pathname,
  ]);

  useEffect(() => {
    if (isLoggingOut || isLoading || !organizationId) return;
    if (user === undefined) return;
    if (user === null) return;
    let cleanPath = removeOrganizationId(pathname || "") || "/dashboard";
    if (cleanPath === `/${organizationId}`) cleanPath = "/dashboard";
    if (cleanPath === "/forbidden") return;

    const roleForAccess = isEmployeeExperienceUI
      ? "employee"
      : (user.role ?? null);
    if (!canAccessRoute(cleanPath, roleForAccess)) {
      // In employee experience mode, invalid pages should return to employee-safe home
      // instead of showing forbidden while role/UI switch is in flight.
      if (isEmployeeExperienceUI) {
        router.replace(`/${organizationId}/announcements`);
        return;
      }
      router.replace(`/${organizationId}/forbidden`);
    }
  }, [
    isLoading,
    organizationId,
    pathname,
    user,
    router,
    isLoggingOut,
    isEmployeeExperienceUI,
  ]);

  const isSwitching =
    !isLoggingOut &&
    !!switchingToOrganizationId &&
    currentOrganizationId !== null &&
    user !== null;
  const switchingOrg = isSwitching
    ? organizations.find((o) => o._id === switchingToOrganizationId)
    : null;

  if (isLoggingOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-500">Signing out...</p>
      </div>
    );
  }

  if (isLoading && isSwitching) {
    return (
      <OrganizationSwitchingOverlay
        isSwitching={true}
        switchingOrgName={switchingOrg?.name}
      />
    );
  }

  return (
    <>
      {children}
      <OrganizationSwitchingOverlay
        isSwitching={isSwitching}
        switchingOrgName={switchingOrg?.name}
      />
    </>
  );
}

export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EmployeeViewProvider>
      <OrganizationLayoutInner>{children}</OrganizationLayoutInner>
    </EmployeeViewProvider>
  );
}
