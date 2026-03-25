"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import type { Id } from "@/convex/_generated/dataModel";

type EmployeeViewContextValue = {
  canUseEmployeeView: boolean;
  matchedEmployeeId: string | null;
  employeeViewActive: boolean;
  setEmployeeViewActive: (active: boolean) => void;
  isEmployeeExperienceUI: boolean;
  effectiveSelfEmployeeId: string | null;
};

const EmployeeViewContext = createContext<EmployeeViewContextValue | null>(
  null,
);

function sessionKey(orgId: string) {
  return `plinth_employee_view_${orgId}`;
}

export function EmployeeViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { effectiveOrganizationId } = useOrganization();
  const user = useQuery(
    api.organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId as Id<"organizations"> }
      : "skip",
  );

  const selfMatch = useQuery(
    api.organizations.getEmployeeSelfMatchForElevatedRole,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId as Id<"organizations"> }
      : "skip",
  );

  const payslipIdentity = useQuery(
    api.organizations.getEmployeeIdForPayslips,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId as Id<"organizations"> }
      : "skip",
  );

  const canUseEmployeeView = Boolean(
    user &&
      selfMatch?.employeeId &&
      ["owner", "admin", "hr", "accounting"].includes(
        (user.role || "").toLowerCase(),
      ),
  );

  const matchedEmployeeId = selfMatch?.employeeId
    ? String(selfMatch.employeeId)
    : null;

  const [employeeViewActive, setEmployeeViewActiveState] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !effectiveOrganizationId) return;
    setEmployeeViewActiveState(
      sessionStorage.getItem(sessionKey(effectiveOrganizationId)) === "1",
    );
  }, [effectiveOrganizationId]);

  const setEmployeeViewActive = useCallback(
    (active: boolean) => {
      setEmployeeViewActiveState(active);
      if (typeof window !== "undefined" && effectiveOrganizationId) {
        sessionStorage.setItem(sessionKey(effectiveOrganizationId), active ? "1" : "0");
      }
    },
    [effectiveOrganizationId],
  );

  useEffect(() => {
    if (!canUseEmployeeView && employeeViewActive) {
      setEmployeeViewActive(false);
    }
  }, [canUseEmployeeView, employeeViewActive, setEmployeeViewActive]);

  const employeeViewOn = canUseEmployeeView && employeeViewActive;

  const isEmployeeExperienceUI = useMemo(() => {
    const r = (user?.role || "").toLowerCase();
    if (r === "employee") return true;
    return employeeViewOn;
  }, [user?.role, employeeViewOn]);

  const effectiveSelfEmployeeId = useMemo(() => {
    if (!user) return null;
    const r = (user.role || "").toLowerCase();
    if (r === "employee") {
      const id = payslipIdentity?.employeeId;
      return id ? String(id) : null;
    }
    if (employeeViewOn && matchedEmployeeId) return matchedEmployeeId;
    return user.employeeId ? String(user.employeeId) : null;
  }, [user, employeeViewOn, matchedEmployeeId, payslipIdentity?.employeeId]);

  const value = useMemo(
    () => ({
      canUseEmployeeView,
      matchedEmployeeId,
      employeeViewActive: employeeViewOn,
      setEmployeeViewActive,
      isEmployeeExperienceUI,
      effectiveSelfEmployeeId,
    }),
    [
      canUseEmployeeView,
      matchedEmployeeId,
      employeeViewOn,
      setEmployeeViewActive,
      isEmployeeExperienceUI,
      effectiveSelfEmployeeId,
    ],
  );

  return (
    <EmployeeViewContext.Provider value={value}>
      {children}
    </EmployeeViewContext.Provider>
  );
}

export function useEmployeeView(): EmployeeViewContextValue {
  const ctx = useContext(EmployeeViewContext);
  if (!ctx) {
    return {
      canUseEmployeeView: false,
      matchedEmployeeId: null,
      employeeViewActive: false,
      setEmployeeViewActive: () => {},
      isEmployeeExperienceUI: false,
      effectiveSelfEmployeeId: null,
    };
  }
  return ctx;
}
