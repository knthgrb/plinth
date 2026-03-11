import Link from "next/link";
import { BookOpen, GraduationCap, Newspaper, Mail } from "lucide-react";

const resources = [
  {
    id: "docs",
    title: "Documentation",
    description: "Detailed guides and API references for integrating with Plinth.",
    icon: BookOpen,
    status: "Coming soon",
  },
  {
    id: "guides",
    title: "Guides",
    description: "Step-by-step tutorials and best practices for people and operations.",
    icon: GraduationCap,
    status: "Coming soon",
  },
  {
    id: "blog",
    title: "Blog",
    description: "Latest updates and articles on people, payroll, and Philippine compliance.",
    icon: Newspaper,
    status: "Coming soon",
  },
  {
    id: "newsletter",
    title: "Newsletter",
    description: "Subscribe for product updates and tips delivered to your inbox.",
    icon: Mail,
    status: "Coming soon",
  },
];

export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Resources
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Help, learning, and updates for Plinth.
        </p>
      </div>

      <div className="mt-16 grid gap-6 sm:grid-cols-2">
        {resources.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              id={item.id}
              className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {item.title}
                    </h2>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-gray-600">
                    {item.description}
                  </p>
                </div>
              </div>
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

