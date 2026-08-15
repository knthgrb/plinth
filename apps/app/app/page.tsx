"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient, signOutAndRedirectToLogin } from "@/lib/auth-client";
import { MainLoader } from "@/components/main-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Archive, Building2, LogOut } from "lucide-react";
import { selectPreferredOrganizationForEntry } from "@/utils/org-membership-lifecycle";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";

function getDefaultRouteForRole(
  role: string | null | undefined,
  accessStatus?: string | null,
): string {
  if (accessStatus === "alumni") return "/payslips";
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  if (r === "employee" || r === "accounting") return "/announcements";
  return "/dashboard";
}

export default function AppHomePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCreateOrganizationOpen, setIsCreateOrganizationOpen] =
    useState(false);

  const organizations = useQuery(
    api.organizations.getUserOrganizations,
    authChecked && hasSession ? {} : "skip",
  );
  const archivedOrganizations = useQuery(
    api.organizations.getArchivedUserOrganizations,
    authChecked && hasSession ? {} : "skip",
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
      const lastActiveOrg = selectPreferredOrganizationForEntry(
        organizations,
      );
      if (!lastActiveOrg) return;
      const path = getDefaultRouteForRole(
        lastActiveOrg.role,
        lastActiveOrg.accessStatus,
      );
      router.replace(`/${lastActiveOrg._id}${path}`);
      return;
    }

    // No organizations (e.g. removed from all orgs) — show create-org option, don't redirect
  }, [authChecked, hasSession, organizations, router]);

  const handleLogout = () => {
    void signOutAndRedirectToLogin(() => setIsSigningOut(true));
  };

  if (
    !authChecked ||
    !hasSession ||
    organizations === undefined ||
    archivedOrganizations === undefined
  ) {
    return <MainLoader />;
  }

  if (organizations && organizations.length > 0) {
    return <MainLoader />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
            <Building2 className="h-6 w-6 text-purple-600" />
          </div>
          <CardTitle className="text-xl">No active organizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            {archivedOrganizations.length > 0
              ? "You can review your archived organizations or create a new one."
              : "You are not in any active organizations. Create one to get started."}
          </p>
          {archivedOrganizations.length > 0 && (
            <section
              aria-labelledby="archived-organizations-heading"
              className="space-y-2"
            >
              <h2
                id="archived-organizations-heading"
                className="text-sm font-semibold text-foreground"
              >
                Archived organizations
              </h2>
              <div className="space-y-2">
                {archivedOrganizations.map((organization) => (
                  <div
                    key={organization._id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100">
                      <Archive className="h-4 w-4 text-gray-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {organization.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {organization.status === "archived"
                          ? "Organization archived"
                          : organization.accessStatus === "removed"
                            ? "Access removed"
                            : organization.accessStatus === "disabled"
                              ? "Access disabled"
                              : "Access suspended"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <Button
            className="w-full"
            onClick={() => setIsCreateOrganizationOpen(true)}
          >
            Create organization
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={handleLogout}
            disabled={isSigningOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {isSigningOut ? "Logging out..." : "Log out"}
          </Button>
        </CardContent>
      </Card>
      <CreateOrganizationDialog
        open={isCreateOrganizationOpen}
        onOpenChange={setIsCreateOrganizationOpen}
      />
    </div>
  );
}
