"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { MarketingNav } from "./marketing-nav";

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

function ActionButtons({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3 ${className}`}>
      <Link
        href="/request-demo"
        className="text-center text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        Request demo
      </Link>
      <Link
        href={mainAppUrl ? `${mainAppUrl}/login` : "/login"}
        className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
      >
        Log in
      </Link>
      <Link
        href={mainAppUrl ? `${mainAppUrl}/signup` : "/signup"}
        className="inline-flex items-center justify-center rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-white hover:bg-brand-purple-hover transition-colors"
      >
        Get Started
      </Link>
    </div>
  );
}

function MobileMenuPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white overscroll-contain lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      {/* Header with close */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4 sm:px-6">
        <span className="text-xl font-semibold text-gray-900">Menu</span>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -m-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Nav + actions — scroll only when content overflows */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <Link
            href="/features"
            className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            onClick={onClose}
          >
            Features
          </Link>
          <Link
            href="/whos-it-for"
            className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            onClick={onClose}
          >
            Who&apos;s it for
          </Link>
          <Link
            href="/resources"
            className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            onClick={onClose}
          >
            Resources
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            onClick={onClose}
          >
            Pricing
          </Link>
          <Link
            href="/support"
            className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            onClick={onClose}
          >
            Support
          </Link>
        </div>
        <div className="mt-6 pt-6 border-t border-gray-200 flex flex-col gap-3">
          <ActionButtons className="w-full" />
        </div>
      </nav>
    </div>
  );
}

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (menuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
    } else {
      const scrollY = Math.abs(parseInt(document.body.style.top || "0", 10));
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      window.scrollTo(0, scrollY);
    }
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 min-w-0">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-gray-900 shrink-0"
        >
          <span className="text-xl">Plinth</span>
        </Link>

        {/* Desktop: nav + actions */}
        <div className="hidden lg:flex lg:items-center lg:gap-8 lg:flex-1 lg:justify-center">
          <MarketingNav />
        </div>
        <div className="hidden lg:flex lg:items-center lg:gap-3 shrink-0">
          <ActionButtons />
        </div>

        {/* Mobile/tablet: hamburger */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="lg:hidden p-2 -m-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Full-page menu via portal — renders at body, unaffected by header */}
      {menuOpen && mounted && typeof document !== "undefined" &&
        createPortal(
          <MobileMenuPanel onClose={() => setMenuOpen(false)} />,
          document.body
        )}
    </header>
  );
}
