"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  Briefcase,
  MessageSquare,
  Settings,
  Receipt,
  Clock,
  ClipboardList,
  LogOut,
  MessageCircle,
  Calculator,
  Bell,
  Package,
  ChevronDown,
  ChevronRight,
  User,
  Building2,
  Wallet,
  BriefcaseIcon,
  Users as UsersIcon,
  Calendar as CalendarIcon,
  Info,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { authClient } from "@/lib/auth-client";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

type NavigationItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[];
  subItems?: NavigationItem[];
};

type NavigationCategory = {
  title: string;
  items: NavigationItem[];
};

const dashboardItem: NavigationItem = {
  name: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
};

const settingsItem: NavigationItem = {
  name: "Settings",
  href: "/settings/organizations",
  icon: Settings,
  subItems: [
    {
      name: "Organization",
      href: "/settings/organizations",
      icon: Building2,
    },
    {
      name: "Payroll Settings",
      href: "/settings/payroll",
      icon: Wallet,
      roles: ["admin", "hr", "accounting"],
    },
    {
      name: "Leave Types",
      href: "/settings/leave-types",
      icon: CalendarIcon,
      roles: ["admin", "hr", "accounting"],
    },
    {
      name: "Departments",
      href: "/settings/departments",
      icon: BriefcaseIcon,
      roles: ["admin", "hr", "accounting"],
    },
    {
      name: "Holidays",
      href: "/settings/holidays",
      icon: CalendarIcon,
      roles: ["admin", "hr", "accounting"],
    },
  ],
};

