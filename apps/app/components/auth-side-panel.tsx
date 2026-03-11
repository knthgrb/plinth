"use client";

import Link from "next/link";
import { Receipt, CalendarCheck, MessageCircle } from "lucide-react";

const marketingUrl =
  process.env.NEXT_PUBLIC_MARKETING_APP_URL ?? process.env.NEXT_PUBLIC_MARKETING_URL ?? "/";

const glassPanel =
  "rounded-xl border border-white/60 bg-white/70 shadow-xl shadow-gray-300/40 backdrop-blur-xl";

function MiniPayrollCard() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 8px 16px -4px rgba(0,0,0,0.1)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2.5 py-0.5 text-[13px] text-gray-500">
          app.plinth.ph/payroll
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900">Payroll</span>
          <span className="rounded bg-brand-purple px-2.5 py-0.5 text-[12px] font-medium text-white">
            + Process
          </span>
        </div>
        <div className="mt-2 space-y-1.5 text-[12px]">
          <div className="flex justify-between text-gray-600">
            <span>Feb 11–25</span>
            <span className="rounded-full bg-blue-100/90 px-1 py-0.5 text-blue-800">Finalized</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Mar 1–15</span>
            <span className="rounded-full bg-amber-100/90 px-1 py-0.5 text-amber-800">Draft</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniAttendanceCard() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 8px 16px -4px rgba(0,0,0,0.1)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2.5 py-0.5 text-[13px] text-gray-500">
          app.plinth.ph/attendance
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900">Attendance</span>
          <span className="rounded bg-gray-200/80 px-2.5 py-0.5 text-[12px] text-gray-600">
            Feb 2026
          </span>
        </div>
        <div className="mt-2 space-y-1.5 text-[12px]">
          <div className="flex justify-between">
            <span className="text-gray-900">Feb 18</span>
            <span className="text-gray-600">9:13 → 6:00</span>
            <span className="rounded-full bg-green-100/90 px-1 py-0.5 text-green-800">Present</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">Feb 13</span>
            <span className="text-gray-600">9:07 → 6:00</span>
            <span className="rounded-full bg-green-100/90 px-1 py-0.5 text-green-800">Present</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniAnnouncementsCard() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 8px 16px -4px rgba(0,0,0,0.1)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2.5 py-0.5 text-[13px] text-gray-500">
          app.plinth.ph/announcements
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-4 backdrop-blur-sm">
        <div className="text-[13px] font-semibold text-gray-900">Company updates</div>
        <div className="mt-2 space-y-2">
          <div className="rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 backdrop-blur-md">
            <div className="text-[12px] font-medium text-gray-900">Holiday schedule</div>
            <div className="text-[11px] text-gray-500">Mar 15</div>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 backdrop-blur-md">
            <div className="text-[12px] font-medium text-gray-900">Team sync</div>
            <div className="text-[11px] text-gray-500">Mar 12</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Liquid glass browser — no laptop frame, just browser chrome + content */
function LiquidGlassBrowser() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/40 bg-gradient-to-br from-white/85 to-gray-100/75 shadow-2xl shadow-purple-200/30 backdrop-blur-2xl"
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.6), 0 25px 50px -12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)",
      }}
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-gray-200/60 bg-white/60 px-4 py-2.5 backdrop-blur-md">
        <div className="flex gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/90" />
          <div className="h-3 w-3 rounded-full bg-amber-400/90" />
          <div className="h-3 w-3 rounded-full bg-emerald-400/90" />
        </div>
        <div className="ml-2 flex flex-1 items-center rounded-lg border border-gray-200/80 bg-white/90 px-4 py-2 text-sm text-gray-500">
          app.plinth.ph
        </div>
      </div>

      {/* Feature dashboard content */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-semibold text-gray-900">Dashboard</span>
          <Link
            href={marketingUrl}
            className="text-sm font-medium text-brand-purple hover:text-brand-purple-hover"
          >
            Plinth
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/80 bg-white/70 p-3 backdrop-blur-md">
            <Receipt className="mb-2 h-5 w-5 text-brand-purple" />
            <div className="text-sm font-medium text-gray-900">Payroll</div>
            <div className="text-xs text-gray-500">2 periods</div>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/70 p-3 backdrop-blur-md">
            <CalendarCheck className="mb-2 h-5 w-5 text-brand-purple" />
            <div className="text-sm font-medium text-gray-900">Attendance</div>
            <div className="text-xs text-gray-500">Feb 2026</div>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/70 p-3 backdrop-blur-md">
            <MessageCircle className="mb-2 h-5 w-5 text-brand-purple" />
            <div className="text-sm font-medium text-gray-900">Announcements</div>
            <div className="text-xs text-gray-500">2 updates</div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-white/80 bg-white/60 p-3 backdrop-blur-md">
          <div className="text-sm font-medium text-gray-700">
            People, payroll, and operations in one place
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Right-side panel for login/signup: liquid glass browser + layered snapshots.
 */
export function AuthSidePanel() {
  return (
    <div className="hidden lg:flex flex-1 min-w-0 bg-gradient-to-br from-purple-50/80 to-indigo-50/80 items-center justify-center p-4">
      <div className="relative h-full w-full max-w-3xl min-h-[400px] flex items-center justify-center">
        {/* Main — liquid glass browser (no laptop border) */}
        <div className="relative z-0 w-full max-w-lg">
          <LiquidGlassBrowser />
        </div>

        {/* Layer 1 — Attendance (back, bottom-left) */}
        <div
          className="absolute -left-2 bottom-2 z-10 w-[280px]"
          style={{ transform: "rotate(-5deg)" }}
        >
          <MiniAttendanceCard />
        </div>

        {/* Layer 2 — Payroll (middle, top-right) */}
        <div
          className="absolute -right-2 -top-2 z-20 w-[260px]"
          style={{ transform: "rotate(4deg)" }}
        >
          <MiniPayrollCard />
        </div>

        {/* Layer 3 — Announcements (front, bottom-right) */}
        <div
          className="absolute -right-4 bottom-4 z-30 w-[240px]"
          style={{ transform: "rotate(3deg)" }}
        >
          <MiniAnnouncementsCard />
        </div>
      </div>
    </div>
  );
}
