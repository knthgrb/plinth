"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import { useOrganization } from "@/hooks/organization-context";
import {
  getOrganizationPath,
  extractOrganizationId,
} from "@/utils/organization-routing";
import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function ForbiddenPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrganizationId, organizations } = useOrganization();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Extract organizationId from URL
  const urlOrganizationId = extractOrganizationId(pathname || "");
  const orgId = urlOrganizationId || currentOrganizationId;

  // Get user role to determine appropriate redirect
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    orgId ? { organizationId: orgId } : "skip",
  );

  const handleGoToDashboard = () => {
    if (isRedirecting) return;
    setIsRedirecting(true);

    // Determine redirect based on user role
    let redirectPath = "/dashboard";
    if (user?.role === "accounting") {
      redirectPath = "/accounting";
    } else if (user?.role === "employee") {
      redirectPath = "/announcements";
    }

    if (orgId) {
      router.push(getOrganizationPath(orgId, redirectPath));
    } else if (organizations && organizations.length > 0) {
      router.push(getOrganizationPath(organizations[0]._id, redirectPath));
    } else {
      router.push(redirectPath);
    }
  };

  // Prevent auto-redirect loops - only show the page
  useEffect(() => {
    // Don't auto-redirect - let user click the button
  }, []);

  return (
    <div className="flex h-screen items-center justify-center p-8 bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          <CardTitle className="text-2xl">Access Forbidden</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-gray-600">
            You don't have permission to access this page. Please contact your
            administrator if you believe this is an error.
          </p>
          <Button onClick={handleGoToDashboard} disabled={isRedirecting}>
            {isRedirecting
              ? "Redirecting..."
              : `Go to ${user?.role === "employee" ? "Announcements" : user?.role === "accounting" ? "Accounting" : "Dashboard"}`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
