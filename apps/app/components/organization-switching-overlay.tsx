"use client";

import { Building2, Loader2 } from "lucide-react";
import { cn } from "@/utils/utils";

type OrganizationSwitchingOverlayProps = {
  isSwitching: boolean;
  switchingOrgName?: string | null;
};

/**
 * Full-screen overlay shown when switching organization.
 * Used by both [organizationId]/layout (over children) and [organizationId]/loading (as the only content).
 */
export function OrganizationSwitchingOverlay({
  isSwitching,
  switchingOrgName,
}: OrganizationSwitchingOverlayProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200",
        isSwitching
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!isSwitching}
    >
      <div
        className={cn(
          "absolute inset-0 bg-white/80 backdrop-blur-sm transition-opacity duration-200",
          isSwitching ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "relative flex flex-col items-center gap-4 rounded-2xl bg-white px-8 py-6 shadow-lg ring-1 ring-black/5 transition-all duration-200",
          isSwitching ? "scale-100 opacity-100" : "scale-95 opacity-0",
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[rgb(245,245,245)]">
          <Building2 className="h-7 w-7 text-brand-purple" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-brand-purple" />
            <span className="text-sm font-medium text-gray-700">
              Switching organization
            </span>
          </div>
          {switchingOrgName && (
            <p className="text-xs text-gray-500">{switchingOrgName}</p>
          )}
        </div>
      </div>
    </div>
  );
}
