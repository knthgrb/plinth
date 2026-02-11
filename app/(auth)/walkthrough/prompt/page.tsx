"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";

export default function WalkthroughPromptPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleYes = () => {
    if (isNavigating) return;
    setIsNavigating(true);
    router.push("/walkthrough/1");
  };

  const handleNo = () => {
    if (isNavigating) return;
    setIsNavigating(true);
    // Navigate to dashboard with organizationId
    if (currentOrganizationId) {
      window.location.href = getOrganizationPath(
        currentOrganizationId,
        "/dashboard",
      );
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Side - Prompt */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-light tracking-tight text-gray-900">
              Do you want a walkthrough of Zen?
            </h1>
          </div>

          <div className="space-y-4">
            <Button
              onClick={handleYes}
              variant="outline"
              className="w-full h-14 text-base font-normal border-2 border-gray-300 hover:border-purple-600 hover:bg-purple-50 text-purple-600"
              disabled={isNavigating}
            >
              Yes, show me around 👑
            </Button>
            <Button
              onClick={handleNo}
              variant="default"
              className="w-full h-14 text-base font-normal bg-brand-purple hover:bg-brand-purple-hover text-white"
              disabled={isNavigating}
            >
              Nah, I'll figure it out 🐰
            </Button>
          </div>
        </div>
      </div>

      {/* Right Side - Image */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50 to-purple-100 items-center justify-center p-12">
        <div className="relative w-full h-full max-w-2xl">
          <div className="absolute inset-0 bg-white rounded-lg shadow-2xl flex items-center justify-center">
            <div className="text-center space-y-4 p-12">
              <div className="text-6xl font-bold text-brand-purple mb-4">
                Zen
              </div>
              <p className="text-gray-600 text-lg">
                Your complete HRIS solution
              </p>
              <div className="grid grid-cols-3 gap-4 mt-8">
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
