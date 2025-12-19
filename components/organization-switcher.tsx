"use client";

import { useState } from "react";
import { useOrganization } from "@/hooks/organization-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";
import { cn } from "@/utils/utils";

export function OrganizationSwitcher() {
  const {
    currentOrganizationId,
    organizations,
    currentOrganization,
    switchOrganization,
    isLoading,
  } = useOrganization();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);

  const orgInitials =
    currentOrganization?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "O";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
        <Building2 className="h-4 w-4" />
        <span>Loading...</span>
      </div>
    );
  }

  // If no organizations, show create option
  if (organizations.length === 0) {
    return (
      <>
        <div className="px-3 py-2">
          <Button
            variant="outline"
            className="w-full justify-start h-8 text-xs"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus className="h-3 w-3 mr-2" />
            Create Organization
          </Button>
        </div>
        <CreateOrganizationDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      </>
    );
  }

  return (
    <>
      <div className="w-full">
        <Select
          value={currentOrganizationId || undefined}
          onValueChange={(value) => {
            switchOrganization(value as any);
          }}
          onOpenChange={setIsSelectOpen}
        >
          <SelectTrigger className="w-full h-10 bg-white hover:bg-gray-50 border-0 shadow-none px-4 py-2 [&>svg:last-child]:hidden">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-xs font-medium text-gray-600 shrink-0">
                {orgInitials}
              </div>
              <span
                className="truncate text-sm font-semibold"
                style={{ color: "rgb(53, 58, 68)" }}
              >
                <SelectValue placeholder="Select organization">
                  {currentOrganization?.name || "Select organization"}
                </SelectValue>
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 opacity-50 transition-transform duration-200 shrink-0",
                isSelectOpen && "rotate-180"
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((org) => {
              const initials =
                org.name
                  ?.split(" ")
                  .map((n: string) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2) || "O";
              return (
                <SelectItem
                  key={org._id}
                  value={org._id}
                  textValue={org.name}
                  hideItemText={true}
                >
                  <div className="flex items-center gap-2.5 w-full">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-xs font-medium text-gray-600 shrink-0">
                      {initials}
                    </div>
                    <span className="text-sm font-semibold">{org.name}</span>
                  </div>
                </SelectItem>
              );
            })}
            <div className="border-t pt-1 mt-1">
              <Button
                variant="ghost"
                className="w-full justify-start h-8 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  setIsCreateDialogOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-2" />
                Create Organization
              </Button>
            </div>
          </SelectContent>
        </Select>
      </div>
      <CreateOrganizationDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </>
  );
}
