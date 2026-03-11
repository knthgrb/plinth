"use client";

/**
 * Image-4 style: dark gradient hero with headline + 4 key stats.
 */
export function StatsSection() {
  const stats = [
    { value: "SSS, PhilHealth, Pag-IBIG", label: "Statutory compliance built in" },
    { value: "Philippine Labor Code", label: "Leave, OT, and holiday rules" },
    { value: "99.9%", label: "Uptime for your company data" },
    { value: "1 platform", label: "Payroll, attendance, leave, and more" },
  ];

  return (
    <section className="relative overflow-hidden border-b border-transparent bg-gradient-to-b from-[#1e1b4b] via-[#312e81] to-[#4c1d95] py-20 sm:py-28">
      <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Where Philippine companies build from
        </h2>
        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-2xl font-bold text-white sm:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-indigo-200">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Subtle network/dots accent at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/20 to-transparent"
        aria-hidden
      />
    </section>
  );
}
