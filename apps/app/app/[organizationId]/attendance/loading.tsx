"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { PageSkeleton } from "../_components/page-skeleton";

export default function Loading() {
  return (
    <MainLayout>
      <PageSkeleton title="Attendance" rows={8} />
    </MainLayout>
  );
}
