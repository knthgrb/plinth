"use client";

import Link from "next/link";

/**
 * Image-5 style: "Powering businesses of all sizes" — two columns + customer story with image.
 */
export function EnterpriseSection() {
  return (
    <section className="border-b border-gray-100 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Scales with you
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-gray-600">
          People, payroll, and operations that adapt to your needs — from a few employees to hundreds.
        </p>

        <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">
              One place for people, payroll, and operations
            </h3>
            <Link
              href="/whos-it-for"
              className="mt-4 inline-flex items-center gap-1 rounded-lg bg-brand-purple px-5 py-2.5 text-sm font-medium text-white shadow-md hover:bg-brand-purple-hover transition-colors"
            >
              See who it&apos;s for →
            </Link>
          </div>
          <p className="text-gray-600">
            SMEs and growing teams across the Philippines use Plinth for people, payroll, attendance, leave, and compliance — without spreadsheets or legacy software.
          </p>
        </div>

        {/* Customer story block */}
        <div className="mt-16">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-900 text-xl font-bold text-white">
                P
              </div>
              <div>
                <p className="font-semibold text-gray-900">
                  Philippine companies run on Plinth
                </p>
                <p className="text-sm text-gray-500">
                  From daily encoding to statutory reports
                </p>
              </div>
            </div>
            <Link
              href="/resources"
              className="text-sm font-medium text-brand-purple hover:underline"
            >
              Read the story →
            </Link>
          </div>
          {/* Snapshot: app UI preview */}
          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200/80 bg-white/90 shadow-xl shadow-gray-200/50 backdrop-blur-sm">
            <div className="flex aspect-[2.5/1] min-h-[200px] items-center justify-center p-6">
              <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-sm font-medium text-gray-700">Dashboard</span>
                  <span className="text-xs text-gray-400">app.plinth.ph</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "Employees", value: "124" },
                    { label: "Payroll (mo)", value: "₱1.2M" },
                    { label: "Pending leave", value: "8" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-md bg-gray-50 py-2">
                      <div className="text-lg font-semibold text-gray-900">{s.value}</div>
                      <div className="text-xs text-gray-500">{s.label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-center text-xs text-gray-500">
                  Everything in one place
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
