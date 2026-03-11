"use client";

import { AuthHeroBackground } from "@/components/auth-hero-background";

const glassPanel =
  "rounded-2xl border border-white/60 bg-white/70 shadow-2xl shadow-gray-300/50 backdrop-blur-xl";
const glassInner =
  "rounded-lg border border-white/80 bg-white/60 backdrop-blur-md";

/** Overlay — Payroll snapshot (small card) */
function OverlayPayrollCard() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.15)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
          <span className="ml-2 min-w-0 truncate rounded bg-white/80 px-2.5 py-0.5 text-xs text-gray-500 backdrop-blur-sm">
            app.plinth.ph/payroll
          </span>
        </div>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Payroll</h3>
          <span className="shrink-0 rounded-md bg-brand-purple px-2 py-1 text-[10px] font-medium text-white">
            + Process
          </span>
        </div>
        <div className={glassInner + " overflow-hidden"}>
          <div className="border-b border-gray-100/80 bg-gray-50/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Payroll Runs
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-gray-100/80 text-left text-gray-500">
                <th className="px-2 py-1 font-medium">Period</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100/60">
                <td className="px-2 py-1 text-gray-900">Feb 11–25, 2026</td>
                <td className="px-2 py-1">
                  <span className="rounded-full bg-blue-100/90 px-1.5 py-0.5 font-medium text-blue-800">
                    Finalized
                  </span>
                </td>
              </tr>
              <tr>
                <td className="px-2 py-1 text-gray-900">Mar 1–15, 2026</td>
                <td className="px-2 py-1">
                  <span className="rounded-full bg-amber-100/90 px-1.5 py-0.5 font-medium text-amber-800">
                    Draft
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Big liquid glass browser — Employees (table layout, no sidebar).
 * Cut at bottom, right, and ~1/4 on left (middle divider).
 */
function BigEmployeeRecordsBrowser() {
  const employees = [
    { name: "Marc Vincent Palautog", position: "Software Engineer" },
    { name: "Jimmy Ricks Chixboi", position: "Software Engineer" },
    { name: "Kenneth Goodboy", position: "Full Stack Developer" },
  ];
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/40 bg-gradient-to-br from-white/85 to-gray-100/75 shadow-2xl shadow-purple-200/30 backdrop-blur-2xl"
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.6), 0 25px 50px -12px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.8)",
        width: "100%",
        maxWidth: "840px",
        height: "540px",
      }}
    >
      {/* Thin browser chrome — liquid glass */}
      <div className="flex items-center gap-2 border-b border-gray-200/60 bg-white/50 px-5 py-2.5 backdrop-blur-md">
        <div className="flex gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/90" />
          <div className="h-3 w-3 rounded-full bg-amber-400/90" />
          <div className="h-3 w-3 rounded-full bg-emerald-400/90" />
        </div>
        <div className="ml-2 flex flex-1 items-center rounded-lg border border-gray-200/80 bg-white/90 px-4 py-2 text-sm text-gray-500">
          app.plinth.ph/employees
        </div>
      </div>

      {/* Employees content — header visible, table extends for cut effect */}
      <div className="absolute inset-x-0 bottom-0 top-[60px] overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100/80 bg-white/30 px-6 py-4 backdrop-blur-sm">
          <h3 className="text-lg font-semibold text-gray-900">Employees</h3>
          <span className="shrink-0 rounded-md bg-brand-purple px-4 py-2 text-sm font-medium text-white">
            + Add Employee
          </span>
        </div>
        <div className="h-[calc(100%-60px)] overflow-hidden">
          <div className="size-full p-6">
            <div className="mb-2 flex gap-1">
              <input
                type="text"
                placeholder="Search"
                className="flex-1 rounded border border-gray-200/80 bg-white/80 px-2 py-1.5 text-xs backdrop-blur-sm"
                readOnly
              />
              <span className="rounded border border-gray-200/80 bg-white/80 px-2 py-1.5 text-xs text-gray-500">
                Department
              </span>
            </div>
            <div className={glassInner + " overflow-hidden mt-3"}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100/80 bg-gray-50/60 text-left text-gray-500">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Position</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr
                      key={emp.name}
                      className="border-b border-gray-100/60 last:border-0"
                    >
                      <td className="px-4 py-2 text-gray-900">{emp.name}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {emp.position}
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-green-100/90 px-2 py-1 text-green-800">
                          active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-4 w-4/5 rounded bg-gray-200/60" />
              <div className="h-4 w-3/5 rounded bg-gray-200/50" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Right-side panel: Big Employees + Payroll overlay.
 * Payroll overlaps Employees and extends beyond it (per red markers).
 */
export function AuthSidePanel() {
  return (
    <div className="relative hidden lg:flex flex-1 min-w-0 overflow-hidden">
      <AuthHeroBackground />
      <div className="relative z-0 flex w-full items-center justify-center p-6 min-h-[580px] -ml-[25%]">
        <div className="relative flex items-end justify-end w-full max-w-5xl min-h-[560px]">
          {/* 1. Big — Employees (ellie-style: whole snapshot shifts left, form covers left 1/4) */}
          <div className="relative z-0 w-full flex justify-end">
            <BigEmployeeRecordsBrowser />
          </div>

          {/* 2. Overlay — Payroll per red markers: extends past Employee right & bottom */}
          <div className="absolute right-[-32px] bottom-[-24px] z-20 w-[480px]">
            <OverlayPayrollCard />
          </div>
        </div>
      </div>
    </div>
  );
}
