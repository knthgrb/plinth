"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { PageSkeleton } from "../_components/page-skeleton";

export default function Loading() {
  return (
    <MainLayout>
      <PageSkeleton title="Documents" rows={7} />
    </MainLayout>
  );
}
