"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Receipt,
  Calendar,
  FileText,
  MessageCircle,
  Bell,
  ChevronDown,
  Plus,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { useOrganization } from "@/hooks/organization-context";
import {
  getOrganizationPath,
  removeOrganizationId,
} from "@/utils/organization-routing";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string; // e.g. "Beta", "Soon"
};

type NavCategory = {
  title: string;
  items: NavItem[];
};

const navigationCategories: NavCategory[] = [
  {
    title: "",
    items: [
      { name: "Announcements", href: "/announcements", icon: Bell, badge: "Soon" },
      { name: "Chat", href: "/chat", icon: MessageCircle, badge: "Soon" },
    ],
  },
  {
    title: "",
    items: [
      { name: "Calendar", href: "/calendar", icon: Calendar },
      { name: "Payslips", href: "/payslips", icon: Receipt },
      { name: "Leave", href: "/leave", icon: Calendar, badge: "Beta" },
      { name: "Documents", href: "/documents", icon: FileText },
    ],
  },
];

type EmployeeSidebarProps = {
  onNavigate?: () => void;
};

export function EmployeeSidebar({ onNavigate }: EmployeeSidebarProps = {}) {
  const pathname = usePathname();
  const {
    currentOrganizationId,
    organizations,
    currentOrganization,
    switchOrganization,
    isLoading: orgsLoading,
  } = useOrganization();
  const [orgPopoverOpen, setOrgPopoverOpen] = useState(false);
  const [isCreateOrgDialogOpen, setIsCreateOrgDialogOpen] = useState(false);

  const cleanPathname = removeOrganizationId(pathname || "");

  return (
    <div className="flex h-full flex-col w-60 border-r border-[rgb(230,230,230)] bg-white font-sans overflow-hidden">
      {/* Organization switcher - same as admin/owner sidebar */}
      <div className="shrink-0 h-14 flex items-center px-3">
        <Popover open={orgPopoverOpen} onOpenChange={setOrgPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-1 pl-0 text-left transition-colors hover:bg-[rgb(250,250,250)] cursor-pointer min-w-0 h-9"
              style={{ color: "rgb(53, 58, 68)" }}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[rgb(245,245,245)] text-xs font-medium text-[rgb(64,64,64)]">
                {currentOrganization?.name?.trim()[0]?.toUpperCase() || "O"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">
                  {currentOrganization?.name || "Select organization"}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-[rgb(133,133,133)] transition-transform duration-200",
                  orgPopoverOpen && "rotate-180"
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-2"
            align="start"
            side="bottom"
          >
            {orgsLoading ? (
              <div className="px-3 py-4 text-center text-xs text-[rgb(133,133,133)]">
                Loading...
              </div>
            ) : organizations.length === 0 ? (
              <Button
                variant="ghost"
                className="w-full justify-start h-8 text-xs"
                onClick={() => {
                  setOrgPopoverOpen(false);
                  setIsCreateOrgDialogOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-2" />
                Create Organization
              </Button>
            ) : (
              <>
                <div className="max-h-[280px] overflow-y-auto space-y-0.5">
                  {organizations.map((org) => {
                    const initial = org.name?.trim()[0]?.toUpperCase() || "O";
                    const isSelected = org._id === currentOrganizationId;
                    return (
                      <button
                        key={org._id}
                        type="button"
                        onClick={() => {
                          switchOrganization(org._id as any);
                          setOrgPopoverOpen(false);
                        }}
                        className={cn(
                          "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm transition-colors",
                          isSelected
                            ? "bg-[rgb(245,245,245)] font-semibold"
                            : "hover:bg-[rgb(250,250,250)] font-normal"
                        )}
                        style={{
                          color: isSelected
                            ? "rgb(23, 43, 77)"
                            : "rgb(64, 64, 64)",
                          lineHeight: "normal",
                        }}
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(245,245,245)] text-xs font-medium text-[rgb(64,64,64)] shrink-0">
                          {initial}
                        </div>
                        <span className="truncate flex-1 text-left">
                          {org.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-[#DDDDDD] pt-1 mt-1">
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-8 text-xs"
                    onClick={() => {
                      setOrgPopoverOpen(false);
                      setIsCreateOrgDialogOpen(true);
                    }}
                  >
                    <Plus className="h-3 w-3 mr-2" />
                    Create Organization
                  </Button>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
        <CreateOrganizationDialog
          open={isCreateOrgDialogOpen}
          onOpenChange={setIsCreateOrgDialogOpen}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navigationCategories.map((category, index) => (
          <div key={category.title ? `cat-${category.title}` : `cat-${index}`} className="space-y-1">
            {category.title ? (
              <h2
                className="px-3 text-xs font-medium"
                style={{
                  color: "rgb(133, 133, 133)",
                  lineHeight: "normal",
                }}
              >
                {category.title}
              </h2>
            ) : null}
            <div className="space-y-1">
              {category.items.map((item) => {
                const orgHref = getOrganizationPath(
                  currentOrganizationId,
                  item.href
                );
                const isActive =
                  cleanPathname === item.href ||
                  cleanPathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.name}
                    href={orgHref}
                    onClick={onNavigate}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg pl-3 pr-2 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-purple-50 text-brand-purple font-semibold"
                        : "hover:bg-[rgb(250,250,250)] font-normal"
                    )}
                    style={{
                      color: isActive ? "rgb(105, 94, 255)" : "rgb(64, 64, 64)",
                      lineHeight: "normal",
                    }}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          item.badge === "Soon"
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
