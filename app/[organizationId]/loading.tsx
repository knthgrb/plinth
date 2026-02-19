"use client";

import { useOrganization } from "@/hooks/organization-context";
import { MainLoader } from "@/components/main-loader";
import { OrganizationSwitchingOverlay } from "@/components/organization-switching-overlay";

/**
 * Shown by Next.js while the [organizationId] segment is loading (e.g. during org switch).
 * When the user is switching org we show the same overlay as the layout so they never see the default loader.
 */
export default function Loading() {
  const { switchingToOrganizationId, organizations } = useOrganization();
  const isSwitching = !!switchingToOrganizationId;
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

  return <MainLoader />;
}
