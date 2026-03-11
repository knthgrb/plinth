"use client";

/**
 * Stripe-style feature snapshots: multiple compact app UI cards
 * (Payroll, Attendance, Leave, Assets, etc.) — CSS-only mockups.
 */

function SnapshotCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-200/50 " +
        className
      }
    >
      <div className="border-b border-gray-100 bg-gray-50/80 px-3 py-2">
        <span className="text-xs font-medium text-gray-500">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export function FeatureSnapshotsSection() {
  return (
    <section className="border-b border-gray-100 bg-gray-50/50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-semibold text-gray-900">
          Everything in one place
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-gray-600">
          People, payroll, attendance, and more — built for Philippine labor law.
        </p>

        {/* Top row: Payroll + Attendance (Stripe-style side-by-side) */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotCard title="Payroll">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between border-b border-gray-100 pb-1">
                <span className="text-gray-500">Cutoff</span>
                <span className="font-medium text-gray-900">Nov 16–30, 2025</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Gross</span>
                <span className="text-gray-900">₱284,500</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">SSS / PhilHealth / Pag-IBIG</span>
                <span className="text-gray-900">₱3,240</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-gray-700">Net pay</span>
                <span className="text-brand-purple">₱241,260</span>
              </div>
            </div>
          </SnapshotCard>

          <SnapshotCard title="Attendance">
            <div className="space-y-1.5 text-sm">
              {[
                { name: "Maria S.", date: "Dec 2", in: "8:02 AM", out: "5:15 PM" },
                { name: "Juan D.", date: "Dec 2", in: "7:58 AM", out: "—" },
                { name: "Ana R.", date: "Dec 2", in: "8:15 AM", out: "5:30 PM" },
              ].map((row) => (
                <div
                  key={row.name}
                  className="flex items-center gap-2 rounded-md border border-gray-100 py-1.5 px-2"
                >
                  <div className="h-6 w-6 shrink-0 rounded-full bg-gray-200" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">{row.name}</span>
                    <span className="ml-1 text-gray-400">{row.date}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{row.in}</span>
                  <span className="text-gray-400 text-xs">{row.out}</span>
                </div>
              ))}
            </div>
          </SnapshotCard>

          <SnapshotCard title="Leave">
            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-2">
                <div className="font-medium text-gray-900">Vacation Leave</div>
                <div className="text-xs text-gray-500">Pending approval</div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Balance</span>
                <span className="text-gray-900">12 days</span>
              </div>
              <div className="flex gap-1">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  Dec 20–22
                </span>
              </div>
            </div>
          </SnapshotCard>
        </div>

        {/* Second row: Assets + Recruitment + Dashboard */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotCard title="Asset management">
            <div className="space-y-1.5 text-sm">
              {[
                { item: "MacBook Pro", tag: "IT-001", status: "Assigned" },
                { item: "Monitor 24\"", tag: "IT-002", status: "Available" },
                { item: "Desk chair", tag: "OF-003", status: "Assigned" },
              ].map((row) => (
                <div
                  key={row.tag}
                  className="flex items-center justify-between rounded-md border border-gray-100 py-1.5 px-2"
                >
                  <div>
                    <div className="font-medium text-gray-900">{row.item}</div>
                    <div className="text-xs text-gray-400">{row.tag}</div>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
          </SnapshotCard>

          <SnapshotCard title="Recruitment">
            <div className="space-y-1.5 text-sm">
              <div className="rounded-md border border-gray-200 bg-gray-50/50 px-2 py-1.5">
                <div className="font-medium text-gray-900">Senior Developer</div>
                <div className="text-xs text-gray-500">3 applicants</div>
              </div>
              {["Maria C.", "Juan L.", "Ana M."].map((name, i) => (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded-md border border-gray-100 py-1 px-2"
                >
                  <div className="h-5 w-5 rounded-full bg-gray-200" />
                  <span className="text-gray-700">{name}</span>
                  <span className="ml-auto text-xs text-gray-400">
                    {i === 0 ? "Interview" : "Screening"}
                  </span>
                </div>
              ))}
            </div>
          </SnapshotCard>

          <SnapshotCard title="Dashboard">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Employees", value: "124" },
                { label: "Payroll (mo)", value: "₱1.2M" },
                { label: "Pending leave", value: "8" },
                { label: "Open roles", value: "3" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm"
                >
                  <div className="text-xs text-gray-400">{stat.label}</div>
                  <div className="font-semibold text-gray-900">{stat.value}</div>
                </div>
              ))}
            </div>
          </SnapshotCard>
        </div>
      </div>
    </section>
  );
}
