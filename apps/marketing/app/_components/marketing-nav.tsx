"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Receipt,
  Briefcase,
  Calendar,
  MessageCircle,
  BookOpen,
  GraduationCap,
  Newspaper,
  Mail,
  Building2,
  Rocket,
  Landmark,
  UserCheck,
} from "lucide-react";
import { NavPopover } from "./nav-popover";

const featuresItems = [
  {
    title: "Payroll (Philippine Labor Code)",
    description:
      "SSS, PhilHealth, Pag-IBIG, withholding tax. Payslips, cutoffs, and compliance.",
    href: "/features",
    icon: <Receipt className="h-4 w-4" />,
  },
  {
    title: "Employee Records",
    description:
      "Profiles, employment details, schedules, leave credits, and requirements.",
    href: "/features",
    icon: <Users className="h-4 w-4" />,
  },
  {
    title: "Recruitment",
    description:
      "Job postings, applicant tracking, interviews, and hire-to-employee flow.",
    href: "/features",
    icon: <Briefcase className="h-4 w-4" />,
  },
  {
    title: "Leave & Attendance",
    description: "Leave requests, approvals, balance tracking, and encoding.",
    href: "/features",
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    title: "Announcements & Chat",
    description: "Rich memos, target audiences, acknowledgements, and team chat.",
    href: "/features",
    icon: <MessageCircle className="h-4 w-4" />,
  },
  {
    title: "Dashboard & Analytics",
    description: "Overview, statistics, recent activity, and quick actions.",
    href: "/features",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
];

const whosItForItems = [
  {
    title: "SMEs in the Philippines",
    description:
      "Small and medium enterprises managing payroll and HR in-house with local compliance.",
    href: "/whos-it-for",
    icon: <Building2 className="h-4 w-4" />,
  },
  {
    title: "Startups",
    description:
      "Growing teams that need structure without the overhead of spreadsheets.",
    href: "/whos-it-for",
    icon: <Rocket className="h-4 w-4" />,
  },
  {
    title: "HR Teams",
    description:
      "HR managers and admins who need one place for records, payroll, and recruitment.",
    href: "/whos-it-for",
    icon: <UserCheck className="h-4 w-4" />,
  },
  {
    title: "Accounting & Finance",
    description:
      "Teams handling payroll, deductions, and Philippine statutory reporting.",
    href: "/whos-it-for",
    icon: <Landmark className="h-4 w-4" />,
  },
];

const resourcesItems = [
  {
    title: "Documentation",
    description: "API references and integration guides.",
    href: "/resources#docs",
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    title: "Guides",
    description: "Step-by-step tutorials and best practices.",
    href: "/resources#guides",
    icon: <GraduationCap className="h-4 w-4" />,
  },
  {
    title: "Blog",
    description: "Updates and articles on HR and payroll.",
    href: "/resources#blog",
    icon: <Newspaper className="h-4 w-4" />,
  },
  {
    title: "Newsletter",
    description: "Subscribe for product updates and tips.",
    href: "/resources#newsletter",
    icon: <Mail className="h-4 w-4" />,
  },
];

export function MarketingNav() {
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null);

  return (
    <nav className="hidden md:flex items-center gap-8">
      <NavPopover
        label="Features"
        sectionTitle="Product features"
        items={featuresItems}
        popoverId="features"
        isOpen={activePopoverId === "features"}
        onActivate={setActivePopoverId}
        onDeactivate={(id) =>
          setActivePopoverId((prev) => (prev === id ? null : prev))
        }
      />
      <NavPopover
        label="Who's it for"
        sectionTitle="Target audiences"
        items={whosItForItems}
        popoverId="whos-it-for"
        isOpen={activePopoverId === "whos-it-for"}
        onActivate={setActivePopoverId}
        onDeactivate={(id) =>
          setActivePopoverId((prev) => (prev === id ? null : prev))
        }
      />
      <NavPopover
        label="Resources"
        sectionTitle="Help & learning"
        items={resourcesItems}
        popoverId="resources"
        isOpen={activePopoverId === "resources"}
        onActivate={setActivePopoverId}
        onDeactivate={(id) =>
          setActivePopoverId((prev) => (prev === id ? null : prev))
        }
      />
      <Link
        href="/pricing"
        className="text-[15px] font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        Pricing
      </Link>
    </nav>
  );
}

