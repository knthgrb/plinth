"use client";

import { useOrganization } from "@/hooks/organization-context";
import { MainLoader } from "@/components/main-loader";
import { OrganizationSwitchingOverlay } from "@/components/organization-switching-overlay";
import { MainLayout } from "@/components/layout/main-layout";
import { PageSkeleton } from "./_components/page-skeleton";

/**
 * Shown by Next.js while the [organizationId] segment is loading (e.g. during org switch).
 * When the user is switching org we show the same overlay as the layout so they never see the default loader.
 */
export default function Loading() {
  const {
    switchingToOrganizationId,
    organizations,
    currentOrganizationId,
    isLoggingOut,
  } = useOrganization();
  // Only show org switcher overlay when actually switching; never when logging out
  const isSwitching =
    !isLoggingOut &&
    !!switchingToOrganizationId &&
    currentOrganizationId !== null;
  const switchingOrg = isSwitching
    ? organizations.find((o) => o._id === switchingToOrganizationId)
    : null;

  if (isSwitching) {
    return (
      <OrganizationSwitchingOverlay
        isSwitching={true}
        switchingOrgName={switchingOrg?.name}
      />
    );
  }

  if (isLoggingOut) {
    return <MainLoader />;
  }

  return (
    <MainLayout disableInitialLoader>
      <PageSkeleton title="Loading" rows={6} />
    </MainLayout>
  );
}
