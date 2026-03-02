"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { MainLoader } from "@/components/main-loader";

function getDefaultRouteForRole(role: string | null | undefined): string {
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  if (r === "employee" || r === "accounting") return "/announcements";
  return "/dashboard";
}

export default function AppHomePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  const organizations = useQuery(
    (api as any).organizations.getUserOrganizations,
    hasSession ? {} : "skip"
  );

  useEffect(() => {
    authClient.getSession().then((session) => {
      setHasSession(!!session?.data?.session);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!hasSession) {
      router.replace("/login");
      return;
    }
    if (organizations === undefined) return;

    if (organizations && organizations.length > 0) {
      const dashboardRoles = ["admin", "owner", "hr"];
      const preferredOrg =
        organizations.find((org: any) =>
          dashboardRoles.includes((org.role as string)?.toLowerCase())
        ) ?? organizations[0];
      const path = getDefaultRouteForRole((preferredOrg as any).role);
      router.replace(`/${preferredOrg._id}${path}`);
      return;
    }

    router.replace("/signup?step=2");
  }, [authChecked, hasSession, organizations, router]);

  return <MainLoader />;
}
