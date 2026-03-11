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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2 py-0.5 text-[11px] text-gray-500">
          app.plinth.ph/payroll
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-900">Payroll</span>
          <span className="rounded bg-brand-purple px-2 py-0.5 text-[10px] font-medium text-white">
            + Process
          </span>
        </div>
        <div className="mt-1.5 space-y-1 text-[10px]">
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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2 py-0.5 text-[11px] text-gray-500">
          app.plinth.ph/attendance
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-900">Attendance</span>
          <span className="rounded bg-gray-200/80 px-2 py-0.5 text-[10px] text-gray-600">
            Feb 2026
          </span>
        </div>
        <div className="mt-1.5 space-y-1 text-[10px]">
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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-2 py-0.5 text-[11px] text-gray-500">
          app.plinth.ph/announcements
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="text-[11px] font-semibold text-gray-900">Company updates</div>
        <div className="mt-1.5 space-y-1.5">
          <div className="rounded-lg border border-white/80 bg-white/70 px-2.5 py-2 backdrop-blur-md">
            <div className="text-[10px] font-medium text-gray-900">Holiday schedule</div>
            <div className="text-[9px] text-gray-500">Mar 15</div>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/70 px-2.5 py-2 backdrop-blur-md">
            <div className="text-[10px] font-medium text-gray-900">Team sync</div>
            <div className="text-[9px] text-gray-500">Mar 12</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Liquid glass MacBook-style browser frame with feature dashboard display */
function MacBookBrowser() {
  return (
    <div
      className="relative overflow-hidden rounded-[2rem] border-[10px] border-gray-800/90 bg-gray-900 shadow-2xl"
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.1), 0 25px 50px -12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Top notch / camera */}
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="h-3 w-16 rounded-full bg-gray-950" />
      </div>

      {/* Screen — liquid glass */}
      <div
        className="relative overflow-hidden rounded-[1.25rem] border border-white/20 bg-gradient-to-br from-white/90 to-gray-100/80 backdrop-blur-2xl"
        style={{
          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.3), 0 0 0 1px rgba(255,255,255,0.5)",
        }}
      >
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-gray-200/60 bg-white/50 px-3 py-2 backdrop-blur-md">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
          </div>
          <div className="ml-2 flex flex-1 items-center rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-[10px] text-gray-500">
            app.plinth.ph
          </div>
        </div>

        {/* Feature dashboard content — not just payroll */}
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-900">Dashboard</span>
            <Link
              href={marketingUrl}
              className="text-[10px] font-medium text-brand-purple hover:text-brand-purple-hover"
            >
              Plinth
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-white/80 bg-white/70 p-2 backdrop-blur-md">
              <Receipt className="mb-1 h-3.5 w-3.5 text-brand-purple" />
              <div className="text-[9px] font-medium text-gray-900">Payroll</div>
              <div className="text-[7px] text-gray-500">2 periods</div>
            </div>
            <div className="rounded-lg border border-white/80 bg-white/70 p-2 backdrop-blur-md">
              <CalendarCheck className="mb-1 h-3.5 w-3.5 text-brand-purple" />
              <div className="text-[9px] font-medium text-gray-900">Attendance</div>
              <div className="text-[7px] text-gray-500">Feb 2026</div>
            </div>
            <div className="rounded-lg border border-white/80 bg-white/70 p-2 backdrop-blur-md">
              <MessageCircle className="mb-1 h-3.5 w-3.5 text-brand-purple" />
              <div className="text-[9px] font-medium text-gray-900">Announcements</div>
              <div className="text-[7px] text-gray-500">2 updates</div>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-white/80 bg-white/60 p-2 backdrop-blur-md">
            <div className="text-[8px] font-medium text-gray-700">People, payroll, and operations in one place</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Right-side panel for login/signup: MacBook browser + layered liquid glass snapshots.
 */
export function AuthSidePanel() {
  return (
    <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50/80 to-indigo-50/80 items-center justify-center p-12">
      <div className="relative w-full max-w-lg">
        {/* Main — liquid glass MacBook browser with feature dashboard */}
        <div className="relative">
          <MacBookBrowser />
        </div>

        {/* Overlapping snapshot 1 — Payroll (top-right), larger */}
        <div
          className="absolute -right-2 -top-4 w-[200px]"
          style={{ transform: "rotate(3deg)" }}
        >
          <MiniPayrollCard />
        </div>

        {/* Overlapping snapshot 2 — Attendance (bottom-left), larger */}
        <div
          className="absolute -left-4 bottom-4 w-[190px]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <MiniAttendanceCard />
        </div>

        {/* Overlapping snapshot 3 — Announcements (bottom-right), larger */}
        <div
          className="absolute -right-4 bottom-2 w-[180px]"
          style={{ transform: "rotate(2deg)" }}
        >
          <MiniAnnouncementsCard />
        </div>
      </div>
    </div>
  );
}
