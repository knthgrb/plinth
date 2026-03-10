"use client";

const glassPanel =
  "rounded-2xl border border-white/70 bg-white/75 shadow-2xl shadow-gray-300/50 backdrop-blur-xl";
const glassCard = "rounded-xl border border-white/80 bg-white/70 backdrop-blur-md";

/**
 * Accounting page context — Your overview, Employee/Operational Cost cards, expense table. Liquid glass.
 */
export function AccountingUISection() {
  return (
    <section className="border-b border-gray-100 bg-gray-50/50 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
          Accounting at a glance
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-gray-600">
          Payroll journal, expenses, and statutory reports — all in one dashboard.
        </p>

        <div className="relative mx-auto mt-12 max-w-7xl">
          <div className={glassPanel} style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.6), 0 25px 50px -12px rgba(0,0,0,0.2)" }}>
            <div className="border-b border-gray-200/80 bg-gray-100/90 px-4 py-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gray-400" />
                <span className="h-2 w-2 rounded-full bg-gray-400" />
                <span className="h-2 w-2 rounded-full bg-gray-400" />
                <span className="ml-4 flex-1 rounded-md bg-white/80 px-3 py-1 text-center text-xs text-gray-500 backdrop-blur-sm">
                  app.plinth.ph/accounting
                </span>
              </div>
            </div>
            <div className="min-h-[340px] bg-gradient-to-b from-white/90 to-gray-50/80 p-6 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">Your overview</h3>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-gray-200/80 bg-white/80 px-2.5 py-1 text-xs text-gray-500 backdrop-blur-sm">
                    Last 7 days
                  </span>
                  <span className="rounded-lg border border-gray-200/80 bg-white/80 px-2.5 py-1 text-xs text-gray-500 backdrop-blur-sm">
                    Rows per page 30
                  </span>
                </div>
              </div>
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <div className={glassCard + " p-4 shadow-lg"}>
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Employee Related Cost</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">₱27,506.67</div>
                  <p className="mt-1 text-xs text-gray-500">₱0.00 paid · ₱27,506.67 remaining · 5 expenses</p>
                  <button type="button" className="mt-2 text-xs font-medium text-brand-purple hover:underline">View expenses</button>
                </div>
                <div className={glassCard + " p-4 shadow-lg"}>
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Operational Cost</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">₱0.00</div>
                  <p className="mt-1 text-xs text-gray-500">₱0.00 paid · ₱0.00 remaining · 0 expenses</p>
                  <button type="button" className="mt-2 text-xs font-medium text-brand-purple hover:underline">View expenses</button>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-gray-900">Employee Related Cost</span>
                    <p className="text-xs text-gray-500">Costs related to employees including payroll, benefits, and leave</p>
                  </div>
                  <button type="button" className="rounded-lg bg-brand-purple px-3 py-1.5 text-xs font-medium text-white">+ Add Expense</button>
                </div>
                <div className={glassCard + " overflow-hidden"}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100/80 bg-gray-50/60 text-left text-gray-500 backdrop-blur-sm">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Paid</th>
                        <th className="px-3 py-2 font-medium">Remaining</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name: "Payroll - Feb 10 - Feb 24, 2026", amount: "₱19,091.67", paid: "₱0.00", remaining: "₱19,091.67" },
                        { name: "SSS - Feb 10 - Feb 24, 2026", amount: "₱5,140.00", paid: "₱0.00", remaining: "₱5,140.00" },
                        { name: "Pag-IBIG - Feb 10 - Feb 24, 2026", amount: "₱800.00", paid: "₱0.00", remaining: "₱800.00" },
                        { name: "PhilHealth - Feb 10 - Feb 24, 2026", amount: "₱2,000.00", paid: "₱0.00", remaining: "₱2,000.00" },
                      ].map((row) => (
                        <tr key={row.name} className="border-b border-gray-100/60 last:border-0">
                          <td className="px-3 py-2 text-gray-900">{row.name}</td>
                          <td className="px-3 py-2 text-gray-600">{row.amount}</td>
                          <td className="px-3 py-2 text-gray-600">{row.paid}</td>
                          <td className="px-3 py-2 text-gray-600">{row.remaining}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full bg-amber-100/90 px-2 py-0.5 font-medium text-amber-800 backdrop-blur-sm">Pending</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div
            className="absolute -right-4 top-1/2 w-[260px] -translate-y-1/2 rounded-xl border border-white/80 bg-white/90 p-4 shadow-xl backdrop-blur-xl sm:right-8"
            style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.8), 0 20px 40px -10px rgba(0,0,0,0.15)" }}
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-brand-purple/20" />
              <span className="font-semibold text-gray-900">Payslip batch</span>
            </div>
            <p className="text-sm text-gray-600">
              Payslips for Nov 16–30 have been generated and are ready for download.
            </p>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>24 employees</span>
              <span className="rounded-full bg-green-100/90 px-2 py-0.5 font-medium text-green-800">Done</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
