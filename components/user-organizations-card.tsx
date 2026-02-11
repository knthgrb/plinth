"use client";

import React, { useState } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2 } from "lucide-react";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";

export function UserOrganizationsCard(): React.ReactElement {
  const { organizations, currentOrganizationId } = useOrganization();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Helper function to get display role name
  const getDisplayRole = (role: string | undefined) => {
    if (role === "admin" || role === "owner") return "Owner";
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";
  };

  return (
    <>
      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Your Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {organizations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Building2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">No organizations yet</p>
              </div>
            ) : (
              organizations.map((org) => (
                <div
                  key={org._id}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                    org._id === currentOrganizationId
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {org.name}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {getDisplayRole(org.role)}
                      </div>
                    </div>
                  </div>
                  {org._id === currentOrganizationId && (
                    <Badge
                      variant="secondary"
                      className="ml-3 shrink-0 bg-brand-purple text-white hover:bg-brand-purple-hover border-0"
                    >
                      Current
                    </Badge>
                  )}
                </div>
              ))
            )}
          </div>
          <Button
            variant="outline"
            className="w-full mt-4 border-gray-300 hover:bg-gray-50"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create New Organization
          </Button>
        </CardContent>
      </Card>

      <CreateOrganizationDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </>
  );
}
