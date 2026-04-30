"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  ChevronDown,
  Settings,
  HelpCircle,
  Menu,
  UserCog,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SettingsModal } from "@/components/settings-modal";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import { NotificationBell } from "@/components/notifications/notification-bell";

type HeaderProps = {
  onMobileMenuOpen?: () => void;
};

export function Header({ onMobileMenuOpen }: HeaderProps) {
  const router = useRouter();
  const { effectiveOrganizationId, clearOrganization } = useOrganization();
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const {
    isOpen: settingsModalOpen,
    openModal: openSettingsModal,
    closeModal: closeSettingsModal,
    initialSection,
  } = useSettingsModal();

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const { canUseEmployeeView, employeeViewActive, setEmployeeViewActive } =
    useEmployeeView();

  const handleLogout = () => {
    clearOrganization();
    sessionStorage.setItem("pendingSignOut", "1");
    void fetch("/api/auth/clear-role-cache", {
      method: "POST",
      credentials: "include",
    });
    router.replace("/login");
  };

  const userInitials =
    user?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ||
    user?.email?.[0].toUpperCase() ||
    "U";

  // Helper function to get display role name
  const getDisplayRole = (role: string | undefined) => {
    if (role === "admin" || role === "owner") return "Owner";
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : "User";
  };
  const isUserLoading = user === undefined || !effectiveOrganizationId;

  return (
    <header className="relative z-10 bg-white shrink-0 h-14 flex items-center">
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 flex items-center justify-between gap-3 h-full">
        <div className="flex items-center h-10 gap-2 flex-1 min-w-0">
          {/* Mobile hamburger menu - visible on mobile/tablet */}
          <button
            onClick={onMobileMenuOpen}
            className="flex lg:hidden items-center justify-center rounded-lg w-10 h-10 shrink-0 text-sm font-normal transition-colors cursor-pointer group"
            style={{
              lineHeight: "normal",
            }}
            title="Open menu"
          >
            <Menu className="h-4 w-4 transition-colors text-gray-900 group-hover:opacity-80" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 h-10">
          {effectiveOrganizationId && <NotificationBell />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openSettingsModal("account")}
                className="flex items-center justify-center rounded-full hover:bg-[rgb(250,250,250)] w-9 h-9 shrink-0 text-sm font-normal transition-colors cursor-pointer group"
                aria-label="Settings"
              >
                <Settings className="h-4.5 w-4.5 transition-colors text-gray-900 group-hover:opacity-80" />
              </button>
            </TooltipTrigger>
            <TooltipContent position="bottom">Settings</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://plinth-marketing.vercel.app/resources#docs"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center justify-center rounded-full hover:bg-[rgb(250,250,250)] w-9 h-9 shrink-0 text-sm font-normal transition-colors cursor-pointer group"
                aria-label="Help"
              >
                <HelpCircle className="h-4.5 w-4.5 transition-colors text-gray-900 group-hover:opacity-80" />
              </a>
            </TooltipTrigger>
            <TooltipContent position="bottom">Help</TooltipContent>
          </Tooltip>
          <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1.5 sm:gap-2 rounded-lg px-2 sm:px-3 h-full text-xs font-normal transition-colors hover:bg-[rgb(250,250,250)] cursor-pointer min-w-0 text-gray-900"
                style={{
                  lineHeight: "normal",
                }}
              >
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className="text-xs bg-[rgb(245,245,245)] text-gray-900">
                    {isUserLoading ? (
                      <span className="block h-3 w-3 rounded bg-[rgb(230,230,230)] animate-pulse" />
                    ) : (
                      userInitials
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start min-w-0 hidden sm:flex">
                  {isUserLoading ? (
                    <span className="h-3 w-20 rounded bg-[rgb(235,235,235)] animate-pulse" />
                  ) : (
                    <span className="text-left truncate text-xs font-bold max-w-[120px]">
                      {user?.name || user?.email || "User"}
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 shrink-0 text-gray-900 ${
                    userPopoverOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end" side="bottom">
              <div className="p-3">
                <div className="flex items-center gap-2.5 mb-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-[rgb(245,245,245)] text-[rgb(64,64,64)]">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    {isUserLoading ? (
                      <div className="h-4 w-28 rounded bg-[rgb(235,235,235)] animate-pulse" />
                    ) : (
                      <p className="text-sm font-medium truncate">
                        {user?.name || user?.email || "User"}
                      </p>
                    )}
                  </div>
                </div>
                <Separator className="my-2" />
                {canUseEmployeeView && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !employeeViewActive;
                        setEmployeeViewActive(next);
                        if (effectiveOrganizationId) {
                          if (next) {
                            router.push(
                              getOrganizationPath(
                                effectiveOrganizationId,
                                "/announcements",
                              ),
                            );
                          } else {
                            const r = (user?.role || "").toLowerCase();
                            if (r === "accounting") {
                              router.push(
                                getOrganizationPath(
                                  effectiveOrganizationId,
                                  "/accounting",
                                ),
                              );
                            } else if (["admin", "owner", "hr"].includes(r)) {
                              router.push(
                                getOrganizationPath(
                                  effectiveOrganizationId,
                                  "/dashboard",
                                ),
                              );
                            }
                          }
                        }
                        setUserPopoverOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm font-normal rounded-lg hover:bg-[rgb(250,250,250)] transition-colors text-left"
                      style={{ color: "rgb(64, 64, 64)" }}
                    >
                      <UserCog className="h-4 w-4 shrink-0" />
                      {employeeViewActive
                        ? "Exit employee view"
                        : "View as employee"}
                    </button>
                    <Separator className="my-2" />
                  </>
                )}
                <button
                  onClick={async () => {
                    setUserPopoverOpen(false);
                    await handleLogout();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm font-normal rounded-lg hover:bg-[rgb(250,250,250)] transition-colors"
                  style={{ color: "rgb(64, 64, 64)" }}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <SettingsModal
            open={settingsModalOpen}
            onOpenChange={(open) => {
              if (open) {
                openSettingsModal("account");
              } else {
                closeSettingsModal();
              }
            }}
            initialSection={initialSection}
          />
        </div>
      </div>
    </header>
  );
}
