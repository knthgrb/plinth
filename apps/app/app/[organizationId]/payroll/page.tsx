"use client";

import { Suspense } from "react";
import PayrollPageClient from "./payroll-page-client";

export default function PayrollPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-8 text-gray-500">
          Loading…
        </div>
      }
    >
      <PayrollPageClient />
    </Suspense>
  );
}
