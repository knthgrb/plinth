import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Receipt,
  Briefcase,
  Calendar,
  Clock,
  FileText,
  ClipboardList,
  Bell,
  MessageCircle,
  Calculator,
  Package,
} from "lucide-react";

const featureGroups = [
  {
    title: "Human Resources",
    items: [
      {
        name: "Employees",
        description:
          "Complete employee profile management: personal info, employment details, compensation, schedule overrides, leave credits, requirements and document tracking, custom deductions and incentives.",
        icon: Users,
      },
      {
        name: "Attendance",
        description:
          "Daily attendance encoding and tracking for payroll and compliance.",
        icon: Clock,
      },
      {
        name: "Evaluations",
        description:
          "Employee evaluations and performance tracking.",
        icon: FileText,
      },
      {
        name: "Leave",
        description:
          "Leave request filing, multi-level approval workflow, leave balance tracking, leave calendar view, and custom leave types.",
        icon: Calendar,
      },
      {
        name: "Requirements",
        description:
          "Pre-defined Philippine employment requirements, document upload and tracking, status management (pending, submitted, verified), and expiration alerts.",
        icon: ClipboardList,
      },
      {
        name: "Recruitment",
        description:
          "Job posting management, applicant tracking system, interview scheduling, and convert applicant to employee.",
        icon: Briefcase,
      },
    ],
  },
  {
    title: "Finance",
    items: [
      {
        name: "Payroll",
        description:
          "Philippine Labor Code compliant payroll: daily attendance encoding, Philippine holidays (2025–2030), automatic SSS, PhilHealth, Pag-IBIG, withholding tax (TRAIN Law), custom deductions, payroll computation engine, payslips, and multiple cutoff periods.",
        icon: Receipt,
      },
      {
        name: "Accounting",
        description:
          "Accounting and expense management for finance teams.",
        icon: Calculator,
      },
    ],
  },
  {
    title: "Communication",
    items: [
      {
        name: "Announcements",
        description:
          "Rich text memos, target audience selection, acknowledgement tracking, and priority levels.",
        icon: Bell,
      },
      {
        name: "Chat",
        description:
          "Team chat with channels and direct messages.",
        icon: MessageCircle,
      },
    ],
  },
  {
    title: "Dashboard & tools",
    items: [
      {
        name: "Dashboard",
        description:
          "Organization overview, quick statistics, recent activity, and quick actions. Role-based views for admin, HR, employee, and accounting.",
        icon: LayoutDashboard,
      },
      {
        name: "Documents & assets",
        description:
          "Document management and assets tracking.",
        icon: Package,
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Features
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Everything you need to run HR and payroll for your team in the Philippines.
        </p>
      </div>

      <div className="mt-16 space-y-16">
        {featureGroups.map((group) => (
          <div key={group.title}>
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-8">
              {group.title}
            </h2>
            <div className="grid gap-8 sm:grid-cols-2">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.name}
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-gray-300 transition-colors"
                  >
                    <div className="flex gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {item.name}
                        </h3>
                        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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

