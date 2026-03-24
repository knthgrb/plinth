"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { PageSkeleton } from "../_components/page-skeleton";

export default function Loading() {
  return (
    <MainLayout>
      <PageSkeleton title="Announcements" rows={6} showAction={false} />
    </MainLayout>
  );
}
