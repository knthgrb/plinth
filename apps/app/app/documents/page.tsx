"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";

export default function DocumentsRedirectPage() {
  const router = useRouter();
  const { currentOrganizationId, isLoading } = useOrganization();

  useEffect(() => {
    if (isLoading || !currentOrganizationId) return;
    router.replace(getOrganizationPath(currentOrganizationId, "/documents"));
  }, [currentOrganizationId, isLoading, router]);

  return (
    <MainLayout>
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Opening documents...</p>
      </div>
    </MainLayout>
  );
}
