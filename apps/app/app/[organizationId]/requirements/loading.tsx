"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout disableInitialLoader>
      <div className="animate-pulse p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 rounded bg-[rgb(240,240,240)]" />
          <div className="h-9 w-32 rounded bg-[rgb(240,240,240)]" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-[rgb(230,230,230)] bg-white p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-[rgb(248,248,248)]" />
            ))}
          </div>
          <div className="rounded-xl border border-[rgb(230,230,230)] bg-white p-4 space-y-3">
            <div className="h-10 w-1/3 rounded bg-[rgb(245,245,245)]" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-[rgb(248,248,248)]" />
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
