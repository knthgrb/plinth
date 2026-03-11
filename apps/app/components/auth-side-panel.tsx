"use client";

import Link from "next/link";
import { Receipt, CalendarCheck, MessageCircle } from "lucide-react";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "/";

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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-2 py-1 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-[9px] text-gray-500">
          app.plinth.ph/payroll
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-2 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-gray-900">Payroll</span>
          <span className="rounded bg-brand-purple px-1.5 py-0.5 text-[8px] font-medium text-white">
            + Process
          </span>
        </div>
        <div className="mt-1 space-y-0.5 text-[8px]">
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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-2 py-1 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-[9px] text-gray-500">
          app.plinth.ph/attendance
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-2 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-gray-900">Attendance</span>
          <span className="rounded bg-gray-200/80 px-1.5 py-0.5 text-[8px] text-gray-600">
            Feb 2026
          </span>
        </div>
        <div className="mt-1 space-y-0.5 text-[8px]">
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
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-2 py-1 backdrop-blur-sm">
        <span className="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-[9px] text-gray-500">
          app.plinth.ph/announcements
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-2 backdrop-blur-sm">
        <div className="text-[9px] font-semibold text-gray-900">Company updates</div>
        <div className="mt-1 space-y-1">
          <div className="rounded-lg border border-white/80 bg-white/70 px-2 py-1.5 backdrop-blur-md">
            <div className="text-[8px] font-medium text-gray-900">Holiday schedule</div>
            <div className="text-[7px] text-gray-500">Mar 15</div>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/70 px-2 py-1.5 backdrop-blur-md">
            <div className="text-[8px] font-medium text-gray-900">Team sync</div>
            <div className="text-[7px] text-gray-500">Mar 12</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Right-side panel for login/signup: layered liquid glass snapshots + Plinth branding.
 */
export function AuthSidePanel() {
  const features = [
    {
      icon: Receipt,
      title: "Payroll",
      description: "SSS, PhilHealth, Pag-IBIG & BIR compliant",
    },
    {
      icon: CalendarCheck,
      title: "Attendance & Leave",
      description: "Encoding, approvals, and balances",
    },
    {
      icon: MessageCircle,
      title: "Announcements & Chat",
      description: "Keep everyone connected",
    },
  ];

  return (
    <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50/80 to-indigo-50/80 items-center justify-center p-12">
      <div className="relative w-full max-w-md">
        {/* Main card — layered base */}
        <div
          className="relative rounded-2xl border border-white/80 bg-white/90 p-10 shadow-2xl shadow-purple-200/20 backdrop-blur-xl"
          style={{
            boxShadow: "0 0 0 1px rgba(255,255,255,0.8), 0 25px 50px -12px rgba(0,0,0,0.12)",
          }}
        >
          <div className="text-center">
            <Link
              href={marketingUrl}
              className="inline-block text-4xl font-bold tracking-tight text-brand-purple transition-colors hover:text-brand-purple-hover focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2 rounded-md"
              title="Go to Plinth"
            >
              Plinth
            </Link>
            <p className="mt-2 text-gray-600">
              People, payroll, and operations in one place
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex items-start gap-3 rounded-xl border border-white/80 bg-white/70 p-3 shadow-lg shadow-gray-200/30 backdrop-blur-md"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{title}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Overlapping snapshot 1 — Payroll (top-right) */}
        <div
          className="absolute -right-4 -top-2 w-[140px]"
          style={{ transform: "rotate(3deg)" }}
        >
          <MiniPayrollCard />
        </div>

        {/* Overlapping snapshot 2 — Attendance (bottom-left) */}
        <div
          className="absolute -left-2 bottom-8 w-[130px]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <MiniAttendanceCard />
        </div>

        {/* Overlapping snapshot 3 — Announcements (bottom-right, smaller) */}
        <div
          className="absolute -right-2 bottom-4 w-[120px]"
          style={{ transform: "rotate(2deg)" }}
        >
          <MiniAnnouncementsCard />
        </div>
      </div>
    </div>
  );
}
