"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { OrganizationManagement } from "@/components/organization-management";

export default function OrganizationsSettingsPage() {
  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Organization Settings
          </h1>
          <p className="text-gray-600 mt-2">Manage your organizations</p>
        </div>

        <OrganizationManagement />
      </div>
    </MainLayout>
  );
}
