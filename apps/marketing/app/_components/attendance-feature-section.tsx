"use client";

const glassPanel =
  "rounded-2xl border border-white/60 bg-white/70 shadow-2xl shadow-gray-300/50 backdrop-blur-xl";
const glassInner = "rounded-lg border border-white/80 bg-white/60 backdrop-blur-md";

/**
 * Attendance page context — employee selector, month, table (Date, Time In/Out, Status, Late, Overtime). Liquid glass.
 */
export function AttendanceFeatureSection() {
  return (
    <section className="border-b border-gray-100 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-3 lg:pt-8">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              Attendance that ties to payroll
            </h2>
            <p className="mt-4 text-gray-600">
              Encode time in and out, view month summary, and bulk add. Late and overtime flow into payroll.
            </p>
          </div>

          <div className="lg:col-span-9">
            <div className={glassPanel} style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 25px 50px -12px rgba(0,0,0,0.15)" }}>
              <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-gray-400" />
                  <span className="h-2 w-2 rounded-full bg-gray-400" />
                  <span className="h-2 w-2 rounded-full bg-gray-400" />
                  <span className="ml-4 flex-1 rounded-md bg-white/80 px-3 py-1 text-center text-xs text-gray-500 backdrop-blur-sm">
                    app.plinth.ph/attendance
                  </span>
                </div>
              </div>
              <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Attendance</h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-500 backdrop-blur-sm">View month summary</span>
                    <span className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-500 backdrop-blur-sm">Bulk Add Attendance</span>
                    <button type="button" className="rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-white">+ Add Attendance</button>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-600 backdrop-blur-sm">Kenneth Garbo</span>
                  <span className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-600 backdrop-blur-sm">February 2026</span>
                  <span className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-600 backdrop-blur-sm">Minutes</span>
                </div>
                <div className={glassInner + " overflow-hidden"}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100/80 bg-gray-50/60 text-left text-gray-500 backdrop-blur-sm">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Time In</th>
                        <th className="px-3 py-2 font-medium">Time Out</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Late</th>
                        <th className="px-3 py-2 font-medium">Overtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100/60">
                        <td className="px-3 py-2 text-gray-900">Feb 18, 2026</td>
                        <td className="px-3 py-2 text-red-600">9:13 AM</td>
                        <td className="px-3 py-2 text-gray-600">6:00 PM</td>
                        <td className="px-3 py-2"><span className="rounded-full bg-green-100/90 px-2 py-0.5 text-green-800 backdrop-blur-sm">Present</span></td>
                        <td className="px-3 py-2 text-red-600">13 mins</td>
                        <td className="px-3 py-2 text-green-600">120 mins</td>
                      </tr>
                      <tr className="border-b border-gray-100/60">
                        <td className="px-3 py-2 text-gray-900">Feb 13, 2026</td>
                        <td className="px-3 py-2 text-red-600">9:07 AM</td>
                        <td className="px-3 py-2 text-gray-600">6:00 PM</td>
                        <td className="px-3 py-2"><span className="rounded-full bg-green-100/90 px-2 py-0.5 text-green-800 backdrop-blur-sm">Present</span></td>
                        <td className="px-3 py-2 text-red-600">7 mins</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                      </tr>
                      <tr className="border-b border-gray-100/60">
                        <td className="px-3 py-2 text-gray-900">Feb 20, 2026</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2"><span className="rounded-full border border-amber-200 bg-amber-50/90 px-2 py-0.5 text-amber-800 backdrop-blur-sm">Holiday</span></td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
