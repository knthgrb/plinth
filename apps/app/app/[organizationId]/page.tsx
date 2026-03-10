"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { MainLoader } from "@/components/main-loader";

function getDefaultRouteForRole(role: string | null | undefined): string {
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  if (r === "employee" || r === "accounting") return "/announcements";
  return "/dashboard";
}

export default function OrganizationIndexPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.organizationId as string;
  const { organizations, currentOrganization, isLoading } = useOrganization();

  useEffect(() => {
    if (!organizationId) return;
    // Prefer current org's role when it matches URL; otherwise use first matching org
    const org =
      currentOrganization?._id === organizationId
        ? currentOrganization
        : organizations?.find((o) => o._id === organizationId);
    const path = org ? getDefaultRouteForRole(org.role) : "/dashboard";
    router.replace(`/${organizationId}${path}`);
  }, [organizationId, currentOrganization, organizations, router]);

  return <MainLoader />;
}
