"use client";

import { useParams, useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";
import { removeOrganizationId } from "@/utils/organization-routing";
import { canAccessRoute } from "@/utils/role-access";
import { MainLoader } from "@/components/main-loader";
import { OrganizationSwitchingOverlay } from "@/components/organization-switching-overlay";

export default function OrganizationLayout({
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
  } = useOrganization();
  const updateLastActive = useMutation(
    (api as any).organizations.updateLastActiveOrganization,
  );
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    organizationId ? { organizationId } : "skip",
  );

  // Validate organizationId from URL and sync with context (do not override when user just switched)
  useEffect(() => {
    if (isLoading || !organizations.length) return;
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

    // Sync URL -> context only when we're not in the middle of a user-initiated switch (avoids infinite loop)
    if (currentOrganizationId !== orgId && !switchingToOrganizationId) {
      switchOrganization(orgId);
    }

    updateLastActive({ organizationId: orgId }).catch((err) => {
      console.error("Failed to update last active organization:", err);
    });
  }, [
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

  // Role-based access: redirect to forbidden only when we have a resolved user and they lack access
  useEffect(() => {
    if (isLoading || !organizationId) return;
    // Wait for user query to resolve (undefined = loading)
    if (user === undefined) return;
    // Don't redirect to forbidden when user is null (e.g. brief unauthenticated state after login); let query refetch
    if (user === null) return;
    let cleanPath = removeOrganizationId(pathname || "") || "/dashboard";
    // When path is exactly /orgId (no subpath), treat as dashboard for access check
    if (cleanPath === `/${organizationId}`) cleanPath = "/dashboard";
    if (cleanPath === "/forbidden") return;
    if (!canAccessRoute(cleanPath, user.role ?? null)) {
      router.replace(`/${organizationId}/forbidden`);
    }
  }, [isLoading, organizationId, pathname, user, router]);

  // Show loading state while validating (MainLoader handles tail so Lottie can finish)
  if (isLoading) {
    return <MainLoader />;
  }

  const isSwitching = !!switchingToOrganizationId;
  const switchingOrg = isSwitching
    ? organizations.find((o) => o._id === switchingToOrganizationId)
    : null;

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
