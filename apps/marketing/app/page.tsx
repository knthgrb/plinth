import Link from "next/link";
import { HeroBackground } from "@/app/_components/hero-background";
import { FeaturesGridSection } from "@/app/_components/features-grid-section";
import { StatsSection } from "@/app/_components/stats-section";
import { EnterpriseSection } from "@/app/_components/enterprise-section";

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

export default function MarketingLandingPage() {
  const signupHref = mainAppUrl ? `${mainAppUrl}/signup` : "/signup";

  return (
    <div className="flex flex-col">
      {/* Hero — background, entrance animation, and trust line */}
      <section className="relative overflow-hidden border-b border-gray-100 bg-white py-20 sm:py-28 lg:py-32">
        <HeroBackground />
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p
              className="hero-entrance text-sm font-medium uppercase tracking-widest text-brand-purple"
              style={{ animation: "hero-fade-up 0.6s ease-out both", opacity: 0 }}
            >
              Built for companies to succeed
            </p>
            <h1
              className="hero-entrance mt-4 text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl"
              style={{ animation: "hero-fade-up 0.6s ease-out 0.1s both", opacity: 0 }}
            >
              The foundation for companies in the Philippines
            </h1>
            <p
              className="hero-entrance mt-6 text-lg leading-relaxed text-gray-600 sm:text-xl"
              style={{ animation: "hero-fade-up 0.6s ease-out 0.2s both", opacity: 0 }}
            >
              Plinth is the foundation your company is built on — people, payroll, compliance, and communication in one place. Built for Philippine labor law.
            </p>
            <div
              className="hero-entrance mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
              style={{ animation: "hero-fade-up 0.6s ease-out 0.3s both", opacity: 0 }}
            >
              <Link
                href={signupHref}
                className="w-full min-w-[160px] shrink-0 rounded-xl bg-brand-purple px-6 py-3.5 text-center text-base font-medium text-white shadow-lg shadow-brand-purple/25 transition-all hover:bg-brand-purple-hover hover:shadow-xl hover:shadow-brand-purple/30 sm:w-auto"
              >
                Get Started
              </Link>
              <Link
                href="/features"
                className="w-full min-w-[160px] shrink-0 rounded-xl border-2 border-gray-200 bg-white px-6 py-3.5 text-center text-base font-medium text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50 sm:w-auto"
              >
                View features
              </Link>
            </div>
            <p
              className="hero-entrance mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-500"
              style={{ animation: "hero-fade-up 0.6s ease-out 0.4s both", opacity: 0 }}
            >
              <span>SSS</span>
              <span className="text-gray-300">·</span>
              <span>PhilHealth</span>
              <span className="text-gray-300">·</span>
              <span>Pag-IBIG</span>
              <span className="text-gray-300">·</span>
              <span>BIR compliant</span>
            </p>
          </div>
        </div>
      </section>

      {/* Broader value — people, operations, communication */}
      <section className="border-b border-gray-100 bg-gray-50/50 py-10 sm:py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-base font-medium text-gray-900 sm:text-lg">
              People, operations, and communication — all in one place.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Payroll, attendance, leave, recruitment, announcements, and chat. Everything your team needs.
            </p>
          </div>
        </div>
      </section>

      <FeaturesGridSection />
      <StatsSection />
      <EnterpriseSection />

      {/* Built for companies to succeed — clear section with CTA */}
      <section className="border-b border-gray-100 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
              Built for companies to succeed
            </h2>
            <p className="mt-3 text-gray-600 sm:text-lg">
              Whether you&apos;re an SME, startup, or growing team — one place for people, operations, and compliance.
            </p>
            <div className="mt-10">
              <Link
                href="/whos-it-for"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-purple px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-purple-hover transition-colors"
              >
                Who&apos;s it for?
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm text-gray-500">© Plinth</span>
          <div className="flex gap-6">
            <Link
              href="/features"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Features
            </Link>
            <Link
              href="/whos-it-for"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Who&apos;s it for
            </Link>
            <Link
              href="/resources"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Resources
            </Link>
            <Link
              href="/pricing"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
