"use client";

import React, { useState } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";

export function UserOrganizationsCard(): React.ReactElement {
  const { organizations, currentOrganizationId } = useOrganization();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {organizations.map((org) => (
              <div
                key={org._id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">{org.name}</div>
                  <div className="text-sm text-gray-500 capitalize">
                    {org.role}
                  </div>
                </div>
                {org._id === currentOrganizationId && (
                  <Badge variant="secondary">Current</Badge>
                )}
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="w-full mt-4"
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











