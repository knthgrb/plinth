"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  Briefcase,
  MessageSquare,
  Receipt,
  Clock,
  ClipboardList,
  MessageCircle,
  Calculator,
  Bell,
  Package,
  ChevronDown,
  ChevronLeft,
  Wallet,
  BriefcaseIcon,
  Users as UsersIcon,
  Calendar as CalendarIcon,
  Plus,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import {
  getOrganizationPath,
  removeOrganizationId,
} from "@/utils/organization-routing";
import { effectiveRole, rolesForPath } from "@/utils/role-access";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";

type NavigationItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[];
  subItems?: NavigationItem[];
  badge?: string; // e.g. "Beta"
};

type NavigationCategory = {
  title: string;
  items: NavigationItem[];
};

const dashboardItem: NavigationItem = {
  name: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  roles: rolesForPath("/dashboard"),
};

const calendarItem: NavigationItem = {
  name: "Calendar",
  href: "/calendar",
  icon: CalendarIcon,
  roles: rolesForPath("/calendar"),
};

// Role-based nav: single source of truth from utils/role-access.ts
const navigationCategories: NavigationCategory[] = [
  {
    title: "Human Resources",
    items: [
      { name: "Employees", href: "/employees", icon: Users, roles: rolesForPath("/employees") },
      { name: "Attendance", href: "/attendance", icon: Clock, roles: rolesForPath("/attendance") },
      { name: "Evaluations", href: "/evaluations", icon: FileText, roles: rolesForPath("/evaluations") },
      { name: "Leave", href: "/leave", icon: Calendar, badge: "Beta", roles: rolesForPath("/leave") },
      { name: "Requirements", href: "/requirements", icon: ClipboardList, roles: rolesForPath("/requirements") },
      { name: "Recruitment", href: "/recruitment", icon: Briefcase, roles: rolesForPath("/recruitment") },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Payroll", href: "/payroll", icon: Receipt, badge: "Beta", roles: rolesForPath("/payroll") },
      { name: "Accounting", href: "/accounting", icon: Calculator, badge: "Beta", roles: rolesForPath("/accounting") },
    ],
  },
  {
    title: "Communication",
    items: [
      { name: "Announcements", href: "/announcements", icon: Bell, badge: "Soon", roles: rolesForPath("/announcements") },
      { name: "Chat", href: "/chat", icon: MessageCircle, badge: "Soon", roles: rolesForPath("/chat") },
    ],
  },
  {
    title: "Media & Tools",
    items: [
      { name: "Documents", href: "/documents", icon: FileText, roles: rolesForPath("/documents") },
      { name: "Assets Management", href: "/assets", icon: Package, roles: rolesForPath("/assets") },
    ],
  },
];

type SidebarProps = {
  onNavigate?: () => void; // Callback to close mobile menu when navigating
};

