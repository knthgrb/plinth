"use client";

import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";

const walkthroughSteps = [
  {
    title: "Employees",
    feature: "CORE FEATURE",
    description: "Manage your organization's workforce efficiently.",
    tips: [
      "Add and manage employee information, roles, and departments",
      "Track employee status, attendance, and performance",
      "Create user accounts for employees to access the system",
    ],
  },
  {
    title: "Payroll",
    feature: "CORE FEATURE",
    description: "Streamline payroll processing and payslip generation.",
    tips: [
      "Create payroll runs for different pay periods",
      "Calculate salaries, deductions, and net pay automatically",
      "Generate and send payslips to employees via email or chat",
    ],
  },
  {
    title: "Leave Management",
    feature: "CORE FEATURE",
    description: "Handle leave requests and track employee time off.",
    tips: [
      "Employees can request leave with different types (vacation, sick, etc.)",
      "Managers can approve or reject leave requests",
      "Track leave balances and history for each employee",
    ],
  },
  {
    title: "Attendance",
    feature: "CORE FEATURE",
    description: "Monitor employee attendance and time tracking.",
    tips: [
      "Record daily attendance for employees",
      "View attendance reports and statistics",
      "Track late arrivals and absences",
    ],
  },
];

export default function WalkthroughStepPage() {
  const router = useRouter();
  const params = useParams();
  const { currentOrganizationId } = useOrganization();
  const stepNumber = parseInt(params.step as string) || 1;
  const [currentStep, setCurrentStep] = useState(stepNumber);

  useEffect(() => {
    setCurrentStep(stepNumber);
  }, [stepNumber]);

  const step = walkthroughSteps[currentStep - 1];
  const isLastStep = currentStep === walkthroughSteps.length;

  const handleNext = () => {
    if (isLastStep) {
      // Navigate to dashboard with organizationId
      if (currentOrganizationId) {
        window.location.href = getOrganizationPath(
          currentOrganizationId,
          "/dashboard",
        );
      } else {
        window.location.href = "/dashboard";
      }
    } else {
      router.push(`/walkthrough/${currentStep + 1}`);
    }
  };

  const handleSkip = () => {
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

  if (!step) {
    if (currentOrganizationId) {
      router.push(getOrganizationPath(currentOrganizationId, "/dashboard"));
    } else {
      router.push("/dashboard");
    }
    return null;
  }

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Side - Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-8">
          <div className="space-y-4">
            <div className="text-sm font-medium text-brand-purple uppercase tracking-wide">
              {step.feature}
            </div>
            <h1 className="text-4xl font-light tracking-tight text-gray-900">
              {step.title} ✨
            </h1>
            <p className="text-lg text-gray-600">{step.description}</p>
            <p className="text-gray-600">Here are some tips:</p>
          </div>

          <div className="space-y-4">
            {step.tips.map((tip, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-brand-purple shrink-0" />
                <p className="text-gray-700 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 pt-4">
            <Button
              onClick={handleNext}
              variant="default"
              className="h-12 px-8 text-base font-normal"
            >
              {isLastStep ? "Get Started" : "Next"}
            </Button>
            <Button
              onClick={handleSkip}
              variant="ghost"
              className="h-12 px-8 text-base font-normal"
            >
              Skip walkthrough
            </Button>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 pt-8">
            {walkthroughSteps.map((_, index) => (
              <div
                key={index}
                className={`h-2 flex-1 rounded-full ${
                  index + 1 <= currentStep ? "bg-brand-purple" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Feature Preview */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50 to-purple-100 items-center justify-center p-12">
        <div className="relative w-full h-full max-w-2xl">
          <div className="absolute inset-0 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
            {/* Feature preview mockup */}
            <div className="p-8 h-full flex flex-col">
              <div className="border-b border-gray-200 pb-4 mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {step.title}
                </h2>
              </div>
              <div className="flex-1 space-y-4">
                {step.tips.map((tip, index) => (
                  <div
                    key={index}
                    className="bg-gray-50 rounded-lg p-4 border border-gray-200"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="h-2 w-2 rounded-full bg-brand-purple" />
                      <div className="h-4 w-32 bg-gray-300 rounded animate-pulse" />
                    </div>
                    <div className="h-3 w-full bg-gray-200 rounded animate-pulse" />
                    <div className="h-3 w-3/4 bg-gray-200 rounded animate-pulse mt-2" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
