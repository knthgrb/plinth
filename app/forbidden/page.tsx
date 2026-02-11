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
import { useEffect, useState } from "react";

export default function ForbiddenPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrganizationId, organizations } = useOrganization();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Extract organizationId from URL if present
  const urlOrganizationId = extractOrganizationId(pathname || "");

  // Determine the appropriate redirect destination based on user role
  const handleGoToHome = () => {
    if (isRedirecting) return;
    setIsRedirecting(true);

    // Use organizationId from URL or context
    const orgId = urlOrganizationId || currentOrganizationId;

    if (orgId) {
      router.push(getOrganizationPath(orgId, "/"));
    } else if (organizations && organizations.length > 0) {
      // Use first available organization
      router.push(getOrganizationPath(organizations[0]._id, "/"));
    } else {
      // Fallback to root home (will redirect appropriately)
      router.push("/");
    }
  };

  // Prevent redirect loop - if we're already on forbidden, don't auto-redirect
  useEffect(() => {
    // Only redirect if we have a valid organization and we're not in a loop
    if (currentOrganizationId && !isRedirecting) {
      // Small delay to prevent immediate redirect loops
      const timer = setTimeout(() => {
        // Check if user has access to home before redirecting
        // This prevents infinite loops
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [currentOrganizationId, isRedirecting]);

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
          <Button onClick={handleGoToHome} disabled={isRedirecting}>
            {isRedirecting ? "Redirecting..." : "Go to Home"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
