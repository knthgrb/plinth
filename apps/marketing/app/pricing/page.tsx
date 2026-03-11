"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "For small teams getting started with people and payroll.",
    monthly: 2999,
    yearly: 29990,
    features: [
      "Up to 25 employees",
      "Payroll (SSS, PhilHealth, Pag-IBIG)",
      "Leave management",
      "Basic support",
    ],
    cta: "Get started",
    highlighted: false,
  },
  {
    id: "professional",
    name: "Professional",
    description: "For growing companies that need full people, payroll, and compliance.",
    monthly: 5999,
    yearly: 59990,
    features: [
      "Up to 100 employees",
      "Everything in Starter",
      "Recruitment & applicant tracking",
      "Evaluations & requirements",
      "Announcements & team chat",
      "Priority support",
    ],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For larger organizations with custom needs.",
    monthly: null,
    yearly: null,
    features: [
      "Unlimited employees",
      "Everything in Professional",
      "Dedicated account manager",
      "Custom integrations",
      "SLA & onboarding",
    ],
    cta: "Contact sales",
    highlighted: false,
  },
] as const;

function formatPrice(amount: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const signupHref = appUrl ? `${appUrl}/signup` : "/signup";

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Pricing
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Simple, transparent pricing for teams in the Philippines.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setBilling("monthly")}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              billing === "monthly"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBilling("yearly")}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              billing === "yearly"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Yearly
          </button>
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded">
            Save 2 months
          </span>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-3 lg:gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-2xl border p-6 sm:p-8 flex flex-col ${
              plan.highlighted
                ? "border-brand-purple bg-brand-purple/5 shadow-lg ring-2 ring-brand-purple/20"
                : "border-gray-200 bg-white"
            }`}
          >
            {plan.highlighted && (
              <p className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold text-brand-purple bg-white px-3 py-1 rounded-full border border-brand-purple/20">
                Most popular
              </p>
            )}
            <h2 className="text-xl font-semibold text-gray-900">{plan.name}</h2>
            <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
            <div className="mt-6">
              {plan.monthly !== null && plan.yearly !== null ? (
                <>
                  <span className="text-3xl font-bold text-gray-900">
                    {billing === "monthly"
                      ? formatPrice(plan.monthly)
                      : formatPrice(plan.yearly)}
                  </span>
                  <span className="text-gray-500 ml-1">
                    /{billing === "monthly" ? "month" : "year"}
                  </span>
                </>
              ) : (
                <span className="text-2xl font-semibold text-gray-900">
                  Custom
                </span>
              )}
            </div>
            <ul className="mt-6 space-y-3 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                  <Check className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link
              href={plan.id === "enterprise" ? "#contact" : signupHref}
              className={`mt-8 inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                plan.highlighted
                  ? "bg-brand-purple text-white hover:bg-brand-purple-hover"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-16 text-center">
        <Link
          href="/"
          className="text-brand-purple font-medium hover:underline"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
