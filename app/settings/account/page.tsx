"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/organization-context";
import { UserOrganizationsCard } from "@/components/user-organizations-card";

export default function AccountSettingsPage() {
  const { currentOrganizationId } = useOrganization();
  const router = useRouter();

  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
          <p className="text-gray-600 mt-2">Manage your account information</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role === "admin" ? (
                <div>
                  <div className="text-sm font-medium text-gray-500">Role</div>
                  <div className="text-lg">Admin</div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-sm font-medium text-gray-500">
                      Name
                    </div>
                    <div className="text-lg">
                      {user?.name || user?.email || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-500">
                      Email
                    </div>
                    <div className="text-lg">{user?.email || "-"}</div>
                  </div>
                </>
              )}
              <Button
                variant="outline"
                onClick={handleLogout}
                className="w-full mt-4"
              >
                Sign Out
              </Button>
            </CardContent>
          </Card>

          <UserOrganizationsCard />
        </div>
      </div>
    </MainLayout>
  );
}
