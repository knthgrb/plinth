"use client";

import { Sidebar } from "./sidebar";
import { EmployeeSidebar } from "./employee-sidebar";
import { Header } from "./header";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { SettingsModalProvider } from "@/hooks/settings-modal-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MainLoader } from "@/components/main-loader";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const hasLoadedUser = useRef(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Track if we've successfully loaded the user at least once
  useEffect(() => {
    if (user !== undefined) {
      hasLoadedUser.current = true;
    }
  }, [user]);

  useEffect(() => {
    if (user === null) {
      // Not authenticated, redirect to login
      router.push("/login");
    }
  }, [user, router]);

  // Handle scroll detection for main content
  useEffect(() => {
    const mainElement = mainContentRef.current;
    if (!mainElement) return;

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

    mainElement.addEventListener("scroll", handleScroll);
    mainElement.addEventListener("mouseenter", handleMouseEnter);
    mainElement.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      mainElement.removeEventListener("scroll", handleScroll);
      mainElement.removeEventListener("mouseenter", handleMouseEnter);
      mainElement.removeEventListener("mouseleave", handleMouseLeave);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Only show full-screen loading on initial load, not during refetches
  if (user === undefined && !hasLoadedUser.current) {
    return <MainLoader />;
  }

  if (user === null || !currentOrganizationId) {
    return null;
  }

  // Only show employee sidebar if user role is explicitly "employee"
  // Default to admin sidebar for admin/hr/accounting or if role is undefined
  const isEmployee = user?.role === "employee";

  return (
    <SettingsModalProvider>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .main-content::-webkit-scrollbar {
            width: 4px;
            background: transparent;
          }
          .main-content::-webkit-scrollbar-track {
            background: transparent;
          }
          .main-content::-webkit-scrollbar-thumb {
            background: transparent;
            border-radius: 2px;
            transition: background 0.5s ease-out;
          }
          .main-content.scrolling::-webkit-scrollbar-thumb,
          .main-content:hover::-webkit-scrollbar-thumb {
            background: #d1d5db;
            transition: background 0.2s ease-in;
          }
          .main-content::-webkit-scrollbar-thumb:hover {
            background: #9ca3af;
          }
          .main-content {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent;
            transition: scrollbar-color 0.5s ease-out;
          }
          .main-content.scrolling,
          .main-content:hover {
            scrollbar-color: #d1d5db transparent;
            transition: scrollbar-color 0.2s ease-in;
          }
        `,
        }}
      />
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Desktop Sidebar - hidden on mobile/tablet */}
        {isEmployee ? (
          <div className="hidden lg:block">
            <EmployeeSidebar />
          </div>
        ) : (
          <div className="hidden lg:block">
            <Sidebar />
          </div>
        )}

        {/* Mobile Menu Drawer */}
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetContent
            side="left"
            className="w-[280px] sm:w-[320px] p-0 overflow-hidden"
          >
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <div className="h-full overflow-hidden">
              {isEmployee ? (
                <EmployeeSidebar
                  onNavigate={() => setIsMobileMenuOpen(false)}
                />
              ) : (
                <Sidebar onNavigate={() => setIsMobileMenuOpen(false)} />
              )}
            </div>
          </SheetContent>
        </Sheet>

        <main
          ref={mainContentRef}
          className={`main-content flex-1 flex flex-col overflow-hidden bg-white ${
            isScrolling ? "scrolling" : ""
          }`}
        >
          <Header onMobileMenuOpen={() => setIsMobileMenuOpen(true)} />
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1400px] mx-auto w-full">{children}</div>
          </div>
        </main>
      </div>
    </SettingsModalProvider>
  );
}
