"use client";

const glassPanel =
  "rounded-2xl border border-white/60 bg-white/70 shadow-2xl shadow-gray-300/50 backdrop-blur-xl";
const glassInner =
  "rounded-lg border border-white/80 bg-white/60 backdrop-blur-md";

/**
 * Payroll page context — app-style Payroll Runs table, liquid glass display.
 */
export function PayrollFeatureSection() {
  return (
    <section className="border-b border-gray-100 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-3 lg:pt-8">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              Run payroll and stay compliant — online and in the Philippines
            </h2>
            <p className="mt-4 text-gray-600">
              Payroll with SSS, PhilHealth, Pag-IBIG, and withholding tax. Payslips, cutoffs, and reports in one place.
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
                    app.plinth.ph/payroll
                  </span>
                </div>
              </div>
              <div className="bg-gradient-to-b from-white/95 to-gray-50/90 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Payroll</h3>
                    <p className="text-sm text-gray-500">Manage payroll processing and payslips</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg border border-gray-200/80 bg-white/80 px-3 py-1.5 text-xs text-gray-500 backdrop-blur-sm">
                      Select month
                    </div>
                    <button
                      type="button"
                      className="rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-white"
                    >
                      + Process Payroll
                    </button>
                  </div>
                </div>
                <div className={glassInner + " overflow-hidden p-0"}>
                  <div className="border-b border-gray-100/80 bg-gray-50/60 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 backdrop-blur-sm">
                    Payroll Runs
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100/80 text-left text-xs text-gray-500">
                        <th className="px-4 py-2.5 font-medium">Period</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Processed Date</th>
                        <th className="px-4 py-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100/60">
                        <td className="px-4 py-2.5 text-gray-900">Feb. 11, 2026 – Feb. 25, 2026</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-blue-100/90 px-2 py-0.5 text-xs font-medium text-blue-800 backdrop-blur-sm">
                            Finalized
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">Mar 11, 2026</td>
                        <td className="px-4 py-2.5 text-gray-400">⋯</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { title: "Attendance", content: "Encode daily time in/out. Tied to payroll." },
                { title: "Leave", content: "Requests, approvals, balance. Philippine leave types." },
                { title: "Recruitment", content: "Job posts, applicants, hire-to-employee flow." },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-white/60 bg-white/70 p-4 shadow-lg shadow-gray-200/50 backdrop-blur-xl"
                >
                  <div className="font-semibold text-gray-900">{f.title}</div>
                  <p className="mt-1 text-sm text-gray-600">{f.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
