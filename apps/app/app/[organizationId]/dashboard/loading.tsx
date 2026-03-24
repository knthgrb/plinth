"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout disableInitialLoader>
      <div className="animate-pulse p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-52 rounded bg-[rgb(240,240,240)]" />
          <div className="h-4 w-72 rounded bg-[rgb(245,245,245)]" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-28 rounded-xl border border-[rgb(230,230,230)] bg-white" />
          <div className="h-28 rounded-xl border border-[rgb(230,230,230)] bg-white" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-64 rounded-xl border border-[rgb(230,230,230)] bg-white" />
          <div className="h-64 rounded-xl border border-[rgb(230,230,230)] bg-white" />
          <div className="h-64 rounded-xl border border-[rgb(230,230,230)] bg-white" />
        </div>
      </div>
    </MainLayout>
  );
}
