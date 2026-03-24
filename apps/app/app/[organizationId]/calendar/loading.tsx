"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout disableInitialLoader>
      <div className="animate-pulse p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-40 rounded bg-[rgb(240,240,240)]" />
            <div className="h-4 w-64 rounded bg-[rgb(245,245,245)]" />
          </div>
          <div className="h-9 w-36 rounded bg-[rgb(240,240,240)]" />
        </div>
        <div className="rounded-xl border border-[rgb(230,230,230)] bg-white p-4 space-y-3">
          <div className="h-10 w-full rounded bg-[rgb(246,246,246)]" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-16 rounded bg-[rgb(248,248,248)]" />
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