// SettingsPopoverItem removed - Settings is now in header modal

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const {
    currentOrganizationId,
    organizations,
    currentOrganization,
    switchOrganization,
    isLoading: orgsLoading,
  } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  // Filter navigation items based on user role (uses role-access effectiveRole)
  const filterItems = (items: NavigationItem[]) => {
    return items.filter((item) => {
      if (!item.roles || item.roles.length === 0) return false; // Only show items with defined roles
      const role = effectiveRole(user?.role);
      if (!role) return false;
      return item.roles.includes(role);
    });
  };

  // Check if dashboard should be shown (no role restriction, so always show)
  const showDashboard =
    !dashboardItem.roles || filterItems([dashboardItem]).length > 0;

  // Settings removed - now accessible via Settings icon in header

  // Filter categories and their items based on user role
  const filteredCategories = navigationCategories
    .map((category) => ({
      ...category,
      items: filterItems(category.items),
    }))
    .filter((category) => category.items.length > 0); // Only show categories with visible items

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isMounted, setIsMounted] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [orgPopoverOpen, setOrgPopoverOpen] = useState(false);
  const [isCreateOrgDialogOpen, setIsCreateOrgDialogOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set mounted state after initial render to prevent flash of submenu items
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Handle scroll detection for sidebar
  useEffect(() => {
    const navElement = navRef.current;
    if (!navElement) return;

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    const handleMouseEnter = () => setIsScrolling(true);
    const handleMouseLeave = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 500);
    };

    navElement.addEventListener("scroll", handleScroll);
    navElement.addEventListener("mouseenter", handleMouseEnter);
    navElement.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      navElement.removeEventListener("scroll", handleScroll);
      navElement.removeEventListener("mouseenter", handleMouseEnter);
      navElement.removeEventListener("mouseleave", handleMouseLeave);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const toggleExpanded = (itemName: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemName)) {
        newSet.delete(itemName);
      } else {
        newSet.add(itemName);
      }
      return newSet;
    });
  };

  const renderNavItem = (item: NavigationItem, isSubItem = false) => {
    // Get organization-aware href
    const orgHref = getOrganizationPath(currentOrganizationId, item.href);
    // Check if active (compare with pathname that may or may not have organizationId)
    const cleanPathname = removeOrganizationId(pathname || "");
    const isActive =
      cleanPathname === item.href || cleanPathname?.startsWith(item.href + "/");
    const hasSubItems = item.subItems && item.subItems.length > 0;
    const isExpanded = expandedItems.has(item.name);
    const filteredSubItems = hasSubItems ? filterItems(item.subItems!) : [];

    // Check if any sub-item is active
    const hasActiveSubItem = hasSubItems
      ? filteredSubItems.some(
          (subItem) =>
            cleanPathname === subItem.href ||
            cleanPathname?.startsWith(subItem.href + "/"),
        )
      : false;

    if (hasSubItems && filteredSubItems.length > 0) {
      return (
        <div key={item.name} className="space-y-1">
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
              // Don't apply active style to parent if a sub-item is active
              isActive && !hasActiveSubItem
                ? "bg-purple-50 text-brand-purple font-semibold"
                : "hover:bg-[rgb(250,250,250)] font-normal",
            )}
            style={{
              color:
                isActive && !hasActiveSubItem
                  ? "rgb(105, 94, 255)"
                  : "rgb(64, 64, 64)",
              lineHeight: "normal",
            }}
          >
            <div className="flex items-center gap-2">
              <item.icon className="h-4 w-4" />
              {item.name}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-300 ease-in-out",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            />
          </button>
          <div
            className={cn(
              "space-y-1 overflow-hidden transition-all duration-300 ease-in-out",
              isExpanded && isMounted
                ? "max-h-[500px] opacity-100"
                : "max-h-0 opacity-0",
            )}
            style={{
              transitionProperty: "max-height, opacity",
            }}
          >
            {filteredSubItems.map((subItem) => {
              const subItemOrgHref = getOrganizationPath(
                currentOrganizationId,
                subItem.href,
              );
              const isSubItemActive =
                cleanPathname === subItem.href ||
                cleanPathname?.startsWith(subItem.href + "/");
              return (
                <Link
                  key={subItem.name}
                  href={subItemOrgHref}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center rounded-lg py-2 pr-3 text-sm transition-colors pl-9",
                    isSubItemActive
                      ? "bg-purple-50 text-brand-purple font-semibold"
                      : "hover:bg-[rgb(250,250,250)] font-normal",
                  )}
                  style={{
                    color: isSubItemActive
                      ? "rgb(105, 94, 255)"
                      : "rgb(64, 64, 64)",
                    lineHeight: "normal",
                  }}
                >
                  {subItem.name}
                </Link>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <Link
        key={item.name}
        href={orgHref}
        onClick={onNavigate}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg pl-3 pr-2 py-2 text-sm transition-colors",
          isSubItem && "ml-4",
          isActive
            ? "bg-purple-50 text-brand-purple font-semibold"
            : "hover:bg-[rgb(250,250,250)] font-normal",
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
                : "bg-amber-100 text-amber-800",
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col w-60 border-r border-[rgb(230,230,230)] bg-white font-sans overflow-hidden">
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .sidebar-nav::-webkit-scrollbar {
            width: 4px;
            background: transparent;
          }
          .sidebar-nav::-webkit-scrollbar-track {
            background: transparent;
          }
          .sidebar-nav::-webkit-scrollbar-thumb {
            background: transparent;
            border-radius: 2px;
            transition: background 0.5s ease-out;
          }
          .sidebar-nav.scrolling::-webkit-scrollbar-thumb,
          .sidebar-nav:hover::-webkit-scrollbar-thumb {
            background: #d1d5db;
            transition: background 0.2s ease-in;
          }
          .sidebar-nav::-webkit-scrollbar-thumb:hover {
            background: #9ca3af;
          }
          .sidebar-nav {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
            transition: scrollbar-color 0.5s ease-out;
          }
          .sidebar-nav.scrolling,
          .sidebar-nav:hover {
            scrollbar-color: #d1d5db transparent;
            transition: scrollbar-color 0.2s ease-in;
          }
        `,
        }}
      />
      {/* Organization switcher - same height as main header (h-12), aligned with search */}
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
                  orgPopoverOpen && "rotate-180",
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
                            : "hover:bg-[rgb(250,250,250)] font-normal",
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
      <nav
        ref={navRef}
        className={cn(
          "sidebar-nav flex-1 overflow-y-auto px-3 py-4",
          isScrolling ? "scrolling" : "",
        )}
      >
        <div className="space-y-6">
          {/* Dashboard without category header */}
          {showDashboard && (
            <div className="space-y-1">
              {renderNavItem(dashboardItem)}
              {filterItems([calendarItem]).length > 0 && renderNavItem(calendarItem)}
            </div>
          )}
          {/* Categories with headers */}
          {filteredCategories.map((category) => (
            <div key={category.title} className="space-y-1">
              <h2
                className="px-3 text-xs font-medium"
                style={{
                  color: "rgb(133, 133, 133)",
                  lineHeight: "normal",
                }}
              >
                {category.title}
              </h2>
              <div className="space-y-1">
                {category.items.map((item) => renderNavItem(item))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
