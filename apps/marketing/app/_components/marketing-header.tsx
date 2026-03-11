"use client";

import { useState } from "react";
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

export function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 overflow-x-hidden">
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

      {/* Mobile/tablet menu overlay — fixed to avoid header overflow clipping */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-[100] bg-black/20 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed left-0 right-0 z-[100] border-b border-gray-200 bg-white shadow-lg lg:hidden"
            style={{ top: "3.5rem" }}
          >
            <nav className="flex flex-col gap-1 p-4 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
              <Link
                href="/features"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                Features
              </Link>
              <Link
                href="/whos-it-for"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                Who&apos;s it for
              </Link>
              <Link
                href="/resources"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                Resources
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                Pricing
              </Link>
              <Link
                href="/support"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                Support
              </Link>
              <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-3">
                <ActionButtons className="w-full" />
              </div>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
