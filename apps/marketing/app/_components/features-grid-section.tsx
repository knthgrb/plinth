"use client";

import Link from "next/link";

const glassPanel =
  "rounded-2xl border border-white/60 bg-white/70 shadow-2xl shadow-gray-300/50 backdrop-blur-xl";
const glassInner =
  "rounded-lg border border-white/80 bg-white/60 backdrop-blur-md";

const ADDITIONAL_FEATURES = [
  "Employee records",
  "Recruitment",
  "Leave & attendance",
  "Announcements & chat",
  "Dashboard & reports",
  "Payslip generation",
  "SSS, PhilHealth, Pag-IBIG",
  "Withholding tax",
  "Leave requests & approvals",
  "Applicant tracking",
  "Document tracking",
  "Team chat",
];

function CompactPayrollSnapshot() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.12)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="ml-2 rounded bg-white/80 px-2 py-0.5 text-[10px] text-gray-500 backdrop-blur-sm">
            app.plinth.ph/payroll
          </span>
        </div>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-900">Payroll</h3>
          <span className="rounded bg-brand-purple px-2 py-1 text-[10px] font-medium text-white">
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

function CompactAccountingSnapshot() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.12)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="ml-2 rounded bg-white/80 px-2 py-0.5 text-[10px] text-gray-500 backdrop-blur-sm">
            app.plinth.ph/accounting
          </span>
        </div>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-medium text-gray-900">
            Your overview
          </span>
          <span className="rounded border border-gray-200/80 bg-white/80 px-2 py-0.5 text-[9px] text-gray-500 backdrop-blur-sm">
            Last 7 days
          </span>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-white/80 bg-white/70 p-2 backdrop-blur-md">
            <div className="text-[9px] font-medium uppercase text-gray-500">
              Employee Related Cost
            </div>
            <div className="text-sm font-semibold text-gray-900">
              ₱27,506.67
            </div>
            <p className="mt-0.5 text-[9px] text-gray-500">
              ₱0 paid · ₱27,506 remaining · 5 expenses
            </p>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/70 p-2 backdrop-blur-md">
            <div className="text-[9px] font-medium uppercase text-gray-500">
              Operational Cost
            </div>
            <div className="text-sm font-semibold text-gray-900">₱0.00</div>
            <p className="mt-0.5 text-[9px] text-gray-500">
              ₱0 paid · ₱0 remaining · 0 expenses
            </p>
          </div>
        </div>
        <div className={glassInner + " overflow-hidden"}>
          <div className="border-b border-gray-100/80 bg-gray-50/60 px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-gray-500">
            Employee Related Cost
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-gray-100/80 text-left text-gray-500">
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Amount</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: "Payroll - Feb 10–24, 2026",
                  amount: "₱19,091.67",
                  status: "Pending",
                },
                {
                  name: "SSS - Feb 10–24, 2026",
                  amount: "₱5,140.00",
                  status: "Pending",
                },
                {
                  name: "Pag-IBIG - Feb 10–24, 2026",
                  amount: "₱800.00",
                  status: "Pending",
                },
              ].map((row) => (
                <tr
                  key={row.name}
                  className="border-b border-gray-100/60 last:border-0"
                >
                  <td className="px-2 py-1 text-gray-900">{row.name}</td>
                  <td className="px-2 py-1 text-gray-600">{row.amount}</td>
                  <td className="px-2 py-1">
                    <span className="rounded-full bg-amber-100/90 px-1.5 py-0.5 font-medium text-amber-800">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompactAttendanceSnapshot() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.12)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="ml-2 rounded bg-white/80 px-2 py-0.5 text-[10px] text-gray-500 backdrop-blur-sm">
            app.plinth.ph/attendance
          </span>
        </div>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-900">Attendance</h3>
          <span className="rounded bg-gray-200/80 px-2 py-0.5 text-[10px] text-gray-600">
            Feb 2026
          </span>
        </div>
        <div className={glassInner + " overflow-hidden"}>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-gray-100/80 bg-gray-50/60 text-left text-gray-500">
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 font-medium">In</th>
                <th className="px-2 py-1 font-medium">Out</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100/60">
                <td className="px-2 py-1 text-gray-900">Feb 18</td>
                <td className="px-2 py-1 text-red-600">9:13</td>
                <td className="px-2 py-1 text-gray-600">6:00</td>
                <td className="px-2 py-1">
                  <span className="rounded-full bg-green-100/90 px-1.5 py-0.5 text-green-800">
                    Present
                  </span>
                </td>
              </tr>
              <tr>
                <td className="px-2 py-1 text-gray-900">Feb 13</td>
                <td className="px-2 py-1 text-red-600">9:07</td>
                <td className="px-2 py-1 text-gray-600">6:00</td>
                <td className="px-2 py-1">
                  <span className="rounded-full bg-green-100/90 px-1.5 py-0.5 text-green-800">
                    Present
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

function CompactEmployeeRecordsSnapshot() {
  return (
    <div
      className={glassPanel + " overflow-hidden"}
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.12)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5 backdrop-blur-sm">
        <span className="ml-2 rounded bg-white/80 px-2 py-0.5 text-[10px] text-gray-500 backdrop-blur-sm">
          app.plinth.ph/employees
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-3 backdrop-blur-sm">
        <div className="space-y-2">
          {["Marc Vincent Palautog", "Jimmy Ricks Chixboi", "Kenneth Goodboy"].map((name, i) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/70 px-2 py-1.5 backdrop-blur-md"
            >
              <div className="h-6 w-6 rounded-full bg-gray-200" />
              <div className="flex-1 text-[10px]">
                <div className="font-medium text-gray-900">{name}</div>
                <div className="text-gray-500">Employee #{1001 + i}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompactRecruitmentSnapshot() {
  return (
    <div
      className={
        glassPanel +
        " min-w-0 max-w-full overflow-hidden sm:min-w-[320px] sm:max-w-[420px] lg:min-w-[420px] lg:max-w-[480px]"
      }
      style={{
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.5), 0 12px 24px -8px rgba(0,0,0,0.12)",
      }}
    >
      <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2 backdrop-blur-sm">
        <span className="ml-2 rounded bg-white/80 px-3 py-1 text-xs text-gray-500 backdrop-blur-sm">
          app.plinth.ph/recruitment
        </span>
      </div>
      <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-4 backdrop-blur-sm">
        <div className="mb-3 text-sm font-semibold text-gray-900">
          Senior Developer
        </div>
        <div className="flex gap-3">
          {["Applied", "Screening", "Interview"].map((stage, i) => (
            <div
              key={stage}
              className="flex-1 rounded-lg border border-white/80 bg-white/70 px-3 py-2 text-center text-xs backdrop-blur-md"
            >
              <div className="font-medium text-gray-900">{stage}</div>
              <div className="text-gray-500">{i + 2}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AndSoMuchMoreCard() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-4 lg:flex-row lg:gap-10">
      <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
        <h3 className="text-xl font-bold tracking-tight text-brand-purple">
          And so much more...
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Everything you need to run your company — people, payroll, and operations.
        </p>
      </div>
      <div
        className="features-more-list relative mt-4 flex items-center justify-center overflow-hidden lg:mt-0"
        style={{ height: "140px", minWidth: "200px" }}
      >
        <ul className="features-more-scroll animate-features-scroll space-y-2 text-base font-medium text-gray-700">
          {[...ADDITIONAL_FEATURES, ...ADDITIONAL_FEATURES].map(
            (feature, i) => (
              <li key={`${feature}-${i}`}>{feature}</li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

export function FeaturesGridSection() {
  return (
    <section className="border-b border-gray-100 bg-gray-50/50 py-16 sm:py-24 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 min-w-0">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Simple, but powerful
          </h2>
          <p className="mt-3 text-gray-600 sm:text-lg">
            People, payroll, attendance, and communication — SSS, PhilHealth, Pag-IBIG, and
            withholding tax handled for you.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-4">
          {/* Row 1: Payroll (3/4) | Employee records (1/4) */}
          <div className="flex flex-col gap-6 rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-3 lg:flex-row lg:items-center lg:gap-8">
            <div className="lg:min-w-0 lg:flex-1 lg:max-w-[45%]">
              <h3 className="text-lg font-semibold text-gray-900">Payroll</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Run payroll with SSS, PhilHealth, Pag-IBIG, and withholding tax.
                Payslips, cutoffs, and reports in one place.
              </p>
            </div>
            <div
              className="flex-1 overflow-hidden rounded-xl lg:max-h-[220px]"
              style={{ maxHeight: "200px" }}
            >
              <CompactPayrollSnapshot />
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-1">
            <h3 className="text-lg font-semibold text-gray-900">
              Employee records
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Profiles, schedules, leave credits, requirements, and document
              tracking — all in one place.
            </p>
            <div
              className="mt-4 overflow-hidden rounded-xl"
              style={{ maxHeight: "180px" }}
            >
              <CompactEmployeeRecordsSnapshot />
            </div>
          </div>

          {/* Row 2: Attendance (1/4) | Accounting (3/4) */}
          <div className="flex flex-col rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-1">
            <h3 className="text-lg font-semibold text-gray-900">Attendance</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Encode time in and out, view month summary. Late and overtime flow
              into payroll.
            </p>
            <div
              className="mt-4 overflow-hidden rounded-xl"
              style={{ maxHeight: "180px" }}
            >
              <CompactAttendanceSnapshot />
            </div>
          </div>

          <div className="flex flex-col gap-6 rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-3 lg:flex-row lg:items-center lg:gap-8">
            <div className="lg:min-w-0 lg:flex-1 lg:max-w-[45%]">
              <h3 className="text-lg font-semibold text-gray-900">
                Accounting
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Payroll journal, expenses, and statutory reports — all in one
                dashboard.
              </p>
            </div>
            <div
              className="flex-1 overflow-hidden rounded-xl lg:max-h-[220px]"
              style={{ maxHeight: "200px" }}
            >
              <CompactAccountingSnapshot />
            </div>
          </div>

          {/* Row 3: Recruitment (full width) */}
          <div className="flex flex-col gap-6 rounded-2xl border border-white/80 bg-white/90 p-6 shadow-xl shadow-gray-200/50 backdrop-blur-sm lg:col-span-4 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
            <div className="lg:min-w-0 lg:flex-1 lg:max-w-[40%]">
              <h3 className="text-lg font-semibold text-gray-900">
                Recruitment
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Track applicants through stages, interviews, and
                hire-to-employee flow — built for Philippine teams.
              </p>
            </div>
            <div
              className="min-w-0 shrink overflow-hidden rounded-xl"
              style={{ maxHeight: "200px" }}
            >
              <CompactRecruitmentSnapshot />
            </div>
          </div>

          {/* Row 4: And so much more (full width, last) */}
          <AndSoMuchMoreCard />
        </div>
        <div className="mt-12 text-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            See all features →
          </Link>
        </div>
      </div>
    </section>
  );
}
