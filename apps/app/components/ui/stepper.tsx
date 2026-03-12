"use client";

import * as React from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/utils/utils";

export interface StepperStep {
  title: string;
  /** Optional icon for in-progress step. Defaults to Circle. */
  icon?: React.ReactNode;
}

interface StepperProps {
  steps: StepperStep[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  const isCompact = steps.length >= 5;
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-start">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;
          const isPending = stepNumber > currentStep;

          return (
            <React.Fragment key={index}>
              {/* Step node */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={cn(
                    "flex items-center justify-center rounded-full border-2 transition-colors",
                    isCompact ? "h-8 w-8" : "h-9 w-9",
                    isCompleted &&
                      "border-emerald-500 bg-emerald-500 text-white",
                    isCurrent &&
                      "border-[#695eff] bg-[#695eff] text-white",
                    isPending &&
                      "border-gray-200 bg-gray-50 text-gray-400",
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" strokeWidth={2.5} />
                  ) : isCurrent ? (
                    step.icon ?? (
                      <Circle className="h-4 w-4" fill="currentColor" />
                    )
                  ) : (
                    <span className="text-sm font-medium">{stepNumber}</span>
                  )}
                </div>
                <div
                  className={cn(
                    "mt-2 text-center min-w-0",
                    isCompact ? "max-w-[85px]" : "max-w-[90px] sm:max-w-[110px]",
                  )}
                >
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Step {stepNumber}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 font-semibold line-clamp-2",
                      isCompact ? "text-xs" : "text-xs sm:text-sm",
                      isCurrent ? "text-[#695eff]" : "text-gray-900",
                    )}
                  >
                    {step.title}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      isCompleted && "text-emerald-600",
                      isCurrent && "text-[#695eff]",
                      isPending && "text-gray-400",
                    )}
                  >
                    {isCompleted ? "Completed" : isCurrent ? "In Progress" : "Pending"}
                  </p>
                </div>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1 mt-4 transition-colors",
                    isCompact ? "min-w-[8px]" : "min-w-[16px] sm:min-w-[24px]",
                    stepNumber < currentStep ? "bg-emerald-500" : "bg-gray-200",
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
