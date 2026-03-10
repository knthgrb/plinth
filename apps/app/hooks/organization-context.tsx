"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type Organization = {
  _id: Id<"organizations">;
  name: string;
  role: "admin" | "owner" | "hr" | "employee" | "accounting";
  employeeId?: Id<"employees">;
  joinedAt: number;
  firstPayDate?: number;
  secondPayDate?: number;
  salaryPaymentFrequency?: "monthly" | "bimonthly";
};

type OrganizationContextType = {
  currentOrganizationId: Id<"organizations"> | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  isLoading: boolean;
  /** Set when user just switched org via switcher; layout should not override with URL until cleared */
  switchingToOrganizationId: Id<"organizations"> | null;
  /** True immediately when clearOrganization (logout) is called; overlay must never show when true */
  isLoggingOut: boolean;
  switchOrganization: (organizationId: Id<"organizations">) => void;
  /** Clear current org (e.g. on logout) so org-dependent queries skip and no backend auth errors */
  clearOrganization: () => void;
  refreshOrganizations: () => void;
};

const OrganizationContext = createContext<OrganizationContextType | undefined>(
  undefined,
);

const STORAGE_KEY = "current_organization_id";

function getDefaultRouteForRole(role: string | null | undefined): string {
  if (!role) return "/dashboard";
  const r = role.toLowerCase();
  // Only employee and accounting land on announcements; admin/owner/hr land on dashboard
  if (r === "employee" || r === "accounting") return "/announcements";
  return "/dashboard";
}

