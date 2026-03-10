"use client";

import Link from "next/link";
import { Receipt, CalendarCheck, ShieldCheck } from "lucide-react";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "/";

/**
 * Right-side panel for login/signup: Plinth logo (links to marketing), tagline, and feature highlights.
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
      icon: ShieldCheck,
      title: "Compliance",
      description: "Built for Philippine labor law",
    },
  ];

  return (
    <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50/80 to-indigo-50/80 items-center justify-center p-12">
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-white/80 bg-white/95 p-10 shadow-xl shadow-purple-200/20 backdrop-blur-sm">
          <div className="text-center">
            <Link
              href={marketingUrl}
              className="inline-block text-4xl font-bold tracking-tight text-brand-purple transition-colors hover:text-brand-purple-hover focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2 rounded-md"
              title="Go to Plinth"
            >
              Plinth
            </Link>
            <p className="mt-2 text-gray-600">
              Your complete HRIS solution
            </p>
          </div>

          <div className="mt-10 space-y-4">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex items-start gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{title}</p>
                  <p className="text-sm text-gray-500">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
