import Link from "next/link";

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

export default function MarketingLandingPage() {
  const signupHref = mainAppUrl ? `${mainAppUrl}/signup` : "/signup";

  return (
    <div className="flex flex-col">
      <section className="relative overflow-hidden border-b border-gray-100">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              HR & payroll for companies in the Philippines
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              Plinth is an HRIS that handles payroll, attendance, leave,
              recruitment, and compliance — built for Philippine labor law.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Link
                href={signupHref}
                className="inline-flex items-center justify-center rounded-lg bg-brand-purple px-6 py-3 text-base font-medium text-white hover:bg-brand-purple-hover transition-colors"
              >
                Get Started
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                View features
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-gray-100 bg-gray-50/50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-semibold text-gray-900">
            One platform for HR and payroll
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-gray-600">
            From employee records to payslips — SSS, PhilHealth, Pag-IBIG, and
            withholding tax handled for you.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Payroll",
                description:
                  "Philippine Labor Code compliant. Automatic SSS, PhilHealth, Pag-IBIG, and TRAIN withholding tax.",
              },
              {
                title: "Employee records",
                description:
                  "Profiles, schedules, leave credits, requirements, and document tracking.",
              },
              {
                title: "Recruitment",
                description:
                  "Job postings, applicant tracking, interviews, and hire-to-employee flow.",
              },
              {
                title: "Leave & attendance",
                description:
                  "Leave requests, approvals, balance tracking, and daily encoding.",
              },
              {
                title: "Announcements & chat",
                description:
                  "Memos, acknowledgements, and team chat in one place.",
              },
              {
                title: "Dashboard & reports",
                description:
                  "Overview, statistics, and quick actions for admins and HR.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              href="/features"
              className="text-brand-purple font-medium hover:underline"
            >
              See all features →
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">
            Built for businesses in the Philippines
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-gray-600">
            Whether you&apos;re an SME, startup, or growing team — Plinth
            handles local compliance so you can focus on your people.
          </p>
          <div className="mt-10">
            <Link
              href="/whos-it-for"
              className="text-brand-purple font-medium hover:underline"
            >
              Who&apos;s it for? →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
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