export function OrganizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const urlOrganizationId = params?.organizationId as string | undefined;

  const [currentOrganizationId, setCurrentOrganizationId] =
    useState<Id<"organizations"> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  /** When set, layout must not sync URL -> context (avoids loop when switching org) */
  const [switchingToOrganizationId, setSwitchingToOrganizationId] =
    useState<Id<"organizations"> | null>(null);
  /** Ref set synchronously so layout/loading see switching state before state flush (every switch shows overlay) */
  const switchingToOrganizationIdRef = useRef<Id<"organizations"> | null>(null);
  const clearSwitchingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set true when clearOrganization (logout) is called so switch overlay never shows during sign-out */
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  /** Ref set synchronously so layout/loading see logout state before state flush (avoid switch overlay on logout) */
  const isLoggingOutRef = useRef(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const updateLastActive = useMutation(
    (api as any).organizations.updateLastActiveOrganization,
  );

  // Use try-catch pattern - if query fails (e.g., unauthenticated), return empty array
  const organizationsQuery = useQuery(api.organizations.getUserOrganizations, {
    // refreshKey could be used to force refetch if implemented, kept for future
  });

  // Handle query errors gracefully (e.g., when user is not authenticated yet)
  const organizations = organizationsQuery || [];

  // Initialize from URL params first, then localStorage, then lastActiveOrganizationId
  useEffect(() => {
    if (typeof window === "undefined" || isInitialized) return;

    if (organizationsQuery === undefined) return; // Wait for organizations to load

    let orgIdToUse: Id<"organizations"> | null = null;

    // Priority 1: URL parameter (if we're on an organization route)
    if (urlOrganizationId) {
      const isValidOrg = organizations.some(
        (org) => org._id === urlOrganizationId,
      );
      if (isValidOrg) {
        orgIdToUse = urlOrganizationId as Id<"organizations">;
      }
    }

    // Priority 2: localStorage
    if (!orgIdToUse) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const isValidOrg = organizations.some((org) => org._id === stored);
        if (isValidOrg) {
          orgIdToUse = stored as Id<"organizations">;
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    // Priority 3: First organization (which is already sorted by lastActiveOrganizationId)
    if (!orgIdToUse && organizations.length > 0) {
      orgIdToUse = organizations[0]._id;
    }

    if (orgIdToUse) {
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
      setCurrentOrganizationId(orgIdToUse);
      localStorage.setItem(STORAGE_KEY, orgIdToUse);

      // If we're not on an organization route, redirect to include organizationId (skip invite flow and other public routes)
      const isPublicOrInvite =
        pathname?.startsWith("/login") ||
        pathname?.startsWith("/signup") ||
        pathname?.startsWith("/walkthrough") ||
        pathname?.startsWith("/forgot-password") ||
        pathname?.startsWith("/reset-password") ||
        pathname?.startsWith("/invite");
      if (!urlOrganizationId && pathname && !isPublicOrInvite) {
        const selectedOrg = organizations.find((o) => o._id === orgIdToUse);
        const defaultPath = selectedOrg
          ? getDefaultRouteForRole(selectedOrg.role)
          : "/dashboard";
        const currentPath = pathname === "/" ? defaultPath : pathname;
        router.replace(`/${orgIdToUse}${currentPath}`);
      }
    }

    setIsInitialized(true);
  }, [
    isInitialized,
    organizations,
    organizationsQuery,
    urlOrganizationId,
    pathname,
    router,
  ]);

  // Sync URL with currentOrganizationId when it changes (avoid redundant replace to prevent loops)
  useEffect(() => {
    if (!isInitialized || !currentOrganizationId) return;
    if (typeof window === "undefined") return;

    const isPublicRoute =
      pathname?.startsWith("/login") ||
      pathname?.startsWith("/signup") ||
      pathname?.startsWith("/walkthrough") ||
      pathname?.startsWith("/forgot-password") ||
      pathname?.startsWith("/reset-password") ||
      pathname?.startsWith("/invite");

    // When URL has caught up with our switch, clear switching flag after a short delay
    // so the loader overlay always shows on every switch (not just the first)
    if (
      urlOrganizationId === currentOrganizationId &&
      switchingToOrganizationId
    ) {
      if (clearSwitchingTimeoutRef.current) {
        clearTimeout(clearSwitchingTimeoutRef.current);
      }
      clearSwitchingTimeoutRef.current = setTimeout(() => {
        setSwitchingToOrganizationId(null);
        switchingToOrganizationIdRef.current = null;
        clearSwitchingTimeoutRef.current = null;
      }, 400);
    }

    // Only replace URL when it truly doesn't match and pathname doesn't already show current org (avoids loop)
    const pathnameStartsWithCurrentOrg = pathname?.startsWith(
      `/${currentOrganizationId}`,
    );
    if (
      !isPublicRoute &&
      pathname &&
      urlOrganizationId !== currentOrganizationId &&
      !pathnameStartsWithCurrentOrg
    ) {
      const currentPath = pathname.replace(/^\/[^/]+/, "") || "/dashboard";
      router.replace(`/${currentOrganizationId}${currentPath}`);
    }

    // Update last active organization in database
    if (currentOrganizationId) {
      updateLastActive({ organizationId: currentOrganizationId }).catch(
        (err) => {
          console.error("Failed to update last active organization:", err);
        },
      );
    }

    return () => {
      if (clearSwitchingTimeoutRef.current) {
        clearTimeout(clearSwitchingTimeoutRef.current);
        clearSwitchingTimeoutRef.current = null;
      }
    };
  }, [
    currentOrganizationId,
    urlOrganizationId,
    pathname,
    router,
    isInitialized,
    updateLastActive,
    switchingToOrganizationId,
  ]);

  // Clear currentOrganizationId if it's not in the user's organizations
  // Skip clearing when we're switching to this id (e.g. just created org not in list yet)
  useEffect(() => {
    if (
      isInitialized &&
      currentOrganizationId &&
      organizationsQuery !== undefined &&
      organizations.length > 0 &&
      !organizations.some((org) => org._id === currentOrganizationId) &&
      currentOrganizationId !== switchingToOrganizationId
    ) {
      setCurrentOrganizationId(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [
    isInitialized,
    currentOrganizationId,
    organizations,
    organizationsQuery,
    switchingToOrganizationId,
  ]);

  const switchOrganization = (organizationId: Id<"organizations">) => {
    setIsLoggingOut(false);
    // Set ref synchronously so layout/loading see switching state before state flush (every switch shows overlay)
    switchingToOrganizationIdRef.current = organizationId;
    // Prevent layout from syncing URL -> context back to previous org while navigation is in flight
    setSwitchingToOrganizationId(organizationId);
    setCurrentOrganizationId(organizationId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, organizationId);

      const currentPath = pathname?.replace(/^\/[^/]+/, "") || "/dashboard";
      router.push(`/${organizationId}${currentPath}`);

      updateLastActive({ organizationId }).catch((err) => {
        console.error("Failed to update last active organization:", err);
      });
    }
  };

  const clearOrganization = () => {
    isLoggingOutRef.current = true;
    setIsLoggingOut(true);
    switchingToOrganizationIdRef.current = null;
    setSwitchingToOrganizationId(null);
    setCurrentOrganizationId(null);
    setIsInitialized(false); // Allow init effect to run again after login so isLoggingOut gets cleared
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const refreshOrganizations = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const currentOrganization =
    organizations.find((org) => org._id === currentOrganizationId) || null;

  // Expose ref value so layout/loading see switching state before state flush (every switch shows overlay)
  const effectiveSwitchingToOrganizationId =
    switchingToOrganizationId ?? switchingToOrganizationIdRef.current;
  // Expose ref so layout/loading never show switch overlay during logout (sync with clearOrganization)
  const effectiveIsLoggingOut = isLoggingOut || isLoggingOutRef.current;

  return (
    <OrganizationContext.Provider
      value={{
        currentOrganizationId,
        organizations,
        currentOrganization,
        isLoading: !isInitialized || organizationsQuery === undefined,
        switchingToOrganizationId: effectiveSwitchingToOrganizationId,
        isLoggingOut: effectiveIsLoggingOut,
        switchOrganization,
        clearOrganization,
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
      "useOrganization must be used within an OrganizationProvider",
    );
  }
  return context;
}
