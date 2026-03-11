"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { format } from "date-fns";

export default function AdminPage() {
  const router = useRouter();
  const isSuperAdmin = useQuery(api.demoRequests.isSuperAdmin);
  const demoRequests = useQuery(api.demoRequests.list);

  useEffect(() => {
    const check = async () => {
      const session = await authClient.getSession();
      if (!session?.data) {
        router.replace("/login?redirect=/admin");
        return;
      }
      if (isSuperAdmin === false) {
        router.replace("/forbidden");
      }
    };
    check();
  }, [isSuperAdmin, router]);

  if (isSuperAdmin === undefined || isSuperAdmin === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Checking access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-semibold text-gray-900">
            Plinth Admin
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          Demo requests
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Requests from the marketing site
        </p>

        {demoRequests === null ? (
          <p className="mt-8 text-gray-500">No access.</p>
        ) : demoRequests === undefined ? (
          <p className="mt-8 text-gray-500">Loading...</p>
        ) : demoRequests.length === 0 ? (
          <div className="mt-8 rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            No demo requests yet.
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Company
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {demoRequests.map((req) => (
                  <tr key={req._id}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {format(req.createdAt, "MMM d, yyyy HH:mm")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <a
                        href={`mailto:${req.email}`}
                        className="text-brand-purple hover:underline"
                      >
                        {req.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {req.companyName || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {req.name || "—"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-600">
                      {req.message || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
