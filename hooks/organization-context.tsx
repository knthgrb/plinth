"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type Organization = {
  _id: Id<"organizations">;
  name: string;
  role: "admin" | "hr" | "employee" | "accounting";
  employeeId?: Id<"employees">;
  joinedAt: number;
  firstPayDate?: number;
  secondPayDate?: number;
};

type OrganizationContextType = {
  currentOrganizationId: Id<"organizations"> | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  isLoading: boolean;
  switchOrganization: (organizationId: Id<"organizations">) => void;
  refreshOrganizations: () => void;
};

const OrganizationContext = createContext<OrganizationContextType | undefined>(
  undefined
);

const STORAGE_KEY = "current_organization_id";

export function OrganizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentOrganizationId, setCurrentOrganizationId] =
    useState<Id<"organizations"> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  // Use try-catch pattern - if query fails (e.g., unauthenticated), return empty array
  const organizationsQuery = useQuery(api.organizations.getUserOrganizations, {
    // refreshKey could be used to force refetch if implemented, kept for future
  });

  // Handle query errors gracefully (e.g., when user is not authenticated yet)
  const organizations = organizationsQuery || [];

  // Initialize from localStorage and validate against user's organizations
  useEffect(() => {
    if (typeof window !== "undefined" && !isInitialized) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          // Only set if organizations have loaded and the stored org is in the list
          if (organizationsQuery !== undefined) {
            const isValidOrg = organizations.some((org) => org._id === stored);
            if (isValidOrg) {
              setCurrentOrganizationId(stored as Id<"organizations">);
            } else {
              // Stored org is not in user's organizations, clear it
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch {
          // Invalid stored value
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setIsInitialized(true);
    }
  }, [isInitialized, organizations, organizationsQuery]);

  // Set default organization if none is selected
  useEffect(() => {
    if (
      isInitialized &&
      !currentOrganizationId &&
      organizations.length > 0 &&
      typeof window !== "undefined"
    ) {
      const firstOrg = organizations[0];
      setCurrentOrganizationId(firstOrg._id);
      localStorage.setItem(STORAGE_KEY, firstOrg._id);
    }
  }, [isInitialized, currentOrganizationId, organizations]);

  // Clear currentOrganizationId if it's not in the user's organizations
  useEffect(() => {
    if (
      isInitialized &&
      currentOrganizationId &&
      organizationsQuery !== undefined &&
      organizations.length > 0 &&
      !organizations.some((org) => org._id === currentOrganizationId)
    ) {
      // Current org is not in user's organizations, clear it
      setCurrentOrganizationId(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isInitialized, currentOrganizationId, organizations, organizationsQuery]);

  const switchOrganization = (organizationId: Id<"organizations">) => {
    setCurrentOrganizationId(organizationId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, organizationId);
    }
  };

  const refreshOrganizations = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const currentOrganization =
    organizations.find((org) => org._id === currentOrganizationId) || null;

  return (
    <OrganizationContext.Provider
      value={{
        currentOrganizationId,
        organizations,
        currentOrganization,
        isLoading: !isInitialized || organizationsQuery === undefined,
        switchOrganization,
        refreshOrganizations,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error(
      "useOrganization must be used within an OrganizationProvider"
    );
  }
  return context;
}
