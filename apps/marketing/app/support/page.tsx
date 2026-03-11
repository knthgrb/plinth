import Link from "next/link";
import { Mail, MessageCircle, BookOpen, FileQuestion } from "lucide-react";

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Support
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Get help with Plinth. We&apos;re here to support you.
        </p>
      </div>

      <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/request-demo"
          className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple">
            <Mail className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            Request a demo
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            See Plinth in action. We&apos;ll walk you through the platform and answer your questions.
          </p>
        </Link>

        <a
          href="mailto:kennethgarbo0@gmail.com"
          className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple">
            <MessageCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            Contact us
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Reach out directly for questions, feedback, or support.
          </p>
        </a>

        <Link
          href="/resources"
          className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple">
            <BookOpen className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            Resources
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Documentation, guides, and best practices.
          </p>
        </Link>

        <Link
          href="/features"
          className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-gray-300 hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple">
            <FileQuestion className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            Features
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Learn what Plinth can do for your company.
          </p>
        </Link>
      </div>
    </div>
  );
}
