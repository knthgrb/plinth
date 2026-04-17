"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { MainLoader } from "@/components/main-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";

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
    hasSession ? {} : "skip",
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
      // Use last active organization (first in list) and its role for redirect
      const lastActiveOrg = organizations[0];
      const path = getDefaultRouteForRole((lastActiveOrg as any).role);
      router.replace(`/${lastActiveOrg._id}${path}`);
      return;
    }

    // No organizations (e.g. removed from all orgs) — show create-org option, don't redirect
  }, [authChecked, hasSession, organizations, router]);

  if (!authChecked || !hasSession || organizations === undefined) {
    return <MainLoader />;
  }

  if (organizations && organizations.length > 0) {
    return <MainLoader />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
            <Building2 className="h-6 w-6 text-purple-600" />
          </div>
          <CardTitle className="text-xl">No organizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            You are not in any organizations. Create one to get started.
          </p>
          <Button
            className="w-full"
            onClick={() => router.push("/signup?step=2")}
          >
            Create organization
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
