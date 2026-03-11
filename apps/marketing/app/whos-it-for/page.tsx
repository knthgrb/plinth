import Link from "next/link";
import { Building2, Rocket, UserCheck, Landmark } from "lucide-react";

const audiences = [
  {
    title: "SMEs in the Philippines",
    description:
      "Small and medium enterprises running people and operations in-house. Plinth handles Philippine statutory compliance (SSS, PhilHealth, Pag-IBIG, BIR) so you can focus on running your business.",
    icon: Building2,
  },
  {
    title: "Startups",
    description:
      "Growing teams that need structure without spreadsheets. Get people, leave, payroll, and communication in one place from day one.",
    icon: Rocket,
  },
  {
    title: "People & operations",
    description:
      "Managers and admins who need one place for people, attendance, evaluations, recruitment, payroll, and communication — with role-based access for employees and accounting.",
    icon: UserCheck,
  },
  {
    title: "Accounting & finance",
    description:
      "Teams handling payroll, expenses, and Philippine statutory reporting. Plinth supports multiple cutoffs, custom deductions, and compliance-ready payslips.",
    icon: Landmark,
  },
];

export default function WhosItForPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Who&apos;s it for
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Plinth is built for companies in the Philippines that need people, payroll, and operations in one place.
        </p>
      </div>

      <div className="mt-16 grid gap-8 sm:grid-cols-2">
        {audiences.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm hover:border-gray-300 transition-colors"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple mb-4">
                <Icon className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">
                {item.title}
              </h2>
              <p className="mt-3 text-gray-600 leading-relaxed">
                {item.description}
              </p>
            </div>
          );
        })}
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

