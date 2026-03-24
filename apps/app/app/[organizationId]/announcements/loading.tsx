"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout>
      <div className="animate-pulse p-4 sm:p-6 lg:p-8 space-y-4 max-w-4xl mx-auto w-full">
        <div className="space-y-2">
          <div className="h-8 w-56 rounded bg-[rgb(240,240,240)]" />
          <div className="h-4 w-80 rounded bg-[rgb(245,245,245)]" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[rgb(230,230,230)] bg-white p-4 space-y-3"
          >
            <div className="h-5 w-1/2 rounded bg-[rgb(245,245,245)]" />
            <div className="h-3 w-2/3 rounded bg-[rgb(248,248,248)]" />
            <div className="h-16 w-full rounded bg-[rgb(248,248,248)]" />
          </div>
        ))}
      </div>
    </MainLayout>
  );
}
