"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout disableInitialLoader>
      <div className="animate-pulse p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-44 rounded bg-[rgb(240,240,240)]" />
          <div className="h-9 w-32 rounded bg-[rgb(240,240,240)]" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-44 rounded-xl border border-[rgb(230,230,230)] bg-white"
            />
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
