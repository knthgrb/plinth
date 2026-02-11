"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLoader } from "@/components/main-loader";

function getDefaultRouteForRole(role: string | null | undefined): string {
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  if (r === "employee") return "/announcements";
  if (r === "accounting") return "/accounting";
  return "/dashboard";
}

// Root page: redirect authenticated users by role (if they have orgs) or signup (if not)
export default function Home() {
  const router = useRouter();
  const organizations = useQuery(
    (api as any).organizations.getUserOrganizations,
    {}
  );

  useEffect(() => {
    // Still loading
    if (organizations === undefined) return;

    if (organizations && organizations.length > 0) {
      const firstOrg = organizations[0];
      const path = getDefaultRouteForRole((firstOrg as any).role);
      router.replace(`/${firstOrg._id}${path}`);
      return;
    }

    // No organizations: new user needs to complete setup
    router.replace("/signup?step=2");
  }, [organizations, router]);

  return <MainLoader />;
}
