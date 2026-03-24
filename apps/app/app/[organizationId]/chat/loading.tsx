"use client";

import { MainLayout } from "@/components/layout/main-layout";

export default function Loading() {
  return (
    <MainLayout>
      <div className="animate-pulse flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden w-full bg-gray-50">
        <aside className="hidden lg:flex w-80 shrink-0 flex-col border-r border-[rgb(230,230,230)] bg-white p-3 space-y-3">
          <div className="h-10 rounded bg-[rgb(245,245,245)]" />
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-[rgb(248,248,248)]" />
          ))}
        </aside>
        <main className="flex-1 p-4 sm:p-6 space-y-4">
          <div className="h-10 w-1/3 rounded bg-[rgb(245,245,245)]" />
          <div className="space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className={`h-10 rounded bg-[rgb(248,248,248)] ${i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto"}`}
              />
            ))}
          </div>
          <div className="h-11 rounded bg-[rgb(245,245,245)]" />
        </main>
      </div>
    </MainLayout>
  );
}