const navigationCategories: NavigationCategory[] = [
  {
    title: "Human Resources",
    items: [
      {
        name: "Employees",
        href: "/employees",
        icon: Users,
        roles: ["admin", "hr", "accounting"],
      },
      {
        name: "Attendance",
        href: "/attendance",
        icon: Clock,
        roles: ["admin", "hr", "accounting"],
      },
      {
        name: "Evaluations",
        href: "/evaluations",
        icon: FileText,
        roles: ["admin", "hr", "accounting"],
      },
      { name: "Leave", href: "/leave", icon: Calendar },
      { name: "Requirements", href: "/requirements", icon: ClipboardList },
      { name: "Recruitment", href: "/recruitment", icon: Briefcase },
    ],
  },
  {
    title: "Finance",
    items: [
      {
        name: "Payroll",
        href: "/payroll",
        icon: Receipt,
        roles: ["admin", "hr", "accounting"],
      },
      {
        name: "Accounting",
        href: "/accounting",
        icon: Calculator,
        roles: ["admin", "accounting"],
      },
    ],
  },
  {
    title: "Communication",
    items: [
      { name: "Announcements", href: "/announcements", icon: Bell },
      {
        name: "Chat",
        href: "/chat",
        icon: MessageCircle,
        roles: ["admin", "hr", "accounting", "employee"],
      },
    ],
  },
  {
    title: "Media & Tools",
    items: [
      {
        name: "Documents",
        href: "/documents",
        icon: FileText,
        roles: ["admin", "hr", "accounting", "employee"],
      },
      {
        name: "Assets Management",
        href: "/assets",
        icon: Package,
        roles: ["admin", "hr", "accounting"],
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  // Filter navigation items based on user role
  const filterItems = (items: NavigationItem[]) => {
    return items.filter((item) => {
      if (!item.roles) return true; // No role restriction
      if (!user?.role) {
        // If role is undefined, deny access (should be fixed by getCurrentUser fallback)
        return false;
      }
      return item.roles.includes(user.role);
    });
  };

  // Check if dashboard should be shown (no role restriction, so always show)
  const showDashboard =
    !dashboardItem.roles || filterItems([dashboardItem]).length > 0;

  // Check if settings should be shown (no role restriction, so always show)
  const showSettings =
    !settingsItem.roles || filterItems([settingsItem]).length > 0;

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
    const isActive =
      pathname === item.href || pathname?.startsWith(item.href + "/");
    const hasSubItems = item.subItems && item.subItems.length > 0;
    const isExpanded = expandedItems.has(item.name);
    const filteredSubItems = hasSubItems ? filterItems(item.subItems!) : [];

    // Check if any sub-item is active
    const hasActiveSubItem = hasSubItems
      ? filteredSubItems.some(
          (subItem) =>
            pathname === subItem.href ||
            pathname?.startsWith(subItem.href + "/")
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
                ? "bg-purple-50 text-purple-600 font-semibold"
                : "hover:bg-gray-50 font-normal"
            )}
            style={{
              color:
                isActive && !hasActiveSubItem
                  ? "rgb(147, 51, 234)"
                  : "rgb(53, 58, 68)",
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
                isExpanded ? "rotate-180" : "rotate-0"
              )}
            />
          </button>
          <div
            className={cn(
              "space-y-1 overflow-hidden transition-all duration-300 ease-in-out",
              isExpanded && isMounted
                ? "max-h-[500px] opacity-100"
                : "max-h-0 opacity-0"
            )}
            style={{
              transitionProperty: "max-height, opacity",
            }}
          >
            {filteredSubItems.map((subItem) => {
              const isSubItemActive =
                pathname === subItem.href ||
                pathname?.startsWith(subItem.href + "/");
              return (
                <Link
                  key={subItem.name}
                  href={subItem.href}
                  className={cn(
                    "flex items-center rounded-lg py-2 pr-3 text-sm transition-colors pl-9",
                    isSubItemActive
                      ? "bg-purple-50 text-purple-600 font-semibold"
                      : "hover:bg-gray-50 font-normal"
                  )}
                  style={{
                    color: isSubItemActive
                      ? "rgb(147, 51, 234)"
                      : "rgb(53, 58, 68)",
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
        href={item.href}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
          isSubItem && "ml-4",
          isActive
            ? "bg-gray-100 text-purple-600 font-semibold"
            : "hover:bg-gray-100 font-normal"
        )}
        style={{
          color: isActive ? "rgb(147, 51, 234)" : "rgb(53, 58, 68)",
          lineHeight: "normal",
        }}
      >
        <item.icon className="h-4 w-4" />
        {item.name}
      </Link>
    );
  };

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const userInitials =
    user?.role === "admin"
      ? "A"
      : user?.name
          ?.split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) ||
        user?.email?.[0].toUpperCase() ||
        "U";

  return (
    <div
      className="flex h-full w-60 flex-col border-r border-gray-200 bg-white"
      style={{
        fontFamily:
          '-apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
      }}
    >
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
      <div className="px-3 py-3">
        <OrganizationSwitcher />
      </div>
      <div className="border-b border-gray-200 shadow-sm"></div>
      <nav
        ref={navRef}
        className={`sidebar-nav flex-1 overflow-y-auto px-3 py-4 ${
          isScrolling ? "scrolling" : ""
        }`}
      >
        <div className="space-y-6">
          {/* Dashboard without category header */}
          {showDashboard && (
            <div className="space-y-1">{renderNavItem(dashboardItem)}</div>
          )}
          {/* Categories with headers */}
          {filteredCategories.map((category) => (
            <div key={category.title} className="space-y-1">
              <h2
                className="px-3 text-xs"
                style={{
                  color: "rgb(89, 97, 113)",
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
          {/* Settings without category header */}
          <div className="space-y-1">
            {showSettings && renderNavItem(settingsItem)}
          </div>
        </div>
      </nav>

      {/* User Account Popover at bottom */}
      <div className="border-t border-gray-200 p-3">
        <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex w-full items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-normal transition-colors hover:bg-gray-50"
              style={{
                color: "rgb(53, 58, 68)",
                lineHeight: "normal",
              }}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs bg-gray-100 text-gray-600">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 text-left truncate">
                {user?.role === "admin"
                  ? "Admin"
                  : user?.name || user?.email || "User"}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  userPopoverOpen && "-rotate-90"
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start" side="top">
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-gray-100 text-gray-600">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {user?.role === "admin" ? "Admin" : user?.name || "User"}
                  </p>
                  {user?.role !== "admin" && (
                    <p className="text-xs text-gray-500 truncate">
                      {user?.email}
                    </p>
                  )}
                </div>
              </div>
              <Separator className="my-3" />
              <Link
                href="/settings/account"
                onClick={() => setUserPopoverOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-normal rounded-lg hover:bg-gray-50 transition-colors"
                style={{
                  color: "rgb(53, 58, 68)",
                }}
              >
                <Info className="h-4 w-4" />
                Account
              </Link>
              <Separator className="my-2" />
              <button
                onClick={async () => {
                  setUserPopoverOpen(false);
                  await handleLogout();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-normal rounded-lg hover:bg-gray-50 transition-colors"
                style={{
                  color: "rgb(53, 58, 68)",
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
